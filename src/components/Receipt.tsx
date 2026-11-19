import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { sar } from '../lib/format';
import type { Invoice } from '../lib/types';

const METHOD: Record<string, string> = { cash: 'نقداً', card: 'شبكة', online: 'دفع إلكتروني' };

export function invoiceTitle(inv: Invoice): string {
  if (inv.vatEnabled) return inv.kind === 'credit_note' ? 'إشعار دائن لفاتورة ضريبية مبسطة' : 'فاتورة ضريبية مبسطة';
  return inv.kind === 'credit_note' ? 'إشعار استرجاع' : 'فاتورة';
}

export const invoiceUrl = (id: string) => window.location.origin + '/invoice/' + id;

/** تاريخ ثابت الصيغة بتوقيت الرياض: 2026-11-19 12:13 */
const dt = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

/** محتوى رمز QR: رمز الهيئة الموقّع إن وُجد، وإلا رابط الفاتورة */
export function useInvoiceQr(inv: Invoice | null): string {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!inv) return;
    let alive = true;
    QRCode.toDataURL(inv.qr || invoiceUrl(inv.id), { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then((u) => { if (alive) setSrc(u); }).catch(() => {});
    return () => { alive = false; };
  }, [inv]);
  return src;
}

export function Receipt({ inv, size, qr }: { inv: Invoice; size: '80mm' | 'a4'; qr: string }) {
  const s = inv.seller;
  const a = s.address;
  const addr = [a.building && a.street ? a.building + ' ' + a.street : a.street, a.district, a.city, a.postal].filter(Boolean).join('، ');
  const gross = inv.lines.reduce((x, l) => x + l.incl, 0);
  const credit = inv.kind === 'credit_note';
  return (
    <div className={'receipt ' + (size === '80mm' ? 'r80' : 'a4')} dir="rtl">
      <div className="c">
        <div className="store">{s.storeName || s.name}</div>
        {s.name && s.name !== s.storeName ? <div>{s.name}</div> : null}
        {addr ? <div className="muted">{addr}</div> : null}
        {s.phone ? <div className="muted" dir="ltr">{s.phone}</div> : null}
        {inv.vatEnabled ? <div>الرقم الضريبي: <span dir="ltr">{s.vatNumber}</span></div> : null}
        {s.crNumber ? <div className="muted">السجل التجاري: <span dir="ltr">{s.crNumber}</span></div> : null}
      </div>
      <div className="ttl">{invoiceTitle(inv)}</div>
      <div className="kv"><span>الرقم</span><b dir="ltr">{inv.number}</b></div>
      <div className="kv"><span>التاريخ</span><span dir="ltr">{dt(inv.issuedAt)}</span></div>
      <div className="kv"><span>الطلب</span><span><span dir="ltr">{inv.orderNumber}</span>{inv.serviceType === 'dinein' ? (inv.table ? ' · طاولة ' + inv.table : ' · محلي') : ' · سفري'}</span></div>
      {inv.cashier ? <div className="kv"><span>الكاشير</span><span>{inv.cashier}</span></div> : null}
      {credit ? (
        <>
          <div className="kv"><span>الفاتورة الأصلية</span><span dir="ltr">{inv.refNumber}</span></div>
          <div className="kv"><span>السبب</span><span>{inv.reason}</span></div>
        </>
      ) : null}
      <div style={{ marginTop: 6 }}>
        {inv.lines.map((l, i) => (
          <div className="rl" key={i}>
            <div className="top"><span>{l.name}</span><span className="num">{sar(l.incl)}</span></div>
            <div className="sub num">{l.qty} × {sar(l.unitIncl)}</div>
          </div>
        ))}
      </div>
      <div className="tot">
        <div className="kv"><span>المجموع</span><span className="num">{sar(gross)}</span></div>
        {inv.discountIncl > 0 ? <div className="kv"><span>الخصم</span><span className="num">− {sar(inv.discountIncl)}</span></div> : null}
        {inv.vatEnabled ? (
          <>
            <div className="kv"><span>الإجمالي غير شامل الضريبة</span><span className="num">{sar(inv.totalEx)}</span></div>
            <div className="kv"><span>ضريبة القيمة المضافة {inv.vatRate}%</span><span className="num">{sar(inv.vatAmount)}</span></div>
            {Math.round(inv.rounding * 100) !== 0 ? <div className="kv muted"><span>فرق التقريب</span><span className="num">{sar(inv.rounding)}</span></div> : null}
          </>
        ) : null}
        <div className="kv grand"><span>{credit ? 'المبلغ المسترد' : inv.vatEnabled ? 'الإجمالي شامل الضريبة' : 'الإجمالي'}</span><span className="num">{sar(inv.total)}</span></div>
        {inv.payments.map((p, i) => (
          <div className="kv" key={i}><span>{METHOD[p.method] ?? p.method}</span><span className="num">{sar(p.amount)}</span></div>
        ))}
      </div>
      {qr ? <img className="qr" src={qr} alt="رمز QR للفاتورة" /> : null}
      {inv.vatEnabled && !inv.qr ? <div className="c muted">رمز الهيئة يُضاف بعد توقيع الفاتورة</div> : null}
      {s.footer ? <div className="c" style={{ marginTop: 4 }}>{s.footer}</div> : null}
      {!inv.vatEnabled ? <div className="c muted">المنشأة غير مسجلة في ضريبة القيمة المضافة</div> : null}
    </div>
  );
}

// ─── الطباعة: يُرسم الإيصال خارج التطبيق ثم يُطبع وحده ───

type Job = { inv: Invoice; size: '80mm' | 'a4' } | null;
let setJob: ((j: Job) => void) | null = null;

export function printInvoice(inv: Invoice, size: '80mm' | 'a4' = '80mm') {
  setJob?.({ inv, size });
}

export function PrintHost() {
  const [job, set] = useState<Job>(null);
  const qr = useInvoiceQr(job?.inv ?? null);
  useEffect(() => {
    setJob = set;
    return () => { setJob = null; };
  }, []);
  useEffect(() => {
    if (!job || !qr) return;
    const style = document.createElement('style');
    style.textContent = job.size === '80mm' ? '@page { size: 80mm auto; margin: 0 }' : '@page { size: A4; margin: 12mm }';
    document.head.appendChild(style);
    document.body.classList.add('printing');
    const done = () => {
      document.body.classList.remove('printing');
      style.remove();
      set(null);
    };
    window.addEventListener('afterprint', done, { once: true });
    const t = window.setTimeout(() => {
      try { window.print(); } catch { done(); }
    }, 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [job, qr]);
  const root = typeof document !== 'undefined' ? document.getElementById('print-root') : null;
  if (!job || !root) return null;
  return createPortal(<Receipt inv={job.inv} size={job.size} qr={qr} />, root);
}
