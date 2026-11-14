import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loading } from '../components/ui';
import { api } from '../lib/api';
import { sar } from '../lib/format';
import { errorText } from '../lib/pricing';
import type { Order } from '../lib/types';
import { useApp } from '../state';

const PK = import.meta.env.VITE_MOYASAR_PUBLISHABLE_KEY as string | undefined;
const METHODS = ((import.meta.env.VITE_MOYASAR_METHODS as string | undefined) || 'creditcard')
  .split(',').map((m) => m.trim()).filter(Boolean);

/** صفحة الدفع: نموذج ميسر إن ضُبط المفتاح، وإلا زر محاكاة للتجربة */
export function Pay() {
  const { id = '' } = useParams();
  const { session, refreshMe } = useApp();
  const nav = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!session) { nav('/login?next=/pay/' + id, { replace: true }); return; }
    api.getOrder(session.token, id).then((o) => {
      if (o.status !== 'awaiting_payment') nav('/order/' + o.id, { replace: true });
      else setOrder(o);
    }).catch((e) => setError(errorText(e)));
  }, [session, id, nav]);

  useEffect(() => {
    if (!order || !PK || mounted.current) return;
    mounted.current = true;
    void (async () => {
      try {
        await import('moyasar-payment-form/dist/moyasar.css');
        const mod: any = await import('moyasar-payment-form'); // eslint-disable-line @typescript-eslint/no-explicit-any
        const Moyasar = mod?.default?.init ? mod.default : mod?.init ? mod : (window as any).Moyasar; // eslint-disable-line @typescript-eslint/no-explicit-any
        Moyasar.init({
          element: '.mysr-form',
          amount: Math.round(order.total * 100),
          currency: 'SAR',
          description: 'طلب مسدار ' + order.number,
          publishable_api_key: PK,
          callback_url: window.location.origin + '/pay/return?order=' + order.id,
          methods: METHODS,
          supported_networks: ['mada', 'visa', 'mastercard'],
          metadata: { order_id: order.id },
          language: 'ar',
          ...(METHODS.includes('applepay')
            ? { apple_pay: { country: 'SA', label: 'مسدار', validate_merchant_url: 'https://api.moyasar.com/v1/applepay/initiate' } }
            : {}),
        });
      } catch {
        setError('تعذر تحميل نموذج الدفع. حدّث الصفحة وحاول مرة أخرى.');
      }
    })();
  }, [order]);

  const simulate = async () => {
    if (!session || !order) return;
    setBusy(true);
    try {
      await api.confirmPayment(session.token, order.id, 'demo');
      await refreshMe();
      nav('/order/' + order.id, { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (error && !order) return <div className="screen"><div className="error" role="alert">{error}</div></div>;
  if (!order) return <Loading />;

  return (
    <div className="screen">
      <h1 className="title">الدفع</h1>
      <div className="card row">
        <span>طلب <b dir="ltr" className="ltr">{order.number}</b></span>
        <b className="num" style={{ fontSize: 18 }}>{sar(order.total)}</b>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {PK ? (
        <div className="mysr-form" />
      ) : (
        <>
          <p className="notice">
            {api.mode === 'demo'
              ? 'بوابة الدفع غير مربوطة في الوضع التجريبي. اضغط الزر لمحاكاة دفع ناجح.'
              : 'لم يُضبط مفتاح ميسر بعد (VITE_MOYASAR_PUBLISHABLE_KEY).'}
          </p>
          {api.mode === 'demo' ? (
            <button type="button" className="btn btn-ink btn-block" disabled={busy} onClick={simulate}>محاكاة الدفع · {sar(order.total)}</button>
          ) : null}
        </>
      )}
      <Link to={'/order/' + order.id} className="btn btn-plain">متابعة الطلب دون دفع الآن</Link>
    </div>
  );
}

/** ميسر يعيد العميل إلى هنا ومعه رقم العملية. التحقق الفعلي يتم في الخادم */
export function PayReturn() {
  const [params] = useSearchParams();
  const { session, refreshMe } = useApp();
  const nav = useNavigate();
  const [error, setError] = useState('');
  const orderId = params.get('order') || '';
  const paymentId = params.get('id') || '';
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!session || !orderId || !paymentId) { setError('بيانات الدفع ناقصة.'); return; }
    started.current = true;
    api.confirmPayment(session.token, orderId, paymentId)
      .then(async () => { await refreshMe(); nav('/order/' + orderId, { replace: true }); })
      .catch(() => setError(params.get('message') || 'لم يكتمل الدفع. لم يُخصم منك شيء إن رُفضت العملية.'));
  }, [session, orderId, paymentId, params, nav, refreshMe]);

  if (!error) return <Loading text="جارٍ تأكيد الدفع" />;
  return (
    <div className="screen">
      <h1 className="title">لم يكتمل الدفع</h1>
      <div className="error" role="alert">{error}</div>
      {orderId ? <Link to={'/pay/' + orderId} className="btn btn-ink btn-block">أعد المحاولة</Link> : null}
      <Link to="/" className="btn btn-plain">العودة إلى الرئيسية</Link>
    </div>
  );
}
