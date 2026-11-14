import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Loading } from '../components/ui';
import { api, newId } from '../lib/api';
import { describeOrderLine, orderWhere, sar, tempLabel, timeAgo } from '../lib/format';
import { errorText } from '../lib/pricing';
import type { Category, Item, OptionGroup, Order, OrderStatus, Settings, Size, WaiterCall } from '../lib/types';
import { useApp } from '../state';

type Tab = 'orders' | 'items' | 'cats' | 'groups' | 'settings';
const TABS: [Tab, string][] = [['orders', 'الطلبات'], ['items', 'الأصناف'], ['cats', 'الأقسام'], ['groups', 'الخيارات'], ['settings', 'الإعدادات']];

export function Admin() {
  const { menu, menuError } = useApp();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('orders');

  useEffect(() => { api.staffSignedIn().then(setSignedIn).catch(() => setSignedIn(false)); }, []);

  if (signedIn === null) return <Loading />;
  if (!signedIn) return <StaffLogin onDone={() => setSignedIn(true)} />;

  return (
    <div className="admin">
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="wordmark">مسدار</span>
          <span className="mute">لوحة التحكم</span>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <button type="button" className="btn btn-plain" onClick={() => api.staffLogout().then(() => setSignedIn(false))}>خروج</button>
      </div>
      {menuError ? <div className="error" role="alert">{menuError}</div> : null}
      {!menu ? <Loading /> : (
        <>
          {tab === 'orders' ? <OrdersTab /> : null}
          {tab === 'items' ? <ItemsTab /> : null}
          {tab === 'cats' ? <CatsTab /> : null}
          {tab === 'groups' ? <GroupsTab /> : null}
          {tab === 'settings' ? <SettingsTab /> : null}
        </>
      )}
    </div>
  );
}

function StaffLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.staffLogin(email, password);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <form className="admin login-box" onSubmit={submit}>
      <span className="wordmark">مسدار</span>
      <h1 className="title">دخول الموظفين</h1>
      {api.mode === 'demo' ? <p className="notice">الوضع التجريبي: اضغط دخول بأي بيانات.</p> : null}
      <div className="field"><label htmlFor="staff-email">البريد الإلكتروني</label>
        <input id="staff-email" dir="ltr" className="input ltr" type="email" autoComplete="username" required={api.mode !== 'demo'} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="staff-pass">كلمة المرور</label>
        <input id="staff-pass" dir="ltr" className="input ltr" type="password" autoComplete="current-password" required={api.mode !== 'demo'} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      <button type="submit" className="btn btn-ink btn-block" disabled={busy}>دخول</button>
      <Link to="/" className="btn btn-plain">موقع العملاء</Link>
    </form>
  );
}

/* ───────────── الطلبات ───────────── */

const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'بانتظار الدفع', waiting_arrival: 'بانتظار الوصول', new: 'جديد', preparing: 'قيد التحضير',
  ready: 'جاهز', done: 'سُلّم', cancelled: 'ملغى',
};

