import { useState } from 'react';
import { PICKUP_LABEL } from '../lib/format';
import type { Pickup } from '../lib/types';
import { useApp } from '../state';
import { Sheet, SheetHead } from './ui';

const PICKUPS: Pickup[] = ['now', '15', '30', 'arrive'];

export function ServiceSheet({ onClose }: { onClose: () => void }) {
  const { service, setService, menu } = useApp();
  const [tableInput, setTableInput] = useState('');
  const isDine = service.type === 'dinein';
  const hasTable = service.table != null;
  const tableNo = parseInt(tableInput, 10);

  return (
    <Sheet label="طريقة الطلب" onClose={onClose}>
      <SheetHead title="طريقة الطلب" onClose={onClose} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <button type="button" className={'chip block' + (isDine ? ' on' : '')} style={{ flexDirection: 'column', gap: 0, minHeight: 76 }}
          aria-pressed={isDine} onClick={() => setService({ type: 'dinein' })}>
          <b style={{ fontSize: 15 }}>محلي</b><span className="small">تقديم على الطاولة</span>
        </button>
        <button type="button" className={'chip block' + (!isDine ? ' on' : '')} style={{ flexDirection: 'column', gap: 0, minHeight: 76 }}
          aria-pressed={!isDine} onClick={() => setService({ type: 'takeaway', table: null, tableSource: null, later: false })}>
          <b style={{ fontSize: 15 }}>سفري</b><span className="small">تغليف للاستلام</span>
        </button>
        <button type="button" className="chip block" style={{ flexDirection: 'column', gap: 0, minHeight: 76 }} disabled={!menu?.settings.deliveryEnabled}>
          <b style={{ fontSize: 15 }}>توصيل</b><span className="small">قريباً</span>
        </button>
      </div>

      {isDine && hasTable ? (
        <>
          <div className="card-sage row">
            <span>
              <b style={{ fontSize: 18 }}>طاولة {service.table}</b><br />
              <span className="small" style={{ color: 'var(--sage-ink)' }}>أدخلتها يدوياً</span>
            </span>
            <button type="button" className="btn btn-line" onClick={() => setService({ table: null, tableSource: null })}>تغيير الطاولة</button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--sage-ink)' }}>نقدّم طلبك على الطاولة في أكواب المقهى.</p>
        </>
      ) : null}

      {isDine && !hasTable ? (
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">أين تجلس؟</span>
          <p className="notice">امسح رمز QR على طاولتك بكاميرا الجوال، فتُحدَّد الطاولة تلقائياً.</p>
          <div className="row">
            <label htmlFor="table-no" style={{ fontSize: 13, flexShrink: 0 }}>أو أدخل رقم الطاولة</label>
            <input id="table-no" className="input num" style={{ maxWidth: 110 }} type="number" min={1} inputMode="numeric"
              value={tableInput} onChange={(e) => setTableInput(e.target.value)} />
            <button type="button" className="btn btn-olive" disabled={!(tableNo > 0)}
              onClick={() => setService({ table: tableNo, tableSource: 'manual', later: false })}>تأكيد</button>
          </div>
          <button type="button" className={'chip block' + (service.later ? ' on' : '')} aria-pressed={service.later}
            onClick={() => setService({ later: !service.later })}>
            لم أصل بعد، ابدؤوا التحضير عند وصولي
          </button>
        </div>
      ) : null}

      {!isDine ? (
        <div className="stack">
          <span className="label">متى تستلم طلبك من منصة الاستلام؟</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {PICKUPS.map((p) => (
              <button key={p} type="button" className={'chip block' + (service.pickup === p ? ' on' : '')}
                aria-pressed={service.pickup === p} onClick={() => setService({ pickup: p })}>
                {PICKUP_LABEL[p]}
              </button>
            ))}
          </div>
          <span className="small" style={{ color: 'var(--sage-ink)' }}>نجهّز طلبك بتغليف سفري.</span>
        </div>
      ) : null}

      <button type="button" className="btn btn-ink" style={{ minHeight: 54 }} onClick={onClose}>تأكيد</button>
    </Sheet>
  );
}
