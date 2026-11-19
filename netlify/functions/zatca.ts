// الربط مع الهيئة من لوحة التحكم: توقيع فاتورة للطباعة، مزامنة يدوية، تسجيل الجهاز، وإعادة الضبط.
import { HttpError, handle, json, requireStaff, serviceClient } from '../lib/server';
import { SANDBOX_OTP } from '../zatca/api';
import { ZatcaError, onboard, reportSigned, resetOnboarding, signPending } from '../zatca/service';

export default handle(async (req) => {
  const sb = serviceClient();
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case 'sign': {
        // الكاشير يطلب توقيع الفاتورة فوراً ليطبع رمز QR الموقّع
        await requireStaff(req, sb, ['owner', 'manager', 'cashier']);
        const { data: inv } = await sb.from('invoices').select('seq').eq('id', body.invoiceId).maybeSingle();
        if (!inv) throw new HttpError(404, 'NOT_FOUND');
        await signPending(sb, inv.seq);
        const { data } = await sb.from('invoices').select('zatca_status, qr').eq('id', body.invoiceId).single();
        return json(200, { status: data?.zatca_status, qr: data?.qr });
      }
      case 'sync': {
        await requireStaff(req, sb, ['owner', 'manager']);
        const signed = await signPending(sb);
        const reported = await reportSigned(sb, 100);
        return json(200, { ...signed, ...reported });
      }
      case 'onboard': {
        await requireStaff(req, sb, ['owner']);
        const env = body.environment;
        if (!['sandbox', 'simulation', 'production'].includes(env)) throw new HttpError(400, 'ENV');
        const otp = env === 'sandbox' ? SANDBOX_OTP : String(body.otp ?? '').trim();
        if (!/^\d{6}$/.test(otp)) throw new HttpError(400, 'OTP');
        const vat = String(body.vatNumber ?? '').trim();
        if (!/^3\d{13}3$/.test(vat)) throw new HttpError(400, 'VAT_NUMBER');
        const result = await onboard(sb, {
          environment: env, otp, vatNumber: vat,
          orgName: String(body.orgName || 'Misdar Cafe').slice(0, 64),
          branchName: String(body.branchName || 'Main Branch').slice(0, 64),
          industry: String(body.industry || 'Food and Beverage').slice(0, 64),
          location: String(body.location || 'Riyadh').slice(0, 64),
        });
        return json(200, result);
      }
      case 'reset': {
        await requireStaff(req, sb, ['owner']);
        await resetOnboarding(sb);
        return json(200, { ok: true });
      }
      default:
        throw new HttpError(400, 'ACTION');
    }
  } catch (e) {
    if (e instanceof ZatcaError) return json(502, { error: e.message });
    throw e;
  }
});
