import { useEffect, useState } from 'react';
import { newId } from '../lib/api';
import { sar } from '../lib/format';
import { useApp } from '../state';
import { Dialog, ErrorBox, Page, dateTime, ok, rpc, useAction, useData } from './shared';

interface Ingredient { id: string; name: string; unit: string; stock: number; reorderLevel: number; cost: number; low: boolean }
interface Recipe { itemId: string; sizeIndex: number | null; ingredientId: string; qty: number }
interface Move { id: number; ingredient: string; unit: string; kind: string; qty: number; note: string; orderNumber: string | null; by: string | null; createdAt: string }

const MOVE: Record<string, string> = { purchase: 'استلام', waste: 'هدر', adjust: 'تسوية جرد', sale: 'بيع', refund: 'استرجاع' };

export function Inventory() {
  const ings = useData(() => rpc<Ingredient[]>('staff_ingredients'), []);
  const moves = useData(() => rpc<Move[]>('staff_stock_moves', { p_limit: 80 }), []);
  const [tab, setTab] = useState<'stock' | 'recipes' | 'moves'>('stock');
  const [edit, setEdit] = useState<Ingredient | null>(null);
  const [move, setMove] = useState<Ingredient | null>(null);
  const reload = () => { void ings.reload(); void moves.reload(); };
  const value = (ings.data ?? []).reduce((a, i) => a + i.stock * i.cost, 0);

  return (
    <Page title="المخزون" actions={
      <div className="seg" style={{ gridTemplateColumns: 'repeat(3, auto)' }}>
        <button type="button" className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>المواد</button>
        <button type="button" className={tab === 'recipes' ? 'on' : ''} onClick={() => setTab('recipes')}>الوصفات</button>
        <button type="button" className={tab === 'moves' ? 'on' : ''} onClick={() => setTab('moves')}>الحركات</button>
      </div>
    }>
      <ErrorBox text={ings.error} />
      {tab === 'stock' ? (
        <>
          <div className="toolbar">
            <button type="button" className="btn btn-ink" onClick={() => setEdit({ id: newId(), name: '', unit: 'غرام', stock: 0, reorderLevel: 0, cost: 0, low: false })}>مادة جديدة</button>
            <span className="small mute">قيمة المخزون التقديرية: {sar(Math.round(value * 100) / 100)}</span>
          </div>
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>المادة</th><th>الرصيد</th><th>حد إعادة الطلب</th><th>تكلفة الوحدة</th><th /></tr></thead>
              <tbody>
                {(ings.data ?? []).map((i) => (
                  <tr key={i.id}>
                    <td><b>{i.name}</b> {i.low ? <span className="badge bad">تحت الحد</span> : null}</td>
                    <td className="num">{i.stock} {i.unit}</td>
                    <td className="num">{i.reorderLevel} {i.unit}</td>
                    <td className="num">{i.cost}</td>
                    <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="pill-btn on" onClick={() => setMove(i)}>حركة</button>
                      <button type="button" className="pill-btn" onClick={() => setEdit(i)}>تعديل</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ings.loaded && !ings.data?.length ? <p className="empty">أضف المواد الخام، ثم اربطها بالأصناف من تبويب الوصفات ليُخصم المخزون تلقائياً مع كل بيع.</p> : null}
          </div>
        </>
      ) : null}
      {tab === 'recipes' ? <Recipes ings={ings.data ?? []} /> : null}
      {tab === 'moves' ? (
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>الوقت</th><th>المادة</th><th>النوع</th><th>الكمية</th><th>المرجع</th><th>بواسطة</th></tr></thead>
            <tbody>
              {(moves.data ?? []).map((m) => (
                <tr key={m.id}><td>{dateTime(m.createdAt)}</td><td>{m.ingredient}</td><td>{MOVE[m.kind] ?? m.kind}</td>
                  <td className="num" dir="ltr">{m.qty > 0 ? '+' : ''}{m.qty} {m.unit}</td><td>{m.orderNumber ?? m.note}</td><td>{m.by ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {edit ? <EditIngredient ing={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} /> : null}
      {move ? <MoveDialog ing={move} onClose={() => setMove(null)} onDone={() => { setMove(null); reload(); }} /> : null}
    </Page>
  );
}

function EditIngredient({ ing, onClose, onDone }: { ing: Ingredient; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState(ing);
  const act = useAction();
  return (
    <Dialog title={ing.name ? 'تعديل ' + ing.name : 'مادة جديدة'} onClose={onClose}>
      <div className="field"><label htmlFor="ing-name">الاسم</label><input id="ing-name" className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label htmlFor="ing-unit">الوحدة</label><input id="ing-unit" className="input" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="غرام، مل، قطعة" /></div>
        <div className="field grow"><label htmlFor="ing-reorder">حد إعادة الطلب</label><input id="ing-reorder" className="input num" type="number" min={0} value={d.reorderLevel} onChange={(e) => setD({ ...d, reorderLevel: Number(e.target.value) })} /></div>
        <div className="field grow"><label htmlFor="ing-cost">تكلفة الوحدة</label><input id="ing-cost" className="input num" type="number" min={0} step="0.001" value={d.cost} onChange={(e) => setD({ ...d, cost: Number(e.target.value) })} /></div>
      </div>
      <span className="small mute">الرصيد يتغير بالحركات فقط: استلام، هدر، تسوية جرد، والبيع تلقائياً.</span>
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-ink" disabled={act.busy || !d.name.trim()} onClick={() => void act.run(() => ok(rpc('staff_save_ingredient', { p: { ...d, name: d.name.trim() } }))).then((r) => { if (r) onDone(); })}>حفظ</button>
    </Dialog>
  );
}

function MoveDialog({ ing, onClose, onDone }: { ing: Ingredient; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'purchase' | 'waste' | 'adjust'>('purchase');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <Dialog title={ing.name + ' · الرصيد ' + ing.stock + ' ' + ing.unit} onClose={onClose}>
      <div className="seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {(['purchase', 'waste', 'adjust'] as const).map((k) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{MOVE[k]}</button>)}
      </div>
      <div className="field"><label htmlFor="mv-qty">{kind === 'adjust' ? 'الفرق (موجب أو سالب)' : 'الكمية'} ({ing.unit})</label>
        <input id="mv-qty" className="input num" type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
      <div className="field"><label htmlFor="mv-note">ملاحظة</label><input id="mv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'purchase' ? 'رقم فاتورة المورد' : ''} /></div>
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-ink" disabled={act.busy || !Number(qty)} onClick={() => void act.run(() => ok(rpc('staff_stock_move', { p_ingredient: ing.id, p_kind: kind, p_qty: Number(qty), p_note: note }))).then((r) => { if (r) onDone(); })}>تسجيل</button>
    </Dialog>
  );
}

function Recipes({ ings }: { ings: Ingredient[] }) {
  const { menu } = useApp();
  const all = useData(() => rpc<Recipe[]>('staff_recipes'), []);
  const [itemId, setItemId] = useState('');
  const [rows, setRows] = useState<{ sizeIndex: string; ingredientId: string; qty: string }[]>([]);
  const act = useAction();
  const item = menu?.items.find((i) => i.id === itemId);
  useEffect(() => {
    setRows((all.data ?? []).filter((r) => r.itemId === itemId).map((r) => ({ sizeIndex: r.sizeIndex == null ? '' : String(r.sizeIndex), ingredientId: r.ingredientId, qty: String(r.qty) })));
  }, [itemId, all.data]);
  if (!menu) return null;
  const count = (id: string) => (all.data ?? []).filter((r) => r.itemId === id).length;
  return (
    <div className="grid-2">
      <div className="panel">
        <h2>الأصناف</h2>
        <div className="list">
          {menu.items.map((i) => (
            <button key={i.id} type="button" className="li" style={{ background: i.id === itemId ? 'var(--sage)' : 'transparent', border: 0, borderBottom: '1px solid var(--line)', textAlign: 'start', padding: '10px 8px', borderRadius: 8 }} onClick={() => setItemId(i.id)}>
              <span>{i.name}</span><span className="small mute">{count(i.id) ? count(i.id) + ' مكونات' : 'بلا وصفة'}</span>
            </button>
          ))}
        </div>
      </div>
      {item ? (
        <div className="panel">
          <h2>وصفة {item.name}</h2>
          <p className="small mute">الكمية لكل قطعة واحدة. «كل الأحجام» تنطبق ما لم تُحدَّد كمية لحجم بعينه.</p>
          {rows.map((r, i) => (
            <div className="row" key={i} style={{ gap: 6 }}>
              <select className="input grow" aria-label="المادة" value={r.ingredientId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))}>
                <option value="">اختر مادة</option>
                {ings.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}
              </select>
              <select className="input" style={{ maxWidth: 130 }} aria-label="الحجم" value={r.sizeIndex} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sizeIndex: e.target.value } : x)))}>
                <option value="">كل الأحجام</option>
                {item.sizes.map((z, k) => <option key={k} value={k}>{z.label}</option>)}
              </select>
              <input className="input num" style={{ maxWidth: 90 }} type="number" min={0} step="any" aria-label="الكمية" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              <button type="button" className="icon-btn bare" aria-label="حذف" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="pill-btn" style={{ alignSelf: 'flex-start', borderStyle: 'dashed' }} disabled={!ings.length} onClick={() => setRows([...rows, { sizeIndex: '', ingredientId: '', qty: '' }])}>أضف مكوناً</button>
          {!ings.length ? <span className="small">أضف المواد أولاً من تبويب المواد.</span> : null}
          <ErrorBox text={act.error} />
          <button type="button" className="btn btn-ink" disabled={act.busy}
            onClick={() => void act.run(() => rpc('staff_save_recipe', { p_item: item.id, p_rows: rows.filter((r) => r.ingredientId && Number(r.qty) > 0).map((r) => ({ sizeIndex: r.sizeIndex === '' ? null : Number(r.sizeIndex), ingredientId: r.ingredientId, qty: Number(r.qty) })) })).then(() => all.reload())}>حفظ الوصفة</button>
        </div>
      ) : <div className="panel"><p className="empty">اختر صنفاً لتحديد مكوناته.</p></div>}
    </div>
  );
}
