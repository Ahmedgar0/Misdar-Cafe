import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { printInvoice } from '../components/Receipt';
import { Icon } from '../components/ui';
import { api } from '../lib/api';
import { describeCartLine, describeOrderLine, sar } from '../lib/format';
import { computeTotals, freeCupReady, groupApplies, normalizePhone } from '../lib/pricing';
import type { CartLine, FreeCup, Invoice, Item, Order, Shift, Temp } from '../lib/types';
import { useApp } from '../state';
import { Dialog, ErrorBox, METHOD_LABEL, Page, rpc, useAction, useData, useStaff } from './shared';

interface Customer { id: string; phone: string; stamps: number; points: number; orders: number }
type Sale = { order: Order; change: number; invoiceId: string | null };

const AUTO_PRINT = 'misdar.pos.autoprint';

/** يجلب الفاتورة، ويطلب توقيعها من الخادم إن كانت الضريبة مفعّلة، ليُطبع رمز QR الموقّع */
export async function loadInvoiceForPrint(id: string): Promise<Invoice | null> {
  let inv = await api.getInvoice(id);
  if (inv && inv.vatEnabled && !inv.qr && api.mode === 'supabase') {
    try {
      await api.staff.fn('zatca', { action: 'sign', invoiceId: id });
      inv = await api.getInvoice(id);
    } catch { /* يُطبع برابط الفاتورة، ويُوقَّع لاحقاً بالمهمة المجدولة */ }
  }
  if (inv) inv = { ...inv, cashier: inv.cashier ?? null };
  return inv;
}

