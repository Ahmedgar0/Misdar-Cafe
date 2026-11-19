// طبقة البيانات: كل العمليات دوال في قاعدة البيانات (RPC) تُستدعى بالطريقة نفسها في الإنتاج والوضع التجريبي.
// الإنتاج: Supabase. الوضع التجريبي: قاعدة Postgres نفسها (PGlite) داخل المتصفح بالملفين ذاتهما.
import { OrderError } from './pricing';
import type { LedgerEntry, Loyalty, Menu, Order, OrderInput, Invoice, Session, StaffMe } from './types';

export interface Transport {
  mode: 'demo' | 'supabase';
  rpc<T>(fn: string, args: Record<string, unknown>, asStaff: boolean): Promise<T>;
  staffSession(): Promise<StaffMe | null>;
  staffLogin(email: string, password: string): Promise<StaffMe>;
  staffLogout(): Promise<void>;
  /** دالة خادم (Netlify) بجلسة الموظف */
  fn<T>(name: string, body: object): Promise<T>;
  confirmPayment(token: string, orderId: string, paymentId: string): Promise<Order>;
  subscribe(cb: () => void): () => void;
  /** حسابات الدخول التجريبية (الوضع التجريبي فقط) */
  demoAccounts?: { email: string; name: string; role: string }[];
}

let transport: Promise<Transport> | null = null;
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const mode: 'demo' | 'supabase' = url && key ? 'supabase' : 'demo';

function t(): Promise<Transport> {
  if (!transport) {
    transport = mode === 'supabase'
      ? import('./api.supabase').then((m) => m.createSupabaseTransport(url!, key!))
      : import('./api.demo').then((m) => m.createDemoTransport());
  }
  return transport;
}

const anon = async <T>(fn: string, args: Record<string, unknown> = {}) => (await t()).rpc<T>(fn, args, false);

export const api = {
  mode,
  ready: () => t(),

  // ─── العميل ───
  getMenu: () => anon<Menu>('get_menu'),
  login: (phone: string, code: string) => anon<Session>('login_with_phone', { p_phone: phone, p_code: code }),
  me: (token: string) => anon<{ loyalty: Loyalty; history: LedgerEntry[] }>('customer_me', { p_token: token }),
  placeOrder: (token: string, input: OrderInput) => anon<Order>('place_order', { p_token: token, p_input: input }),
  getOrder: (token: string, id: string) => anon<Order>('get_order', { p_token: token, p_id: id }),
  myOrders: (token: string) => anon<Order[]>('my_orders', { p_token: token }),
  markArrived: (token: string, id: string, table: number | null) => anon<Order>('mark_arrived', { p_token: token, p_id: id, p_table: table }),
  callWaiter: (table: number) => anon<void>('call_waiter', { p_table: table }),
  getInvoice: (id: string) => anon<Invoice | null>('get_invoice', { p_id: id }),
  confirmPayment: async (token: string, orderId: string, paymentId: string) => (await t()).confirmPayment(token, orderId, paymentId),

  // ─── الموظفون ───
  staff: {
    session: async () => (await t()).staffSession(),
    login: async (email: string, password: string) => (await t()).staffLogin(email, password),
    logout: async () => (await t()).staffLogout(),
    rpc: async <T>(fn: string, args: Record<string, unknown> = {}) => (await t()).rpc<T>(fn, args, true),
    fn: async <T>(name: string, body: object) => (await t()).fn<T>(name, body),
    subscribe: (cb: () => void) => {
      let off: (() => void) | null = null;
      let dead = false;
      void t().then((x) => { if (!dead) off = x.subscribe(cb); });
      return () => { dead = true; off?.(); };
    },
  },
};

export function demoOnly(): never {
  throw new OrderError('DEMO_ONLY');
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
