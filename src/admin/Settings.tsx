import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Settings } from '../lib/types';
import { useApp } from '../state';
import { ErrorBox, Page, rpc, useAction, useStaff } from './shared';

export function SettingsPage() {
  const { menu, reloadMenu } = useApp();
  const { can } = useStaff();
  const owner = can('owner');
  const [s, setS] = useState<Settings | null>(menu?.settings ?? null);
  const [msg, setMsg] = useState('');
  const act = useAction();
  useEffect(() => { if (menu && !s) setS(menu.settings); }, [menu, s]);
  if (!menu || !s) return null;

  const set = (p: Partial<Settings>) => { setS({ ...s, ...p }); setMsg(''); };
  const num = (k: keyof Settings) => (e: { target: { value: string } }) => set({ [k]: Number(e.target.value) } as Partial<Settings>);
  const save = () => {
    if (!(s.stampsForFree >= 1) || !(s.pointsPerRiyalDiscount >= 1) || s.stampMin < 0 || s.pointsPerRiyal < 0) { act.setError('تحقق من القيم: يجب أن تكون أرقاماً موجبة.'); return; }
    void act.run(async () => {
      await rpc('staff_save_settings', { p: s });
      await reloadMenu();
      setMsg('حُفظت الإعدادات.');
    });
  };
  const free = menu.items.filter((i) => i.freeCupEligible).map((i) => i.name);
  const addr = (k: keyof Settings['address']) => (e: { target: { value: string } }) => set({ address: { ...s.address, [k]: e.target.value } });

  return (
    <Page title="الإعدادات" actions={<button type="button" className="btn btn-olive" disabled={act.busy} onClick={save}>حفظ الإعدادات</button>}>
      <ErrorBox text={act.error} />
      {msg ? <div className="notice" role="status">{msg}</div> : null}
      <div className="grid-2">
        <div className="panel">
          <h2>بيانات المنشأة</h2>
          {!owner ? <span className="small mute">يعدّلها المالك فقط.</span> : null}
          <fieldset disabled={!owner} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
            <div className="field"><label htmlFor="st-name">الاسم التجاري (يظهر للعملاء)</label><input id="st-name" className="input" value={s.storeName} onChange={(e) => set({ storeName: e.target.value })} /></div>
            <div className="field"><label htmlFor="st-legal">الاسم النظامي كما في السجل</label><input id="st-legal" className="input" value={s.legalName} onChange={(e) => set({ legalName: e.target.value })} /></div>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow"><label htmlFor="st-cr">رقم السجل التجاري</label><input id="st-cr" className="input num" dir="ltr" value={s.crNumber} onChange={(e) => set({ crNumber: e.target.value })} /></div>
              <div className="field grow"><label htmlFor="st-phone">الهاتف</label><input id="st-phone" className="input num" dir="ltr" value={s.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow"><label htmlFor="ad-street">الشارع</label><input id="ad-street" className="input" value={s.address.street} onChange={addr('street')} /></div>
              <div className="field" style={{ maxWidth: 110 }}><label htmlFor="ad-bld">رقم المبنى</label><input id="ad-bld" className="input num" dir="ltr" value={s.address.building} onChange={addr('building')} /></div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow"><label htmlFor="ad-dist">الحي</label><input id="ad-dist" className="input" value={s.address.district} onChange={addr('district')} /></div>
              <div className="field grow"><label htmlFor="ad-city">المدينة</label><input id="ad-city" className="input" value={s.address.city} onChange={addr('city')} /></div>
              <div className="field" style={{ maxWidth: 110 }}><label htmlFor="ad-postal">الرمز البريدي</label><input id="ad-postal" className="input num" dir="ltr" value={s.address.postal} onChange={addr('postal')} /></div>
            </div>
          </fieldset>
        </div>

        <div className="panel">
          <h2>ضريبة القيمة المضافة</h2>
          <fieldset disabled={!owner} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
            <label className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <input type="checkbox" checked={s.vatEnabled} onChange={(e) => set({ vatEnabled: e.target.checked })} />
              <b>المنشأة مسجّلة في ضريبة القيمة المضافة</b>
            </label>
            <span className="small mute">
              {s.vatEnabled
                ? 'الفواتير الجديدة تصدر «فاتورة ضريبية مبسطة» بالرقم الضريبي، والأسعار في القائمة شاملة الضريبة. فعّل الربط مع الهيئة من صفحته.'
                : 'غير مسجّلة: تصدر «فاتورة» بلا ضريبة ولا رقم ضريبي. فعّل هذا الخيار يوم تسجيلك في الهيئة.'}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow"><label htmlFor="vat-no">الرقم الضريبي (15 رقماً)</label><input id="vat-no" className="input num" dir="ltr" maxLength={15} value={s.vatNumber} onChange={(e) => set({ vatNumber: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="field" style={{ maxWidth: 110 }}><label htmlFor="vat-rate">النسبة %</label><input id="vat-rate" className="input num" type="number" min={0} max={100} value={s.vatRate} onChange={num('vatRate')} /></div>
            </div>
            <div className="field"><label htmlFor="inv-prefix">بادئة رقم الفاتورة</label><input id="inv-prefix" className="input num" dir="ltr" style={{ maxWidth: 140 }} value={s.invoicePrefix} onChange={(e) => set({ invoicePrefix: e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 8) })} /></div>
          </fieldset>
        </div>

        <div className="panel">
          <h2>قواعد المكافآت</h2>
          <div className="field"><label htmlFor="s-min">الحد الأدنى للطلب المؤهل للختم (ر.س)</label><input id="s-min" className="input num" type="number" min={0} step="0.5" value={s.stampMin} onChange={num('stampMin')} /></div>
          <div className="field"><label htmlFor="s-n">عدد الأختام قبل الكوب المجاني</label><input id="s-n" className="input num" type="number" min={1} value={s.stampsForFree} onChange={num('stampsForFree')} /></div>
          <div className="field"><label htmlFor="s-earn">النقاط المكتسبة لكل ريال مدفوع</label><input id="s-earn" className="input num" type="number" min={0} step="0.5" value={s.pointsPerRiyal} onChange={num('pointsPerRiyal')} /></div>
          <div className="field"><label htmlFor="s-redeem">عدد النقاط التي تخصم ريالاً واحداً</label><input id="s-redeem" className="input num" type="number" min={1} value={s.pointsPerRiyalDiscount} onChange={num('pointsPerRiyalDiscount')} /></div>
          <span className="small" style={{ color: 'var(--sage-ink)' }}>الكوب المجاني: {free.length ? free.join('، ') : 'لا صنف مشمول بعد'}. غيّر الأصناف المشمولة من صفحة القائمة.</span>
        </div>

        <div className="panel">
          <h2>الإيصال</h2>
          <div className="field"><label htmlFor="r-foot">نص أسفل الإيصال</label><textarea id="r-foot" className="input" rows={3} value={s.receiptFooter} onChange={(e) => set({ receiptFooter: e.target.value })} /></div>
          <span className="small mute">الطباعة على طابعة حرارية 80 مم. لطباعة بلا نافذة تأكيد على جهاز الكاشير شغّل Chrome بخيار ‎--kiosk-printing‎ (التفاصيل في دليل التشغيل).</span>
        </div>
      </div>
      <TableCodes />
    </Page>
  );
}

