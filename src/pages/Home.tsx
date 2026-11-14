import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ItemSheet } from '../components/ItemSheet';
import { ServiceSheet } from '../components/ServiceSheet';
import { Icon, ServiceBar, StampRow, WaiterButton, Waves } from '../components/ui';
import { api } from '../lib/api';
import { describeOrderLine, sar, stampMessage } from '../lib/format';
import type { Item, Order } from '../lib/types';
import { useApp } from '../state';

export function Home() {
  const { menu, session, loyalty, service, addLines } = useApp();
  const nav = useNavigate();
  const [svcOpen, setSvcOpen] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  const [last, setLast] = useState<Order | null>(null);

  useEffect(() => {
    if (!session) { setLast(null); return; }
    let alive = true;
    api.myOrders(session.token).then((o) => { if (alive) setLast(o.find((x) => x.lines.length > 0) ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [session]);

  if (!menu) return null;
  const s = menu.settings;
  const visibleCats = new Set(menu.categories.filter((c) => c.visible).map((c) => c.id));
  const orderable = menu.items.filter((i) => i.available && visibleCats.has(i.categoryId));
  const popular = [...orderable.filter((i) => i.freeCupEligible), ...orderable.filter((i) => !i.freeCupEligible)].slice(0, 4);

  const reorder = () => {
    if (!last) return;
    const lines = last.lines
      .filter((l) => menu.items.some((i) => i.id === l.itemId && i.available))
      .map((l) => ({
        itemId: l.itemId, sizeIndex: l.sizeIndex, temp: l.temp, note: l.note, qty: l.qty,
        choices: l.choices.map((c) => ({ groupId: c.groupId, optionIndexes: c.optionIndexes })),
      }));
    addLines(lines);
    nav('/cart');
  };

  return (
    <div className="screen">
      <div className="row">
        <div>
          <div className="wordmark">مسدار</div>
          <div dir="ltr" className="wordmark-sub ltr">MISDAR CAFE</div>
        </div>
        {session && loyalty ? (
          <Link to="/rewards" className="btn btn-plain" style={{ background: 'var(--surf)', minHeight: 44 }}><span className="num">{loyalty.points}</span> نقطة</Link>
        ) : (
          <Link to="/login" className="btn btn-plain" style={{ background: 'var(--surf)', minHeight: 44 }}>تسجيل الدخول</Link>
        )}
      </div>

      <ServiceBar onOpen={() => setSvcOpen(true)} />
      {service.type === 'dinein' ? <WaiterButton table={service.table} /> : null}

      <div className="hero">
        <Waves />
        <div className="inner">
          <span className="small soft">بطاقة القهوة</span>
          {session && loyalty ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.35 }}>{stampMessage(loyalty.stamps, s.stampsForFree)}</div>
              <StampRow stamps={loyalty.stamps} need={s.stampsForFree} tone="olive" />
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.35 }}>كوب مجاني بعد كل {s.stampsForFree} طلبات</div>
              <StampRow stamps={0} need={s.stampsForFree} tone="olive" />
              <Link to="/login" className="btn btn-light" style={{ alignSelf: 'flex-start' }}>سجّل دخولك لتجمع الأختام</Link>
            </>
          )}
        </div>
      </div>

      {last ? (
        <div className="card-sage row">
          <div style={{ minWidth: 0 }}>
            <div className="small" style={{ color: 'var(--sage-ink)' }}>طلبك الأخير</div>
            <div style={{ fontWeight: 600 }}>{last.lines.map((l) => describeOrderLine(l).title).join('، ')}</div>
            <div className="small num" style={{ color: 'var(--sage-ink)' }}>{sar(last.subtotal)}</div>
          </div>
          <button type="button" className="btn btn-ink" style={{ flexShrink: 0, minHeight: 44 }} onClick={reorder}>أعد الطلب</button>
        </div>
      ) : null}

      <div className="row">
        <h2 className="section-title">من القائمة</h2>
        <Link to="/menu" className="btn-text" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>القائمة كاملة</Link>
      </div>
      <div className="tiles">
        {popular.map((it, i) => (
          <button key={it.id} type="button" className={'tile t' + i} onClick={() => setOpen(it)}>
            <span>
              <span className="name">{it.name}</span><br />
              <span className="sub">{it.hot && it.cold ? 'ساخن أو بارد' : it.description}</span>
            </span>
            <span className="row">
              <span className="num" style={{ fontSize: 13, fontWeight: 500 }}>
                {it.sizes.length > 1 ? 'من ' : ''}{sar(it.sizes.find((z) => z.price != null)?.price ?? 0)}
              </span>
              <Icon name="plus" />
            </span>
          </button>
        ))}
      </div>

      {svcOpen ? <ServiceSheet onClose={() => setSvcOpen(false)} /> : null}
      {open ? <ItemSheet item={open} initialTemp={null} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
