import { describe, expect, it } from 'vitest';
import {
  computeTotals, initialStatus, loyaltyAfterCancel, loyaltyAfterPayment, loyaltyAfterPlacement,
  needsArrival, normalizePhone, statusAfterOnlinePayment,
} from './pricing';
import { seedMenu } from './seed';
import type { Service } from './types';

const menu = seedMenu();
const s = menu.settings;
const table4: Service = { type: 'dinein', table: 4, tableSource: 'qr', later: false, pickup: 'now' };
const remote: Service = { type: 'takeaway', table: null, tableSource: null, later: false, pickup: 'now' };

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
