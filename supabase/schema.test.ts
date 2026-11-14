// يشغّل schema.sql على Postgres حقيقي (PGlite) ويتحقق أن دوال القاعدة تطابق منطق pricing.ts.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const ids: Record<string, string> = {};

async function rpc<T = any>(fn: string, ...args: unknown[]): Promise<T> {
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  const r = await db.query<{ v: T }>(`select ${fn}(${ph}) as v`, args);
  return r.rows[0].v;
}
const asStaff = (on: boolean) => db.exec(`select set_config('test.uid', '${on ? '00000000-0000-0000-0000-000000000001' : ''}', false)`);

beforeAll(async () => {
  db = new PGlite();
  // ما يوفره Supabase جاهزاً: الأدوار ودالة auth.uid()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  `);
  await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into staff values ('00000000-0000-0000-0000-000000000001')`);
  const items = await db.query<{ id: string; name: string }>('select id, name from items');
  for (const r of items.rows) ids[r.name] = r.id;
  const groups = await db.query<{ id: string; name: string }>('select id, name from option_groups');
  for (const r of groups.rows) ids['g:' + r.name] = r.id;
});

const table4 = { type: 'dinein', table: 4, later: false, pickup: 'now' };
const remote = { type: 'takeaway', table: null, later: false, pickup: 'now' };
const line = (name: string, sizeIndex = 0, extra = {}) => ({ itemId: ids[name], sizeIndex, temp: null, choices: [], note: '', qty: 1, ...extra });
const input = (over: object) => JSON.stringify({ lines: [], service: table4, payMethod: 'cashier', usePoints: false, freeCup: null, ...over });

async function login(phone: string): Promise<string> {
  return (await rpc<{ token: string }>('login_with_phone', phone, '1234')).token;
}
const loyalty = async (token: string) => (await rpc('customer_me', token)).loyalty;

describe('schema.sql', () => {
  it('يزرع القائمة: 15 صنفاً و3 أقسام', async () => {
    const r = await db.query<{ i: number; c: number }>('select (select count(*)::int from items) i, (select count(*)::int from categories) c');
    expect(r.rows[0]).toEqual({ i: 15, c: 3 });
  });

  it('الدخول: يرفض الرمز الخاطئ والرقم غير السعودي', async () => {
    await expect(rpc('login_with_phone', '0512345678', '0000')).rejects.toThrow('BAD_CODE');
    await expect(rpc('login_with_phone', '12345', '1234')).rejects.toThrow('BAD_PHONE');
    const s = await rpc('login_with_phone', '0512345678', '1234');
    expect(s.phone).toBe('+966512345678');
  });

  it('التسعير من القاعدة، والأختام بعد الدفع فقط', async () => {
    const t = await login('0500000001');
    const o = await rpc('place_order', t, input({ lines: [line('كابتشينو', 1), line('لقيمات', 1)] }));
    expect(Number(o.total)).toBe(19);
    expect(o.status).toBe('new');
    expect(await loyalty(t)).toEqual({ stamps: 0, points: 0 });
    await asStaff(true);
    await rpc('staff_set_order_status', o.id, 'done');
    await asStaff(false);
    expect(await loyalty(t)).toEqual({ stamps: 1, points: 19 });
  });

  it('طلب أقل من 6 ريالات لا يكسب ختماً', async () => {
    const t = await login('0500000002');
    const o = await rpc('place_order', t, input({ lines: [line('إسبريسو')] }));
    await asStaff(true);
    await rpc('staff_mark_paid', o.id);
    await asStaff(false);
    expect(await loyalty(t)).toEqual({ stamps: 0, points: 4 });
  });

  it('الطلب الرابع: كوب مجاني ثم بطاقة جديدة، والإلغاء يعيده', async () => {
    const t = await login('0500000003');
    await asStaff(true);
    for (let i = 0; i < 3; i++) {
      const o = await rpc('place_order', t, input({ lines: [line('لاتيه', 1)] }));
      await rpc('staff_mark_paid', o.id);
    }
    expect(await loyalty(t)).toEqual({ stamps: 3, points: 27 });
    await expect(rpc('place_order', t, input({ freeCup: { itemId: ids['لاتيه'], temp: null } }))).rejects.toThrow('FREE_ITEM');
    const free = await rpc('place_order', t, input({ lines: [line('لاتيه', 1)], freeCup: { itemId: ids['قهوة اليوم'], temp: 'cold' } }));
    expect(free.freeCup).toEqual({ name: 'قهوة اليوم', temp: 'cold' });
    expect((await loyalty(t)).stamps).toBe(0);
    await rpc('staff_set_order_status', free.id, 'cancelled');
    expect(await loyalty(t)).toEqual({ stamps: 3, points: 27 });
    const again = await rpc('place_order', t, input({ lines: [line('لاتيه', 1)], freeCup: { itemId: ids['قهوة سودانية'], temp: null } }));
    await rpc('staff_mark_paid', again.id);
    await asStaff(false);
    expect(await loyalty(t)).toEqual({ stamps: 0, points: 36 });
  });

  it('خصم النقاط: كل 20 نقطة بريال', async () => {
    const t = await login('0500000004');
    await db.exec(`update customers set points = 140 where phone = '+966500000004'`);
    const o = await rpc('place_order', t, input({ lines: [line('كابتشينو', 1), line('لقيمات', 1)], usePoints: true }));
    expect([Number(o.discount), o.pointsUsed, Number(o.total), o.pointsEarned]).toEqual([7, 140, 12, 12]);
    expect((await loyalty(t)).points).toBe(0);
  });

  it('قواعد الطلب: الطاولة، الحرارة، الحجم بلا سعر، الثلج مع البارد', async () => {
    const t = await login('0500000005');
    await expect(rpc('place_order', t, input({ service: { type: 'dinein', table: null, later: false }, lines: [line('لاتيه')] }))).rejects.toThrow('TABLE_REQUIRED');
    await expect(rpc('place_order', t, input({ lines: [line('قهوة اليوم')] }))).rejects.toThrow('TEMP');
    await expect(rpc('place_order', t, input({ lines: [line('قهوة سودانية', 2)] }))).rejects.toThrow('SIZE');
    const ice = [{ groupId: ids['g:الثلج'], optionIndexes: [1] }];
    const hot = await rpc('place_order', t, input({ lines: [line('قهوة اليوم', 0, { temp: 'hot', choices: ice })] }));
    expect(hot.lines[0].choices).toEqual([]);
    const cold = await rpc('place_order', t, input({ lines: [line('قهوة اليوم', 0, { temp: 'cold', choices: ice, note: 'x' })] }));
    expect(cold.lines[0].choices[0].labels).toEqual(['ثلج قليل']);
    expect(cold.lines[0].note).toBe('');
    const j = await rpc('place_order', t, input({ lines: [line('قهوة سودانية', 0, { note: 'زنجبيل زيادة' })] }));
    expect(j.lines[0].note).toBe('زنجبيل زيادة');
  });

  it('حالات الوصول والدفع الإلكتروني', async () => {
    const t = await login('0500000006');
    const cash = await rpc('place_order', t, input({ service: remote, lines: [line('لاتيه')] }));
    expect(cash.status).toBe('waiting_arrival');
    expect((await rpc('mark_arrived', t, cash.id, null)).status).toBe('new');

    const online = await rpc('place_order', t, input({ service: remote, payMethod: 'online', lines: [line('لاتيه')] }));
    expect(online.status).toBe('awaiting_payment');
    await expect(rpc('confirm_payment', online.id, 'pay_1', 600)).rejects.toThrow('AMOUNT');
    const paid = await rpc('confirm_payment', online.id, 'pay_1', 700);
    expect([paid.status, paid.paymentStatus]).toEqual(['new', 'paid']);
    expect(await loyalty(t)).toEqual({ stamps: 1, points: 7 });

    const later = await rpc('place_order', t, input({ service: { type: 'dinein', table: null, later: true }, payMethod: 'online', lines: [line('لاتيه')] }));
    expect((await rpc('confirm_payment', later.id, 'pay_2', 700)).status).toBe('waiting_arrival');
    await expect(rpc('mark_arrived', t, later.id, null)).rejects.toThrow('TABLE_REQUIRED');
    const seated = await rpc('mark_arrived', t, later.id, 7);
    expect([seated.status, seated.table]).toEqual(['new', 7]);
  });

  it('لا يرى العميل طلب غيره، وغير الموظف لا يغيّر الحالة', async () => {
    const a = await login('0500000007');
    const b = await login('0500000008');
    const o = await rpc('place_order', a, input({ lines: [line('لاتيه')] }));
    await expect(rpc('get_order', b, o.id)).rejects.toThrow('NOT_FOUND');
    await expect(rpc('staff_set_order_status', o.id, 'done')).rejects.toThrow('NOT_STAFF');
    await expect(rpc('place_order', '00000000-0000-0000-0000-000000000000', input({ lines: [line('لاتيه')] }))).rejects.toThrow('AUTH');
  });

  it('دور الزائر: يقرأ القائمة ويستدعي الدوال، ولا يصل لجداول العملاء', async () => {
    await db.exec('set role anon');
    try {
      const r = await db.query<{ n: number }>('select count(*)::int n from items');
      expect(r.rows[0].n).toBe(15);
      const s = await rpc('login_with_phone', '0500000099', '1234');
      const o = await rpc('place_order', s.token, input({ lines: [line('لاتيه')] }));
      expect(Number(o.total)).toBe(7);
      await expect(db.query('select * from customers')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from sessions')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from private_settings')).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into items (category_id, name) select id, 'x' from categories limit 1")).rejects.toThrow(/permission denied/);
      await expect(rpc('confirm_payment', o.id, 'pay_x', 700)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });

  it('نداء النادل لا يتكرر للطاولة نفسها', async () => {
    await rpc('call_waiter', 4);
    await rpc('call_waiter', 4);
    const r = await db.query<{ n: number }>('select count(*)::int n from waiter_calls where resolved_at is null');
    expect(r.rows[0].n).toBe(1);
  });
});
