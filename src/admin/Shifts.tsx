import { useState } from 'react';
import { sar } from '../lib/format';
import type { Shift } from '../lib/types';
import { Dialog, ErrorBox, Page, dateTime, rpc, time, useAction, useData, useStaff } from './shared';

export function Shifts() {
  const { can } = useStaff();
  const cur = useData(() => rpc<Shift | null>('staff_current_shift'), [], true);
  const history = useData(() => (can('owner', 'manager') ? rpc<Shift[]>('staff_shifts', { p_limit: 40 }) : Promise.resolve([] as Shift[])), []);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closed, setClosed] = useState<Shift | null>(null);

  return (
    <Page title="الورديات والصندوق">
      <ErrorBox text={cur.error} />
      {cur.loaded && !cur.data ? <OpenForm onDone={() => { void cur.reload(); void history.reload(); }} /> : null}
      {cur.data ? (
        <div className="grid-2">
          <ShiftSummary s={cur.data} title="ورديتي الحالية" />
          <div className="stack" style={{ gap: 16 }}>
            <CashMoveForm onDone={(s) => cur.setData(s)} />
            <button type="button" className="btn btn-ink btn-block" onClick={() => setCloseOpen(true)}>إغلاق الوردية وجرد الدرج</button>
          </div>
        </div>
      ) : null}
      {closed ? <ShiftSummary s={closed} title="ملخص الوردية المغلقة" /> : null}
      {can('owner', 'manager') ? (
        <div className="panel">
          <h2>سجل الورديات</h2>
          <div className="scroll-x" style={{ border: 0 }}>
            <table className="tbl">
              <thead><tr><th>الموظف</th><th>الفتح</th><th>الإغلاق</th><th>طلبات</th><th>نقد</th><th>شبكة</th><th>المتوقع</th><th>المعدود</th><th>الفرق</th></tr></thead>
              <tbody>
                {(history.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>{s.staffName}</td><td>{dateTime(s.openedAt)}</td><td>{s.closedAt ? time(s.closedAt) : <span className="badge olive">مفتوحة</span>}</td>
                    <td className="num">{s.orders}</td><td className="num">{sar(s.cashSales)}</td><td className="num">{sar(s.cardSales)}</td>
                    <td className="num">{sar(s.expectedCash)}</td><td className="num">{s.countedCash == null ? '—' : sar(s.countedCash)}</td>
                    <td>{s.difference == null ? '—' : <span className={'badge ' + (s.difference === 0 ? 'good' : s.difference < 0 ? 'bad' : 'warn')}>{sar(s.difference)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {closeOpen && cur.data ? (
        <CloseDialog s={cur.data} onClose={() => setCloseOpen(false)} onDone={(s) => { setCloseOpen(false); setClosed(s); cur.setData(null); void cur.reload(); void history.reload(); }} />
      ) : null}
    </Page>
  );
}

function ShiftSummary({ s, title }: { s: Shift; title: string }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="list">
        <div className="li"><span>الموظف</span><b>{s.staffName}</b></div>
        <div className="li"><span>الفتح</span><span>{dateTime(s.openedAt)}</span></div>
        <div className="li"><span>النقد الافتتاحي</span><span className="num">{sar(s.openingCash)}</span></div>
        <div className="li"><span>طلبات الوردية</span><span className="num">{s.orders}</span></div>
        <div className="li"><span>مبيعات نقدية</span><span className="num">+ {sar(s.cashSales)}</span></div>
        {s.cashRefunds > 0 ? <div className="li"><span>استرجاع نقدي</span><span className="num">− {sar(s.cashRefunds)}</span></div> : null}
        {s.cashIn > 0 ? <div className="li"><span>إيداع في الدرج</span><span className="num">+ {sar(s.cashIn)}</span></div> : null}
        {s.cashOut > 0 ? <div className="li"><span>سحب من الدرج</span><span className="num">− {sar(s.cashOut)}</span></div> : null}
        <div className="li"><b>النقد المتوقع في الدرج</b><b className="num">{sar(s.expectedCash)}</b></div>
        <div className="li"><span>مبيعات الشبكة (خارج الدرج)</span><span className="num">{sar(s.cardSales)}</span></div>
        {s.countedCash != null ? (
          <>
            <div className="li"><span>المعدود عند الإغلاق</span><span className="num">{sar(s.countedCash)}</span></div>
            <div className="li"><b>{s.difference === 0 ? 'مطابق' : (s.difference ?? 0) < 0 ? 'عجز' : 'زيادة'}</b><b className="num">{sar(Math.abs(s.difference ?? 0))}</b></div>
          </>
        ) : null}
      </div>
      {s.moves.length ? (
        <details><summary className="small" style={{ cursor: 'pointer' }}>حركات الدرج ({s.moves.length})</summary>
          <div className="list">{s.moves.map((m, i) => <div className="li" key={i}><span>{m.kind === 'in' ? 'إيداع' : 'سحب'}: {m.reason}</span><span className="num">{sar(m.amount)} · {time(m.at)}</span></div>)}</div>
        </details>
      ) : null}
    </div>
  );
}

function OpenForm({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState('');
  const act = useAction();
  return (
    <div className="panel" style={{ maxWidth: 460 }}>
      <h2>لا وردية مفتوحة</h2>
      <div className="field"><label htmlFor="opening">النقد الافتتاحي في الدرج (ر.س)</label>
        <input id="opening" className="input num" type="number" min={0} step="0.5" value={v} onChange={(e) => setV(e.target.value)} /></div>
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-ink" disabled={act.busy} onClick={() => void act.run(() => rpc('staff_open_shift', { p_opening: Number(v) || 0 })).then((r) => { if (r) onDone(); })}>فتح الوردية</button>
    </div>
  );
}

function CashMoveForm({ onDone }: { onDone: (s: Shift) => void }) {
  const [kind, setKind] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction();
  return (
    <div className="panel">
      <h2>حركة نقدية</h2>
      <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button type="button" className={kind === 'out' ? 'on' : ''} onClick={() => setKind('out')}>سحب من الدرج</button>
        <button type="button" className={kind === 'in' ? 'on' : ''} onClick={() => setKind('in')}>إيداع في الدرج</button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input num" style={{ maxWidth: 120 }} type="number" min={0} step="0.5" aria-label="المبلغ" placeholder="المبلغ" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="input grow" aria-label="السبب" placeholder={kind === 'out' ? 'مثال: شراء حليب' : 'مثال: فكة'} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-line" disabled={act.busy || !(Number(amount) > 0) || !reason.trim()}
        onClick={() => void act.run(() => rpc<Shift>('staff_cash_move', { p_kind: kind, p_amount: Number(amount), p_reason: reason.trim() })).then((s) => { if (s) { onDone(s); setAmount(''); setReason(''); } })}>تسجيل</button>
    </div>
  );
}

function CloseDialog({ s, onClose, onDone }: { s: Shift; onClose: () => void; onDone: (s: Shift) => void }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const act = useAction();
  const diff = counted === '' ? null : Number(counted) - s.expectedCash;
  return (
    <Dialog title="إغلاق الوردية" onClose={onClose}>
      <p>عدّ النقد في الدرج واكتب المبلغ كما هو. يظهر الفرق بعد الإغلاق.</p>
      <div className="field"><label htmlFor="counted">النقد المعدود (ر.س)</label>
        <input id="counted" className="input num" autoFocus type="number" min={0} step="0.5" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
      {diff != null && diff !== 0 ? (
        <div className="field"><label htmlFor="close-note">ملاحظة عن الفرق</label>
          <input id="close-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      ) : null}
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-ink btn-block" disabled={act.busy || counted === ''}
        onClick={() => void act.run(() => rpc<Shift>('staff_close_shift', { p_counted: Number(counted), p_note: note })).then((r) => { if (r) onDone(r); })}>إغلاق الوردية</button>
    </Dialog>
  );
}
