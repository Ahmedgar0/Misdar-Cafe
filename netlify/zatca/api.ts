// عميل واجهات منصة فاتورة. كل الدوال تعيد حالة HTTP والجسم كما هو، ويُفسَّر الرد في مكان الاستدعاء.
import type { ZatcaEnv } from './csr';

export const BASE_URL: Record<ZatcaEnv, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

/** رمز OTP الثابت لبيئة المطورين */
export const SANDBOX_OTP = '123345';

export interface Credentials { token: string; secret: string }
export interface ApiResult<T = any> { status: number; body: T }

const basic = (c: Credentials) => 'Basic ' + Buffer.from(`${c.token}:${c.secret}`).toString('base64');

async function call<T>(env: ZatcaEnv, path: string, headers: Record<string, string>, body: unknown): Promise<ApiResult<T>> {
  const res = await fetch(BASE_URL[env] + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'Accept-Version': 'V2', 'Accept-Language': 'en', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* نص عادي */ }
  return { status: res.status, body: parsed as T };
}

export interface CsidBody { requestID: number | string; binarySecurityToken: string; secret: string; dispositionMessage?: string }

/** شهادة الامتثال: الطلب + رمز OTP من بوابة فاتورة */
export const complianceCsid = (env: ZatcaEnv, csrPem: string, otp: string) =>
  call<CsidBody>(env, '/compliance', { OTP: otp }, { csr: Buffer.from(csrPem).toString('base64') });

/** فحص امتثال لفاتورة نموذجية */
export const complianceCheck = (env: ZatcaEnv, c: Credentials, d: { hash: string; uuid: string; xml: string }) =>
  call(env, '/compliance/invoices', { Authorization: basic(c) },
    { invoiceHash: d.hash, uuid: d.uuid, invoice: Buffer.from(d.xml, 'utf8').toString('base64') });

/** شهادة الإنتاج بعد اجتياز فحوص الامتثال */
export const productionCsid = (env: ZatcaEnv, c: Credentials, requestId: string) =>
  call<CsidBody>(env, '/production/csids', { Authorization: basic(c) }, { compliance_request_id: requestId });

/** إبلاغ الهيئة بفاتورة مبسطة (خلال 24 ساعة من إصدارها) */
export const reportInvoice = (env: ZatcaEnv, c: Credentials, d: { hash: string; uuid: string; xml: string }) =>
  call(env, '/invoices/reporting/single', { Authorization: basic(c), 'Clearance-Status': '0' },
    { invoiceHash: d.hash, uuid: d.uuid, invoice: Buffer.from(d.xml, 'utf8').toString('base64') });

/** نص الشهادة من binarySecurityToken (الهيئة ترسله مرمّزاً مرتين) */
export const tokenToCert = (token: string) => Buffer.from(token, 'base64').toString('utf8');

/** ملخص مقروء لرد الهيئة: الأخطاء والتحذيرات */
export function summarize(body: any): { errors: string[]; warnings: string[] } {
  const v = body?.validationResults ?? {};
  const fmt = (m: any) => (typeof m === 'string' ? m : [m.code, m.message].filter(Boolean).join(': '));
  return {
    errors: (v.errorMessages ?? []).map(fmt).concat(body?.errors ? [].concat(body.errors).map(fmt) : []),
    warnings: (v.warningMessages ?? []).map(fmt),
  };
}
