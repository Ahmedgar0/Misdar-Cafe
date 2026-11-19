// منطق التسعير والمكافآت. دوال نقية يستخدمها الوضع التجريبي والواجهة،
// وتطابقها دوال قاعدة البيانات في supabase/schema.sql (يتحقق منها schema.test.ts).
import type {
  Item, LineChoice, Loyalty, Menu, OptionGroup, OrderStatus, PayMethod, Service, Settings, Temp,
} from './types';

export class OrderError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const ERROR_TEXT: Record<string, string> = {
  AUTH: 'انتهت جلستك. سجّل الدخول من جديد.',
  BAD_CODE: 'رمز التحقق غير صحيح.',
  BAD_PHONE: 'اكتب رقم جوال سعودياً يبدأ بـ 05.',
  EMPTY: 'سلتك فارغة.',
  TABLE_REQUIRED: 'حدد طاولتك أولاً.',
  ITEM_UNAVAILABLE: 'أحد الأصناف لم يعد متاحاً. احذفه من السلة.',
  SIZE: 'أحد الأحجام بلا سعر بعد.',
  TEMP: 'اختر ساخن أو بارد.',
  OPTION: 'أحد الخيارات لم يعد موجوداً. أعد إضافة الصنف.',
  FREE_NOT_READY: 'لم تكتمل أختامك بعد.',
  FREE_ITEM: 'هذا الصنف غير مشمول بالكوب المجاني.',
  NOT_FOUND: 'الطلب غير موجود.',
  AMOUNT: 'مبلغ الدفع لا يطابق الطلب.',
  NOT_STAFF: 'هذا الحساب ليس من حسابات الموظفين.',
  HAS_ITEMS: 'القسم يحتوي أصنافاً. انقلها أولاً.',
  NO_SHIFT: 'افتح وردية أولاً من صفحة الورديات أو من الكاشير.',
  SHIFT_OPEN: 'لديك وردية مفتوحة بالفعل.',
  TENDERED: 'المبلغ المستلم أقل من المطلوب نقداً.',
  UNPAID: 'الطلب لم يُدفع بعد. سجّل الدفع أولاً.',
  FORBIDDEN: 'صلاحيتك لا تسمح بهذه العملية.',
  REASON: 'اكتب السبب.',
  PAID_REFUND: 'الطلب مدفوع: استخدم الاسترجاع بدل الإلغاء.',
  CLOSED: 'الطلب مغلق.',
  CANCELLED: 'الطلب ملغى.',
  VAT_NUMBER: 'الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بالرقم 3.',
  NO_USER: 'لا يوجد حساب بهذا البريد.',
  LAST_OWNER: 'يجب أن يبقى مالك واحد نشط على الأقل.',
  ROLE: 'اختر دوراً صحيحاً.',
  BAD_LOGIN: 'البريد أو كلمة المرور غير صحيحة.',
  DEMO_ONLY: 'هذه الخاصية تعمل بعد النشر فقط، لأنها تحتاج الخادم.',
  EMAIL_TAKEN: 'البريد مستخدم لحساب آخر.',
  EMAIL: 'اكتب بريداً صحيحاً.',
  PASSWORD: 'كلمة المرور 8 أحرف على الأقل.',
  OTP: 'رمز التفعيل 6 أرقام من بوابة فاتورة.',
  BUSY: 'عملية توقيع أخرى جارية. حاول بعد ثوانٍ.',
  CONFIG: 'متغيرات الخادم ناقصة في إعدادات Netlify.',
  SERVICE: 'اختر طريقة الطلب.',
  PAY: 'طريقة الدفع غير صحيحة.',
};

export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const code = Object.keys(ERROR_TEXT).find((k) => raw.includes(k));
  return code ? ERROR_TEXT[code] : 'تعذر تنفيذ العملية. حاول مرة أخرى.';
}

/** يحوّل 05XXXXXXXX إلى الصيغة الدولية +9665XXXXXXXX */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  let local = digits;
  if (local.startsWith('966')) local = local.slice(3);
  if (local.startsWith('0')) local = local.slice(1);
  if (!/^5\d{8}$/.test(local)) throw new OrderError('BAD_PHONE');
  return '+966' + local;
}

