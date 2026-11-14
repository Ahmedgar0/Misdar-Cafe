import type {
  Category, Item, LedgerEntry, Loyalty, Menu, OptionGroup, Order, OrderInput, OrderStatus, Session, Settings, WaiterCall,
} from './types';
import { createLocalApi } from './api.local';
import { createSupabaseApi } from './api.supabase';

export interface Api {
  /** demo = بيانات محفوظة في المتصفح فقط، بلا خادم */
  mode: 'demo' | 'supabase';

  getMenu(): Promise<Menu>;

  // العميل
  login(phone: string, code: string): Promise<Session>;
  me(token: string): Promise<{ loyalty: Loyalty; history: LedgerEntry[] }>;
  placeOrder(token: string, input: OrderInput): Promise<Order>;
  getOrder(token: string, id: string): Promise<Order>;
  myOrders(token: string): Promise<Order[]>;
  markArrived(token: string, id: string, table: number | null): Promise<Order>;
  confirmPayment(token: string, orderId: string, paymentId: string): Promise<Order>;
  callWaiter(table: number): Promise<void>;

  // الموظفون
  staffSignedIn(): Promise<boolean>;
  staffLogin(email: string, password: string): Promise<void>;
  staffLogout(): Promise<void>;
  saveCategory(c: Category): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  saveGroup(g: OptionGroup): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  saveItem(i: Item): Promise<void>;
  deleteItem(id: string): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  listOrders(): Promise<Order[]>;
  setOrderStatus(id: string, status: OrderStatus): Promise<void>;
  markOrderPaid(id: string): Promise<void>;
  listWaiterCalls(): Promise<WaiterCall[]>;
  resolveWaiterCall(id: string): Promise<void>;
  /** يستدعي cb عند تغير الطلبات أو النداءات. يعيد دالة الإلغاء */
  subscribeStaff(cb: () => void): () => void;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const api: Api = url && key ? createSupabaseApi(url, key) : createLocalApi();

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