function OrdersTab() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [calls, setCalls] = useState<WaiterCall[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([api.listOrders(), api.listWaiterCalls()]);
      setOrders(o);
      setCalls(c);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
    return api.subscribeStaff(() => void load());
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { setError(errorText(e)); }
    await load();
  };

  if (!orders) return error ? <div className="error" role="alert">{error}</div> : <Loading />;
  const active = orders.filter((o) => o.status !== 'done' && o.status !== 'cancelled');
  const closed = orders.filter((o) => o.status === 'done' || o.status === 'cancelled').slice(0, 12);

  return (
    <div className="stack" style={{ gap: 16 }}>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {calls.length > 0 ? (
        <div className="cards">
          {calls.map((c) => (
            <div key={c.id} className="call-card row">
              <span><b>نداء النادل · طاولة {c.table}</b><br /><span className="small" style={{ color: 'var(--olive-soft)' }}>{timeAgo(c.createdAt)}</span></span>
              <button type="button" className="btn btn-light" style={{ minHeight: 44 }} onClick={() => act(() => api.resolveWaiterCall(c.id))}>تمت الخدمة</button>
            </div>
          ))}
        </div>
      ) : null}

      <h2 className="section-title">الطلبات الحية <span className="mute small num">({active.length})</span></h2>
      {active.length === 0 ? <div className="dashed">لا طلبات حالياً. الطلبات الجديدة تظهر هنا فور وصولها.</div> : null}
      <div className="cards">
        {active.map((o) => <OrderCard key={o.id} o={o} act={act} />)}
      </div>

      {closed.length > 0 ? (
        <>
          <h2 className="section-title">آخر الطلبات المنتهية</h2>
          <div className="cards">{closed.map((o) => <OrderCard key={o.id} o={o} act={act} />)}</div>
        </>
      ) : null}
    </div>
  );
}

