// الوضع التجريبي: كل البيانات في localStorage. يعمل دون Supabase لتجربة الموقع كاملاً.
import type { Api } from './api';
import {
  OrderError, computeTotals, freeCupReady, initialStatus, loyaltyAfterCancel, loyaltyAfterPayment,
  loyaltyAfterPlacement, normalizePhone, resolveTemp, statusAfterOnlinePayment, unitPrice, validateService,
} from './pricing';
import { seedMenu } from './seed';
import type {
  LedgerEntry, Loyalty, Menu, Order, OrderInput, OrderLine, OrderStatus, WaiterCall,
} from './types';

export const DEMO_OTP = '1234';
const KEY = 'misdar-demo-v1';

interface Db {
  menu: Menu;
  customers: Record<string, Loyalty>;
  sessions: Record<string, string>;
  orders: Order[];
  ledger: (LedgerEntry & { phone: string })[];
  calls: (WaiterCall & { resolved: boolean })[];
  seq: number;
  staff: boolean;
}

function fresh(): Db {
  return { menu: seedMenu(), customers: {}, sessions: {}, orders: [], ledger: [], calls: [], seq: 1001, staff: false };
}

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch { /* تخزين غير متاح: نعمل من الذاكرة */ }
  return fresh();
}

let memory: Db | null = null;
function read(): Db {
  if (!memory) memory = load();
  return memory;
}
function write(db: Db): void {
  memory = db;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch { /* نتجاهل */ }
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const now = () => new Date().toISOString();

export function buildOrder(menu: Menu, loyalty: Loyalty, input: OrderInput, phone: string, seq: number): Order {
  validateService(input.service);
  const lines: OrderLine[] = input.lines.map((l) => {
    const item = menu.items.find((i) => i.id === l.itemId);
    if (!item || !item.available) throw new OrderError('ITEM_UNAVAILABLE');
    const temp = resolveTemp(item, l.temp);
    const unit = unitPrice(item, l.sizeIndex, menu.groups, l.choices, temp);
    const choices = l.choices.flatMap((c) => {
      const g = menu.groups.find((x) => x.id === c.groupId);
      if (!g || !item.groupIds.includes(g.id) || (g.coldOnly && temp !== 'cold')) return [];
      const idx = g.multi ? c.optionIndexes : c.optionIndexes.slice(0, 1);
      return [{ groupId: g.id, groupName: g.name, labels: idx.map((i) => g.options[i].label), optionIndexes: idx }];
    });
    return {
      itemId: item.id,
      sizeIndex: l.sizeIndex,
      name: item.name,
      sizeLabel: item.sizes.length > 1 ? item.sizes[l.sizeIndex].label : '',
      temp,
      choices,
      note: item.noteTitle ? (l.note || '').slice(0, 160) : '',
      qty: Math.max(1, Math.min(50, Math.floor(l.qty))),
      unitPrice: unit,
    };
  });

  let freeCup: Order['freeCup'] = null;
  if (input.freeCup) {
    if (!freeCupReady(loyalty, menu.settings)) throw new OrderError('FREE_NOT_READY');
    const item = menu.items.find((i) => i.id === input.freeCup!.itemId);
    if (!item || !item.freeCupEligible || !item.available) throw new OrderError('FREE_ITEM');
    freeCup = { name: item.name, temp: item.hot && item.cold ? input.freeCup.temp ?? 'hot' : null };
  }
  if (lines.length === 0 && !freeCup) throw new OrderError('EMPTY');

  const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
  const t = computeTotals(subtotal, loyalty, menu.settings, input.usePoints);
  const sv = input.service.type === 'takeaway' ? { ...input.service, table: null } : input.service;
  return {
    id: uid(),
    number: 'M-' + seq,
    status: initialStatus(sv, input.payMethod, t.total),
    paymentStatus: 'unpaid',
    payMethod: input.payMethod,
    serviceType: sv.type,
    table: sv.table,
    later: sv.later,
    pickup: sv.pickup,
    lines,
    freeCup,
    subtotal: t.subtotal,
    discount: t.discount,
    total: t.total,
    pointsUsed: t.pointsUsed,
    pointsEarned: t.pointsToEarn,
    qualifies: t.qualifies,
    loyaltySettled: false,
    customerPhone: phone,
    createdAt: now(),
  };
}

export function createLocalApi(): Api {
  const phoneOf = (db: Db, token: string): string => {
    const phone = db.sessions[token];
    if (!phone) throw new OrderError('AUTH');
    return phone;
  };
  const ledger = (db: Db, phone: string, o: Order, kind: LedgerEntry['kind'], points: number, stamps: number) => {
    db.ledger.unshift({ id: uid(), phone, kind, points, stamps, orderNumber: o.number, createdAt: now() });
  };
  const settle = (db: Db, o: Order) => {
    if (o.loyaltySettled) return;
    const before = db.customers[o.customerPhone];
    const after = loyaltyAfterPayment(before, { pointsEarned: o.pointsEarned, qualifies: o.qualifies, usedFree: !!o.freeCup }, db.menu.settings);
    db.customers[o.customerPhone] = after;
    o.loyaltySettled = true;
    if (o.pointsEarned > 0 || after.stamps > before.stamps) {
      ledger(db, o.customerPhone, o, 'earn', o.pointsEarned, after.stamps - before.stamps);
    }
  };
  const pay = (db: Db, o: Order) => {
    o.paymentStatus = 'paid';
    if (o.status === 'awaiting_payment') {
      o.status = statusAfterOnlinePayment({ type: o.serviceType, table: o.table, pickup: o.pickup });
    }
    settle(db, o);
  };
  const find = (db: Db, id: string): Order => {
    const o = db.orders.find((x) => x.id === id);
    if (!o) throw new OrderError('NOT_FOUND');
    return o;
  };
  const upsert = <T extends { id: string }>(list: T[], v: T) => {
    const i = list.findIndex((x) => x.id === v.id);
    if (i >= 0) list[i] = v;
    else list.push(v);
  };

  return {
    mode: 'demo',

    async getMenu() {
      return structuredClone(read().menu);
    },

    async login(phone, code) {
      const p = normalizePhone(phone);
      if (code !== DEMO_OTP) throw new OrderError('BAD_CODE');
      const db = read();
      db.customers[p] ??= { stamps: 0, points: 0 };
      const token = uid();
      db.sessions[token] = p;
      write(db);
      return { token, phone: p };
    },

    async me(token) {
      const db = read();
      const phone = phoneOf(db, token);
      return {
        loyalty: { ...db.customers[phone] },
        history: db.ledger.filter((l) => l.phone === phone).slice(0, 20),
      };
    },

    async placeOrder(token, input) {
      const db = read();
      const phone = phoneOf(db, token);
      const loyalty = db.customers[phone];
      const order = buildOrder(db.menu, loyalty, input, phone, db.seq);
      db.seq += 1;
      db.customers[phone] = loyaltyAfterPlacement(
        loyalty,
        { subtotal: order.subtotal, discount: order.discount, pointsUsed: order.pointsUsed, total: order.total, qualifies: order.qualifies, pointsToEarn: order.pointsEarned },
        !!order.freeCup,
      );
      if (order.pointsUsed > 0) ledger(db, phone, order, 'redeem', -order.pointsUsed, 0);
      if (order.freeCup) ledger(db, phone, order, 'free_cup', 0, -db.menu.settings.stampsForFree);
      db.orders.unshift(order);
      if (order.total === 0) pay(db, order);
      write(db);
      return structuredClone(order);
    },

    async getOrder(token, id) {
      const db = read();
      const phone = phoneOf(db, token);
      const o = find(db, id);
      if (o.customerPhone !== phone) throw new OrderError('NOT_FOUND');
      return structuredClone(o);
    },

    async myOrders(token) {
      const db = read();
      const phone = phoneOf(db, token);
      return structuredClone(db.orders.filter((o) => o.customerPhone === phone).slice(0, 10));
    },

    async markArrived(token, id, table) {
      const db = read();
      const phone = phoneOf(db, token);
      const o = find(db, id);
      if (o.customerPhone !== phone) throw new OrderError('NOT_FOUND');
      if (o.status === 'waiting_arrival') {
        if (o.serviceType === 'dinein') {
          if (table == null) throw new OrderError('TABLE_REQUIRED');
          o.table = table;
        }
        o.status = 'new';
        write(db);
      }
      return structuredClone(o);
    },

    async confirmPayment(token, orderId) {
      // في الوضع التجريبي لا يوجد خادم يتحقق من ميسر، فنعتمد الدفع مباشرة.
      const db = read();
      phoneOf(db, token);
      const o = find(db, orderId);
      if (o.paymentStatus !== 'paid') pay(db, o);
      write(db);
      return structuredClone(o);
    },

    async callWaiter(table) {
      const db = read();
      if (!db.calls.some((c) => c.table === table && !c.resolved)) {
        db.calls.unshift({ id: uid(), table, createdAt: now(), resolved: false });
        write(db);
      }
    },

    async staffSignedIn() {
      return read().staff;
    },
    async staffLogin() {
      const db = read();
      db.staff = true;
      write(db);
    },
    async staffLogout() {
      const db = read();
      db.staff = false;
      write(db);
    },

    async saveCategory(c) {
      const db = read();
      upsert(db.menu.categories, c);
      write(db);
    },
    async deleteCategory(id) {
      const db = read();
      if (db.menu.items.some((i) => i.categoryId === id)) throw new OrderError('HAS_ITEMS');
      db.menu.categories = db.menu.categories.filter((c) => c.id !== id);
      write(db);
    },
    async saveGroup(g) {
      const db = read();
      upsert(db.menu.groups, g);
      write(db);
    },
    async deleteGroup(id) {
      const db = read();
      db.menu.groups = db.menu.groups.filter((g) => g.id !== id);
      db.menu.items.forEach((i) => { i.groupIds = i.groupIds.filter((g) => g !== id); });
      write(db);
    },
    async saveItem(i) {
      const db = read();
      upsert(db.menu.items, i);
      write(db);
    },
    async deleteItem(id) {
      const db = read();
      db.menu.items = db.menu.items.filter((i) => i.id !== id);
      write(db);
    },
    async saveSettings(s) {
      const db = read();
      db.menu.settings = s;
      write(db);
    },

    async listOrders() {
      return structuredClone(read().orders.slice(0, 60));
    },
    async setOrderStatus(id, status: OrderStatus) {
      const db = read();
      const o = find(db, id);
      if (status === 'cancelled' && o.status !== 'cancelled' && !o.loyaltySettled) {
        db.customers[o.customerPhone] = loyaltyAfterCancel(
          db.customers[o.customerPhone], { pointsUsed: o.pointsUsed, usedFree: !!o.freeCup }, db.menu.settings,
        );
        if (o.pointsUsed > 0 || o.freeCup) {
          ledger(db, o.customerPhone, o, 'refund', o.pointsUsed, o.freeCup ? db.menu.settings.stampsForFree : 0);
        }
      }
      o.status = status;
      if (status === 'done' && o.paymentStatus !== 'paid') pay(db, o);
      write(db);
    },
    async markOrderPaid(id) {
      const db = read();
      const o = find(db, id);
      if (o.paymentStatus !== 'paid') pay(db, o);
      write(db);
    },
    async listWaiterCalls() {
      return read().calls.filter((c) => !c.resolved).map(({ id, table, createdAt }) => ({ id, table, createdAt }));
    },
    async resolveWaiterCall(id) {
      const db = read();
      const c = db.calls.find((x) => x.id === id);
      if (c) c.resolved = true;
      write(db);
    },
    subscribeStaff(cb) {
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          memory = null;
          cb();
        }
      };
      window.addEventListener('storage', onStorage);
      const t = window.setInterval(cb, 4000);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.clearInterval(t);
      };
    },
  };
}
