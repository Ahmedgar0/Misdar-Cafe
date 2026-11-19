import { Link } from 'react-router-dom';
import { sar } from '../lib/format';
import type { Shift } from '../lib/types';
import { ErrorBox, Page, rpc, useData, useStaff } from './shared';

interface Dash {
  role: string;
  todaySales: number | null;
  todayInvoices: number;
  todayAvg: number | null;
  yesterdaySales: number | null;
  activeOrders: number;
  waitingArrival: number;
  unpaidCashier: number;
  waiterCalls: number;
  lowStock: { name: string; stock: number; unit: string }[];
  unavailableItems: number;
  shift: Shift | null;
  openShifts: number;
  zatca: { vatEnabled: boolean; status: string; environment: string; pending: number; overdue: number; rejected: number } | null;
}

export function Dashboard() {
  const { me, can } = useStaff();
  const { data: d, error } = useData(() => rpc<Dash>('staff_dashboard'), [], true);
  const greet = new Date().getHours() < 12 ? 'صباح الخير' : 'مساء الخير';

  return (
    <Page title={`${greet}، ${me.name || 'أهلاً'}`} actions={can('owner', 'manager', 'cashier') ? <Link to="/admin/pos" className="btn btn-ink">فتح الكاشير</Link> : null}>
      <ErrorBox text={error} />
      {!d ? null : (
        <>
          {d.waiterCalls > 0 ? (
            <Link to="/admin/orders" className="panel olive" style={{ textDecoration: 'none' }}>
              <b style={{ fontSize: 18 }}>{d.waiterCalls === 1 ? 'نداء نادل واحد بانتظار الخدمة' : `${d.waiterCalls} نداءات نادل بانتظار الخدمة`}</b>
              <span className="soft">افتح الطلبات لتعليمها بعد الخدمة</span>
            </Link>
          ) : null}

          <div className="grid">
            {d.todaySales != null ? (
              <div className="stat olive">
                <span className="label">مبيعات اليوم</span>
                <span className="value">{sar(d.todaySales)}</span>
                <span className="sub">أمس {sar(d.yesterdaySales ?? 0)}</span>
              </div>
            ) : null}
            <div className="stat"><span className="label">فواتير اليوم</span><span className="value">{d.todayInvoices}</span>
              {d.todayAvg != null ? <span className="sub">متوسط الفاتورة {sar(d.todayAvg)}</span> : null}</div>
            <Link to="/admin/orders" className="stat"><span className="label">طلبات قيد التنفيذ</span><span className="value">{d.activeOrders}</span>
              <span className="sub">{d.waitingArrival ? `${d.waitingArrival} بانتظار وصول العميل` : 'لا أحد بانتظار الوصول'}</span></Link>
            {can('owner', 'manager', 'cashier') ? (
              <Link to="/admin/pos" className="stat"><span className="label">بانتظار الدفع عند الكاشير</span><span className="value">{d.unpaidCashier}</span>
                <span className="sub">طلبات من الموقع لم تُحصَّل</span></Link>
            ) : null}
          </div>

          <div className="grid-2">
            {can('owner', 'manager', 'cashier') ? (
              <div className="panel">
                <h2>ورديتي</h2>
                {d.shift ? (
                  <>
                    <div className="row"><span>مفتوحة منذ</span><b>{new Date(d.shift.openedAt).toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })}</b></div>
                    <div className="row"><span>النقد المتوقع في الدرج</span><b className="num">{sar(d.shift.expectedCash)}</b></div>
                    <div className="row"><span>مبيعات الشبكة</span><b className="num">{sar(d.shift.cardSales)}</b></div>
                    <Link to="/admin/shifts" className="btn btn-line">إدارة الوردية</Link>
                  </>
                ) : (
                  <>
                    <p className="mute">لا وردية مفتوحة. افتحها قبل البيع النقدي.</p>
                    <Link to="/admin/shifts" className="btn btn-olive">فتح وردية</Link>
                  </>
                )}
                {can('owner', 'manager') && d.openShifts > 0 ? <span className="small mute">ورديات مفتوحة الآن: {d.openShifts}</span> : null}
              </div>
            ) : null}

            {d.zatca ? <ZatcaCard z={d.zatca} /> : null}

            <div className={'panel' + (d.lowStock.length ? ' warn' : '')}>
              <h2>المخزون</h2>
              {d.lowStock.length === 0 ? <p className="mute">لا مواد تحت حد إعادة الطلب.</p> : (
                <div className="list">
                  {d.lowStock.map((s) => <div className="li" key={s.name}><span>{s.name}</span><b className="num">{s.stock} {s.unit}</b></div>)}
                </div>
              )}
              {d.unavailableItems > 0 ? <span className="small">أصناف معلّمة «نفد»: {d.unavailableItems}</span> : null}
              {can('owner', 'manager') ? <Link to="/admin/inventory" className="btn btn-line">المخزون</Link> : null}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}

function ZatcaCard({ z }: { z: NonNullable<Dash['zatca']> }) {
  if (!z.vatEnabled) {
    return (
      <div className="panel">
        <h2>الفوترة الإلكترونية</h2>
        <p className="mute">المنشأة غير مسجلة في ضريبة القيمة المضافة: الفواتير تصدر دون ضريبة ولا تُرسل للهيئة.</p>
        <Link to="/admin/zatca" className="btn btn-line">الربط مع الهيئة</Link>
      </div>
    );
  }
  const live = z.status === 'ready' && z.environment === 'production';
  const bad = !live || z.overdue > 0 || z.rejected > 0;
  return (
    <div className={'panel' + (bad ? ' bad' : ' sage')}>
      <h2>الفوترة الإلكترونية</h2>
      {!live ? <b>الضريبة مفعّلة والجهاز غير مسجّل في بيئة الإنتاج. الفواتير لا تُرسل للهيئة.</b> : null}
      <div className="row"><span>بانتظار الإبلاغ</span><b className="num">{z.pending}</b></div>
      {z.overdue > 0 ? <div className="row"><span>اقتربت من مهلة 24 ساعة</span><b className="num">{z.overdue}</b></div> : null}
      {z.rejected > 0 ? <div className="row"><span>مرفوضة</span><b className="num">{z.rejected}</b></div> : null}
      <Link to="/admin/zatca" className="btn btn-line">التفاصيل</Link>
    </div>
  );
}
