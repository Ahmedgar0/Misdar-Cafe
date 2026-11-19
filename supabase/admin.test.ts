// اختبارات الترحيل الثاني: الأدوار، الكاشير، الورديات، الفواتير، الاسترجاع، الضريبة، المخزون، التقارير، سلسلة الهيئة.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const ids: Record<string, string> = {};
const U = {
  owner: '00000000-0000-0000-0000-0000000000a1',
  manager: '00000000-0000-0000-0000-0000000000a2',
  cashier: '00000000-0000-0000-0000-0000000000a3',
  barista: '00000000-0000-0000-0000-0000000000a4',
  newbie: '00000000-0000-0000-0000-0000000000a5',
};

async function as(user: keyof typeof U | null) {
  await db.exec(`select set_config('test.uid', '${user ? U[user] : ''}', false)`);
}
async function rpc<T = any>(fn: string, ...args: unknown[]): Promise<T> {
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  const r = await db.query<{ v: T }>(`select ${fn}(${ph}) as v`, args);
  return r.rows[0].v;
}
const one = async <T = any>(sql: string, args: unknown[] = []): Promise<T> => (await db.query<T>(sql, args)).rows[0];
const num = (v: unknown) => Number(v);

const line = (name: string, sizeIndex = 0, extra = {}) => ({ itemId: ids[name], sizeIndex, temp: null, choices: [], note: '', qty: 1, ...extra });
const sale = (over: object) => JSON.stringify({ lines: [], service: { type: 'takeaway', table: null }, payments: [], ...over });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
  `);
  for (const [k, v] of Object.entries(U)) await db.query('insert into auth.users values ($1, $2)', [v, k + '@misdar.test']);
  await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await db.query('insert into staff (user_id) values ($1)', [U.owner]);
  await db.exec(readFileSync(new URL('./002_admin_pos.sql', import.meta.url), 'utf8'));
  // تشغيل الترحيل مرتين يجب ألا يكسر شيئاً
  await db.exec(readFileSync(new URL('./002_admin_pos.sql', import.meta.url), 'utf8'));
  for (const r of (await db.query<{ id: string; name: string }>('select id, name from items')).rows) ids[r.name] = r.id;
  await as('owner');
  await rpc('staff_add_member', 'MANAGER@misdar.test', 'سارة', 'manager');
  await rpc('staff_add_member', 'cashier@misdar.test', 'خالد', 'cashier');
  await rpc('staff_add_member', 'barista@misdar.test', 'علي', 'barista');
});

describe('الأدوار', () => {
  it('المالك يُرحَّل بدوره وبريده، والإضافة تعمل بالبريد', async () => {
    const me = await rpc('staff_me');
    expect(me).toMatchObject({ role: 'owner', email: 'owner@misdar.test' });
    const list = await rpc<any[]>('staff_list');
    expect(list.map((s) => s.role).sort()).toEqual(['barista', 'cashier', 'manager', 'owner']);
    await expect(rpc('staff_add_member', 'nobody@x.test', '', 'cashier')).rejects.toThrow('NO_USER');
  });

  it('لا يُحذف آخر مالك، وغير المالك لا يدير الموظفين', async () => {
    await expect(rpc('staff_save_member', JSON.stringify({ userId: U.owner, role: 'manager' }))).rejects.toThrow('LAST_OWNER');
    await as('manager');
    await expect(rpc('staff_list')).rejects.toThrow('FORBIDDEN');
    await as('newbie');
    await expect(rpc('staff_dashboard')).rejects.toThrow('NOT_STAFF');
  });

  it('الباريستا: يغيّر الحالة ويعلّم النفاد، ولا يبيع ولا يرى المبالغ', async () => {
    await as('barista');
    await expect(rpc('staff_pos_sale', sale({ lines: [line('لاتيه')] }))).rejects.toThrow('FORBIDDEN');
    await rpc('staff_set_item_available', ids['ماتشا'], false);
    await rpc('staff_set_item_available', ids['ماتشا'], true);
    const d = await rpc('staff_dashboard');
    expect(d.todaySales).toBeNull();
    expect(d.zatca).toBeNull();
    await expect(rpc('staff_save_item', JSON.stringify({ id: ids['لاتيه'], name: 'x' }))).rejects.toThrow('FORBIDDEN');
  });
});

describe('الكاشير والورديات', () => {
  it('لا بيع دون وردية مفتوحة', async () => {
    await as('cashier');
    await expect(rpc('staff_pos_sale', sale({ lines: [line('لاتيه')] }))).rejects.toThrow('NO_SHIFT');
    const sh = await rpc('staff_open_shift', 100);
    expect(num(sh.openingCash)).toBe(100);
    await expect(rpc('staff_open_shift', 50)).rejects.toThrow('SHIFT_OPEN');
  });

  it('بيع نقدي: الباقي، الدفعة، الفاتورة دون ضريبة', async () => {
    await as('cashier');
    const r = await rpc('staff_pos_sale', sale({ lines: [line('كابتشينو', 1), line('لقيمات', 0)], tendered: 20 }));
    expect(num(r.change)).toBe(6);
    expect(r.order).toMatchObject({ channel: 'pos', status: 'new', paymentStatus: 'paid', createdBy: 'خالد' });
    expect(r.order.payments).toEqual([{ method: 'cash', kind: 'sale', amount: 14 }]);
    const inv = await rpc('get_invoice', r.invoiceId);
    expect(inv).toMatchObject({ number: 'INV-000001', kind: 'invoice', vatEnabled: false, zatcaStatus: 'not_applicable' });
    expect([num(inv.total), num(inv.vatAmount), num(inv.totalEx), num(inv.rounding)]).toEqual([14, 0, 14, 0]);
    expect(inv.lines.map((l: any) => l.name)).toEqual(['كابتشينو · كبير', 'لقيمات · صغير']);
    expect(inv.cashier).toBeNull();
    await expect(rpc('staff_pos_sale', sale({ lines: [line('لاتيه')], tendered: 5 }))).rejects.toThrow('TENDERED');
  });

  it('دفع مقسوم بين الشبكة والنقد، وعميل بجواله يكسب المكافآت', async () => {
    await as('cashier');
    const r = await rpc('staff_pos_sale', sale({
      lines: [line('سبانيش لاتيه', 1, { temp: 'cold' }), line('كوكيز')], customerPhone: '0511111111',
      payments: [{ method: 'card', amount: 10 }], tendered: 10,
    }));
    expect(r.order.payments).toEqual([{ method: 'card', kind: 'sale', amount: 10 }, { method: 'cash', kind: 'sale', amount: 4 }]);
    expect(num(r.change)).toBe(6);
    expect(r.order.customerPhone).toBe('+966511111111');
    const c = await one<{ stamps: number; points: number }>(`select stamps, points from customers where phone = '+966511111111'`);
    expect(c).toEqual({ stamps: 1, points: 14 });
  });

  it('الخصم اليدوي للمدير فقط', async () => {
    await as('cashier');
    await expect(rpc('staff_pos_sale', sale({ lines: [line('لاتيه')], manualDiscount: { amount: 2, reason: 'ضيف' } }))).rejects.toThrow('FORBIDDEN');
    await as('manager');
    await rpc('staff_open_shift', 0);
    const r = await rpc('staff_pos_sale', sale({ lines: [line('لاتيه')], manualDiscount: { amount: 2, reason: 'ضيف' } }));
    expect([num(r.order.total), num(r.order.manualDiscount)]).toEqual([5, 2]);
    const inv = await rpc('get_invoice', r.invoiceId);
    expect([num(inv.discountIncl), num(inv.totalEx)]).toEqual([2, 5]);
    await rpc('staff_close_shift', 5, '');
  });

  it('طلب من الموقع يُدفع عند الكاشير: الشبكة دون وردية، والنقد يحتاج وردية', async () => {
    const s = await rpc('login_with_phone', '0522222222', '1234');
    await as(null);
    const o = await rpc('place_order', s.token, JSON.stringify({ lines: [line('لاتيه')], service: { type: 'dinein', table: 3 }, payMethod: 'cashier', usePoints: false, freeCup: null }));
    expect([o.channel, o.invoiceId]).toEqual(['online', null]);
    await as('barista');
    await expect(rpc('staff_set_order_status', o.id, 'done')).rejects.toThrow('UNPAID');
    await expect(rpc('staff_mark_paid', o.id, 'cash')).rejects.toThrow('FORBIDDEN');
    await as('owner');
    await expect(rpc('staff_mark_paid', o.id, 'cash')).rejects.toThrow('NO_SHIFT');
    const paid = await rpc('staff_mark_paid', o.id, 'card');
    expect(paid.paymentStatus).toBe('paid');
    expect(paid.invoiceId).toBeTruthy();
    await as('barista');
    await rpc('staff_set_order_status', o.id, 'done');
  });

  it('الإيداع والسحب وإغلاق الوردية بالعجز', async () => {
    await as('cashier');
    await expect(rpc('staff_cash_move', 'out', 10, '')).rejects.toThrow('REASON');
    await rpc('staff_cash_move', 'out', 10, 'شراء حليب');
    await rpc('staff_cash_move', 'in', 50, 'فكة');
    const cur = await rpc('staff_current_shift');
    // 100 افتتاح + 14 نقد + 4 نقد − 10 + 50
    expect(num(cur.expectedCash)).toBe(158);
    const closed = await rpc('staff_close_shift', 155, 'عجز بسيط');
    expect([num(closed.expectedCash), num(closed.countedCash), num(closed.difference)]).toEqual([158, 155, -3]);
    expect(closed.moves).toHaveLength(2);
    expect(await rpc('staff_current_shift')).toBeNull();
    await as('manager');
    const all = await rpc<any[]>('staff_shifts', 10);
    expect(all.length).toBe(2);
  });
});

describe('الاسترجاع وإشعار الدائن', () => {
  it('يعكس المكافآت ويعيد المخزون ويرد النقد من الوردية', async () => {
    await as('owner');
    await rpc('staff_save_ingredient', JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', name: 'حليب', unit: 'مل', reorderLevel: 500 }));
    await rpc('staff_stock_move', '11111111-1111-1111-1111-111111111111', 'purchase', 1000, 'فاتورة المورد');
    await rpc('staff_save_recipe', ids['لاتيه'], JSON.stringify([{ sizeIndex: null, ingredientId: '11111111-1111-1111-1111-111111111111', qty: 200 }, { sizeIndex: 1, ingredientId: '11111111-1111-1111-1111-111111111111', qty: 300 }]));
    await rpc('staff_open_shift', 0);
    const r = await rpc('staff_pos_sale', sale({ lines: [line('لاتيه', 0, { qty: 2 }), line('لاتيه', 1)], customerPhone: '0533333333' }));
    const stock = async () => num((await one<{ stock: string }>(`select stock from ingredients where name = 'حليب'`)).stock);
    expect(await stock()).toBe(1000 - 400 - 300);
    const before = await one(`select stamps, points from customers where phone = '+966533333333'`);
    expect(before).toEqual({ stamps: 1, points: 23 });

    await as('cashier');
    await expect(rpc('staff_refund', r.order.id, 'خطأ', null)).rejects.toThrow('FORBIDDEN');
    await as('owner');
    await expect(rpc('staff_refund', r.order.id, '', null)).rejects.toThrow('REASON');
    const ref = await rpc('staff_refund', r.order.id, 'طلب خاطئ', null);
    expect(ref.order.status).toBe('refunded');
    expect(await stock()).toBe(1000);
    expect(await one(`select stamps, points from customers where phone = '+966533333333'`)).toEqual({ stamps: 0, points: 0 });
    const cn = await rpc('get_invoice', ref.creditNoteId);
    expect(cn).toMatchObject({ kind: 'credit_note', refNumber: 'INV-000005', reason: 'طلب خاطئ' });
    expect(cn.number).toMatch(/^INV-CN-\d{6}$/);
    expect(num(cn.total)).toBe(23);
    await expect(rpc('staff_refund', r.order.id, 'مرة ثانية', null)).rejects.toThrow('CLOSED');
    const sh = await rpc('staff_close_shift', 0, '');
    expect([num(sh.cashSales), num(sh.cashRefunds), num(sh.expectedCash)]).toEqual([23, 23, 0]);
  });
});

describe('ضريبة القيمة المضافة', () => {
  it('لا تُفعَّل دون رقم ضريبي صحيح، والمدير لا يغيّرها', async () => {
    await as('owner');
    await expect(rpc('staff_save_settings', JSON.stringify({ vatEnabled: true, vatNumber: '12345' }))).rejects.toThrow('VAT_NUMBER');
    await as('manager');
    await rpc('staff_save_settings', JSON.stringify({ vatEnabled: true, vatNumber: '300000000000003', stampMin: 6 }));
    expect((await rpc('get_menu')).settings.vatEnabled).toBe(false);
  });

  it('الفاتورة تستخرج الضريبة من السعر الشامل وتُعلَّم بانتظار الهيئة', async () => {
    await as('owner');
    await rpc('staff_save_settings', JSON.stringify({ vatEnabled: true, vatNumber: '300000000000003', legalName: 'مؤسسة مسدار', crNumber: '1010101010' }));
    await rpc('staff_open_shift', 0);
    const r = await rpc('staff_pos_sale', sale({ lines: [line('شاي أحمر', 0, { qty: 3 }), line('كوكيز')] }));
    const inv = await rpc('get_invoice', r.invoiceId);
    expect(inv).toMatchObject({ vatEnabled: true, zatcaStatus: 'pending' });
    expect(inv.seller).toMatchObject({ name: 'مؤسسة مسدار', vatNumber: '300000000000003' });
    // 9 ر.س → 7.83 + 1.17 ، 5 ر.س → 4.35 + 0.65
    expect(inv.lines.map((l: any) => [num(l.incl), num(l.ex), num(l.vat)])).toEqual([[9, 7.83, 1.17], [5, 4.35, 0.65]]);
    expect([num(inv.totalEx), num(inv.vatAmount), num(inv.total)]).toEqual([12.18, 1.83, 14]);
    expect(num(inv.totalEx) + num(inv.vatAmount) + num(inv.rounding)).toBeCloseTo(14, 6);
    await rpc('staff_close_shift', 14, '');
  });
});

describe('التقارير ولوحة المؤشرات', () => {
  it('التقرير يجمع الفواتير ويطرح المسترجع', async () => {
    await as('owner');
    const today = (await one<{ d: string }>(`select ((now() at time zone 'Asia/Riyadh')::date)::text d`)).d;
    const r = await rpc('staff_report', today, today);
    // 14 + 14 + 5 + 7 + 23 + 14 فواتير، و23 مسترجعة
    expect(num(r.summary.invoices)).toBe(6);
    expect(num(r.summary.net)).toBe(14 + 14 + 5 + 7 + 23 + 14 - 23);
    expect(num(r.summary.refunds)).toBe(23);
    expect(num(r.summary.discounts)).toBe(2);
    expect(num(r.vatReport.vatOnSales)).toBe(1.83);
    expect(r.topItems[0]).toMatchObject({ name: 'شاي أحمر', qty: 3 });
    expect(r.byMethod.find((m: any) => m.method === 'card')).toMatchObject({ sales: 17 });
    const d = await rpc('staff_dashboard');
    expect(num(d.todaySales)).toBe(num(r.summary.net));
    expect(d.lowStock).toEqual([]);
    expect(d.zatca).toMatchObject({ vatEnabled: true, status: 'none', pending: 1 });
    await as('cashier');
    await expect(rpc('staff_report', today, today)).rejects.toThrow('FORBIDDEN');
    const list = await rpc<any[]>('staff_invoices', today, today, 'CN');
    expect(list).toHaveLength(1);
  });
});

describe('سلسلة الهيئة', () => {
  it('القفل والتسلسل: لا تُحفظ فاتورة بتجزئة سابقة خاطئة', async () => {
    const pending = await one<{ id: string }>(`select id from invoices where zatca_status = 'pending' order by seq limit 1`);
    const a = '00000000-0000-0000-0000-00000000f001', b = '00000000-0000-0000-0000-00000000f002';
    expect(await rpc('zatca_try_lock', a, 30)).toBe(true);
    expect(await rpc('zatca_try_lock', b, 30)).toBe(false);
    const st = await one<{ last_hash: string }>('select last_hash from zatca_state');
    await expect(rpc('zatca_save_signed', pending.id, a, 1, 'wrong', 'h1', 'qr', '<x/>')).rejects.toThrow('CHAIN');
    await expect(rpc('zatca_save_signed', pending.id, b, 1, st.last_hash, 'h1', 'qr', '<x/>')).rejects.toThrow('LOCK');
    await rpc('zatca_save_signed', pending.id, a, 1, st.last_hash, 'h1', 'qr', '<x/>');
    expect(await one('select last_icv, last_hash from zatca_state')).toEqual({ last_icv: 1, last_hash: 'h1' });
    await rpc('zatca_unlock', a);
    expect(await rpc('zatca_try_lock', b, 30)).toBe(true);
    await rpc('zatca_unlock', b);
    await as('cashier');
    await expect(rpc('staff_invoice_xml', pending.id)).rejects.toThrow('FORBIDDEN');
    await as('owner');
    expect(await rpc('staff_invoice_xml', pending.id)).toBe('<x/>');
  });

  it('المفتاح الخاص لا يصل إليه المتصفح', async () => {
    await db.exec('set role authenticated');
    try {
      await expect(db.query('select private_key from zatca_state')).rejects.toThrow(/permission denied/);
      await expect(db.query(`select zatca_try_lock('00000000-0000-0000-0000-00000000f003', 5)`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select issue_invoice(gen_random_uuid())`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });
});

describe('العملاء', () => {
  it('البحث والتعديل اليدوي بسبب', async () => {
    await as('cashier');
    const list = await rpc<any[]>('staff_customers', '0511111111');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ phone: '+966511111111', stamps: 1, points: 14 });
    await expect(rpc('staff_adjust_loyalty', list[0].id, 10, 0, 'تعويض')).rejects.toThrow('FORBIDDEN');
    await as('manager');
    await rpc('staff_adjust_loyalty', list[0].id, 10, 5, 'تعويض عن تأخير');
    const d = await rpc('staff_customer_detail', list[0].id);
    expect(d.ledger[0]).toMatchObject({ kind: 'adjust', points: 10, note: 'تعويض عن تأخير' });
    // الأختام لا تتجاوز حد البطاقة
    expect(await one(`select stamps, points from customers where id = $1`, [list[0].id])).toEqual({ stamps: 3, points: 24 });
  });
});
