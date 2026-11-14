import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api } from './api';
import { OrderError } from './pricing';
import type { Category, Item, Menu, OptionGroup, Order, Settings, WaiterCall } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));

function mapOrder(o: any): Order {
  return {
    ...o,
    subtotal: num(o.subtotal),
    discount: num(o.discount),
    total: num(o.total),
    lines: (o.lines ?? []).map((l: any) => ({ ...l, unitPrice: num(l.unitPrice) })),
  } as Order;
}

const toCategory = (r: any): Category => ({ id: r.id, name: r.name, sort: r.sort, visible: r.visible });
const toGroup = (r: any): OptionGroup => ({
  id: r.id, name: r.name, multi: r.multi, coldOnly: r.cold_only, defaultIndex: r.default_index ?? 0,
  options: (r.options ?? []).map((o: any) => ({ label: o.label, price: num(o.price) })),
});
const toItem = (r: any): Item => ({
  id: r.id, categoryId: r.category_id, name: r.name, description: r.description,
  sizes: (r.sizes ?? []).map((s: any) => ({ label: s.label, price: s.price === null || s.price === '' ? null : Number(s.price) })),
  hot: r.hot, cold: r.cold, groupIds: r.group_ids ?? [], noteTitle: r.note_title,
  available: r.available, freeCupEligible: r.free_cup_eligible, sort: r.sort,
});
const toSettings = (r: any): Settings => ({
  stampMin: num(r.stamp_min), stampsForFree: r.stamps_for_free, pointsPerRiyal: num(r.points_per_riyal),
  pointsPerRiyalDiscount: r.points_per_riyal_discount, deliveryEnabled: r.delivery_enabled,
});

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey);

  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new OrderError(error.message);
    return data as T;
  }
  async function check(p: PromiseLike<{ error: { message: string; code?: string } | null }>): Promise<void> {
    const { error } = await p;
    if (error) throw new OrderError(error.code === '23503' ? 'HAS_ITEMS' : error.message);
  }

  return {
    mode: 'supabase',

    async getMenu(): Promise<Menu> {
      const [c, g, i, s] = await Promise.all([
        sb.from('categories').select('*').order('sort'),
        sb.from('option_groups').select('*').order('name'),
        sb.from('items').select('*').order('sort'),
        sb.from('settings').select('*').eq('id', 1).single(),
      ]);
      const err = c.error ?? g.error ?? i.error ?? s.error;
      if (err) throw new OrderError(err.message);
      return {
        categories: (c.data ?? []).map(toCategory),
        groups: (g.data ?? []).map(toGroup),
        items: (i.data ?? []).map(toItem),
        settings: toSettings(s.data),
      };
    },

    login: (phone, code) => rpc('login_with_phone', { p_phone: phone, p_code: code }),
    me: (token) => rpc('customer_me', { p_token: token }),
    placeOrder: async (token, input) => mapOrder(await rpc('place_order', { p_token: token, p_input: input })),
    getOrder: async (token, id) => mapOrder(await rpc('get_order', { p_token: token, p_id: id })),
    myOrders: async (token) => (await rpc<any[]>('my_orders', { p_token: token })).map(mapOrder),
    markArrived: async (token, id, table) =>
      mapOrder(await rpc('mark_arrived', { p_token: token, p_id: id, p_table: table })),

    async confirmPayment(token, orderId, paymentId) {
      const res = await fetch('/.netlify/functions/confirm-payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, orderId, paymentId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new OrderError(body.error ?? 'PAYMENT');
      return mapOrder(body.order);
    },

    callWaiter: (table) => rpc('call_waiter', { p_table: table }),

    async staffSignedIn() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return false;
      const { data: rows } = await sb.from('staff').select('user_id').limit(1);
      return !!rows && rows.length > 0;
    },
    async staffLogin(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new OrderError(error.message);
      const { data: rows } = await sb.from('staff').select('user_id').limit(1);
      if (!rows || rows.length === 0) {
        await sb.auth.signOut();
        throw new OrderError('NOT_STAFF');
      }
    },
    async staffLogout() {
      await sb.auth.signOut();
    },

    saveCategory: (c) => check(sb.from('categories').upsert({ id: c.id, name: c.name, sort: c.sort, visible: c.visible })),
    deleteCategory: (id) => check(sb.from('categories').delete().eq('id', id)),
    saveGroup: (g) =>
      check(sb.from('option_groups').upsert({ id: g.id, name: g.name, multi: g.multi, cold_only: g.coldOnly, default_index: g.defaultIndex, options: g.options })),
    async deleteGroup(id) {
      const { data, error } = await sb.from('items').select('id, group_ids').contains('group_ids', [id]);
      if (error) throw new OrderError(error.message);
      for (const row of data ?? []) {
        await check(sb.from('items').update({ group_ids: (row.group_ids as string[]).filter((g) => g !== id) }).eq('id', row.id));
      }
      await check(sb.from('option_groups').delete().eq('id', id));
    },
    saveItem: (i) =>
      check(sb.from('items').upsert({
        id: i.id, category_id: i.categoryId, name: i.name, description: i.description, sizes: i.sizes,
        hot: i.hot, cold: i.cold, group_ids: i.groupIds, note_title: i.noteTitle, available: i.available,
        free_cup_eligible: i.freeCupEligible, sort: i.sort,
      })),
    deleteItem: (id) => check(sb.from('items').delete().eq('id', id)),
    saveSettings: (s) =>
      check(sb.from('settings').update({
        stamp_min: s.stampMin, stamps_for_free: s.stampsForFree, points_per_riyal: s.pointsPerRiyal,
        points_per_riyal_discount: s.pointsPerRiyalDiscount, delivery_enabled: s.deliveryEnabled,
      }).eq('id', 1)),

    listOrders: async () => (await rpc<any[]>('staff_orders')).map(mapOrder),
    setOrderStatus: (id, status) => rpc('staff_set_order_status', { p_id: id, p_status: status }),
    markOrderPaid: (id) => rpc('staff_mark_paid', { p_id: id }),
    async listWaiterCalls(): Promise<WaiterCall[]> {
      const { data, error } = await sb.from('waiter_calls').select('*').is('resolved_at', null).order('created_at');
      if (error) throw new OrderError(error.message);
      return (data ?? []).map((r: any) => ({ id: r.id, table: r.table_no, createdAt: r.created_at }));
    },
    resolveWaiterCall: (id) => rpc('staff_resolve_call', { p_id: id }),

    subscribeStaff(cb) {
      const channel = sb
        .channel('staff-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, cb)
        .subscribe();
      // احتياط إن انقطع الاتصال اللحظي
      const t = window.setInterval(cb, 20000);
      return () => {
        window.clearInterval(t);
        void sb.removeChannel(channel);
      };
    },
  };
}