function OrderCard({ o, act }: { o: Order; act: (fn: () => Promise<void>) => Promise<void> }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const set = (s: OrderStatus) => act(() => api.setOrderStatus(o.id, s));
  const open = o.status !== 'done' && o.status !== 'cancelled';
  return (
    <div className="order-card">
      <div className="row">
        <span><b dir="ltr" className="ltr">{o.number}</b> · <b>{orderWhere(o)}</b><br />
          <span className="small mute"><span dir="ltr" className="ltr">{o.customerPhone}</span> · {timeAgo(o.createdAt)}</span></span>
        <span className={'status ' + o.status}>{STATUS_LABEL[o.status]}</span>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {o.lines.map((l, i) => {
          const d = describeOrderLine(l);
          return <div key={i}><b>{d.title}</b>{d.meta ? <span className="small mute"> — {d.meta}</span> : null}</div>;
        })}
        {o.freeCup ? <div><b>{o.freeCup.name}{o.freeCup.temp ? ' · ' + tempLabel(o.freeCup.temp) : ''}</b><span className="small mute"> — كوب مجاني</span></div> : null}
      </div>
      <div className="row small">
        <span className="num"><b>{sar(o.total)}</b>{o.discount > 0 ? ' بعد خصم ' + sar(o.discount) : ''}</span>
        <span>{o.paymentStatus === 'paid' ? 'مدفوع' : o.payMethod === 'cashier' ? 'يدفع عند الكاشير' : 'لم يُدفع'}</span>
      </div>
      {open ? (
        <div className="wrap">
          {o.status === 'new' || o.status === 'waiting_arrival' ? <button type="button" className="pill-btn on" onClick={() => set('preparing')}>ابدأ التحضير</button> : null}
          {o.status === 'preparing' ? <button type="button" className="pill-btn on" onClick={() => set('ready')}>جاهز</button> : null}
          {o.status === 'ready' ? <button type="button" className="pill-btn on" onClick={() => set('done')}>تم التسليم</button> : null}
          {o.paymentStatus !== 'paid' && o.payMethod === 'cashier' ? <button type="button" className="pill-btn" onClick={() => act(() => api.markOrderPaid(o.id))}>تم الدفع</button> : null}
          {confirmCancel
            ? <button type="button" className="pill-btn" onClick={() => set('cancelled')}>تأكيد الإلغاء</button>
            : <button type="button" className="pill-btn" onClick={() => setConfirmCancel(true)}>إلغاء</button>}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── الأصناف ───────────── */

interface SizeDraft { label: string; price: string }
interface ItemDraft extends Omit<Item, 'sizes'> { sizes: SizeDraft[] }

function ItemsTab() {
  const { menu, reloadMenu } = useApp();
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!menu) return null;
  const catName = (id: string) => menu.categories.find((c) => c.id === id)?.name ?? '';

  const blank = (): ItemDraft => ({
    id: newId(), categoryId: menu.categories[0]?.id ?? '', name: '', description: '', hot: true, cold: false, groupIds: [],
    noteTitle: '', available: true, freeCupEligible: false, sort: menu.items.reduce((m, i) => Math.max(m, i.sort), -1) + 1,
    sizes: [{ label: 'عادي', price: '' }],
  });
  const edit = (it: Item) => {
    setDraft({ ...it, sizes: it.sizes.map((s) => ({ label: s.label, price: s.price == null ? '' : String(s.price) })) });
    setIsNew(false);
    setConfirmDelete(false);
    setError('');
  };
  const patch = (p: Partial<ItemDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setSize = (i: number, p: Partial<SizeDraft>) => patch({ sizes: draft!.sizes.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  const run = async (fn: () => Promise<void>, close = true) => {
    try {
      await fn();
      await reloadMenu();
      if (close) setDraft(null);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  const save = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { setError('اكتب اسم الصنف.'); return; }
    if (!draft.categoryId) { setError('أضف قسماً أولاً من تبويب الأقسام.'); return; }
    const sizes: Size[] = draft.sizes.filter((s) => s.label.trim()).map((s) => ({ label: s.label.trim(), price: s.price === '' ? null : Number(s.price) }));
    if (sizes.length === 0) { setError('أضف حجماً واحداً على الأقل.'); return; }
    void run(() => api.saveItem({ ...draft, name, description: draft.description.trim(), noteTitle: draft.noteTitle.trim(), sizes }));
  };

  return (
    <div className="split">
      <div className="main">
        <div className="row">
          <h2 className="section-title">الأصناف <span className="mute small num">({menu.items.length})</span></h2>
          <button type="button" className="btn btn-ink" onClick={() => { setDraft(blank()); setIsNew(true); setError(''); }}>صنف جديد</button>
        </div>
        <div className="table-box">
          <div className="table">
            <div className="tr head"><span>الصنف</span><span>القسم</span><span>التقديم</span><span>الأحجام والأسعار</span><span>الحالة</span><span /></div>
            {menu.items.map((it) => (
              <div key={it.id} className={'tr' + (draft?.id === it.id ? ' editing' : '')}>
                <b>{it.name}</b>
                <span className="small">{catName(it.categoryId)}</span>
                <span className="small">{it.hot && it.cold ? 'ساخن وبارد' : it.hot ? 'ساخن' : it.cold ? 'بارد' : 'بلا'}</span>
                <span className="small num">{it.sizes.map((s) => s.label + ' ' + (s.price == null ? 'بلا سعر' : s.price)).join(' · ')}</span>
                <button type="button" className={'pill-btn' + (it.available ? ' on' : '')} aria-pressed={it.available}
                  onClick={() => run(() => api.saveItem({ ...it, available: !it.available }), false)}>{it.available ? 'متاح' : 'نفد'}</button>
                <button type="button" className="pill-btn" onClick={() => edit(it)}>تعديل</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {draft ? (
        <div className="side form-card">
          <b style={{ fontSize: 18 }}>{isNew ? 'صنف جديد' : 'تعديل الصنف'}</b>
          <div className="field"><label htmlFor="it-name">اسم الصنف</label>
            <input id="it-name" className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} /></div>
          <div className="field"><label htmlFor="it-desc">وصف قصير (اختياري)</label>
            <input id="it-desc" className="input" value={draft.description} onChange={(e) => patch({ description: e.target.value })} /></div>
          <div className="field"><label htmlFor="it-cat">القسم</label>
            <select id="it-cat" className="input" value={draft.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
              {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="stack"><span className="label">التقديم</span>
            <div className="wrap">
              <button type="button" className={'pill-btn' + (draft.hot ? ' on' : '')} aria-pressed={draft.hot} onClick={() => patch({ hot: !draft.hot })}>ساخن</button>
              <button type="button" className={'pill-btn' + (draft.cold ? ' on' : '')} aria-pressed={draft.cold} onClick={() => patch({ cold: !draft.cold })}>بارد</button>
            </div></div>
          <div className="stack"><span className="label">الأحجام والأسعار (ر.س). اترك السعر فارغاً لحجم لم يُسعَّر بعد</span>
            {draft.sizes.map((s, i) => (
              <div className="row" key={i} style={{ gap: 8 }}>
                <input className="input grow" aria-label="اسم الحجم" value={s.label} onChange={(e) => setSize(i, { label: e.target.value })} />
                <input className="input num" aria-label="السعر" style={{ width: 84 }} type="number" min={0} step="0.5" value={s.price} onChange={(e) => setSize(i, { price: e.target.value })} />
                <button type="button" className="icon-btn bare" aria-label="حذف الحجم" onClick={() => patch({ sizes: draft.sizes.filter((_, j) => j !== i) })}><Icon name="close" size={18} /></button>
              </div>
            ))}
            <button type="button" className="pill-btn" style={{ alignSelf: 'flex-start', borderStyle: 'dashed' }} onClick={() => patch({ sizes: [...draft.sizes, { label: '', price: '' }] })}>أضف حجماً</button>
          </div>
          <div className="stack"><span className="label">خيارات الصنف</span>
            <div className="wrap">
              {menu.groups.map((g) => {
                const on = draft.groupIds.includes(g.id);
                return <button key={g.id} type="button" className={'pill-btn' + (on ? ' on' : '')} aria-pressed={on}
                  onClick={() => patch({ groupIds: on ? draft.groupIds.filter((x) => x !== g.id) : [...draft.groupIds, g.id] })}>{g.name}</button>;
              })}
              {menu.groups.length === 0 ? <span className="small">لا مجموعات بعد. أضفها من تبويب الخيارات.</span> : null}
            </div></div>
          <div className="field"><label htmlFor="it-note">حقل نصي يكتبه العميل (اتركه فارغاً لإخفائه)</label>
            <input id="it-note" className="input" placeholder="مثال: صف قهوتك" value={draft.noteTitle} onChange={(e) => patch({ noteTitle: e.target.value })} /></div>
          <button type="button" className={'pill-btn' + (draft.freeCupEligible ? ' on' : '')} aria-pressed={draft.freeCupEligible} style={{ alignSelf: 'flex-start' }}
            onClick={() => patch({ freeCupEligible: !draft.freeCupEligible })}>{draft.freeCupEligible ? 'مشمول بالكوب المجاني' : 'غير مشمول بالكوب المجاني'}</button>
          {error ? <div className="error" role="alert">{error}</div> : null}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-olive grow" onClick={save}>حفظ الصنف</button>
            <button type="button" className="btn btn-plain" onClick={() => setDraft(null)}>إلغاء</button>
          </div>
          {!isNew ? (confirmDelete
            ? <button type="button" className="pill-btn" onClick={() => run(() => api.deleteItem(draft.id))}>تأكيد حذف الصنف نهائياً</button>
            : <button type="button" className="pill-btn" onClick={() => setConfirmDelete(true)}>حذف الصنف</button>) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── الأقسام ───────────── */

function CatsTab() {
  const { menu, reloadMenu } = useApp();
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  if (!menu) return null;
  const run = async (fn: () => Promise<void>) => {
    try { await fn(); await reloadMenu(); setError(''); } catch (e) { setError(errorText(e)); }
  };
  const cats = [...menu.categories].sort((a, b) => a.sort - b.sort);
  const move = (c: Category, dir: -1 | 1) => {
    const i = cats.findIndex((x) => x.id === c.id), other = cats[i + dir];
    if (!other) return;
    void run(async () => {
      await api.saveCategory({ ...c, sort: other.sort });
      await api.saveCategory({ ...other, sort: c.sort });
    });
  };
  return (
    <div className="stack" style={{ maxWidth: 820, gap: 12 }}>
      <div className="row">
        <h2 className="section-title">الأقسام</h2>
        <button type="button" className="btn btn-ink"
          onClick={() => run(() => api.saveCategory({ id: newId(), name: 'قسم جديد', visible: true, sort: cats.reduce((m, c) => Math.max(m, c.sort), -1) + 1 }))}>قسم جديد</button>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {cats.map((c, i) => {
        const count = menu.items.filter((it) => it.categoryId === c.id).length;
        const name = names[c.id] ?? c.name;
        const save = () => { if (name.trim() && name.trim() !== c.name) void run(() => api.saveCategory({ ...c, name: name.trim() })); };
        return (
          <div key={c.id} className="card row" style={{ flexWrap: 'wrap', padding: '12px 14px' }}>
            <input className="input" aria-label="اسم القسم" style={{ flex: '1 1 220px' }} value={name}
              onChange={(e) => setNames({ ...names, [c.id]: e.target.value })} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <span className="small mute num" style={{ minWidth: 64 }}>{count} صنف</span>
            <button type="button" className="pill-btn" disabled={i === 0} onClick={() => move(c, -1)}>أعلى</button>
            <button type="button" className="pill-btn" disabled={i === cats.length - 1} onClick={() => move(c, 1)}>أسفل</button>
            <button type="button" className={'pill-btn' + (c.visible ? ' on' : '')} aria-pressed={c.visible} onClick={() => run(() => api.saveCategory({ ...c, visible: !c.visible }))}>{c.visible ? 'ظاهر' : 'مخفي'}</button>
            <button type="button" className="pill-btn" disabled={count > 0} onClick={() => run(() => api.deleteCategory(c.id))}>حذف</button>
          </div>
        );
      })}
      <span className="small mute">الاسم يُحفظ عند الخروج من الحقل. القسم الذي يحتوي أصنافاً لا يُحذف: انقل أصنافه أولاً أو أخفِه.</span>
    </div>
  );
}

/* ───────────── خيارات الأصناف ───────────── */

interface GroupDraft extends Omit<OptionGroup, 'options'> { options: { label: string; price: string }[] }
const toDraft = (g: OptionGroup): GroupDraft => ({ ...g, options: g.options.map((o) => ({ label: o.label, price: o.price ? String(o.price) : '' })) });

function GroupsTab() {
  const { menu, reloadMenu } = useApp();
  const [error, setError] = useState('');
  if (!menu) return null;
  const run = async (fn: () => Promise<void>) => {
    try { await fn(); await reloadMenu(); setError(''); } catch (e) { setError(errorText(e)); }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <h2 className="section-title">خيارات الأصناف</h2>
        <button type="button" className="btn btn-ink"
          onClick={() => run(() => api.saveGroup({ id: newId(), name: 'مجموعة جديدة', multi: false, coldOnly: false, defaultIndex: 0, options: [] }))}>مجموعة خيارات جديدة</button>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      <div className="cards">
        {menu.groups.map((g) => <GroupCard key={g.id} group={g} run={run} />)}
      </div>
      <span className="small mute">اربط كل مجموعة بالأصناف من نموذج تعديل الصنف في تبويب الأصناف.</span>
    </div>
  );
}

function GroupCard({ group, run }: { group: OptionGroup; run: (fn: () => Promise<void>) => Promise<void> }) {
  const [d, setD] = useState<GroupDraft>(() => toDraft(group));
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = (p: Partial<GroupDraft>) => { setD({ ...d, ...p }); setDirty(true); };
  const setOpt = (i: number, p: Partial<{ label: string; price: string }>) => patch({ options: d.options.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const save = () => {
    const options = d.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), price: Number(o.price) || 0 }));
    const next: OptionGroup = { ...d, name: d.name.trim() || group.name, options, defaultIndex: Math.min(d.defaultIndex, Math.max(0, options.length - 1)) };
    void run(() => api.saveGroup(next)).then(() => { setD(toDraft(next)); setDirty(false); });
  };
  return (
    <div className="card stack" style={{ gap: 10, padding: 18 }}>
      <input className="input" aria-label="اسم المجموعة" style={{ fontWeight: 600, fontSize: 15 }} value={d.name} onChange={(e) => patch({ name: e.target.value })} />
      <div className="wrap">
        <button type="button" className="pill-btn on" onClick={() => patch({ multi: !d.multi })}>{d.multi ? 'اختيار متعدد' : 'اختيار واحد'}</button>
        <button type="button" className={'pill-btn' + (d.coldOnly ? ' on' : '')} aria-pressed={d.coldOnly} onClick={() => patch({ coldOnly: !d.coldOnly })}>{d.coldOnly ? 'يظهر مع البارد فقط' : 'يظهر دائماً'}</button>
      </div>
      <span className="label">الخيار، وسعره الإضافي إن وجد (ر.س){d.multi ? '' : '. اختر الخيار المحدد مسبقاً'}</span>
      {d.options.map((o, i) => (
        <div className="row" key={i} style={{ gap: 8 }}>
          {!d.multi ? (
            <input type="radio" name={'def-' + d.id} aria-label={'افتراضي: ' + (o.label || 'خيار')} checked={d.defaultIndex === i} onChange={() => patch({ defaultIndex: i })} style={{ width: 20, height: 20, accentColor: '#2F3B25' }} />
          ) : null}
          <input className="input grow" aria-label="اسم الخيار" value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} />
          <input className="input num" aria-label="السعر الإضافي" style={{ width: 76 }} type="number" min={0} step="0.5" placeholder="0" value={o.price} onChange={(e) => setOpt(i, { price: e.target.value })} />
          <button type="button" className="icon-btn bare" aria-label="حذف الخيار" onClick={() => patch({ options: d.options.filter((_, j) => j !== i) })}><Icon name="close" size={18} /></button>
        </div>
      ))}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="pill-btn" style={{ borderStyle: 'dashed' }} onClick={() => patch({ options: [...d.options, { label: '', price: '' }] })}>أضف خياراً</button>
        <span className="wrap">
          {confirmDelete
            ? <button type="button" className="pill-btn" onClick={() => run(() => api.deleteGroup(group.id))}>تأكيد الحذف</button>
            : <button type="button" className="pill-btn" onClick={() => setConfirmDelete(true)}>حذف المجموعة</button>}
          <button type="button" className="pill-btn on" disabled={!dirty} onClick={save}>حفظ</button>
        </span>
      </div>
    </div>
  );
}

/* ───────────── الإعدادات ورموز الطاولات ───────────── */

function SettingsTab() {
  const { menu, reloadMenu } = useApp();
  const [s, setS] = useState<Settings | null>(menu?.settings ?? null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [tables, setTables] = useState(10);
  const [qrs, setQrs] = useState<{ n: number; src: string }[]>([]);

  useEffect(() => {
    let alive = true;
    const count = Math.max(0, Math.min(60, tables));
    Promise.all(Array.from({ length: count }, (_, i) =>
      QRCode.toDataURL(window.location.origin + '/t/' + (i + 1), { margin: 1, width: 320, color: { dark: '#11120F', light: '#FFFFFF' } })
        .then((src) => ({ n: i + 1, src })))).then((list) => { if (alive) setQrs(list); }).catch(() => {});
    return () => { alive = false; };
  }, [tables]);

  if (!menu || !s) return null;
  const num = (k: keyof Settings) => (e: { target: { value: string } }) => { setS({ ...s, [k]: Number(e.target.value) }); setMsg(''); };
  const save = async () => {
    if (!(s.stampsForFree >= 1) || !(s.pointsPerRiyalDiscount >= 1) || s.stampMin < 0 || s.pointsPerRiyal < 0) { setError('تحقق من القيم: يجب أن تكون أرقاماً موجبة.'); return; }
    try {
      await api.saveSettings(s);
      await reloadMenu();
      setMsg('حُفظت الإعدادات.');
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  const free = menu.items.filter((i) => i.freeCupEligible).map((i) => i.name);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="cards no-print">
        <div className="form-card">
          <b style={{ fontSize: 18 }}>قواعد المكافآت</b>
          <div className="field"><label htmlFor="s-min">الحد الأدنى للطلب المؤهل للختم (ر.س)</label>
            <input id="s-min" className="input num" type="number" min={0} step="0.5" value={s.stampMin} onChange={num('stampMin')} /></div>
          <div className="field"><label htmlFor="s-n">عدد الأختام قبل الكوب المجاني</label>
            <input id="s-n" className="input num" type="number" min={1} value={s.stampsForFree} onChange={num('stampsForFree')} /></div>
          <div className="field"><label htmlFor="s-earn">النقاط المكتسبة لكل ريال مدفوع</label>
            <input id="s-earn" className="input num" type="number" min={0} step="0.5" value={s.pointsPerRiyal} onChange={num('pointsPerRiyal')} /></div>
          <div className="field"><label htmlFor="s-redeem">عدد النقاط التي تخصم ريالاً واحداً</label>
            <input id="s-redeem" className="input num" type="number" min={1} value={s.pointsPerRiyalDiscount} onChange={num('pointsPerRiyalDiscount')} /></div>
          <span className="small" style={{ color: 'var(--sage-ink)' }}>
            الكوب المجاني: {free.length ? free.join('، ') : 'لا صنف مشمول بعد'}. غيّر الأصناف المشمولة من نموذج تعديل الصنف.
          </span>
          {error ? <div className="error" role="alert">{error}</div> : null}
          {msg ? <div className="notice" role="status" style={{ background: '#fbfaf5' }}>{msg}</div> : null}
          <button type="button" className="btn btn-olive" onClick={save}>حفظ الإعدادات</button>
        </div>
        <div className="card stack" style={{ gap: 12, padding: 22 }}>
          <b style={{ fontSize: 18 }}>قواعد الطلب</b>
          <span>مسح رمز QR على الطاولة يحدد رقمها ويجعل الطلب محلياً تلقائياً.</span>
          <span>نداء النادل متاح لكل طلب محلي له طاولة، ويظهر أعلى تبويب الطلبات.</span>
          <span>الطلب المحلي لا يُرسل قبل تحديد الطاولة أو اختيار التحضير عند الوصول.</span>
          <span>طلب من خارج المقهى مع الدفع عند الكاشير: يبدأ تحضيره عند تأكيد الوصول.</span>
          <span>الأختام والنقاط تُضاف بعد الدفع، والإلغاء يعيد ما استُخدم منها.</span>
          <span className="mute">التوصيل معطل ويظهر للعميل «قريباً».</span>
        </div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="row no-print" style={{ flexWrap: 'wrap' }}>
          <h2 className="section-title">رموز الطاولات</h2>
          <span className="row">
            <label htmlFor="tables" className="small">عدد الطاولات</label>
            <input id="tables" className="input num" style={{ width: 90 }} type="number" min={1} max={60} value={tables} onChange={(e) => setTables(Number(e.target.value))} />
            <button type="button" className="btn btn-ink" onClick={() => window.print()}>طباعة</button>
          </span>
        </div>
        <p className="small mute no-print">كل رمز يفتح الموقع على طاولته. اطبعها بعد ربط النطاق النهائي، لأن الرابط جزء من الرمز: <span dir="ltr" className="ltr">{window.location.origin}/t/1</span></p>
        <div className="qr-grid">
          {qrs.map((q) => (
            <div className="qr" key={q.n}>
              <img src={q.src} alt={'رمز QR لطاولة ' + q.n} />
              <b>طاولة {q.n}</b>
              <span style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--olive)' }}>مسدار</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
