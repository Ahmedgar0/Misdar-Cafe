import { describe, expect, it } from 'vitest';
import { buildOrder } from './api.local';
import {
  computeTotals, initialStatus, loyaltyAfterCancel, loyaltyAfterPayment, loyaltyAfterPlacement,
  needsArrival, normalizePhone, statusAfterOnlinePayment,
} from './pricing';
import { seedMenu } from './seed';
import type { OrderInput, Service } from './types';

const menu = seedMenu();
const s = menu.settings;
const table4: Service = { type: 'dinein', table: 4, tableSource: 'qr', later: false, pickup: 'now' };
const remote: Service = { type: 'takeaway', table: null, tableSource: null, later: false, pickup: 'now' };
const line = (itemId: string, sizeIndex = 0, extra = {}) => ({ itemId, sizeIndex, temp: null, choices: [], note: '', qty: 1, ...extra });
const input = (over: Partial<OrderInput>): OrderInput => ({ lines: [], service: table4, payMethod: 'cashier', usePoints: false, freeCup: null, ...over });

describe('الهاتف', () => {
  it('يوحّد الصيغ', () => {
    expect(normalizePhone('0512345678')).toBe('+966512345678');
    expect(normalizePhone('+966 51 234 5678')).toBe('+966512345678');
    expect(() => normalizePhone('12345')).toThrow('BAD_PHONE');
  });
});

describe('الأختام والنقاط', () => {
  it('الحد الأدنى للختم 6 ريالات بعد الخصم', () => {
    expect(computeTotals(5, { stamps: 0, points: 0 }, s, false).qualifies).toBe(false);
    expect(computeTotals(6, { stamps: 0, points: 0 }, s, false).qualifies).toBe(true);
    // 7 ريالات ناقص خصم ريالين = 5، فلا ختم
    expect(computeTotals(7, { stamps: 0, points: 40 }, s, true)).toMatchObject({ discount: 2, pointsUsed: 40, total: 5, qualifies: false });
  });
  it('كل 20 نقطة بريال، ولا يتجاوز الخصم قيمة الطلب', () => {
    expect(computeTotals(19, { stamps: 0, points: 140 }, s, true)).toMatchObject({ discount: 7, pointsUsed: 140, total: 12, pointsToEarn: 12 });
    expect(computeTotals(3, { stamps: 0, points: 140 }, s, true)).toMatchObject({ discount: 3, pointsUsed: 60, total: 0 });
  });
  it('ثلاثة طلبات مؤهلة ثم كوب مجاني في الرابع، ثم بطاقة جديدة', () => {
    let l = { stamps: 0, points: 0 };
    for (let i = 0; i < 3; i++) {
      const t = computeTotals(9, l, s, false);
      l = loyaltyAfterPlacement(l, t, false);
      l = loyaltyAfterPayment(l, { pointsEarned: t.pointsToEarn, qualifies: t.qualifies, usedFree: false }, s);
    }
    expect(l).toEqual({ stamps: 3, points: 27 });
    // طلب خامس دون اختيار الكوب: الأختام لا تتجاوز 3
    const extra = computeTotals(9, l, s, false);
    expect(loyaltyAfterPayment(l, { pointsEarned: extra.pointsToEarn, qualifies: true, usedFree: false }, s).stamps).toBe(3);
    // الطلب الرابع بالكوب المجاني
    const t4 = computeTotals(9, l, s, false);
    l = loyaltyAfterPlacement(l, t4, true);
    expect(l.stamps).toBe(0);
    l = loyaltyAfterPayment(l, { pointsEarned: t4.pointsToEarn, qualifies: true, usedFree: true }, s);
    expect(l).toEqual({ stamps: 0, points: 36 });
  });
  it('الإلغاء يعيد النقاط والكوب المجاني', () => {
    expect(loyaltyAfterCancel({ stamps: 0, points: 10 }, { pointsUsed: 40, usedFree: true }, s)).toEqual({ stamps: 3, points: 50 });
  });
});

