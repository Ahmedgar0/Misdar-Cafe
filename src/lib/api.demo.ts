// الوضع التجريبي: قاعدة Postgres كاملة داخل المتصفح (PGlite) تشغّل ملفات قاعدة البيانات نفسها،
// فيطابق كل منطق الأسعار والمكافآت والفواتير ما يجري في الإنتاج. البيانات تُحفظ في هذا المتصفح فقط.
import schema from '../../supabase/schema.sql?raw';
import migration from '../../supabase/002_admin_pos.sql?raw';
import type { Transport } from './api';
import { OrderError } from './pricing';
import type { Order, StaffMe } from './types';

const STAFF_KEY = 'misdar.demo.staff';

const ACCOUNTS = [
  { id: '00000000-0000-4000-8000-000000000001', email: 'owner@misdar.demo', name: 'المالك', role: 'owner' },
  { id: '00000000-0000-4000-8000-000000000002', email: 'manager@misdar.demo', name: 'المدير', role: 'manager' },
  { id: '00000000-0000-4000-8000-000000000003', email: 'cashier@misdar.demo', name: 'الكاشير', role: 'cashier' },
  { id: '00000000-0000-4000-8000-000000000004', email: 'barista@misdar.demo', name: 'الباريستا', role: 'barista' },
];

const BOOT = `
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role; exception when duplicate_object then null; end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('test.uid', true), '')::uuid $f$;
  create table if not exists auth.users (id uuid primary key, email text);
`;

const SEED = (owner: string) => `
  select set_config('test.uid', '${owner}', true);
  insert into ingredients (id, name, unit, stock, reorder_level, cost) values
    ('10000000-0000-4000-8000-000000000001', 'حليب', 'مل', 12000, 3000, 0.006),
    ('10000000-0000-4000-8000-000000000002', 'بن مختص', 'غرام', 2500, 1000, 0.12),
    ('10000000-0000-4000-8000-000000000003', 'بن سوداني', 'غرام', 1800, 800, 0.08),
    ('10000000-0000-4000-8000-000000000004', 'أكواب ورقية', 'قطعة', 140, 200, 0.35);
  insert into recipes (item_id, size_index, ingredient_id, qty)
    select id, null::int, '10000000-0000-4000-8000-000000000002'::uuid, 18::numeric from items where name in ('إسبريسو', 'كابتشينو', 'لاتيه', 'سبانيش لاتيه', 'أمريكانو')
    union all select id, null::int, '10000000-0000-4000-8000-000000000001'::uuid, 200::numeric from items where name in ('كابتشينو', 'لاتيه', 'سبانيش لاتيه')
    union all select id, null::int, '10000000-0000-4000-8000-000000000003'::uuid, 12::numeric from items where name = 'قهوة سودانية'
    union all select id, null::int, '10000000-0000-4000-8000-000000000004'::uuid, 1::numeric from items where name in ('كابتشينو', 'لاتيه', 'سبانيش لاتيه', 'أمريكانو', 'قهوة اليوم');
`;

