// مسار الخادم كاملاً على قاعدة حقيقية (PGlite): التسجيل، توقيع فواتير البيع بالتسلسل، والإبلاغ. ردود الهيئة محاكاة.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKey } from './csr';
import { INITIAL_PIH, decodeTlv, verifySignature } from './invoice';
import { onboard, reportSigned, rowToInvoice, signPending } from './service';

let db: PGlite;
let certBody = '';
let caDir = '';

/** يصدر شهادة من طلب الشهادة المرسل، كما تفعل الهيئة */
function issueFromCsr(csrB64: string): string {
  writeFileSync(join(caDir, 'req.csr'), Buffer.from(csrB64, 'base64'));
  execFileSync('openssl', ['x509', '-req', '-in', join(caDir, 'req.csr'), '-CA', join(caDir, 'c.pem'), '-CAkey', join(caDir, 'k.pem'),
    '-CAcreateserial', '-days', '30', '-sha256', '-out', join(caDir, 'issued.pem')], { stdio: 'ignore' });
  certBody = readFileSync(join(caDir, 'issued.pem'), 'utf8').replace(/-----[^-]+-----|\s/g, '');
  return Buffer.from(certBody).toString('base64');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// بديل مصغّر لعميل Supabase يكفي الاستعلامات التي يستخدمها service.ts
function fakeSupabase(pg: PGlite): any {
  const q = (table: string) => {
    const where: string[] = [];
    const args: unknown[] = [];
    let cols = '*', order = '', limit = '', mode: 'select' | 'update' = 'select', patch: Record<string, unknown> = {}, head = false;
    const b: any = {
      select(c = '*', opts?: { count?: string; head?: boolean }) { cols = c; head = !!opts?.head; return b; },
      update(p: Record<string, unknown>) { mode = 'update'; patch = p; return b; },
      eq(c: string, v: unknown) { args.push(v); where.push(`${c} = $${args.length}`); return b; },
      lte(c: string, v: unknown) { args.push(v); where.push(`${c} <= $${args.length}`); return b; },
      not(c: string, op: string, v: unknown) { where.push(`${c} ${op} not ${v}`); return b; },
      order(c: string) { order = ` order by ${c}`; return b; },
      limit(n: number) { limit = ` limit ${n}`; return b; },
      async run() {
        const w = where.length ? ' where ' + where.join(' and ') : '';
        if (mode === 'update') {
          const sets = Object.keys(patch).map((k, i) => `${k} = $${args.length + i + 1}`);
          const vals = Object.values(patch).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
          await pg.query(`update ${table} set ${sets.join(', ')}${w}`, [...args, ...vals]);
          return { data: null, error: null };
        }
        if (head) {
          const r = await pg.query<{ n: number }>(`select count(*)::int n from ${table}${w}`, args);
          return { data: null, count: r.rows[0].n, error: null };
        }
        const r = await pg.query(`select ${cols} from ${table}${w}${order}${limit}`, args);
        return { data: r.rows, error: null };
      },
      async single() { const r = await b.run(); return { data: r.data?.[0] ?? null, error: r.data?.[0] ? null : { message: 'none' } }; },
      async maybeSingle() { const r = await b.run(); return { data: r.data?.[0] ?? null, error: null }; },
      then(res: any, rej: any) { return b.run().then(res, rej); },
    };
    return b;
  };
  return {
    from: q,
    async rpc(fn: string, a: Record<string, unknown>) {
      const keys = Object.keys(a);
      try {
        const r = await pg.query<{ v: unknown }>(`select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) v`, keys.map((k) => a[k]));
        return { data: r.rows[0].v, error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    },
  };
}

const zatcaReplies: { path: string; status: number; body: unknown }[] = [];
function mockZatca(handler: (path: string, body: any) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const path = new URL(url).pathname.replace(/^\/e-invoicing\/[^/]+/, '');
    const r = handler(path, JSON.parse(init.body));
    zatcaReplies.push({ path, ...r });
    return new Response(JSON.stringify(r.body), { status: r.status });
  }));
}
afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zatca-svc-'));
  caDir = dir;
  writeFileSync(join(dir, 'k.pem'), generateKey());
  execFileSync('openssl', ['req', '-x509', '-new', '-key', join(dir, 'k.pem'), '-sha256', '-days', '30',
    '-subj', '/DC=local/DC=gov/DC=extgazt/CN=TSZEINVOICE-SubCA-1', '-out', join(dir, 'c.pem')]);
  certBody = readFileSync(join(dir, 'c.pem'), 'utf8').replace(/-----[^-]+-----|\s/g, '');

  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
    insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'owner@misdar.test');
  `);
  await db.exec(readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into staff (user_id) values ('00000000-0000-0000-0000-0000000000a1')`);
  await db.exec(readFileSync(new URL('../../supabase/002_admin_pos.sql', import.meta.url), 'utf8'));
  await db.exec(`select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false)`);
  await db.query(`select staff_save_settings($1)`, [JSON.stringify({
    vatEnabled: true, vatNumber: '399999999900003', legalName: 'مؤسسة مسدار', crNumber: '1010101010',
    address: { street: 'طريق الملك فهد', building: '1234', district: 'العليا', city: 'الرياض', postal: '12345' },
  })]);
  await db.query('select staff_open_shift(0)');
  const ids = Object.fromEntries((await db.query<{ id: string; name: string }>('select id, name from items')).rows.map((r) => [r.name, r.id]));
  const sale = (lines: object[], extra = {}) => db.query('select staff_pos_sale($1)', [JSON.stringify({ lines, service: { type: 'takeaway' }, payments: [], ...extra })]);
  await sale([{ itemId: ids['لاتيه'], sizeIndex: 1, qty: 2 }]);
  await sale([{ itemId: ids['قهوة اليوم'], sizeIndex: 0, temp: 'cold', qty: 1 }, { itemId: ids['لقيمات'], sizeIndex: 2, qty: 1 }], { payments: [{ method: 'card', amount: 19 }] });
});

