import { useEffect, useState } from 'react';
import { printInvoice } from '../components/Receipt';
import { describeOrderLine, orderWhere, sar, tempLabel } from '../lib/format';
import type { Order, OrderStatus, WaiterCall } from '../lib/types';
import { useApp } from '../state';
import { loadInvoiceForPrint } from './Pos';
import { Dialog, ErrorBox, METHOD_LABEL, Page, dateTime, rpc, time, useAction, useData, useStaff } from './shared';

const STATUS: Record<OrderStatus, string> = {
  awaiting_payment: 'بانتظار الدفع', waiting_arrival: 'بانتظار الوصول', new: 'جديد', preparing: 'قيد التحضير',
  ready: 'جاهز', done: 'سُلّم', cancelled: 'ملغى', refunded: 'مسترجع',
};

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

export function Orders() {
  const { can } = useStaff();
  const orders = useData(() => rpc<Order[]>('staff_orders'), [], true);
  const calls = useData(() => rpc<WaiterCall[]>('staff_waiter_calls'), [], true);
  const [tab, setTab] = useState<'board' | 'search' | 'items'>('board');
  const act = useAction();
  const now = useNow();

  const set = (o: Order, status: OrderStatus) => void act.run(() => rpc('staff_set_order_status', { p_id: o.id, p_status: status })).then(() => orders.reload());
  const list = orders.data ?? [];
  const col = (st: OrderStatus[]) => list.filter((o) => st.includes(o.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const waiting = col(['waiting_arrival', 'awaiting_payment']);

  return (
    <Page title="الطلبات" actions={
      <div className="seg" style={{ gridTemplateColumns: 'repeat(3, auto)' }}>
        <button type="button" className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>شاشة التحضير</button>
        {can('owner', 'manager', 'cashier') ? <button type="button" className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>بحث واسترجاع</button> : null}
        <button type="button" className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>الأصناف النافدة</button>
      </div>
    }>
      <ErrorBox text={orders.error || act.error} />
      {(calls.data ?? []).length > 0 ? (
        <div className="grid">
          {calls.data!.map((c) => (
            <div key={c.id} className="panel olive">
              <b style={{ fontSize: 18 }}>نداء النادل · طاولة {c.table}</b>
              <span className="soft">منذ {Math.max(0, Math.round((now - new Date(c.createdAt).getTime()) / 60000))} دقيقة</span>
              <button type="button" className="btn btn-light" onClick={() => void act.run(() => rpc('staff_resolve_call', { p_id: c.id })).then(() => calls.reload())}>تمت الخدمة</button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'board' ? (
        <>
          <div className="board">
            {([['new', 'جديد'], ['preparing', 'قيد التحضير'], ['ready', 'جاهز للتسليم']] as [OrderStatus, string][]).map(([st, label]) => {
              const os = col([st]);
              return (
                <section key={st} className="board-col" aria-label={label}>
                  <div className="ttl"><span>{label}</span><span className="badge ink">{os.length}</span></div>
                  {os.map((o) => <Ticket key={o.id} o={o} now={now} onSet={(s) => set(o, s)} />)}
                </section>
              );
            })}
          </div>
          {waiting.length > 0 ? (
            <div className="panel">
              <h2>بانتظار العميل</h2>
              <div className="list">
                {waiting.map((o) => (
                  <div className="li" key={o.id}>
                    <span><b dir="ltr">{o.number}</b> · {orderWhere(o)} · {o.lines.map((l) => describeOrderLine(l).title).join('، ')}</span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="badge line">{STATUS[o.status]}</span>
                      {o.status === 'waiting_arrival' ? <button type="button" className="pill-btn on" onClick={() => set(o, 'new')}>وصل العميل</button> : null}
                      {can('owner', 'manager', 'cashier') && o.paymentStatus === 'unpaid' ? <button type="button" className="pill-btn" onClick={() => set(o, 'cancelled')}>إلغاء</button> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <Finished list={list.filter((o) => o.status === 'done')} />
        </>
      ) : null}
      {tab === 'search' ? <SearchOrders /> : null}
      {tab === 'items' ? <Availability /> : null}
    </Page>
  );
}

function Ticket({ o, now, onSet }: { o: Order; now: number; onSet: (s: OrderStatus) => void }) {
  const { can } = useStaff();
  const mins = Math.round((now - new Date(o.createdAt).getTime()) / 60000);
  const unpaid = o.paymentStatus === 'unpaid';
  return (
    <article className={'ticket' + (mins >= 10 && o.status !== 'ready' ? ' late' : '')}>
      <div className="row">
        <b dir="ltr">{o.number}</b>
        <span className="row" style={{ gap: 4 }}>
          <span className={'badge' + (o.channel === 'pos' ? ' line' : '')}>{o.channel === 'pos' ? 'كاشير' : 'الموقع'}</span>
          <span className="badge ink">{o.serviceType === 'dinein' ? (o.table ? 'طاولة ' + o.table : 'محلي') : 'سفري'}</span>
        </span>
      </div>
      {o.lines.map((l, i) => (
        <div className="ln" key={i}>
          <b>{l.qty > 1 ? l.qty + '× ' : ''}{l.name}{l.sizeLabel ? ' · ' + l.sizeLabel : ''}{l.temp ? ' · ' + tempLabel(l.temp) : ''}</b>
          {l.choices.length ? <small>{l.choices.flatMap((c) => c.labels).join('، ')}</small> : null}
          {l.note ? <span className="note">{l.note}</span> : null}
        </div>
      ))}
      {o.freeCup ? <div className="ln"><b>{o.freeCup.name}{o.freeCup.temp ? ' · ' + tempLabel(o.freeCup.temp) : ''}</b><small>كوب مجاني</small></div> : null}
      <div className="row small mute">
        <span>منذ {mins} د · {time(o.createdAt)}</span>
        {unpaid ? <span className="badge warn">لم يُدفع</span> : null}
      </div>
      <div className="wrap">
        {o.status === 'new' ? <button type="button" className="pill-btn on" onClick={() => onSet('preparing')}>ابدأ التحضير</button> : null}
        {o.status === 'preparing' ? <button type="button" className="pill-btn on" onClick={() => onSet('ready')}>جاهز</button> : null}
        {o.status === 'ready' ? <button type="button" className="pill-btn on" disabled={unpaid} title={unpaid ? 'حصّل الدفع من الكاشير أولاً' : ''} onClick={() => onSet('done')}>تم التسليم</button> : null}
        {can('owner', 'manager', 'cashier') && unpaid && o.status === 'new' ? <button type="button" className="pill-btn" onClick={() => onSet('cancelled')}>إلغاء</button> : null}
      </div>
    </article>
  );
}

function Finished({ list }: { list: Order[] }) {
  if (!list.length) return null;
  return (
    <details className="panel">
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>سُلّمت اليوم ({list.length})</summary>
      <div className="list">
        {list.slice(0, 40).map((o) => (
          <div className="li" key={o.id}><span><b dir="ltr">{o.number}</b> · {orderWhere(o)}</span><span className="num">{sar(o.total)} · {time(o.createdAt)}</span></div>
        ))}
      </div>
    </details>
  );
}

function SearchOrders() {
  const { can } = useStaff();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const res = useData(() => rpc<Order[]>('staff_find_orders', { p_search: term, p_limit: 60 }), [term]);
  const [refund, setRefund] = useState<Order | null>(null);
  const act = useAction();
  const print = (o: Order) => void act.run(async () => {
    const inv = o.invoiceId ? await loadInvoiceForPrint(o.invoiceId) : null;
    if (inv) printInvoice(inv);
  });
  return (
    <div className="panel">
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <input className="input" placeholder="رقم الطلب أو جوال العميل" aria-label="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-ink">بحث</button>
      </form>
      <ErrorBox text={res.error || act.error} />
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>الطلب</th><th>الوقت</th><th>المكان</th><th>العميل</th><th>الإجمالي</th><th>الدفع</th><th>الحالة</th><th /></tr></thead>
          <tbody>
            {(res.data ?? []).map((o) => (
              <tr key={o.id}>
                <td><b dir="ltr">{o.number}</b></td>
                <td>{dateTime(o.createdAt)}</td>
                <td>{orderWhere(o)}</td>
                <td dir="ltr">{o.customerPhone ?? '—'}</td>
                <td className="num">{sar(o.total)}</td>
                <td>{o.paymentStatus === 'paid' ? o.payments.filter((p) => p.kind === 'sale').map((p) => METHOD_LABEL[p.method]).join(' + ') || 'مجاني' : 'لم يُدفع'}</td>
                <td><span className="badge line">{STATUS[o.status]}</span></td>
                <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  {o.invoiceId ? <button type="button" className="pill-btn" onClick={() => print(o)}>إيصال</button> : null}
                  {can('owner', 'manager') && o.paymentStatus === 'paid' && o.status !== 'refunded' ? <button type="button" className="pill-btn" onClick={() => setRefund(o)}>استرجاع</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {res.data && !res.data.length ? <p className="empty">لا نتائج.</p> : null}
      </div>
      {refund ? <RefundDialog order={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); void res.reload(); }} /> : null}
    </div>
  );
}

function RefundDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const sale = order.payments.filter((p) => p.kind === 'sale').sort((a, b) => b.amount - a.amount)[0]?.method ?? 'cash';
  const [method, setMethod] = useState<string>(sale);
  const act = useAction();
  return (
    <Dialog title={'استرجاع الطلب ' + order.number} onClose={onClose}>
      <p>يصدر إشعار دائن بكامل المبلغ <b className="num">{sar(order.total)}</b>، وتُعكس أختام العميل ونقاطه، وتعود مكونات الأصناف إلى المخزون.</p>
      <div className="field"><label htmlFor="ref-reason">سبب الاسترجاع</label>
        <input id="ref-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: طلب خاطئ" /></div>
      <div className="stack"><span className="label">طريقة رد المبلغ</span>
        <div className="wrap">
          {['cash', 'card', 'online'].map((m) => <button key={m} type="button" className={'chip' + (method === m ? ' on' : '')} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>)}
        </div>
        {method === 'cash' ? <span className="small mute">يُخصم من نقد ورديتك المفتوحة.</span> : null}
        {method === 'online' ? <span className="small mute">أعد المبلغ من لوحة ميسر، فالاسترجاع هنا يسجّل العملية فقط.</span> : null}
      </div>
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-ink btn-block" disabled={act.busy || !reason.trim()}
        onClick={() => void act.run(async () => {
          const r = await rpc<{ creditNoteId: string | null }>('staff_refund', { p_id: order.id, p_reason: reason.trim(), p_method: method });
          if (r.creditNoteId) {
            const inv = await loadInvoiceForPrint(r.creditNoteId);
            if (inv) printInvoice(inv);
          }
          onDone();
        })}>تأكيد الاسترجاع وطباعة الإشعار</button>
    </Dialog>
  );
}

function Availability() {
  const { menu, reloadMenu } = useApp();
  const act = useAction();
  if (!menu) return null;
  return (
    <div className="panel">
      <p className="mute">علّم الصنف «نفد» فيختفي طلبه من الموقع والكاشير حتى تعيده.</p>
      <ErrorBox text={act.error} />
      <div className="grid">
        {menu.items.map((it) => (
          <button key={it.id} type="button" className={'pill-btn' + (it.available ? ' on' : '')} style={{ minHeight: 52, justifyContent: 'space-between', display: 'flex', alignItems: 'center', padding: '0 16px' }}
            onClick={() => void act.run(() => rpc('staff_set_item_available', { p_id: it.id, p_available: !it.available })).then(() => reloadMenu())}>
            <span>{it.name}</span><span>{it.available ? 'متاح' : 'نفد'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
