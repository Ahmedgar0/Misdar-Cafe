import { useState } from 'react';
import { Icon } from '../components/ui';
import { newId } from '../lib/api';
import type { Category, Item, OptionGroup, Size } from '../lib/types';
import { useApp } from '../state';
import { Page, rpc } from './shared';
import { errorText } from '../lib/pricing';

export function MenuAdmin() {
  const [tab, setTab] = useState<'items' | 'cats' | 'groups'>('items');
  return (
    <Page title="القائمة" actions={
      <div className="seg" style={{ gridTemplateColumns: 'repeat(3, auto)' }}>
        <button type="button" className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>الأصناف</button>
        <button type="button" className={tab === 'cats' ? 'on' : ''} onClick={() => setTab('cats')}>الأقسام</button>
        <button type="button" className={tab === 'groups' ? 'on' : ''} onClick={() => setTab('groups')}>الخيارات</button>
      </div>
    }>
      {tab === 'items' ? <ItemsTab /> : null}
      {tab === 'cats' ? <CatsTab /> : null}
      {tab === 'groups' ? <GroupsTab /> : null}
    </Page>
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

  const run = async (fn: () => Promise<unknown>, close = true) => {
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
    void run(() => rpc('staff_save_item', { p: { ...draft, name, description: draft.description.trim(), noteTitle: draft.noteTitle.trim(), sizes } }));
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
                  onClick={() => run(() => rpc('staff_set_item_available', { p_id: it.id, p_available: !it.available }), false)}>{it.available ? 'متاح' : 'نفد'}</button>
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
            ? <button type="button" className="pill-btn" onClick={() => run(() => rpc('staff_delete_item', { p_id: draft.id }))}>تأكيد حذف الصنف نهائياً</button>
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
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await reloadMenu(); setError(''); } catch (e) { setError(errorText(e)); }
  };
  const cats = [...menu.categories].sort((a, b) => a.sort - b.sort);
  const move = (c: Category, dir: -1 | 1) => {
    const i = cats.findIndex((x) => x.id === c.id), other = cats[i + dir];
    if (!other) return;
    void run(async () => {
      await rpc('staff_save_category', { p: { ...c, sort: other.sort } });
      await rpc('staff_save_category', { p: { ...other, sort: c.sort } });
    });
  };
  return (
    <div className="stack" style={{ maxWidth: 820, gap: 12 }}>
      <div className="row">
        <h2 className="section-title">الأقسام</h2>
        <button type="button" className="btn btn-ink"
          onClick={() => run(() => rpc('staff_save_category', { p: { id: newId(), name: 'قسم جديد', visible: true, sort: cats.reduce((m, c) => Math.max(m, c.sort), -1) + 1 } }))}>قسم جديد</button>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {cats.map((c, i) => {
        const count = menu.items.filter((it) => it.categoryId === c.id).length;
        const name = names[c.id] ?? c.name;
        const save = () => { if (name.trim() && name.trim() !== c.name) void run(() => rpc('staff_save_category', { p: { ...c, name: name.trim() } })); };
        return (
          <div key={c.id} className="card row" style={{ flexWrap: 'wrap', padding: '12px 14px' }}>
            <input className="input" aria-label="اسم القسم" style={{ flex: '1 1 220px' }} value={name}
              onChange={(e) => setNames({ ...names, [c.id]: e.target.value })} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <span className="small mute num" style={{ minWidth: 64 }}>{count} صنف</span>
            <button type="button" className="pill-btn" disabled={i === 0} onClick={() => move(c, -1)}>أعلى</button>
            <button type="button" className="pill-btn" disabled={i === cats.length - 1} onClick={() => move(c, 1)}>أسفل</button>
            <button type="button" className={'pill-btn' + (c.visible ? ' on' : '')} aria-pressed={c.visible} onClick={() => run(() => rpc('staff_save_category', { p: { ...c, visible: !c.visible } }))}>{c.visible ? 'ظاهر' : 'مخفي'}</button>
            <button type="button" className="pill-btn" disabled={count > 0} onClick={() => run(() => rpc('staff_delete_category', { p_id: c.id }))}>حذف</button>
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
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await reloadMenu(); setError(''); } catch (e) { setError(errorText(e)); }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <h2 className="section-title">خيارات الأصناف</h2>
        <button type="button" className="btn btn-ink"
          onClick={() => run(() => rpc('staff_save_group', { p: { id: newId(), name: 'مجموعة جديدة', multi: false, coldOnly: false, defaultIndex: 0, options: [] } }))}>مجموعة خيارات جديدة</button>
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
    void run(() => rpc('staff_save_group', { p: next })).then(() => { setD(toDraft(next)); setDirty(false); });
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
            ? <button type="button" className="pill-btn" onClick={() => run(() => rpc('staff_delete_group', { p_id: group.id }))}>تأكيد الحذف</button>
            : <button type="button" className="pill-btn" onClick={() => setConfirmDelete(true)}>حذف المجموعة</button>}
          <button type="button" className="pill-btn on" disabled={!dirty} onClick={save}>حفظ</button>
        </span>
      </div>
    </div>
  );
}

