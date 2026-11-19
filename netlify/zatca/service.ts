// منطق الخادم للربط مع الهيئة: التسجيل، توقيع الفواتير بالتسلسل، والإبلاغ.
// يعمل بمفتاح الخادم (service_role) لأنه يقرأ المفتاح الخاص من zatca_state.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { complianceCheck, complianceCsid, productionCsid, reportInvoice, summarize, tokenToCert, type Credentials } from './api';
import { buildCsr, generateKey, type ZatcaEnv } from './csr';
import { INITIAL_PIH, signInvoice, type DocType, type ZatcaInvoice } from './invoice';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;

export class ZatcaError extends Error {}

const n = (v: unknown) => Number(v ?? 0);

function meansCode(payments: { method: string; amount: number }[]): ZatcaInvoice['paymentMeans'] {
  const top = [...(payments ?? [])].sort((a, b) => n(b.amount) - n(a.amount))[0];
  return !top || top.method === 'cash' ? '10' : '48';
}

/** يحوّل صف الفاتورة من قاعدة البيانات إلى مدخلات المستند */
export function rowToInvoice(row: any, icv: number, pih: string): ZatcaInvoice {
  const s = row.seller ?? {};
  return {
    uuid: row.id,
    number: row.number,
    type: row.kind === 'credit_note' ? 'credit_note' : 'invoice',
    issuedAt: new Date(row.issued_at),
    icv,
    pih,
    refNumber: row.ref_number ?? undefined,
    reason: row.reason || undefined,
    seller: { name: s.name, vatNumber: s.vatNumber, crNumber: s.crNumber, address: s.address ?? {} },
    vatRate: n(row.vat_rate),
    lines: (row.lines ?? []).map((l: any) => ({ name: l.name, qty: n(l.qty), ex: n(l.ex), vat: n(l.vat) })),
    discountEx: n(row.discount_ex),
    totalEx: n(row.total_ex),
    vatAmount: n(row.vat_amount),
    rounding: n(row.rounding),
    total: n(row.total),
    paymentMeans: meansCode(row.payments),
  };
}

async function state(sb: Db): Promise<any> {
  const { data, error } = await sb.from('zatca_state').select('*').eq('id', 1).single();
  if (error) throw new ZatcaError(error.message);
  return data;
}