export async function createDemoTransport(): Promise<Transport> {
  const { PGliteWorker } = await import('@electric-sql/pglite/worker');
  const db = await PGliteWorker.create(new Worker(new URL('./pglite.worker.ts', import.meta.url), { type: 'module' }));

  // التهيئة الأولى داخل معاملة واحدة، فلو فُتح تبويبان معاً لا تُنفَّذ مرتين
  await db.transaction(async (tx) => {
    const ready = await tx.query<{ ok: boolean }>(`select to_regclass('public.invoices') is not null as ok`);
    if (ready.rows[0].ok) return;
    await tx.exec(BOOT);
    for (const a of ACCOUNTS) await tx.query('insert into auth.users values ($1, $2) on conflict do nothing', [a.id, a.email]);
    await tx.exec(schema);
    await tx.query('insert into staff (user_id) values ($1) on conflict do nothing', [ACCOUNTS[0].id]);
    await tx.exec(migration);
    await tx.query(`select set_config('test.uid', $1, true)`, [ACCOUNTS[0].id]);
    await tx.query(`update staff set name = 'المالك' where user_id = $1`, [ACCOUNTS[0].id]);
    for (const a of ACCOUNTS.slice(1)) await tx.query('select staff_add_member($1, $2, $3)', [a.email, a.name, a.role]);
    await tx.exec(SEED(ACCOUNTS[0].id));
  });

  let staffId: string | null = (() => { try { return localStorage.getItem(STAFF_KEY); } catch { return null; } })();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  // كل استدعاء معاملة مستقلة: تحدد هوية المستخدم ثم تنفذ الدالة، فلا تتداخل الهويات بين التبويبات
  async function call<T>(fn: string, args: Record<string, unknown>, uid: string | null): Promise<T> {
    const keys = Object.keys(args);
    const vals = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`;
    try {
      return await db.transaction(async (tx) => {
        await tx.query(`select set_config('test.uid', $1, true)`, [uid ?? '']);
        const r = await tx.query<{ v: T }>(sql, vals);
        return r.rows[0]?.v as T;
      });
    } catch (e) {
      throw new OrderError(e instanceof Error ? e.message : String(e));
    }
  }

  const me = () => (staffId ? call<StaffMe | null>('staff_me', {}, staffId) : Promise.resolve(null));

  return {
    mode: 'demo',
    demoAccounts: ACCOUNTS.map(({ email, name, role }) => ({ email, name, role })),

    async rpc<T>(fn: string, args: Record<string, unknown>, asStaff: boolean) {
      const out = await call<T>(fn, args, asStaff ? staffId : null);
      if (!/^(get_|staff_me|staff_dashboard|staff_report|staff_current|staff_shifts|staff_orders|staff_find|staff_invoices|staff_customers|staff_customer_detail|staff_ingredients|staff_recipes|staff_stock_moves|staff_list|staff_zatca|staff_waiter|customer_me|my_orders)/.test(fn)) notify();
      return out;
    },

    staffSession: me,
    async staffLogin(email) {
      const a = ACCOUNTS.find((x) => x.email === email.trim().toLowerCase());
      if (!a) throw new OrderError('BAD_LOGIN');
      staffId = a.id;
      try { localStorage.setItem(STAFF_KEY, a.id); } catch { /* نتجاهل */ }
      const m = await me();
      if (!m) throw new OrderError('NOT_STAFF');
      return m;
    },
    async staffLogout() {
      staffId = null;
      try { localStorage.removeItem(STAFF_KEY); } catch { /* نتجاهل */ }
    },

    async fn<T>(name: string, body: Record<string, unknown>) {
      if (name === 'staff-create') {
        const id = crypto.randomUUID();
        await call('staff_me', {}, staffId);
        await db.query('insert into auth.users values ($1, $2) on conflict do nothing', [id, String(body.email).toLowerCase()]);
        await call('staff_add_member', { p_email: body.email, p_name: body.name, p_role: body.role }, staffId);
        return { userId: id } as T;
      }
      // التوقيع والإبلاغ يحتاجان الخادم ومفتاحه الخاص
      throw new OrderError('DEMO_ONLY');
    },

    async confirmPayment(token, orderId) {
      // لا خادم ولا بوابة دفع في الوضع التجريبي: نعتمد الدفع مباشرة بعد التحقق من ملكية الطلب
      await call('get_order', { p_token: token, p_id: orderId }, null);
      await db.transaction(async (tx) => { await tx.query(`select pay_order($1, $2)`, [orderId, 'demo-' + Date.now()]); });
      notify();
      return call<Order>('get_order', { p_token: token, p_id: orderId }, null);
    },

    subscribe(cb) {
      listeners.add(cb);
      const onStorage = () => cb();
      window.addEventListener('focus', onStorage);
      const timer = window.setInterval(cb, 5000);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('focus', onStorage);
        window.clearInterval(timer);
      };
    },
  };
}
