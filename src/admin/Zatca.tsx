import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mode } from '../lib/api';
import { useApp } from '../state';
import { Dialog, ErrorBox, Page, dateTime, ok, rpc, useAction, useData, useStaff } from './shared';

type Env = 'sandbox' | 'simulation' | 'production';
interface Status {
  environment: Env | null; status: 'none' | 'compliance' | 'ready' | 'error'; egsSerial: string | null; onboardedAt: string | null;
  lastError: string | null; lastIcv: number; hasCertificate: boolean; complianceResults: unknown;
  pending: number; signed: number; reported: number; warning: number; rejected: number; oldestPending: string | null;
}
interface Step { name: string; ok: boolean; detail: unknown }

const ENV_LABEL: Record<Env, string> = { sandbox: 'بيئة المطورين (تجريبية)', simulation: 'بيئة المحاكاة', production: 'البيئة الفعلية' };
const STATUS_LABEL: Record<Status['status'], [string, string]> = {
  none: ['غير مربوط', ''], compliance: ['فحص الامتثال لم يكتمل', 'warn'], ready: ['مربوط وجاهز', 'ok'], error: ['خطأ', 'bad'],
};

export function Zatca() {
  const { can } = useStaff();
  const { menu } = useApp();
  const st = useData(() => rpc<Status>('staff_zatca_status'), []);
  const [onboarding, setOnboarding] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [msg, setMsg] = useState('');
  const act = useAction();
  const s = st.data;
  const vatOn = !!menu?.settings.vatEnabled;
  const live = s?.environment === 'production' && s.status === 'ready';
  const overdue = s?.oldestPending ? Date.now() - new Date(s.oldestPending).getTime() > 20 * 3600 * 1000 : false;

  const sync = () => void act.run(async () => {
    const r = await api.staff.fn<{ signed?: number; reported?: number; rejected?: number; failed?: number }>('zatca', { action: 'sync' });
    setMsg(`وُقّعت ${r.signed ?? 0} وأُبلغ عن ${r.reported ?? 0}${r.rejected ? ` · رُفضت ${r.rejected}` : ''}${r.failed ? ` · تعذّر ${r.failed} وستُعاد المحاولة` : ''}.`);
    await st.reload();
  });

  return (
    <Page title="الربط مع هيئة الزكاة والضريبة والجمارك" actions={live ? <button type="button" className="btn btn-ink" disabled={act.busy} onClick={sync}>مزامنة الآن</button> : null}>
      {mode === 'demo' ? <div className="notice">هذه نسخة العرض: الربط الفعلي يعمل بعد النشر على Netlify وربط Supabase. يمكنك استعراض الصفحة فقط.</div> : null}
      {!vatOn ? (
        <div className="notice">المنشأة غير مسجّلة في ضريبة القيمة المضافة حالياً، لذا تصدر الفواتير دون ضريبة ولا تُرسل للهيئة. عند التسجيل: فعّل الضريبة وأدخل الرقم الضريبي من <Link to="/admin/settings">الإعدادات</Link>، ثم اربط الجهاز هنا.</div>
      ) : null}
      <ErrorBox text={st.error || act.error} />
      {msg ? <div className="notice" role="status">{msg}</div> : null}
      {s ? (
        <>
          <div className="grid">
            <div className="stat"><span className="label">حالة الربط</span><span className="value" style={{ fontSize: 20 }}><span className={'badge ' + STATUS_LABEL[s.status][1]}>{STATUS_LABEL[s.status][0]}</span></span>
              <span className="sub">{s.environment ? ENV_LABEL[s.environment] : 'لم يُسجَّل جهاز بعد'}</span></div>
            <div className="stat"><span className="label">بانتظار الإبلاغ</span><span className="value">{s.pending + s.signed}</span>
              <span className="sub">{s.oldestPending ? 'أقدمها ' + dateTime(s.oldestPending) : 'لا شيء معلق'}</span></div>
            <div className="stat"><span className="label">أُبلغ عنها</span><span className="value">{s.reported + s.warning}</span><span className="sub">{s.warning ? s.warning + ' مع تحذيرات' : 'بلا تحذيرات'}</span></div>
            <div className="stat"><span className="label">مرفوضة</span><span className="value" style={{ color: s.rejected ? 'var(--bad)' : undefined }}>{s.rejected}</span><span className="sub">آخر عداد {s.lastIcv}</span></div>
          </div>
          {overdue ? <div className="error" role="alert">توجد فواتير معلقة منذ أكثر من 20 ساعة. المهلة النظامية للإبلاغ 24 ساعة من الإصدار: اضغط «مزامنة الآن» وتحقق من رسالة الخطأ.</div> : null}
          {s.lastError ? <div className="error" role="alert">آخر خطأ: <span dir="ltr">{s.lastError}</span></div> : null}
          {s.rejected ? <div className="notice">راجع الفواتير المرفوضة وأسباب الرفض من <Link to="/admin/invoices">صفحة الفواتير</Link> (عمود «الهيئة»).</div> : null}

          <div className="grid-2">
            <div className="panel">
              <h2>كيف يعمل الربط</h2>
              <ol className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.9 }}>
                <li>كل بيع يصدر فاتورة ضريبية مبسطة برقم تسلسلي وعداد وتجزئة مرتبطة بالفاتورة السابقة.</li>
                <li>يوقّع الخادم الفاتورة بشهادة الجهاز، ويطبع الإيصال رمز QR الموقّع.</li>
                <li>تُبلَّغ الهيئة تلقائياً كل 10 دقائق (الحد النظامي 24 ساعة)، والمرتجعات تصدر إشعارات دائنة.</li>
                <li>البيئة التجريبية والمحاكاة للاختبار فقط ولا تُعد فواتير نظامية.</li>
              </ol>
            </div>
            {can('owner') ? (
              <div className="panel">
                <h2>تسجيل الجهاز</h2>
                <p className="small mute">ابدأ بالبيئة التجريبية للتأكد من سلامة الفواتير، ثم سجّل في البيئة الفعلية برمز OTP من بوابة «فاتورة».</p>
                {s.hasCertificate ? <span className="small">الجهاز الحالي: <span dir="ltr">{s.egsSerial}</span>{s.onboardedAt ? ' · منذ ' + dateTime(s.onboardedAt) : ''}</span> : null}
                <div className="row" style={{ gap: 8, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-olive" disabled={!vatOn} onClick={() => setOnboarding(true)}>{s.hasCertificate ? 'إعادة التسجيل' : 'تسجيل الجهاز'}</button>
                  {s.hasCertificate ? (confirmReset
                    ? <button type="button" className="btn btn-line" disabled={act.busy} onClick={() => void act.run(() => ok(api.staff.fn('zatca', { action: 'reset' }))).then((r) => { if (!r) return; setConfirmReset(false); void st.reload(); })}>تأكيد فك الربط</button>
                    : <button type="button" className="btn btn-plain" onClick={() => setConfirmReset(true)}>فك الربط</button>) : null}
                </div>
                {!vatOn ? <span className="small mute">يتطلب تفعيل الضريبة والرقم الضريبي أولاً.</span> : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {onboarding && menu ? <Onboard vat={menu.settings.vatNumber} name={menu.settings.legalName || menu.settings.storeName} city={menu.settings.address.city}
        onClose={() => setOnboarding(false)} onDone={() => void st.reload()} /> : null}
    </Page>
  );
}

const STEP_LABEL: Record<string, string> = {
  csr: 'إنشاء المفتاح وطلب الشهادة', compliance_csid: 'شهادة الامتثال', compliance_invoices: 'فواتير فحص الامتثال', production_csid: 'شهادة الإنتاج',
};

function Onboard({ vat, name, city, onClose, onDone }: { vat: string; name: string; city: string; onClose: () => void; onDone: () => void }) {
  const [env, setEnv] = useState<Env>('sandbox');
  const [otp, setOtp] = useState('');
  const [org, setOrg] = useState(/^[\x20-\x7e]*$/.test(name) && name ? name : 'Misdar Cafe');
  const [branch, setBranch] = useState('Main Branch');
  const [location, setLocation] = useState(/^[\x20-\x7e]*$/.test(city) && city ? city : 'Riyadh');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const act = useAction();
  const go = () => void act.run(async () => {
    const r = await api.staff.fn<{ ok: boolean; steps: Step[] }>('zatca', {
      action: 'onboard', environment: env, otp, vatNumber: vat, orgName: org, branchName: branch, industry: 'Food and Beverage', location,
    });
    setSteps(r.steps);
    onDone();
  });
  return (
    <Dialog title="تسجيل جهاز الفوترة" onClose={onClose} wide>
      <div className="seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {(['sandbox', 'simulation', 'production'] as Env[]).map((e) => <button key={e} type="button" className={env === e ? 'on' : ''} onClick={() => setEnv(e)}>{ENV_LABEL[e]}</button>)}
      </div>
      {env === 'sandbox' ? <span className="small mute">لا تحتاج OTP: تستخدم الهيئة رمزاً ثابتاً للاختبار. مناسبة للتحقق من أن الفواتير تجتاز الفحص.</span> : (
        <div className="field"><label htmlFor="otp">رمز OTP (6 أرقام) من بوابة فاتورة {env === 'simulation' ? 'للمحاكاة' : ''}</label>
          <input id="otp" className="input num" dir="ltr" inputMode="numeric" maxLength={6} style={{ maxWidth: 160 }} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
          <span className="small mute">من fatoora.zatca.gov.sa ← تسجيل وحدة حلول جديدة ← توليد رمز. صالح لمدة ساعة.</span></div>
      )}
      {env === 'production' ? <div className="notice">بعد التسجيل الفعلي تُبلَّغ كل فاتورة تصدر من الكاشير والموقع للهيئة، ولا يمكن حذفها أو تعديلها.</div> : null}
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label htmlFor="z-vat">الرقم الضريبي</label><input id="z-vat" className="input num" dir="ltr" value={vat} readOnly /></div>
        <div className="field grow"><label htmlFor="z-org">اسم المنشأة بالإنجليزية</label><input id="z-org" className="input" dir="ltr" value={org} onChange={(e) => setOrg(e.target.value)} /></div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label htmlFor="z-branch">اسم الفرع بالإنجليزية</label><input id="z-branch" className="input" dir="ltr" value={branch} onChange={(e) => setBranch(e.target.value)} /></div>
        <div className="field grow"><label htmlFor="z-loc">الموقع</label><input id="z-loc" className="input" dir="ltr" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
      </div>
      <ErrorBox text={act.error} />
      {steps ? (
        <div className="list">
          {steps.map((x, i) => (
            <div className="li" key={i}><span>{STEP_LABEL[x.name] ?? x.name}</span><span className={'badge ' + (x.ok ? 'ok' : 'bad')}>{x.ok ? 'نجح' : 'فشل'}</span></div>
          ))}
          {steps.some((x) => !x.ok) ? <pre className="small" dir="ltr" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(steps.find((x) => !x.ok)?.detail, null, 2)}</pre> : null}
        </div>
      ) : null}
      <button type="button" className="btn btn-ink" disabled={act.busy || (env !== 'sandbox' && otp.length !== 6)} onClick={go}>{act.busy ? 'جارٍ التسجيل…' : 'ابدأ التسجيل'}</button>
    </Dialog>
  );
}