export function Pos() {
  const { menu } = useApp();
  const { can } = useStaff();
  const shift = useData(() => rpc<Shift | null>('staff_current_shift'), []);
  const pending = useData(() => rpc<Order[]>('staff_orders'), [], true);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState<Item | null>(null);
  const [service, setService] = useState<{ type: 'takeaway' | 'dinein'; table: string }>({ type: 'takeaway', table: '' });
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [free, setFree] = useState<FreeCup | null>(null);
  const [discount, setDiscount] = useState<{ amount: number; reason: string } | null>(null);
  const [pay, setPay] = useState<'cash' | 'card' | 'split' | null>(null);
  const [done, setDone] = useState<Sale | null>(null);
  const [collect, setCollect] = useState<Order | null>(null);
  const [askDiscount, setAskDiscount] = useState(false);
  const [autoPrint, setAutoPrint] = useState(() => { try { return localStorage.getItem(AUTO_PRINT) !== '0'; } catch { return true; } });
  const act = useAction();

  const items = useMemo(() => {
    if (!menu) return [];
    const visible = new Set(menu.categories.filter((c) => c.visible).map((c) => c.id));
    const term = q.trim();
    return menu.items
      .filter((i) => visible.has(i.categoryId) && (cat === 'all' || i.categoryId === cat) && (!term || i.name.includes(term)))
      .sort((a, b) => a.sort - b.sort);
  }, [menu, cat, q]);

  if (!menu) return null;
  const s = menu.settings;
  const views = lines.map((l) => ({ l, v: describeCartLine(menu, l) })).filter((x) => x.v);
  const subtotal = views.reduce((a, x) => a + x.v!.unit * x.l.qty, 0);
  const loyalty = customer ? { stamps: customer.stamps, points: customer.points } : { stamps: 0, points: 0 };
  const t = computeTotals(subtotal, loyalty, s, usePoints && !!customer);
  const manual = Math.min(discount?.amount ?? 0, Math.max(0, subtotal - t.discount));
  const total = Math.round((t.total - manual) * 100) / 100;
  const ready = !!customer && freeCupReady(loyalty, s);
  const usedFree = ready && !!free;
  const empty = views.length === 0 && !usedFree;

  const freeOptions = menu.items.filter((i) => i.freeCupEligible && i.available).flatMap<FreeCup & { label: string }>((i) =>
    i.hot && i.cold
      ? [{ itemId: i.id, temp: 'hot', label: i.name + ' ساخنة' }, { itemId: i.id, temp: 'cold', label: i.name + ' باردة' }]
      : [{ itemId: i.id, temp: null, label: i.name }]);

  const addSimple = (it: Item) => {
    const simple = it.sizes.filter((z) => z.price != null).length === 1 && !(it.hot && it.cold) && !it.noteTitle
      && !menu.groups.some((g) => groupApplies(it, g, it.hot ? 'hot' : null) && g.options.length > 0);
    if (!simple) { setOpen(it); return; }
    const sizeIndex = it.sizes.findIndex((z) => z.price != null);
    const same = lines.find((l) => l.itemId === it.id && l.sizeIndex === sizeIndex && l.choices.length === 0 && !l.note);
    if (same) setLines(lines.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l)));
    else setLines([...lines, { key: crypto.randomUUID(), itemId: it.id, sizeIndex, temp: null, choices: [], note: '', qty: 1 }]);
  };

  const lookup = async () => {
    setCustomer(null);
    setFree(null);
    setUsePoints(false);
    if (!phone.trim()) return;
    await act.run(async () => {
      const p = normalizePhone(phone);
      const found = await rpc<Customer[]>('staff_customers', { p_search: p });
      setCustomer(found.find((c) => c.phone === p) ?? { id: '', phone: p, stamps: 0, points: 0, orders: 0 });
    });
  };

  const reset = () => {
    setLines([]); setPhone(''); setCustomer(null); setUsePoints(false); setFree(null); setDiscount(null);
    setService({ type: 'takeaway', table: '' }); setPay(null);
  };

  const sell = async (payments: { method: 'card'; amount: number }[], tendered: number | null) => {
    const r = await act.run(() => rpc<Sale>('staff_pos_sale', {
      p: {
        lines: views.map(({ l: { key: _k, ...rest } }) => rest),
        service: { type: service.type, table: service.type === 'dinein' && service.table ? Number(service.table) : null },
        customerPhone: customer?.phone ?? '',
        usePoints: usePoints && !!customer,
        freeCup: usedFree ? free : null,
        manualDiscount: manual > 0 ? { amount: manual, reason: discount?.reason ?? '' } : null,
        payments, tendered,
      },
    }));
    if (!r) return;
    setPay(null);
    setDone(r);
    reset();
    void shift.reload();
    void pending.reload();
    if (autoPrint && r.invoiceId) {
      const inv = await loadInvoiceForPrint(r.invoiceId);
      if (inv) printInvoice(inv);
    }
  };

  if (shift.loaded && shift.data === null && !shift.error) {
    return <Page title="الكاشير"><OpenShift onOpen={() => void shift.reload()} /></Page>;
  }

  const unpaid = (pending.data ?? []).filter((o) => o.paymentStatus === 'unpaid' && o.payMethod === 'cashier' && o.status !== 'cancelled' && o.status !== 'refunded');

  return (
    <Page title="الكاشير" actions={
      <>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={autoPrint} onChange={(e) => { setAutoPrint(e.target.checked); try { localStorage.setItem(AUTO_PRINT, e.target.checked ? '1' : '0'); } catch { /* */ } }} />
          طباعة الإيصال تلقائياً
        </label>
        <Link to="/admin/shifts" className="btn btn-plain">الوردية</Link>
      </>
    }>
      <ErrorBox text={shift.error} />
      {unpaid.length > 0 ? (
        <div className="panel warn">
          <h2>طلبات من الموقع بانتظار الدفع عند الكاشير</h2>
          <div className="wrap">
            {unpaid.map((o) => (
              <button key={o.id} type="button" className="btn btn-ink" onClick={() => setCollect(o)}>
                <span dir="ltr">{o.number}</span> · {o.table ? 'طاولة ' + o.table : o.serviceType === 'dinein' ? 'محلي' : 'سفري'} · {sar(o.total)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="pos">
        <div className="stack" style={{ gap: 12 }}>
          <div className="toolbar">
            <input className="input" style={{ maxWidth: 220 }} placeholder="ابحث عن صنف" aria-label="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className={'chip' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>الكل</button>
            {menu.categories.filter((c) => c.visible).sort((a, b) => a.sort - b.sort).map((c) => (
              <button key={c.id} type="button" className={'chip' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.name}</button>
            ))}
          </div>
          <div className="pos-items">
            {items.map((it) => {
              const first = it.sizes.find((z) => z.price != null);
              return (
                <button key={it.id} type="button" className="pos-item" disabled={!it.available || !first} onClick={() => addSimple(it)}>
                  <b>{it.name}</b>
                  <span>{!it.available ? 'نفد' : first ? (it.sizes.filter((z) => z.price != null).length > 1 ? 'من ' : '') + sar(first.price!) : 'بلا سعر'}
                    {it.hot && it.cold ? ' · ساخن/بارد' : ''}</span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="ticket-panel" aria-label="الفاتورة الحالية">
          <div className="seg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <button type="button" className={service.type === 'takeaway' ? 'on' : ''} onClick={() => setService({ type: 'takeaway', table: '' })}>سفري</button>
            <button type="button" className={service.type === 'dinein' ? 'on' : ''} onClick={() => setService({ ...service, type: 'dinein' })}>محلي</button>
          </div>
          {service.type === 'dinein' ? (
            <input className="input num" type="number" min={1} inputMode="numeric" placeholder="رقم الطاولة (اختياري)" aria-label="رقم الطاولة"
              value={service.table} onChange={(e) => setService({ ...service, table: e.target.value })} />
          ) : null}

          <div>
            {views.length === 0 && !usedFree ? <p className="empty">اختر الأصناف من القائمة</p> : null}
            {views.map(({ l, v }) => (
              <div className="tline" key={l.key}>
                <span style={{ minWidth: 0 }}><b>{v!.title}</b>{v!.meta ? <><br /><span className="small mute">{v!.meta}</span></> : null}</span>
                <span className="stepper">
                  <button type="button" aria-label="إنقاص" onClick={() => setLines(l.qty > 1 ? lines.map((x) => (x.key === l.key ? { ...x, qty: x.qty - 1 } : x)) : lines.filter((x) => x.key !== l.key))}>−</button>
                  <span>{l.qty}</span>
                  <button type="button" aria-label="زيادة" onClick={() => setLines(lines.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                </span>
                <b className="num" style={{ minWidth: 56, textAlign: 'left' }}>{sar(v!.unit * l.qty)}</b>
              </div>
            ))}
            {usedFree ? <div className="tline"><b>{freeOptions.find((o) => o.itemId === free!.itemId && o.temp === free!.temp)?.label}</b><span className="badge">مجاني</span><b>0</b></div> : null}
          </div>

          <div className="stack">
            <div className="row" style={{ gap: 6 }}>
              <input className="input grow num" dir="ltr" type="tel" inputMode="tel" placeholder="05XXXXXXXX" aria-label="جوال العميل للمكافآت"
                value={phone} onChange={(e) => { setPhone(e.target.value); setCustomer(null); }} onKeyDown={(e) => { if (e.key === 'Enter') void lookup(); }} />
              <button type="button" className="btn btn-plain" style={{ minHeight: 48 }} onClick={() => void lookup()}>عميل</button>
            </div>
            {customer ? (
              <div className="card-sage stack" style={{ gap: 6, padding: 12 }}>
                <span className="small">{customer.id ? `${customer.orders} طلبات سابقة` : 'عميل جديد: يُسجَّل مع هذا الطلب'} · أختام {customer.stamps}/{s.stampsForFree} · {customer.points} نقطة</span>
                {customer.points >= s.pointsPerRiyalDiscount && views.length ? (
                  <label className="row small" style={{ justifyContent: 'flex-start', gap: 6 }}>
                    <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} /> استخدام النقاط ({sar(Math.floor(customer.points / s.pointsPerRiyalDiscount))})
                  </label>
                ) : null}
                {ready ? (
                  <div className="wrap" style={{ gap: 6 }}>
                    {freeOptions.map((o) => {
                      const on = free?.itemId === o.itemId && free?.temp === o.temp;
                      return <button key={o.label} type="button" className={'chip' + (on ? ' on' : '')} style={{ minHeight: 36 }} onClick={() => setFree(on ? null : o)}>{o.label}</button>;
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="summary">
            <div className="row"><span>المجموع</span><span className="num">{sar(subtotal)}</span></div>
            {t.discount > 0 ? <div className="row"><span>خصم النقاط</span><span className="num">− {sar(t.discount)}</span></div> : null}
            {manual > 0 ? <div className="row"><span>خصم: {discount?.reason}</span><span className="num">− {sar(manual)}</span></div> : null}
            <div className="row total"><span>الإجمالي</span><span className="num">{sar(total)}</span></div>
            {s.vatEnabled ? <span className="small mute">شامل ضريبة القيمة المضافة {s.vatRate}%</span> : null}
          </div>
          <ErrorBox text={act.error} />
          <div className="paybtns">
            <button type="button" className="btn-ink" style={{ background: 'var(--ink)', color: 'var(--off)' }} disabled={empty || act.busy} onClick={() => (total === 0 ? void sell([], null) : setPay('cash'))}>نقدي</button>
            <button type="button" style={{ background: 'var(--olive)', color: 'var(--off)' }} disabled={empty || act.busy || total === 0} onClick={() => void sell([{ method: 'card', amount: total }], null)}>شبكة</button>
            <button type="button" style={{ background: 'var(--sage)' }} disabled={empty || act.busy || total === 0} onClick={() => setPay('split')}>مقسوم</button>
          </div>
          <div className="row">
            {can('owner', 'manager') ? <button type="button" className="btn-text" disabled={empty} onClick={() => setAskDiscount(true)}>خصم يدوي</button> : <span />}
            <button type="button" className="btn-text" disabled={empty && !phone} onClick={reset}>إفراغ</button>
          </div>
        </aside>
      </div>

      {open ? <PosItemDialog item={open} onClose={() => setOpen(null)} onAdd={(l) => { setLines([...lines, { ...l, key: crypto.randomUUID() }]); setOpen(null); }} /> : null}
      {pay === 'cash' ? <CashDialog total={total} busy={act.busy} error={act.error} onClose={() => setPay(null)} onPay={(tendered) => void sell([], tendered)} /> : null}
      {pay === 'split' ? <SplitDialog total={total} busy={act.busy} error={act.error} onClose={() => setPay(null)} onPay={(card, tendered) => void sell([{ method: 'card', amount: card }], tendered)} /> : null}
      {askDiscount ? <DiscountDialog max={Math.max(0, subtotal - t.discount)} onClose={() => setAskDiscount(false)} onSet={(d) => { setDiscount(d); setAskDiscount(false); }} /> : null}
      {done ? <DoneDialog sale={done} onClose={() => setDone(null)} /> : null}
      {collect ? <CollectDialog order={collect} onClose={() => setCollect(null)} onDone={(r) => { setCollect(null); void pending.reload(); void shift.reload(); setDone(r); }} autoPrint={autoPrint} /> : null}
    </Page>
  );
}

function OpenShift({ onOpen }: { onOpen: () => void }) {
  const [amount, setAmount] = useState('');
  const act = useAction();
  return (
    <div className="panel" style={{ maxWidth: 460 }}>
      <h2>افتح وردية للبدء</h2>
      <p className="mute">عدّ النقد في الدرج واكتب المبلغ. يُحسب عليه ما يجب أن يكون في الدرج عند الإغلاق.</p>
      <div className="field"><label htmlFor="open-cash">النقد الافتتاحي (ر.س)</label>
        <input id="open-cash" className="input num" type="number" min={0} step="0.5" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-ink" disabled={act.busy} onClick={() => void act.run(() => rpc('staff_open_shift', { p_opening: Number(amount) || 0 })).then((r) => { if (r) onOpen(); })}>فتح الوردية</button>
    </div>
  );
}

function CashDialog({ total, busy, error, onClose, onPay }: { total: number; busy: boolean; error: string; onClose: () => void; onPay: (tendered: number) => void }) {
  const [v, setV] = useState('');
  const tendered = v === '' ? total : Number(v);
  const change = tendered - total;
  const notes = [...new Set([total, Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, 50, 100, 200, 500].filter((n) => n >= total))].slice(0, 6);
  return (
    <Dialog title="دفع نقدي" onClose={onClose}>
      <div className="row"><span>المطلوب</span><span className="big-num">{sar(total)}</span></div>
      <div className="cash-keys">
        {notes.map((n) => <button key={n} type="button" onClick={() => setV(String(n))}>{n === total ? 'المبلغ نفسه' : n}</button>)}
      </div>
      <div className="field"><label htmlFor="tendered">المبلغ المستلم</label>
        <input id="tendered" className="input num" autoFocus type="number" min={0} step="0.5" inputMode="decimal" value={v} placeholder={String(total)} onChange={(e) => setV(e.target.value)} /></div>
      <div className={'panel ' + (change < 0 ? 'bad' : 'sage')} style={{ padding: 14 }}>
        <div className="row"><b>{change < 0 ? 'ناقص' : 'الباقي للعميل'}</b><span className="big-num">{sar(Math.abs(change))}</span></div>
      </div>
      <ErrorBox text={error} />
      <button type="button" className="btn btn-ink btn-block" disabled={busy || change < 0} onClick={() => onPay(tendered)}>تأكيد الدفع</button>
    </Dialog>
  );
}

function SplitDialog({ total, busy, error, onClose, onPay }: { total: number; busy: boolean; error: string; onClose: () => void; onPay: (card: number, tendered: number) => void }) {
  const [card, setCard] = useState('');
  const [cash, setCash] = useState('');
  const c = Math.min(Number(card) || 0, total);
  const due = Math.round((total - c) * 100) / 100;
  const tendered = cash === '' ? due : Number(cash);
  return (
    <Dialog title="دفع مقسوم" onClose={onClose}>
      <div className="row"><span>الإجمالي</span><b className="num">{sar(total)}</b></div>
      <div className="field"><label htmlFor="split-card">المبلغ على الشبكة</label>
        <input id="split-card" className="input num" autoFocus type="number" min={0} step="0.5" value={card} onChange={(e) => setCard(e.target.value)} /></div>
      <div className="row"><span>الباقي نقداً</span><b className="num">{sar(due)}</b></div>
      <div className="field"><label htmlFor="split-cash">النقد المستلم</label>
        <input id="split-cash" className="input num" type="number" min={0} step="0.5" value={cash} placeholder={String(due)} onChange={(e) => setCash(e.target.value)} /></div>
      {tendered > due ? <div className="row"><span>الباقي للعميل</span><b className="num">{sar(tendered - due)}</b></div> : null}
      <ErrorBox text={error} />
      <button type="button" className="btn btn-ink btn-block" disabled={busy || c <= 0 || tendered < due} onClick={() => onPay(c, tendered)}>تأكيد الدفع</button>
    </Dialog>
  );
}

function DiscountDialog({ max, onClose, onSet }: { max: number; onClose: () => void; onSet: (d: { amount: number; reason: string } | null) => void }) {
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState(false);
  const [reason, setReason] = useState('');
  const value = Math.min(max, pct ? Math.round(max * (Number(amount) || 0)) / 100 : Number(amount) || 0);
  return (
    <Dialog title="خصم يدوي" onClose={onClose}>
      <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button type="button" className={!pct ? 'on' : ''} onClick={() => setPct(false)}>مبلغ</button>
        <button type="button" className={pct ? 'on' : ''} onClick={() => setPct(true)}>نسبة %</button>
      </div>
      <div className="field"><label htmlFor="disc-amount">{pct ? 'النسبة' : 'المبلغ (ر.س)'}</label>
        <input id="disc-amount" className="input num" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="field"><label htmlFor="disc-reason">السبب (يظهر في التقارير)</label>
        <input id="disc-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: ضيافة، تعويض" /></div>
      <div className="row"><span>قيمة الخصم</span><b className="num">{sar(value)}</b></div>
      <div className="row">
        <button type="button" className="btn btn-plain" onClick={() => onSet(null)}>إلغاء الخصم</button>
        <button type="button" className="btn btn-ink" disabled={value <= 0 || !reason.trim()} onClick={() => onSet({ amount: value, reason: reason.trim() })}>تطبيق</button>
      </div>
    </Dialog>
  );
}

function DoneDialog({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const act = useAction();
  const print = (size: '80mm' | 'a4') => void act.run(async () => {
    const inv = sale.invoiceId ? await loadInvoiceForPrint(sale.invoiceId) : null;
    if (inv) printInvoice(inv, size);
  });
  return (
    <Dialog title="تم البيع" onClose={onClose}>
      <div className="panel sage" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span className="small">رقم الطلب</span>
        <span className="big-num" dir="ltr">{sale.order.number}</span>
        {sale.change > 0 ? <b style={{ fontSize: 20 }}>الباقي للعميل: {sar(sale.change)}</b> : null}
      </div>
      <ErrorBox text={act.error} />
      <div className="row">
        <button type="button" className="btn btn-line" disabled={!sale.invoiceId || act.busy} onClick={() => print('80mm')}><Icon name="print" size={18} /> طباعة الإيصال</button>
        <button type="button" className="btn btn-plain" disabled={!sale.invoiceId || act.busy} onClick={() => print('a4')}>فاتورة A4</button>
      </div>
      <button type="button" className="btn btn-ink btn-block" autoFocus onClick={onClose}>بيع جديد</button>
    </Dialog>
  );
}

function CollectDialog({ order, onClose, onDone, autoPrint }: { order: Order; onClose: () => void; onDone: (s: Sale) => void; autoPrint: boolean }) {
  const act = useAction();
  const go = (method: 'cash' | 'card') => void act.run(async () => {
    const o = await rpc<Order>('staff_mark_paid', { p_id: order.id, p_method: method });
    if (autoPrint && o.invoiceId) {
      const inv = await loadInvoiceForPrint(o.invoiceId);
      if (inv) printInvoice(inv);
    }
    onDone({ order: o, change: 0, invoiceId: o.invoiceId });
  });
  return (
    <Dialog title={'تحصيل الطلب ' + order.number} onClose={onClose}>
      <div className="list">
        {order.lines.map((l, i) => { const d = describeOrderLine(l); return <div className="li" key={i}><span>{d.title}</span><span className="num">{sar(l.unitPrice * l.qty)}</span></div>; })}
      </div>
      <div className="row total"><b>المطلوب</b><span className="big-num">{sar(order.total)}</span></div>
      <ErrorBox text={act.error} />
      <div className="paybtns" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button type="button" style={{ background: 'var(--ink)', color: 'var(--off)' }} disabled={act.busy} onClick={() => go('cash')}>نقدي</button>
        <button type="button" style={{ background: 'var(--olive)', color: 'var(--off)' }} disabled={act.busy} onClick={() => go('card')}>شبكة</button>
      </div>
      <span className="small mute">{METHOD_LABEL.cash}: يُضاف لنقد ورديتك. {METHOD_LABEL.card}: من جهاز الشبكة.</span>
    </Dialog>
  );
}

function PosItemDialog({ item, onClose, onAdd }: { item: Item; onClose: () => void; onAdd: (l: Omit<CartLine, 'key'>) => void }) {
  const { menu } = useApp();
  const both = item.hot && item.cold;
  const [sizeIndex, setSizeIndex] = useState(Math.max(0, item.sizes.findIndex((z) => z.price != null)));
  const [temp, setTemp] = useState<Temp | null>(null);
  const [sel, setSel] = useState<Record<string, number[]>>({});
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);
  const groups = (menu?.groups ?? []).filter((g) => groupApplies(item, g, both ? temp : item.hot ? 'hot' : null) && g.options.length > 0);
  const picked = (id: string, multi: boolean, def: number) => sel[id] ?? (multi ? [] : [def]);
  const size = item.sizes[sizeIndex];
  const unit = (size?.price ?? 0) + groups.reduce((a, g) => a + picked(g.id, g.multi, g.defaultIndex).reduce((b, i) => b + (g.options[i]?.price || 0), 0), 0);
  const can = !(both && !temp) && size?.price != null;
  const add = () => onAdd({
    itemId: item.id, sizeIndex, temp: both ? temp : null, note: note.trim(), qty,
    choices: groups.map((g) => ({ groupId: g.id, optionIndexes: picked(g.id, g.multi, g.defaultIndex) })).filter((c) => c.optionIndexes.length),
  });
  return (
    <Dialog title={item.name} onClose={onClose}>
      {both ? (
        <div className="temp-pick">
          <button type="button" className={temp === 'hot' ? 'on' : ''} onClick={() => setTemp('hot')}><Icon name="hot" size={24} /> ساخن</button>
          <button type="button" className={temp === 'cold' ? 'on' : ''} onClick={() => setTemp('cold')}><Icon name="cold" size={24} /> بارد</button>
        </div>
      ) : null}
      {item.sizes.length > 1 ? (
        <div className="stack"><span className="label">الحجم</span><div className="wrap">
          {item.sizes.map((z, i) => <button key={i} type="button" className={'chip' + (sizeIndex === i ? ' on' : '')} disabled={z.price == null} onClick={() => setSizeIndex(i)}>{z.label} · {z.price == null ? 'بلا سعر' : sar(z.price)}</button>)}
        </div></div>
      ) : null}
      {groups.map((g) => (
        <div className="stack" key={g.id}><span className="label">{g.name}</span><div className="wrap">
          {g.options.map((o, i) => {
            const on = picked(g.id, g.multi, g.defaultIndex).includes(i);
            return <button key={i} type="button" className={'chip' + (on ? ' on' : '')} onClick={() => {
              const cur = picked(g.id, g.multi, g.defaultIndex);
              setSel({ ...sel, [g.id]: g.multi ? (on ? cur.filter((x) => x !== i) : [...cur, i]) : [i] });
            }}>{o.label}{o.price ? ' +' + o.price : ''}</button>;
          })}
        </div></div>
      ))}
      <div className="field"><label htmlFor="pos-note">{item.noteTitle || 'ملاحظة للباريستا'}</label>
        <input id="pos-note" className="input" maxLength={160} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="row">
        <div className="qty">
          <button type="button" aria-label="إنقاص" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
          <span className="num">{qty}</span>
          <button type="button" aria-label="زيادة" onClick={() => setQty(qty + 1)}>+</button>
        </div>
        <button type="button" className="btn btn-ink grow" style={{ minHeight: 52 }} disabled={!can} onClick={add}>
          {both && !temp ? 'اختر ساخن أو بارد' : 'إضافة · ' + sar(unit * qty)}
        </button>
      </div>
    </Dialog>
  );
}