/** هل الخيار ظاهر لهذا الصنف بهذه الحرارة؟ */
export function groupApplies(item: Item, group: OptionGroup, temp: Temp | null): boolean {
  if (!item.groupIds.includes(group.id)) return false;
  if (group.coldOnly && temp !== 'cold') return false;
  return true;
}

export function resolveTemp(item: Item, temp: Temp | null): Temp | null {
  if (item.hot && item.cold) {
    if (temp !== 'hot' && temp !== 'cold') throw new OrderError('TEMP');
    return temp;
  }
  return null;
}

export function unitPrice(
  item: Item, sizeIndex: number, groups: OptionGroup[], choices: LineChoice[], temp: Temp | null,
): number {
  const size = item.sizes[sizeIndex];
  if (!size || size.price == null) throw new OrderError('SIZE');
  let price = size.price;
  for (const c of choices) {
    const g = groups.find((x) => x.id === c.groupId);
    if (!g || !groupApplies(item, g, temp)) continue;
    const picked = g.multi ? c.optionIndexes : c.optionIndexes.slice(0, 1);
    for (const i of picked) {
      const opt = g.options[i];
      if (!opt) throw new OrderError('OPTION');
      price += opt.price || 0;
    }
  }
  return price;
}

export interface Totals {
  subtotal: number;
  discount: number;
  pointsUsed: number;
  total: number;
  qualifies: boolean;
  pointsToEarn: number;
}

export function computeTotals(subtotal: number, loyalty: Loyalty, s: Settings, usePoints: boolean): Totals {
  const maxDiscount = Math.floor(loyalty.points / s.pointsPerRiyalDiscount);
  const discount = usePoints ? Math.min(maxDiscount, Math.floor(subtotal)) : 0;
  const total = subtotal - discount;
  return {
    subtotal,
    discount,
    pointsUsed: discount * s.pointsPerRiyalDiscount,
    total,
    qualifies: total >= s.stampMin,
    pointsToEarn: Math.floor(total * s.pointsPerRiyal),
  };
}

export function freeCupReady(loyalty: Loyalty, s: Settings): boolean {
  return loyalty.stamps >= s.stampsForFree;
}

/** عند إرسال الطلب: تُخصم النقاط المستخدمة ويُستهلك الكوب المجاني */
export function loyaltyAfterPlacement(l: Loyalty, t: Totals, usedFree: boolean): Loyalty {
  return { points: l.points - t.pointsUsed, stamps: usedFree ? 0 : l.stamps };
}

/** عند تأكيد الدفع: تُضاف النقاط والختم */
export function loyaltyAfterPayment(
  l: Loyalty, o: { pointsEarned: number; qualifies: boolean; usedFree: boolean }, s: Settings,
): Loyalty {
  const stamp = o.qualifies && !o.usedFree && l.stamps < s.stampsForFree;
  return { points: l.points + o.pointsEarned, stamps: l.stamps + (stamp ? 1 : 0) };
}

/** عند إلغاء طلب لم يُدفع: تُعاد النقاط والكوب المجاني */
export function loyaltyAfterCancel(
  l: Loyalty, o: { pointsUsed: number; usedFree: boolean }, s: Settings,
): Loyalty {
  return { points: l.points + o.pointsUsed, stamps: o.usedFree ? s.stampsForFree : l.stamps };
}

/** طلب لا يُحضَّر قبل تأكيد وصول العميل */
export function needsArrival(sv: Pick<Service, 'type' | 'table' | 'pickup'>, pay: PayMethod): boolean {
  if (sv.table != null) return false;
  return sv.type === 'dinein' || sv.pickup === 'arrive' || pay === 'cashier';
}

export function initialStatus(sv: Service, pay: PayMethod, total: number): OrderStatus {
  if (pay === 'online' && total > 0) return 'awaiting_payment';
  return needsArrival(sv, pay) ? 'waiting_arrival' : 'new';
}

export function statusAfterOnlinePayment(sv: Pick<Service, 'type' | 'table' | 'pickup'>): OrderStatus {
  return needsArrival(sv, 'online') ? 'waiting_arrival' : 'new';
}

export function validateService(sv: Service): void {
  if (sv.type !== 'dinein' && sv.type !== 'takeaway') throw new OrderError('SERVICE');
  if (sv.type === 'dinein' && sv.table == null && !sv.later) throw new OrderError('TABLE_REQUIRED');
}

export function findItem(menu: Menu, id: string): Item | undefined {
  return menu.items.find((i) => i.id === id);
}