describe('خدمة الهيئة', () => {
  it('لا توقيع للفواتير الحقيقية قبل التسجيل في بيئة الإنتاج', async () => {
    const sb = fakeSupabase(db);
    expect(await signPending(sb)).toEqual({ signed: 0 });
    const r = await db.query<{ n: number }>(`select count(*)::int n from invoices where zatca_status = 'pending'`);
    expect(r.rows[0].n).toBe(2);
  });

  it('التسجيل: شهادة امتثال، ثلاثة فحوص، ثم شهادة إنتاج', async () => {
    let token = '';
    mockZatca((path, body) => {
      if (path === '/compliance') {
        token = issueFromCsr(body.csr);
        return { status: 200, body: { requestID: 1234, binarySecurityToken: token, secret: 's1' } };
      }
      if (path === '/compliance/invoices') {
        expect(body.uuid).toMatch(/^[0-9a-f-]{36}$/);
        const xml = Buffer.from(body.invoice, 'base64').toString();
        expect(xml).toContain(`<ds:DigestValue>${body.invoiceHash}</ds:DigestValue>`);
        return { status: 200, body: { reportingStatus: 'REPORTED', validationResults: { status: 'PASS', errorMessages: [], warningMessages: [] } } };
      }
      if (path === '/production/csids') return { status: 200, body: { requestID: 99, binarySecurityToken: token, secret: 's2' } };
      return { status: 404, body: {} };
    });
    const sb = fakeSupabase(db);
    const r = await onboard(sb, { environment: 'production', otp: '111111', vatNumber: '399999999900003', orgName: 'Misdar', branchName: 'Main', industry: 'Food', location: 'Riyadh' });
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true, true, true]);
    expect(zatcaReplies.filter((x) => x.path === '/compliance/invoices')).toHaveLength(3);
    const st = await db.query<any>('select status, environment, last_icv, last_hash, production_secret from zatca_state');
    expect(st.rows[0]).toMatchObject({ status: 'ready', environment: 'production', last_icv: 0, last_hash: INITIAL_PIH, production_secret: 's2' });
  });

  it('توقيع الفواتير بالتسلسل: ICV متتابع وكل فاتورة تحمل تجزئة سابقتها', async () => {
    const sb = fakeSupabase(db);
    expect(await signPending(sb)).toEqual({ signed: 2 });
    const rows = (await db.query<any>('select * from invoices order by seq')).rows;
    expect(rows.map((r) => [r.zatca_status, Number(r.icv)])).toEqual([['signed', 1], ['signed', 2]]);
    expect(rows[0].pih).toBe(INITIAL_PIH);
    expect(rows[1].pih).toBe(rows[0].invoice_hash);
    for (const r of rows) {
      const qr = decodeTlv(r.qr);
      expect(verifySignature(r.invoice_hash, qr[6].toString(), certBody)).toBe(true);
      expect(r.xml).toContain(`<cbc:ID>${r.number}</cbc:ID>`);
      expect(r.xml).toContain(`<cbc:UUID>${r.id}</cbc:UUID>`);
    }
    expect(rows[1].xml).toContain('<cbc:Name>قهوة اليوم · عادي · بارد</cbc:Name>');
    expect(rows[1].xml).toContain('<cbc:PaymentMeansCode>48</cbc:PaymentMeansCode>');
    const st = await db.query<any>('select last_icv, last_hash, lock_holder from zatca_state');
    expect(st.rows[0]).toMatchObject({ last_icv: 2, last_hash: rows[1].invoice_hash, lock_holder: null });
    // لا شيء يُوقَّع مرتين
    expect(await signPending(sb)).toEqual({ signed: 0 });
  });

  it('مطابقة صف الفاتورة: مجاميع XML تساوي ما دفعه العميل', async () => {
    const row = (await db.query<any>('select * from invoices order by seq limit 1')).rows[0];
    const doc = rowToInvoice(row, 1, INITIAL_PIH);
    expect(doc.totalEx + doc.vatAmount + doc.rounding).toBeCloseTo(18, 6);
    expect(doc.lines).toEqual([{ name: 'لاتيه · كبير', qty: 2, ex: 15.65, vat: 2.35 }]);
  });

  it('الإبلاغ: المقبول والمقبول بتحذير والمرفوض وتعذّر الاتصال', async () => {
    let n = 0;
    mockZatca(() => (++n === 1
      ? { status: 200, body: { reportingStatus: 'REPORTED' } }
      : { status: 400, body: { reportingStatus: 'NOT_REPORTED', validationResults: { errorMessages: [{ code: 'BR-KSA-37', message: 'x' }] } } }));
    const sb = fakeSupabase(db);
    expect(await reportSigned(sb)).toEqual({ reported: 1, rejected: 1, failed: 0 });
    const rows = (await db.query<any>('select zatca_status, report_attempts, zatca_response from invoices order by seq')).rows;
    expect(rows.map((r) => r.zatca_status)).toEqual(['reported', 'rejected']);
    expect(rows[1].zatca_response.validationResults.errorMessages[0].code).toBe('BR-KSA-37');

    // فاتورة جديدة، والشبكة متعطلة: تبقى موقّعة لإعادة المحاولة
    const id = (await db.query<{ id: string }>(`select id from items where name = 'كوكيز'`)).rows[0].id;
    await db.query('select staff_pos_sale($1)', [JSON.stringify({ lines: [{ itemId: id, sizeIndex: 0, qty: 1 }], service: { type: 'takeaway' }, payments: [] })]);
    await signPending(sb);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    expect(await reportSigned(sb)).toEqual({ reported: 0, rejected: 0, failed: 1 });
    const last = (await db.query<any>('select zatca_status, report_attempts, icv from invoices order by seq desc limit 1')).rows[0];
    expect([last.zatca_status, last.report_attempts, Number(last.icv)]).toEqual(['signed', 1, 3]);
  });
});
