import { useState } from 'react';
import { sar } from '../lib/format';
import { ErrorBox, METHOD_LABEL, Page, download, riyadhDate, rpc, toCsv, useData } from './shared';

interface Report {
  summary: { invoices: number; creditNotes: number; gross: number; discounts: number; refunds: number; net: number; netEx: number; vat: number; avgTicket: number };
  byMethod: { method: string; sales: number; refunds: number }[];
  byChannel: { channel: string; orders: number; total: number }[];
  byDay: { day: string; total: number; invoices: number }[];
  byHour: { hour: number; total: number; invoices: number }[];
  topItems: { name: string; qty: number; amount: number }[];
  byCategory: { name: string; qty: number; amount: number }[];
  vatReport: { enabled: boolean; taxableSales: number; vatOnSales: number; taxableReturns: number; vatOnReturns: number; nonTaxableSales: number };
}

const PRESETS: [string, () => [string, string]][] = [
  ['اليوم', () => [riyadhDate(), riyadhDate()]],
  ['أمس', () => [riyadhDate(-1), riyadhDate(-1)]],
  ['آخر 7 أيام', () => [riyadhDate(-6), riyadhDate()]],
  ['هذا الشهر', () => [riyadhDate().slice(0, 8) + '01', riyadhDate()]],
  ['آخر 30 يوماً', () => [riyadhDate(-29), riyadhDate()]],
];

