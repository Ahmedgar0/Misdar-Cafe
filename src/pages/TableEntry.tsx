import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loading } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../state';

/** رابط رمز QR على الطاولة: /t/4. مسحه يعني طلباً محلياً على تلك الطاولة */
export function TableEntry() {
  const { n = '' } = useParams();
  const { setService, session, lastOrderId } = useApp();
  const nav = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const table = parseInt(n, 10);
    if (!(table > 0)) { nav('/', { replace: true }); return; }
    setService({ type: 'dinein', table, tableSource: 'qr', later: false });

    // عميل طلب مسبقاً «محلي عند الوصول»: مسح الرمز يسجّل وصوله وطاولته
    if (session && lastOrderId) {
      api.getOrder(session.token, lastOrderId)
        .then((o) => (o.status === 'waiting_arrival' && o.serviceType === 'dinein' ? api.markArrived(session.token, o.id, table) : null))
        .then((o) => nav(o ? '/order/' + o.id : '/', { replace: true }))
        .catch(() => nav('/', { replace: true }));
    } else {
      nav('/', { replace: true });
    }
  }, [n, nav, setService, session, lastOrderId]);

  return <Loading text="جارٍ تحديد طاولتك" />;
}