describe('حالات الطلب', () => {
  it('رمز الطاولة: تحضير فوري', () => {
    expect(needsArrival(table4, 'cashier')).toBe(false);
    expect(initialStatus(table4, 'cashier', 9)).toBe('new');
    expect(initialStatus(table4, 'online', 9)).toBe('awaiting_payment');
    expect(statusAfterOnlinePayment(table4)).toBe('new');
  });
  it('من الخارج: الدفع عند الكاشير أو «عند وصولي» ينتظر الوصول', () => {
    expect(initialStatus(remote, 'cashier', 9)).toBe('waiting_arrival');
    expect(statusAfterOnlinePayment(remote)).toBe('new');
    expect(statusAfterOnlinePayment({ ...remote, pickup: 'arrive' })).toBe('waiting_arrival');
  });
  it('محلي من الخارج ينتظر الوصول حتى مع الدفع الإلكتروني', () => {
    const later: Service = { type: 'dinein', table: null, tableSource: null, later: true, pickup: 'now' };
    expect(statusAfterOnlinePayment(later)).toBe('waiting_arrival');
  });
});

describe('بناء الطلب', () => {
  const l0 = { stamps: 0, points: 0 };
  it('يسعّر من القائمة لا من العميل', () => {
    const o = buildOrder(menu, l0, input({ lines: [line('i-cappuccino', 1), line('i-luqaimat', 1)] }), '+966500000000', 1001);
    expect(o.total).toBe(19);
    expect(o.lines[0]).toMatchObject({ name: 'كابتشينو', sizeLabel: 'كبير', unitPrice: 9 });
  });
  it('يرفض المحلي بلا طاولة، والحجم بلا سعر، والبارد دون اختيار', () => {
    const noTable: Service = { type: 'dinein', table: null, tableSource: null, later: false, pickup: 'now' };
    expect(() => buildOrder(menu, l0, input({ service: noTable, lines: [line('i-latte')] }), 'p', 1)).toThrow('TABLE_REQUIRED');
    expect(() => buildOrder(menu, l0, input({ lines: [line('i-jebena', 2)] }), 'p', 1)).toThrow('SIZE');
    expect(() => buildOrder(menu, l0, input({ lines: [line('i-cod')] }), 'p', 1)).toThrow('TEMP');
  });
  it('الثلج يظهر مع البارد فقط، ووصف القهوة يُحفظ', () => {
    const hot = buildOrder(menu, l0, input({ lines: [line('i-cod', 0, { temp: 'hot', choices: [{ groupId: 'g-ice', optionIndexes: [1] }] })] }), 'p', 1);
    expect(hot.lines[0].choices).toEqual([]);
    const cold = buildOrder(menu, l0, input({ lines: [line('i-cod', 0, { temp: 'cold', choices: [{ groupId: 'g-ice', optionIndexes: [1] }] })] }), 'p', 1);
    expect(cold.lines[0].choices[0].labels).toEqual(['ثلج قليل']);
    const j = buildOrder(menu, l0, input({ lines: [line('i-jebena', 0, { note: 'زنجبيل زيادة' })] }), 'p', 1);
    expect(j.lines[0].note).toBe('زنجبيل زيادة');
  });
  it('الكوب المجاني يحتاج 3 أختام وصنفاً مشمولاً', () => {
    expect(() => buildOrder(menu, { stamps: 2, points: 0 }, input({ freeCup: { itemId: 'i-jebena', temp: null } }), 'p', 1)).toThrow('FREE_NOT_READY');
    expect(() => buildOrder(menu, { stamps: 3, points: 0 }, input({ freeCup: { itemId: 'i-latte', temp: null } }), 'p', 1)).toThrow('FREE_ITEM');
    const o = buildOrder(menu, { stamps: 3, points: 0 }, input({ freeCup: { itemId: 'i-cod', temp: 'cold' } }), 'p', 1);
    expect(o.freeCup).toEqual({ name: 'قهوة اليوم', temp: 'cold' });
    expect(o.total).toBe(0);
    expect(o.status).toBe('new');
  });
});
