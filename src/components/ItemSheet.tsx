import { useMemo, useState } from 'react';
import { sar } from '../lib/format';
import { groupApplies } from '../lib/pricing';
import type { Item, Temp } from '../lib/types';
import { useApp } from '../state';
import { Icon, Sheet, SheetHead } from './ui';

export function ItemSheet({ item, initialTemp, onClose }: { item: Item; initialTemp: Temp | null; onClose: () => void }) {
  const { menu, addLines } = useApp();
  const both = item.hot && item.cold;
  const firstPriced = Math.max(0, item.sizes.findIndex((s) => s.price != null));
  const [sizeIndex, setSizeIndex] = useState(firstPriced);
  const [temp, setTemp] = useState<Temp | null>(both ? initialTemp : null);
  const [sel, setSel] = useState<Record<string, number[]>>({});
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);

  const groups = useMemo(
    () => (menu?.groups ?? []).filter((g) => groupApplies(item, g, temp) && g.options.length > 0),
    [menu, item, temp],
  );
  // المجموعات ذات الاختيار الواحد تبدأ بخيارها الافتراضي
  const picked = (gid: string, multi: boolean, def: number): number[] => sel[gid] ?? (multi ? [] : [def]);

  const size = item.sizes[sizeIndex];
  const needTemp = both && !temp;
  const unit = (size?.price ?? 0) + groups.reduce(
    (a, g) => a + picked(g.id, g.multi, g.defaultIndex).reduce((b, i) => b + (g.options[i]?.price || 0), 0), 0);
  const disabled = needTemp || !size || size.price == null;

  const toggle = (gid: string, multi: boolean, def: number, i: number) => {
    const cur = picked(gid, multi, def);
    setSel({ ...sel, [gid]: multi ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]) : [i] });
  };

  const add = () => {
    if (disabled) return;
    addLines([{
      itemId: item.id, sizeIndex, temp: both ? temp : null, note: item.noteTitle ? note.trim() : '', qty,
      choices: groups
        .map((g) => ({ groupId: g.id, optionIndexes: picked(g.id, g.multi, g.defaultIndex) }))
        .filter((c) => c.optionIndexes.length > 0),
    }]);
    onClose();
  };

  return (
    <Sheet label={'تخصيص ' + item.name} onClose={onClose}>
      <SheetHead title={item.name} sub={item.description} onClose={onClose} />

      {both ? (
        <div className="stack">
          <span className="label">كيف تفضّله؟</span>
          <div className="temp-pick">
            <button type="button" className={temp === 'hot' ? 'on' : ''} aria-pressed={temp === 'hot'} onClick={() => setTemp('hot')}>
              <Icon name="hot" size={26} /> ساخن
            </button>
            <button type="button" className={temp === 'cold' ? 'on' : ''} aria-pressed={temp === 'cold'} onClick={() => setTemp('cold')}>
              <Icon name="cold" size={26} /> بارد
            </button>
          </div>
        </div>
      ) : null}

      {item.sizes.length > 1 ? (
        <div className="stack">
          <span className="label">الحجم</span>
          <div className="wrap">
            {item.sizes.map((s, i) => (
              <button key={i} type="button" className={'chip' + (sizeIndex === i ? ' on' : '')} disabled={s.price == null}
                aria-pressed={sizeIndex === i} onClick={() => setSizeIndex(i)}>
                {s.label} · {s.price == null ? 'السعر لاحقاً' : sar(s.price)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {groups.map((g) => (
        <div className="stack" key={g.id}>
          <span className="label">{g.name}{g.multi ? ' (اختر ما تشاء)' : ''}</span>
          <div className="wrap">
            {g.options.map((o, i) => {
              const on = picked(g.id, g.multi, g.defaultIndex).includes(i);
              return (
                <button key={i} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on}
                  onClick={() => toggle(g.id, g.multi, g.defaultIndex, i)}>
                  {o.label}{o.price ? ' · +' + sar(o.price) : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {item.noteTitle ? (
        <div className="field">
          <label htmlFor="item-note" style={{ fontSize: 15, fontWeight: 700, color: 'var(--olive)' }}>{item.noteTitle}</label>
          <textarea id="item-note" className="input" maxLength={160} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: زنجبيل زيادة، تحميص غامق، سكر على جنب" />
          <span className="small mute">نحضّرها كما تصفها.</span>
        </div>
      ) : null}

      <div className="row">
        <div className="qty">
          <button type="button" aria-label="إنقاص الكمية" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
          <span className="num">{qty}</span>
          <button type="button" aria-label="زيادة الكمية" onClick={() => setQty(Math.min(50, qty + 1))}>+</button>
        </div>
        <button type="button" className="btn btn-ink grow" style={{ minHeight: 52 }} disabled={disabled} onClick={add}>
          {needTemp ? 'اختر ساخن أو بارد' : 'أضف إلى السلة · ' + sar(unit * qty)}
        </button>
      </div>
    </Sheet>
  );
}
