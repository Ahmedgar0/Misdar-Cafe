import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loading, WaiterButton, Waves } from '../components/ui';
import { api } from '../lib/api';
import { PICKUP_LABEL, describeOrderLine, sar, tempLabel } from '../lib/format';
import { errorText } from '../lib/pricing';
import type { Order } from '../lib/types';
import { useApp } from '../state';

function headline(o: Order): { title: string; text: string } {
  switch (o.status) {
    case 'awaiting_payment':
      return { title: 'بانتظار الدفع', text: 'أكمل الدفع ليبدأ تحضير طلبك.' };
    case 'waiting_arrival':
      return o.serviceType === 'dinein'
        ? { title: 'نبدأ التحضير عند وصولك', text: 'عند دخولك امسح رمز QR على طاولتك، أو أدخل رقمها هنا.' }
        : { title: 'نبدأ التحضير عند وصولك', text: 'اضغط «وصلت» عند دخولك المقهى.' };
    case 'new':
    case 'preparing':
      if (o.serviceType === 'dinein') return { title: 'استلمنا طلبك', text: 'نحضّره الآن ونقدّمه على طاولة ' + o.table + '.' };
      return {
        title: 'استلمنا طلبك',
        text: o.pickup === '15' || o.pickup === '30'
          ? 'نجهّزه بتغليف سفري ليكون جاهزاً ' + PICKUP_LABEL[o.pickup] + '. استلمه من منصة الاستلام.'
          : 'نحضّره الآن بتغليف سفري. استلمه من منصة الاستلام.',
      };
    case 'ready':
      return o.serviceType === 'dinein'
        ? { title: 'طلبك جاهز', text: 'في طريقه إلى طاولة ' + o.table + '.' }
        : { title: 'طلبك جاهز', text: 'استلمه من منصة الاستلام برقم الطلب.' };
    case 'done':
      return { title: 'بالهناء', text: 'سُلّم طلبك. نراك قريباً.' };
    default:
      return { title: 'أُلغي الطلب', text: 'أعدنا إليك النقاط أو الكوب المجاني إن استُخدما.' };
  }
}

export function OrderPage() {
  const { id = '' } = useParams();
  const { session, refreshMe, menu } = useApp();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [table, setTable] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const o = await api.getOrder(session.token, id);
      setOrder((prev) => {
        if (prev && (prev.status !== o.status || prev.paymentStatus !== o.paymentStatus)) void refreshMe();
        return o;
      });
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }, [session, id, refreshMe]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  if (!session) return <div className="screen"><Link to={'/login?next=/order/' + id} className="btn btn-ink btn-block">سجّل الدخول لمتابعة طلبك</Link></div>;
  if (error && !order) return <div className="screen"><div className="error" role="alert">{error}</div></div>;
  if (!order) return <Loading />;

  const h = headline(order);
  const stage = order.status === 'ready' || order.status === 'done' ? 2 : order.status === 'preparing' ? 1 : order.status === 'new' ? 0 : -1;
  const needTable = order.status === 'waiting_arrival' && order.serviceType === 'dinein';
  const tableNo = parseInt(table, 10);

  const arrive = async () => {
    setBusy(true);
    try {
      setOrder(await api.markArrived(session.token, order.id, needTable ? tableNo : null));
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  const earned: string[] = [];
  if (order.pointsEarned > 0) earned.push('+' + order.pointsEarned + ' نقطة');
  if (order.qualifies && !order.freeCup) earned.push('ختم');
  const need = menu?.settings.stampsForFree ?? 3;

  return (
    <div className="screen" style={{ paddingTop: 32, gap: 18 }}>
      <div className="hero" style={{ padding: '26px 22px' }}>
        <Waves />
        <div className="inner" style={{ gap: 8 }}>
          <span className="small soft">رقم الطلب</span>
          <span dir="ltr" className="ltr num" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, textAlign: 'right' }}>{order.number}</span>
          <h1 style={{ fontSize: 20, fontWeight: 600 }} role="status">{h.title}</h1>
          <p style={{ fontSize: 13, color: '#E3E6DA' }}>{h.text}</p>
        </div>
      </div>

      {order.status !== 'cancelled' && order.status !== 'awaiting_payment' ? (
        <div className="steps">
          {['استلمنا الطلب', 'قيد التحضير', 'جاهز'].map((label, i) => (
            <div key={label} className={'step' + (i <= stage ? ' on' : '')}>{label}</div>
          ))}
        </div>
      ) : null}

      {order.status === 'awaiting_payment' ? <Link to={'/pay/' + order.id} className="btn btn-ink btn-block">ادفع الآن · {sar(order.total)}</Link> : null}

      {order.status === 'waiting_arrival' ? (
        <div className="stack">
          {needTable ? (
            <div className="field">
              <label htmlFor="arrive-table">رقم طاولتك</label>
              <input id="arrive-table" className="input num" type="number" min={1} inputMode="numeric" value={table} onChange={(e) => setTable(e.target.value)} />
            </div>
          ) : null}
          <button type="button" className="btn btn-ink btn-block" disabled={busy || (needTable && !(tableNo > 0))} onClick={arrive}>وصلت إلى المقهى</button>
        </div>
      ) : null}

      {error ? <div className="error" role="alert">{error}</div> : null}
      {order.serviceType === 'dinein' && stage >= 0 && order.status !== 'done' ? <WaiterButton table={order.table} /> : null}

      <div className="card stack">
        {order.lines.map((l, i) => {
          const d = describeOrderLine(l);
          return (
            <div className="row" key={i} style={{ alignItems: 'flex-start' }}>
              <span><b>{d.title}</b>{d.meta ? <><br /><span className="small mute">{d.meta}</span></> : null}</span>
              <span className="num">{sar(l.unitPrice * l.qty)}</span>
            </div>
          );
        })}
        {order.freeCup ? (
          <div className="row"><span><b>{order.freeCup.name}{order.freeCup.temp ? ' · ' + tempLabel(order.freeCup.temp) : ''}</b><br /><span className="small mute">كوبك المجاني</span></span><span>مجاناً</span></div>
        ) : null}
        <div className="summary" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          {order.discount > 0 ? <div className="row mute"><span>خصم النقاط</span><span className="num">− {sar(order.discount)}</span></div> : null}
          <div className="row total"><span>الإجمالي</span><span className="num">{sar(order.total)}</span></div>
          <div className="row mute"><span>الدفع</span><span>{order.paymentStatus === 'paid' ? 'مدفوع' : order.payMethod === 'cashier' ? 'عند الكاشير' : 'بانتظار الدفع'}</span></div>
          {earned.length > 0 ? (
            <div className="hint">
              {order.loyaltySettled ? 'أُضيف إلى رصيدك: ' : 'يُضاف إلى رصيدك بعد الدفع: '}{earned.join('، ')}
            </div>
          ) : order.freeCup ? <div className="hint">استخدمت {need} أختام. بدأت بطاقة جديدة.</div> : null}
        </div>
      </div>

      <Link to="/" className="btn btn-line btn-block">العودة إلى الرئيسية</Link>
    </div>
  );
}
