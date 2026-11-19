export type Temp = 'hot' | 'cold';

export interface Size {
  label: string;
  /** null = السعر لم يحدد بعد، فلا يمكن طلب هذا الحجم */
  price: number | null;
}

export interface Category {
  id: string;
  name: string;
  sort: number;
  visible: boolean;
}

export interface OptionChoice {
  label: string;
  /** سعر إضافي بالريال، 0 إن لم يوجد */
  price: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  multi: boolean;
  coldOnly: boolean;
  /** الخيار المحدد مسبقاً في المجموعات ذات الاختيار الواحد */
  defaultIndex: number;
  options: OptionChoice[];
}

export interface Item {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  sizes: Size[];
  hot: boolean;
  cold: boolean;
  groupIds: string[];
  /** عنوان الحقل النصي الذي يكتبه العميل، مثل «صف قهوتك». فارغ = بلا حقل */
  noteTitle: string;
  available: boolean;
  freeCupEligible: boolean;
  sort: number;
}

export interface Address { street: string; building: string; district: string; city: string; postal: string; additional?: string }

export interface Settings {
  stampMin: number;
  stampsForFree: number;
  pointsPerRiyal: number;
  /** عدد النقاط التي تخصم ريالاً واحداً */
  pointsPerRiyalDiscount: number;
  deliveryEnabled: boolean;
  storeName: string;
  legalName: string;
  crNumber: string;
  vatNumber: string;
  vatEnabled: boolean;
  vatRate: number;
  address: Address;
  phone: string;
  receiptFooter: string;
  invoicePrefix: string;
}

export interface Menu {
  categories: Category[];
  groups: OptionGroup[];
  items: Item[];
  settings: Settings;
}

export type ServiceType = 'dinein' | 'takeaway';
export type Pickup = 'now' | '15' | '30' | 'arrive';

export interface Service {
  type: ServiceType;
  table: number | null;
  tableSource: 'qr' | 'manual' | null;
  /** طلب محلي من خارج المقهى: يبدأ التحضير عند الوصول */
  later: boolean;
  pickup: Pickup;
}

export interface LineChoice {
  groupId: string;
  optionIndexes: number[];
}

export interface CartLine {
  key: string;
  itemId: string;
  sizeIndex: number;
  temp: Temp | null;
  choices: LineChoice[];
  note: string;
  qty: number;
}

export interface FreeCup {
  itemId: string;
  temp: Temp | null;
}

export type PayMethod = 'online' | 'cashier';

export interface OrderInput {
  lines: Omit<CartLine, 'key'>[];
  service: Service;
  payMethod: PayMethod;
  usePoints: boolean;
  freeCup: FreeCup | null;
}

export type OrderStatus =
  | 'awaiting_payment'
  | 'waiting_arrival'
  | 'new'
  | 'preparing'
  | 'ready'
  | 'done'
  | 'cancelled'
  | 'refunded';

export interface OrderLine {
  itemId: string;
  sizeIndex: number;
  name: string;
  sizeLabel: string;
  temp: Temp | null;
  choices: { groupId: string; groupName: string; labels: string[]; optionIndexes: number[] }[];
  note: string;
  qty: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: 'unpaid' | 'paid';
  payMethod: PayMethod;
  serviceType: ServiceType;
  table: number | null;
  later: boolean;
  pickup: Pickup;
  lines: OrderLine[];
  freeCup: { name: string; temp: Temp | null } | null;
  subtotal: number;
  discount: number;
  total: number;
  pointsUsed: number;
  pointsEarned: number;
  qualifies: boolean;
  loyaltySettled: boolean;
  customerPhone: string | null;
  createdAt: string;
  channel: 'online' | 'pos';
  manualDiscount: number;
  discountReason: string;
  createdBy: string | null;
  invoiceId: string | null;
  payments: { method: PayKind; kind: 'sale' | 'refund'; amount: number }[];
}

export type PayKind = 'cash' | 'card' | 'online';
export type Role = 'owner' | 'manager' | 'cashier' | 'barista';

export interface StaffMe { userId: string; name: string; email: string; role: Role }

export interface InvoiceLine { name: string; qty: number; unitIncl: number; incl: number; ex: number; vat: number }

export type ZatcaStatus = 'not_applicable' | 'pending' | 'signed' | 'reported' | 'warning' | 'rejected';

export interface Invoice {
  id: string;
  number: string;
  kind: 'invoice' | 'credit_note';
  refNumber: string | null;
  reason: string;
  issuedAt: string;
  buyerPhone: string | null;
  vatEnabled: boolean;
  vatRate: number;
  seller: { name: string; storeName: string; vatNumber: string; crNumber: string; address: Address; phone: string; footer: string };
  lines: InvoiceLine[];
  discountIncl: number;
  discountEx: number;
  totalEx: number;
  vatAmount: number;
  rounding: number;
  total: number;
  payments: { method: PayKind; amount: number }[];
  orderNumber: string;
  serviceType: ServiceType;
  table: number | null;
  zatcaStatus: ZatcaStatus;
  qr: string | null;
  icv: number | null;
  cashier?: string | null;
  zatcaResponse?: unknown;
  reportedAt: string | null;
}

export interface Shift {
  id: string;
  staffName: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  cashSales: number;
  cardSales: number;
  cashRefunds: number;
  otherRefunds: number;
  cashIn: number;
  cashOut: number;
  orders: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  note: string;
  moves: { kind: 'in' | 'out'; amount: number; reason: string; at: string }[];
}

export interface Loyalty {
  stamps: number;
  points: number;
}

export interface LedgerEntry {
  id: string;
  kind: 'earn' | 'redeem' | 'free_cup' | 'refund' | 'adjust' | 'reverse';
  points: number;
  stamps: number;
  orderNumber: string;
  createdAt: string;
}

export interface Session {
  token: string;
  phone: string;
}

export interface WaiterCall {
  id: string;
  table: number;
  createdAt: string;
}