function TableCodes() {
  const [tables, setTables] = useState(10);
  const [qrs, setQrs] = useState<{ n: number; src: string }[]>([]);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    let alive = true;
    const count = Math.max(0, Math.min(60, tables));
    Promise.all(Array.from({ length: count }, (_, i) =>
      QRCode.toDataURL(window.location.origin + '/t/' + (i + 1), { margin: 1, width: 320, color: { dark: '#11120F', light: '#FFFFFF' } })
        .then((src) => ({ n: i + 1, src })))).then((list) => { if (alive) setQrs(list); }).catch(() => {});
    return () => { alive = false; };
  }, [tables]);
  useEffect(() => {
    if (!printing) return;
    const style = document.createElement('style');
    style.textContent = '@page { size: A4; margin: 12mm; }';
    document.head.appendChild(style);
    document.body.classList.add('printing');
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); document.body.classList.remove('printing'); style.remove(); };
  }, [printing]);
  const grid = (
    <div className="qr-grid">
      {qrs.map((q) => (
        <div className="qr" key={q.n}>
          <img src={q.src} alt={'رمز QR لطاولة ' + q.n} />
          <b>طاولة {q.n}</b>
          <span style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--olive)' }}>مسدار</span>
        </div>
      ))}
    </div>
  );
  const root = document.getElementById('print-root');
  return (
    <div className="panel">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2>رموز الطاولات</h2>
        <span className="row">
          <label htmlFor="tables" className="small">عدد الطاولات</label>
          <input id="tables" className="input num" style={{ width: 90 }} type="number" min={1} max={60} value={tables} onChange={(e) => setTables(Number(e.target.value))} />
          <button type="button" className="btn btn-ink" onClick={() => setPrinting(true)}>طباعة</button>
        </span>
      </div>
      <p className="small mute">مسح الرمز يحدد رقم الطاولة ويجعل الطلب محلياً تلقائياً. اطبعها بعد ربط النطاق النهائي، لأن الرابط جزء من الرمز: <span dir="ltr" className="ltr">{window.location.origin}/t/1</span></p>
      {grid}
      {printing && root ? createPortal(grid, root) : null}
    </div>
  );
}
