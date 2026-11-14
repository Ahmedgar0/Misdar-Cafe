import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ServiceSheet } from '../components/ServiceSheet';
import { Icon, ServiceBar, Waves } from '../components/ui';
import { api } from '../lib/api';
import { describeCartLine, sar } from '../lib/format';
import { computeTotals, errorText, freeCupReady, needsArrival } from '../lib/pricing';
import type { FreeCup, PayMethod } from '../lib/types';
import { useApp } from '../state';

export function Cart() {
  const { menu, cart, removeLine, clearCart, service, session, loyalty, refreshMe, setLastOrderId } = useApp();
  const nav = useNavigate();
  const [svcOpen, setSvcOpen] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [free, setFree] = useState<FreeCup | null>(null);
  const [pay, setPay] = useState<PayMethod>('online');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // أصناف حُذفت من القائمة أو نفدت تُزال من السلة
  const views = menu ? cart.map((l) => ({ l, v: describeCartLine(menu, l) })) : [];
  const stale = views.filter((x) => !x.v).map((x) => x.l.key).join(',');
  useEffect(() => {
    if (stale) stale.split(',').forEach(removeLine);
  }, [stale, removeLine]);

  if (!menu) return null;
  const s = menu.settings;
  const lines = views.filter((x) => x.v);
  const l = loyalty ?? { stamps: 0, points: 0 };
  const ready = !!session && freeCupReady(l, s);
  const subtotal = lines.reduce((a, x) => a + x.v!.unit * x.l.qty, 0);
  const t = computeTotals(subtotal, l, s, usePoints && !!session);
  const maxDiscount = Math.floor(l.points / s.pointsPerRiyalDiscount);
  const usedFree = ready && !!free;
  const empty = lines.length === 0 && !usedFree;
  const svcReady = !(service.type === 'dinein' && service.table == null && !service.later);
  const waits = needsArrival(service, pay);

  type FreeOption = FreeCup & { label: string };
  const freeOptions = menu.items.filter((i) => i.freeCupEligible && i.available).flatMap<FreeOption>((i) =>
    i.hot && i.cold
      ? [{ itemId: i.id, temp: 'hot', label: i.name + ' ساخنة' }, { itemId: i.id, temp: 'cold', label: i.name + ' باردة' }]
      : [{ itemId: i.id, temp: null, label: i.name }]);

  let hint: string;
  if (!session) hint = 'سجّل دخولك لتكسب الأختام والنقاط من هذا الطلب.';
  else if (usedFree) hint = 'هذا طلبك الرابع. تبدأ بعده بطاقة جديدة.';
  else if (ready) hint = 'كوبك المجاني جاهز. اختره من القائمة أعلاه.';
  else if (t.qualifies) hint = 'هذا الطلب يضيف ختماً إلى بطاقتك بعد الدفع.';
  else hint = 'أضف ' + sar(s.stampMin - t.total) + ' ليُحتسب الطلب ختماً. الحد الأدنى ' + sar(s.stampMin) + '.';

  const submit = async () => {
    if (!session) { nav('/login?next=/cart'); return; }
    setBusy(true);
    setError('');
    try {
      const order = await api.placeOrder(session.token, {
        lines: lines.map(({ l: { key: _key, ...rest } }) => rest),
        service, payMethod: pay, usePoints, freeCup: usedFree ? free : null,
      });
      clearCart();
      setLastOrderId(order.id);
      await refreshMe();
      nav(order.status === 'awaiting_payment' ? '/pay/' + order.id : '/order/' + order.id, { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  let cta: string;
  if (!session) cta = 'سجّل الدخول لإتمام الطلب';
  else if (!svcReady) cta = 'حدد طاولتك أولاً';
  else if (t.total === 0) cta = 'أرسل الطلب';
  else if (pay === 'cashier') cta = 'أرسل الطلب وادفع عند الكاشير';
  else cta = 'متابعة إلى الدفع · ' + sar(t.total);

  return (
    <div className="screen">
      <h1 className="title">السلة</h1>
      <ServiceBar onOpen={() => setSvcOpen(true)} />

      {empty && !ready ? (
        <div className="dashed">
          <span>سلتك فارغة</span>
          <Link to="/menu" className="btn btn-olive">تصفح القائمة</Link>
        </div>
      ) : null}

      <div>
        {lines.map(({ l: line, v }) => (
          <div className="line" key={line.key}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{v!.title}{line.qty > 1 ? ' × ' + line.qty : ''}</div>
              {v!.meta ? <div className="small mute">{v!.meta}</div> : null}
            </div>
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <span className="num" style={{ fontSize: 13 }}>{sar(v!.unit * line.qty)}</span>
              <button type="button" className="icon-btn bare" aria-label={'حذف ' + v!.title} onClick={() => removeLine(line.key)}><Icon name="close" size={18} /></button>
            </div>
          </div>
        ))}
        {usedFree ? (
          <div className="line">
            <div><div style={{ fontWeight: 600 }}>{freeOptions.find((o) => o.itemId === free!.itemId && o.temp === free!.temp)?.label}</div><div className="small mute">كوبك المجاني</div></div>
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 13 }}>مجاناً</span>
              <button type="button" className="icon-btn bare" aria-label="إزالة الكوب المجاني" onClick={() => setFree(null)}><Icon name="close" size={18} /></button>
            </div>
          </div>
        ) : null}
      </div>

      {ready ? (
        <div className="hero" style={{ borderRadius: 22, padding: 18 }}>
          <Waves />
          <div className="inner" style={{ gap: 12 }}>
            <div><div style={{ fontSize: 16, fontWeight: 600 }}>هذا طلبك الرابع</div><div className="small soft">اختر كوبك المجاني</div></div>
            <div className="wrap">
              {freeOptions.map((o) => {
                const on = free?.itemId === o.itemId && free?.temp === o.temp;
                return (
                  <button key={o.label} type="button" className="chip" aria-pressed={on}
                    style={on ? { background: '#EFEBE1', borderColor: '#EFEBE1', color: '#2F3B25' } : { background: 'transparent', borderColor: '#A9B39A', color: '#EFEBE1' }}
                    onClick={() => setFree(on ? null : { itemId: o.itemId, temp: o.temp })}>{o.label}</button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {session && maxDiscount > 0 && lines.length > 0 ? (
        <button type="button" className="service-bar" aria-pressed={usePoints} style={usePoints ? { background: 'var(--sage)', borderColor: 'var(--olive)' } : undefined}
          onClick={() => setUsePoints(!usePoints)}>
          <span><b>استخدم نقاطي</b><br /><span className="small num" style={{ color: 'var(--sage-ink)' }}>رصيدك {l.points} نقطة، تساوي {sar(maxDiscount)}</span></span>
          <span className="action">{usePoints ? 'مفعّل' : 'تفعيل'}</span>
        </button>
      ) : null}

      {!empty ? (
        <>
          <div className="card summary">
            <div className="row" style={{ color: 'var(--sage-ink)' }}><span>المجموع</span><span className="num">{sar(t.subtotal)}</span></div>
            {t.discount > 0 ? <div className="row" style={{ color: 'var(--sage-ink)' }}><span>خصم النقاط</span><span className="num">− {sar(t.discount)}</span></div> : null}
            <div className="row total"><span>الإجمالي</span><span className="num">{sar(t.total)}</span></div>
            <div className="hint">{hint}</div>
          </div>

          {t.total > 0 ? (
            <div className="stack">
              <span className="label">طريقة الدفع</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <button type="button" className={'chip block' + (pay === 'online' ? ' on' : '')} aria-pressed={pay === 'online'} onClick={() => setPay('online')}>دفع إلكتروني</button>
                <button type="button" className={'chip block' + (pay === 'cashier' ? ' on' : '')} aria-pressed={pay === 'cashier'} onClick={() => setPay('cashier')}>عند الكاشير</button>
              </div>
              {waits && service.type === 'takeaway' && pay === 'cashier' ? (
                <span className="small" style={{ color: 'var(--sage-ink)' }}>الدفع عند الكاشير لطلب من خارج المقهى: يبدأ التحضير عند تأكيد وصولك.</span>
              ) : null}
            </div>
          ) : null}

          {error ? <div className="error" role="alert">{error}</div> : null}
          <button type="button" className="btn btn-ink btn-block" disabled={busy || (!!session && !svcReady)} onClick={submit}>
            {busy ? 'جارٍ إرسال الطلب' : cta}
          </button>
        </>
      ) : null}

      {svcOpen ? <ServiceSheet onClose={() => setSvcOpen(false)} /> : null}
    </div>
  );
}