export function Reports() {
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[0][1]());
  const r = useData(() => rpc<Report>('staff_report', { p_from: from, p_to: to }), [from, to]);
  const d = r.data;

  const exportCsv = () => d && download(`report-${from}-${to}.csv`, toCsv([
    ['البند', 'القيمة'],
    ['الفواتير', d.summary.invoices], ['إشعارات الدائن', d.summary.creditNotes], ['إجمالي المبيعات قبل الخصم', d.summary.gross],
    ['الخصومات', d.summary.discounts], ['المسترجع', d.summary.refunds], ['الصافي', d.summary.net], ['ضريبة القيمة المضافة', d.summary.vat],
    [], ['الصنف', 'الكمية', 'المبلغ'], ...d.topItems.map((i) => [i.name, i.qty, i.amount]),
    [], ['اليوم', 'الصافي', 'الفواتير'], ...d.byDay.map((x) => [x.day, x.total, x.invoices]),
  ]));

  return (
    <Page title="التقارير" actions={<button type="button" className="btn btn-plain" disabled={!d} onClick={exportCsv}>تصدير CSV</button>}>
      <div className="toolbar">
        {PRESETS.map(([label, fn]) => {
          const [a, b] = fn();
          return <button key={label} type="button" className={'chip' + (a === from && b === to ? ' on' : '')} onClick={() => setRange([a, b])}>{label}</button>;
        })}
        <label className="row small" style={{ gap: 6 }}>من <input className="input" type="date" value={from} onChange={(e) => setRange([e.target.value, to])} /></label>
        <label className="row small" style={{ gap: 6 }}>إلى <input className="input" type="date" value={to} onChange={(e) => setRange([from, e.target.value])} /></label>
      </div>
      <ErrorBox text={r.error} />
      {d ? (
        <>
          <div className="grid">
            <div className="stat olive"><span className="label">صافي المبيعات</span><span className="value">{sar(d.summary.net)}</span><span className="sub">بعد الخصومات والمسترجع</span></div>
            <div className="stat"><span className="label">الفواتير</span><span className="value">{d.summary.invoices}</span><span className="sub">متوسط {sar(d.summary.avgTicket)}</span></div>
            <div className="stat"><span className="label">الخصومات</span><span className="value">{sar(d.summary.discounts)}</span><span className="sub">نقاط وخصم يدوي</span></div>
            <div className="stat"><span className="label">المسترجع</span><span className="value">{sar(d.summary.refunds)}</span><span className="sub">{d.summary.creditNotes} إشعار دائن</span></div>
          </div>

          <div className="grid-2">
            <div className="panel">
              <h2>{d.byDay.length > 1 ? 'المبيعات حسب اليوم' : 'المبيعات حسب الساعة'}</h2>
              {d.byDay.length > 1
                ? <Bars data={d.byDay.map((x) => ({ label: x.day.slice(5), value: x.total, title: `${x.day}: ${sar(x.total)} · ${x.invoices} فاتورة` }))} />
                : <Bars data={Array.from({ length: 24 }, (_, h) => { const x = d.byHour.find((y) => y.hour === h); return { label: String(h), value: x?.total ?? 0, title: `${h}:00 — ${sar(x?.total ?? 0)} · ${x?.invoices ?? 0} فاتورة` }; }).filter((_, h) => h >= 6 || d.byHour.some((y) => y.hour === h))} />}
            </div>
            <div className="panel">
              <h2>طرق الدفع</h2>
              <HBars rows={d.byMethod.map((m) => ({ label: METHOD_LABEL[m.method] ?? m.method, value: m.sales, note: m.refunds ? `مسترجع ${sar(m.refunds)}` : '' }))} />
              <h2>القنوات</h2>
              <HBars rows={d.byChannel.map((c) => ({ label: c.channel === 'pos' ? 'الكاشير' : 'الموقع', value: c.total, note: `${c.orders} طلب` }))} />
            </div>
            <div className="panel">
              <h2>الأكثر مبيعاً</h2>
              <table className="tbl"><thead><tr><th>الصنف</th><th>الكمية</th><th>المبلغ</th></tr></thead>
                <tbody>{d.topItems.map((i) => <tr key={i.name}><td>{i.name}</td><td className="num">{i.qty}</td><td className="num">{sar(i.amount)}</td></tr>)}</tbody></table>
              {!d.topItems.length ? <p className="empty">لا مبيعات.</p> : null}
            </div>
            <div className="panel">
              <h2>الأقسام</h2>
              <HBars rows={d.byCategory.map((c) => ({ label: c.name, value: c.amount, note: `${c.qty} قطعة` }))} />
            </div>
            <div className="panel">
              <h2>تقرير ضريبة القيمة المضافة</h2>
              {!d.vatReport.enabled && d.vatReport.taxableSales === 0 ? <p className="mute">المنشأة غير مسجلة ضريبياً. المبيعات غير الخاضعة: {sar(d.vatReport.nonTaxableSales)}</p> : (
                <div className="list">
                  <div className="li"><span>المبيعات الخاضعة (غير شاملة)</span><b className="num">{sar(d.vatReport.taxableSales)}</b></div>
                  <div className="li"><span>ضريبة المبيعات</span><b className="num">{sar(d.vatReport.vatOnSales)}</b></div>
                  <div className="li"><span>المرتجعات (غير شاملة)</span><span className="num">{sar(d.vatReport.taxableReturns)}</span></div>
                  <div className="li"><span>ضريبة المرتجعات</span><span className="num">{sar(d.vatReport.vatOnReturns)}</span></div>
                  <div className="li"><b>صافي الضريبة المستحقة</b><b className="num">{sar(d.vatReport.vatOnSales - d.vatReport.vatOnReturns)}</b></div>
                  {d.vatReport.nonTaxableSales ? <div className="li"><span>مبيعات قبل تفعيل الضريبة</span><span className="num">{sar(d.vatReport.nonTaxableSales)}</span></div> : null}
                </div>
              )}
              <span className="small mute">للاسترشاد عند تعبئة الإقرار. راجع محاسبك قبل التقديم.</span>
            </div>
          </div>
        </>
      ) : null}
    </Page>
  );
}

function Bars({ data }: { data: { label: string; value: number; title: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.some((d) => d.value)) return <p className="empty">لا مبيعات في هذه الفترة.</p>;
  return (
    <div>
      <div className="bars" role="img" aria-label="رسم المبيعات">
        {data.map((d, i) => <div key={i} className="bar" title={d.title} style={{ height: `${(d.value / max) * 100}%`, opacity: d.value ? 1 : 0.15 }} />)}
      </div>
      <div className="bars-x">{data.map((d, i) => <span key={i}>{d.label}</span>)}</div>
    </div>
  );
}

function HBars({ rows }: { rows: { label: string; value: number; note: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="empty">لا بيانات.</p>;
  return (
    <div className="stack">
      {rows.map((r) => (
        <div className="hbar" key={r.label}>
          <span>{r.label}</span>
          <span className="track"><span className="fill" style={{ display: 'block', width: `${(r.value / max) * 100}%` }} /></span>
          <span className="num">{sar(r.value)}{r.note ? <span className="small mute"> · {r.note}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
