import { useState } from 'react';
import { describeOrderLine, sar } from '../lib/format';
import type { Order } from '../lib/types';
import { Dialog, ErrorBox, Page, dateTime, ok, rpc, useAction, useData, useStaff } from './shared';

interface Customer { id: string; phone: string; stamps: number; points: number; orders: number; spent: number; lastOrder: string | null; createdAt: string }
interface Detail { orders: Order[]; ledger: { kind: string; points: number; stamps: number; note: string; orderNumber: string; createdAt: string }[] }

const KIND: Record<string, string> = { earn: 'كسب', redeem: 'استبدال نقاط', free_cup: 'كوب مجاني', refund: 'إعادة بعد إلغاء', adjust: 'تعديل يدوي', reverse: 'عكس بعد استرجاع' };

export function Customers() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const list = useData(() => rpc<Customer[]>('staff_customers', { p_search: term }), [term]);
  const [open, setOpen] = useState<Customer | null>(null);
  return (
    <Page title="العملاء">
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <input className="input" dir="ltr" placeholder="05XXXXXXXX" aria-label="بحث بالجوال" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-ink">بحث</button>
      </form>
      <ErrorBox text={list.error} />
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>الجوال</th><th>الأختام</th><th>النقاط</th><th>الطلبات</th><th>إجمالي الإنفاق</th><th>آخر طلب</th></tr></thead>
          <tbody>
            {(list.data ?? []).map((c) => (
              <tr key={c.id} className="click" tabIndex={0} onClick={() => setOpen(c)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(c); }}>
                <td dir="ltr"><b>{c.phone}</b></td><td className="num">{c.stamps}</td><td className="num">{c.points}</td>
                <td className="num">{c.orders}</td><td className="num">{sar(c.spent)}</td><td>{c.lastOrder ? dateTime(c.lastOrder) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.loaded && !list.data?.length ? <p className="empty">لا عملاء بعد. يُسجَّل العميل عند أول طلب بجواله.</p> : null}
      </div>
      {open ? <CustomerDialog c={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} /> : null}
    </Page>
  );
}

function CustomerDialog({ c, onClose, onChanged }: { c: Customer; onClose: () => void; onChanged: () => void }) {
  const { can } = useStaff();
  const d = useData(() => rpc<Detail>('staff_customer_detail', { p_id: c.id }), [c.id]);
  const [points, setPoints] = useState('');
  const [stamps, setStamps] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction();
  return (
    <Dialog title={c.phone} onClose={onClose} wide>
      <div className="grid">
        <div className="stat"><span className="label">الأختام</span><span className="value">{c.stamps}</span></div>
        <div className="stat"><span className="label">النقاط</span><span className="value">{c.points}</span></div>
        <div className="stat"><span className="label">الإنفاق</span><span className="value">{sar(c.spent)}</span><span className="sub">{c.orders} طلب</span></div>
      </div>
      {can('owner', 'manager') ? (
        <div className="panel">
          <h2>تعديل الرصيد</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input num" style={{ maxWidth: 110 }} type="number" placeholder="± نقاط" aria-label="النقاط" value={points} onChange={(e) => setPoints(e.target.value)} />
            <input className="input num" style={{ maxWidth: 110 }} type="number" placeholder="± أختام" aria-label="الأختام" value={stamps} onChange={(e) => setStamps(e.target.value)} />
            <input className="input grow" placeholder="السبب" aria-label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <ErrorBox text={act.error} />
          <button type="button" className="btn btn-line" disabled={act.busy || !reason.trim() || (!Number(points) && !Number(stamps))}
            onClick={() => void act.run(() => ok(rpc('staff_adjust_loyalty', { p_id: c.id, p_points: Number(points) || 0, p_stamps: Number(stamps) || 0, p_reason: reason.trim() })))
              .then((r) => { if (!r) return; setPoints(''); setStamps(''); setReason(''); void d.reload(); onChanged(); })}>حفظ التعديل</button>
        </div>
      ) : null}
      <div className="grid-2">
        <div className="panel">
          <h2>آخر الطلبات</h2>
          <div className="list">
            {(d.data?.orders ?? []).map((o) => (
              <div className="li" key={o.id}><span><b dir="ltr">{o.number}</b> · {o.lines.map((l) => describeOrderLine(l).title).join('، ')}<br /><span className="small mute">{dateTime(o.createdAt)}</span></span><span className="num">{sar(o.total)}</span></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h2>حركات المكافآت</h2>
          <div className="list">
            {(d.data?.ledger ?? []).map((l, i) => (
              <div className="li" key={i}><span>{KIND[l.kind] ?? l.kind}{l.orderNumber ? ' · ' + l.orderNumber : ''}{l.note ? ' · ' + l.note : ''}<br /><span className="small mute">{dateTime(l.createdAt)}</span></span>
                <span className="num small">{l.points ? (l.points > 0 ? '+' : '') + l.points + ' نقطة' : ''}{l.stamps ? ' ' + (l.stamps > 0 ? '+' : '') + l.stamps + ' ختم' : ''}</span></div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