async function withLock<T>(sb: Db, fn: (holder: string) => Promise<T>): Promise<T> {
  const holder = randomUUID();
  for (let i = 0; i < 20; i++) {
    const { data, error } = await sb.rpc('zatca_try_lock', { p_holder: holder, p_seconds: 90 });
    if (error) throw new ZatcaError(error.message);
    if (data) {
      try {
        return await fn(holder);
      } finally {
        await sb.rpc('zatca_unlock', { p_holder: holder });
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new ZatcaError('BUSY');
}

/** الفواتير الحقيقية تُوقَّع وتُبلَّغ في بيئة الإنتاج فقط؛ بيئتا الاختبار للتجربة بنماذج */
export const isLive = (st: any) => st.environment === 'production' && st.status === 'ready' && !!st.production_cert;

/** يوقّع الفواتير المعلّقة بترتيبها حتى seq المطلوب (أو كلها) */
export async function signPending(sb: Db, upToSeq?: number): Promise<{ signed: number }> {
  return withLock(sb, async (holder) => {
    let st = await state(sb);
    if (!isLive(st)) return { signed: 0 };
    const cert = tokenToCert(st.production_cert);
    let signed = 0;
    for (;;) {
      let q = sb.from('invoices').select('*').eq('zatca_status', 'pending').order('seq').limit(25);
      if (upToSeq != null) q = q.lte('seq', upToSeq);
      const { data: rows, error } = await q;
      if (error) throw new ZatcaError(error.message);
      if (!rows?.length) break;
      for (const row of rows) {
        const icv = n(st.last_icv) + 1;
        const doc = rowToInvoice(row, icv, st.last_hash);
        const s = signInvoice(doc, cert, st.private_key);
        const { error: e } = await sb.rpc('zatca_save_signed', {
          p_id: row.id, p_holder: holder, p_icv: icv, p_pih: st.last_hash, p_hash: s.hash, p_qr: s.qr, p_xml: s.xml,
        });
        if (e) throw new ZatcaError(e.message);
        st = { ...st, last_icv: icv, last_hash: s.hash };
        signed++;
      }
      if (rows.length < 25) break;
    }
    return { signed };
  });
}

/** يبلّغ الهيئة بالفواتير الموقّعة. الرفض يُحفظ للمراجعة، وأخطاء الشبكة تُعاد لاحقاً */
export async function reportSigned(sb: Db, limit = 40): Promise<{ reported: number; rejected: number; failed: number }> {
  const st = await state(sb);
  if (!isLive(st)) return { reported: 0, rejected: 0, failed: 0 };
  const creds: Credentials = { token: st.production_cert, secret: st.production_secret };
  const { data: rows, error } = await sb.from('invoices').select('id, seq, invoice_hash, xml, report_attempts')
    .eq('zatca_status', 'signed').order('seq').limit(limit);
  if (error) throw new ZatcaError(error.message);
  const out = { reported: 0, rejected: 0, failed: 0 };
  for (const row of rows ?? []) {
    let status: string | null = null;
    let response: unknown = null;
    try {
      const r = await reportInvoice(st.environment as ZatcaEnv, creds, { hash: row.invoice_hash, uuid: row.id, xml: row.xml });
      response = { http: r.status, ...(typeof r.body === 'object' ? r.body : { text: r.body }) };
      if (r.status === 200) status = 'reported';
      else if (r.status === 202) status = 'warning';
      else if (r.status === 400) status = 'rejected';
    } catch (e) {
      response = { error: String(e) };
    }
    await sb.from('invoices').update({
      zatca_status: status ?? 'signed', zatca_response: response, report_attempts: n(row.report_attempts) + 1,
      reported_at: status && status !== 'rejected' ? new Date().toISOString() : null,
    }).eq('id', row.id);
    if (status === 'reported' || status === 'warning') out.reported++;
    else if (status === 'rejected') out.rejected++;
    else out.failed++;
  }
  return out;
}

export interface OnboardInput {
  environment: ZatcaEnv;
  otp: string;
  vatNumber: string;
  orgName: string;
  branchName: string;
  industry: string;
  location: string;
}

/** التسجيل الكامل: مفتاح جديد، شهادة امتثال، ثلاثة فحوص نموذجية، ثم شهادة الإنتاج */
export async function onboard(sb: Db, input: OnboardInput): Promise<{ ok: boolean; steps: { name: string; ok: boolean; detail: unknown }[] }> {
  const { data: settings, error } = await sb.from('settings').select('*').eq('id', 1).single();
  if (error) throw new ZatcaError(error.message);
  const st = await state(sb);
  const env = input.environment;
  const steps: { name: string; ok: boolean; detail: unknown }[] = [];
  const fail = async (msg: string) => {
    await sb.from('zatca_state').update({ last_error: msg, compliance_results: steps }).eq('id', 1);
    return { ok: false, steps };
  };

  const key = generateKey();
  const csr = buildCsr(key, {
    env, vatNumber: input.vatNumber, orgName: input.orgName, branchName: input.branchName,
    commonName: `Misdar-POS-${String(st.egs_serial).slice(0, 8)}`, serial: `1-Misdar|2-Web|3-${st.egs_serial}`,
    location: input.location, industry: input.industry,
  });

  const c = await complianceCsid(env, csr, input.otp);
  steps.push({ name: 'شهادة الامتثال', ok: c.status === 200, detail: c.status === 200 ? { requestID: c.body.requestID } : c.body });
  if (c.status !== 200) return fail('COMPLIANCE_CSID ' + c.status);
  const compliance: Credentials = { token: c.body.binarySecurityToken, secret: c.body.secret };
  await sb.from('zatca_state').update({
    environment: env, status: 'compliance', private_key: key, csr, compliance_cert: compliance.token,
    compliance_secret: compliance.secret, compliance_request_id: String(c.body.requestID), last_error: null,
  }).eq('id', 1);

  // فواتير نموذجية بسلسلتها الخاصة، لا تمس سلسلة الفواتير الحقيقية
  const seller = {
    name: settings.legal_name || settings.store_name, vatNumber: input.vatNumber, crNumber: settings.cr_number || '0000000000',
    address: settings.address,
  };
  let pih = INITIAL_PIH;
  const types: [DocType, string][] = [['invoice', 'فاتورة مبسطة'], ['credit_note', 'إشعار دائن'], ['debit_note', 'إشعار مدين']];
  for (const [i, [type, label]] of types.entries()) {
    const doc: ZatcaInvoice = {
      uuid: randomUUID(), number: `TEST-${i + 1}`, type, issuedAt: new Date(), icv: i + 1, pih,
      refNumber: type === 'invoice' ? undefined : 'TEST-1', reason: type === 'invoice' ? undefined : 'اختبار',
      seller, vatRate: 15, lines: [{ name: 'قهوة سودانية', qty: 1, ex: 4.35, vat: 0.65 }],
      discountEx: 0, totalEx: 4.35, vatAmount: 0.65, rounding: 0, total: 5, paymentMeans: '10',
    };
    const s = signInvoice(doc, tokenToCert(compliance.token), key);
    const r = await complianceCheck(env, compliance, { hash: s.hash, uuid: doc.uuid, xml: s.xml });
    const sum = summarize(r.body);
    const ok = r.status === 200 || r.status === 202;
    steps.push({ name: 'فحص ' + label, ok, detail: { http: r.status, status: (r.body as any)?.reportingStatus, ...sum } });
    if (!ok) return fail('COMPLIANCE_CHECK ' + label);
    pih = s.hash;
  }

  const p = await productionCsid(env, compliance, String(c.body.requestID));
  steps.push({ name: 'شهادة الإنتاج', ok: p.status === 200, detail: p.status === 200 ? { requestID: p.body.requestID } : p.body });
  if (p.status !== 200) return fail('PRODUCTION_CSID ' + p.status);

  // سلسلة الإنتاج تبدأ من أولها إن لم تُوقَّع فاتورة حقيقية من قبل
  const { count } = await sb.from('invoices').select('id', { count: 'exact', head: true }).not('icv', 'is', null);
  await sb.from('zatca_state').update({
    status: 'ready', production_cert: p.body.binarySecurityToken, production_secret: p.body.secret,
    onboarded_at: new Date().toISOString(), compliance_results: steps, last_error: null,
    ...(env === 'production' && !count ? { last_icv: 0, last_hash: INITIAL_PIH } : {}),
  }).eq('id', 1);
  return { ok: true, steps };
}

export async function resetOnboarding(sb: Db): Promise<void> {
  await sb.from('zatca_state').update({
    status: 'none', private_key: null, csr: null, compliance_cert: null, compliance_secret: null, compliance_request_id: null,
    production_cert: null, production_secret: null, onboarded_at: null, compliance_results: null, last_error: null,
  }).eq('id', 1);
}
