import { useState } from 'react';
import { Receipt, invoiceTitle, invoiceUrl, printInvoice, useInvoiceQr } from '../components/Receipt';
import { Icon } from '../components/ui';
import { api } from '../lib/api';
import { sar } from '../lib/format';
import type { Invoice, ZatcaStatus } from '../lib/types';
import { loadInvoiceForPrint } from './Pos';
import { Dialog, ErrorBox, METHOD_LABEL, Page, dateTime, download, riyadhDate, rpc, toCsv, useAction, useData, useStaff } from './shared';

export const ZATCA_LABEL: Record<ZatcaStatus, [string, string]> = {
  not_applicable: ['بلا ضريبة', 'line'],
  pending: ['بانتظار التوقيع', 'warn'],
  signed: ['موقّعة، بانتظار الإبلاغ', 'warn'],
  reported: ['مُبلَّغة للهيئة', 'good'],
  warning: ['مُبلَّغة بتحذيرات', 'warn'],
  rejected: ['مرفوضة', 'bad'],
};

export function Invoices() {
  const [from, setFrom] = useState(riyadhDate());
  const [to, setTo] = useState(riyadhDate());
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const list = useData(() => rpc<Invoice[]>('staff_invoices', { p_from: from, p_to: to, p_search: term }), [from, to, term], true);
  const [open, setOpen] = useState<Invoice | null>(null);
  const rows = list.data ?? [];
  const sum = rows.reduce((a, i) => a + (i.kind === 'credit_note' ? -i.total : i.total), 0);
  const vat = rows.reduce((a, i) => a + (i.kind === 'credit_note' ? -i.vatAmount : i.vatAmount), 0);

  const exportCsv = () => download(`invoices-${from}-${to}.csv`, toCsv([
    ['الرقم', 'النوع', 'التاريخ', 'الطلب', 'جوال العميل', 'غير شامل الضريبة', 'الضريبة', 'الإجمالي', 'الدفع', 'حالة الهيئة', 'الفاتورة الأصلية'],
    ...rows.map((i) => [i.number, i.kind === 'credit_note' ? 'إشعار دائن' : 'فاتورة', new Date(i.issuedAt).toISOString(), i.orderNumber, i.buyerPhone,
      i.totalEx, i.vatAmount, i.total, i.payments.map((p) => METHOD_LABEL[p.method] + ' ' + p.amount).join(' + '), ZATCA_LABEL[i.zatcaStatus][0], i.refNumber]),
  ]));

  return (
    <Page title="الفواتير" actions={<button type="button" className="btn btn-plain" disabled={!rows.length} onClick={exportCsv}>تصدير CSV</button>}>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <label className="row small" style={{ gap: 6 }}>من <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="row small" style={{ gap: 6 }}>إلى <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <input className="input" placeholder="رقم الفاتورة أو الطلب أو الجوال" aria-label="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-ink">بحث</button>
      </form>
      <ErrorBox text={list.error} />
      <div className="grid">
        <div className="stat"><span className="label">عدد المستندات</span><span className="value">{rows.length}</span></div>
        <div className="stat"><span className="label">الصافي</span><span className="value">{sar(sum)}</span></div>
        <div className="stat"><span className="label">ضريبة القيمة المضافة</span><span className="value">{sar(vat)}</span></div>
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>الرقم</th><th>النوع</th><th>التاريخ</th><th>الطلب</th><th>الإجمالي</th><th>الضريبة</th><th>الدفع</th><th>الهيئة</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="click" tabIndex={0} onClick={() => setOpen(i)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(i); }}>
                <td><b dir="ltr">{i.number}</b></td>
                <td>{i.kind === 'credit_note' ? <span className="badge bad">إشعار دائن</span> : 'فاتورة'}</td>
                <td>{dateTime(i.issuedAt)}</td>
                <td dir="ltr">{i.orderNumber}</td>
                <td className="num">{i.kind === 'credit_note' ? '− ' : ''}{sar(i.total)}</td>
                <td className="num">{i.vatEnabled ? sar(i.vatAmount) : '—'}</td>
                <td>{i.payments.map((p) => METHOD_LABEL[p.method]).join(' + ') || '—'}</td>
                <td><span className={'badge ' + ZATCA_LABEL[i.zatcaStatus][1]}>{ZATCA_LABEL[i.zatcaStatus][0]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.loaded && !rows.length ? <p className="empty">لا فواتير في هذه الفترة.</p> : null}
      </div>
      {open ? <InvoiceDialog inv={open} onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}

function InvoiceDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const { can } = useStaff();
  const qr = useInvoiceQr(inv);
  const act = useAction();
  const [copied, setCopied] = useState(false);
  const print = (size: '80mm' | 'a4') => void act.run(async () => {
    const fresh = await loadInvoiceForPrint(inv.id);
    if (fresh) printInvoice(fresh, size);
  });
  const xml = () => void act.run(async () => {
    const x = await rpc<string | null>('staff_invoice_xml', { p_id: inv.id });
    if (x) download(inv.number + '.xml', x, 'application/xml');
  });
  const resp = inv.zatcaResponse as { validationResults?: { errorMessages?: { code: string; message: string }[]; warningMessages?: { code: string; message: string }[] } } | null;
  const msgs = [...(resp?.validationResults?.errorMessages ?? []), ...(resp?.validationResults?.warningMessages ?? [])];
  return (
    <Dialog title={invoiceTitle(inv) + ' ' + inv.number} onClose={onClose} wide>
      <div className="toolbar">
        <button type="button" className="btn btn-ink" disabled={act.busy} onClick={() => print('80mm')}><Icon name="print" size={18} /> إيصال 80 مم</button>
        <button type="button" className="btn btn-plain" disabled={act.busy} onClick={() => print('a4')}>فاتورة A4</button>
        <button type="button" className="btn btn-plain" onClick={() => { void navigator.clipboard?.writeText(invoiceUrl(inv.id)).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'نُسخ الرابط' : 'نسخ رابط الفاتورة'}</button>
        {can('owner', 'manager') && inv.zatcaStatus !== 'not_applicable' && inv.zatcaStatus !== 'pending' ? <button type="button" className="btn btn-plain" onClick={xml}>ملف XML</button> : null}
      </div>
      <ErrorBox text={act.error} />
      {inv.vatEnabled ? (
        <div className={'panel ' + (inv.zatcaStatus === 'rejected' ? 'bad' : inv.zatcaStatus === 'reported' ? 'sage' : 'warn')} style={{ padding: 12 }}>
          <b>{ZATCA_LABEL[inv.zatcaStatus][0]}{inv.icv ? ` · العداد ${inv.icv}` : ''}</b>
          {msgs.map((m, i) => <span className="small" key={i}>{m.code}: {m.message}</span>)}
          {api.mode === 'demo' ? <span className="small">التوقيع والإبلاغ يعملان بعد النشر.</span> : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'center' }}><Receipt inv={inv} size="a4" qr={qr} /></div>
    </Dialog>
  );
}
