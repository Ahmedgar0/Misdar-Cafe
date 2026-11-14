import { useState } from 'react';
import { ItemSheet } from '../components/ItemSheet';
import { Icon } from '../components/ui';
import { sar } from '../lib/format';
import type { Item, Temp } from '../lib/types';
import { useApp } from '../state';

type Filter = 'all' | Temp;
const FILTERS: [Filter, string][] = [['all', 'الكل'], ['hot', 'ساخن'], ['cold', 'بارد']];

export function MenuPage() {
  const { menu } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState<Item | null>(null);
  if (!menu) return null;

  const cats = menu.categories.filter((c) => c.visible).sort((a, b) => a.sort - b.sort);
  const visible = new Set(cats.map((c) => c.id));
  const items = menu.items
    .filter((i) => visible.has(i.categoryId))
    .filter((i) => cat === 'all' || i.categoryId === cat)
    .filter((i) => (filter === 'all' ? true : filter === 'hot' ? i.hot : i.cold))
    .sort((a, b) => a.sort - b.sort);

  return (
    <div className="screen" style={{ gap: 14 }}>
      <h1 className="title">القائمة</h1>
      <div className="seg" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      <div className="wrap">
        <button type="button" className={'chip' + (cat === 'all' ? ' on' : '')} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>الكل</button>
        {cats.map((c) => (
          <button key={c.id} type="button" className={'chip' + (cat === c.id ? ' on' : '')} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>
        ))}
      </div>
      <div>
        {items.map((it) => {
          const first = it.sizes.find((z) => z.price != null);
          return (
            <button key={it.id} type="button" className="menu-row" disabled={!it.available || !first} onClick={() => setOpen(it)}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span className="name">{it.name}</span>
                <span className="wrap" style={{ gap: 6, alignItems: 'center' }}>
                  {it.description ? <span className="small mute">{it.description}</span> : null}
                  {it.hot && it.cold ? <span className="tag">ساخن أو بارد</span> : null}
                  {!it.available ? <span className="small mute">نفد اليوم</span> : null}
                </span>
              </span>
              <span className="row" style={{ flexShrink: 0 }}>
                <span className="num" style={{ fontSize: 13, color: 'var(--sage-ink)' }}>
                  {first ? (it.sizes.length > 1 ? 'من ' : '') + sar(first.price as number) : 'السعر لاحقاً'}
                </span>
                <span className="plus"><Icon name="plus" size={18} /></span>
              </span>
            </button>
          );
        })}
      </div>
      {items.length === 0 ? <div className="dashed">لا توجد أصناف بهذا التصنيف.</div> : null}
      {open ? <ItemSheet item={open} initialTemp={filter === 'all' ? null : filter} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
