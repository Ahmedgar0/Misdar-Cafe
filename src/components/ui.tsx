import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { errorText } from '../lib/pricing';
import { serviceSummary, stampMessage } from '../lib/format';
import { useApp } from '../state';

const WAVE =
  'M-20 10C60-16 130 36 200 10S340-16 420 10M-20 40C60 14 130 66 200 40S340 14 420 40M-20 70C60 44 130 96 200 70S340 44 420 70' +
  'M-20 100C60 74 130 126 200 100S340 74 420 100M-20 130C60 104 130 156 200 130S340 104 420 130M-20 160C60 134 130 186 200 160S340 134 420 160' +
  'M-20 190C60 164 130 216 200 190S340 164 420 190M-20 220C60 194 130 246 200 220S340 194 420 220';

export function Waves({ stroke = '#475636', className = 'waves' }: { stroke?: string; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 400 220" preserveAspectRatio="none">
      <path d={WAVE} fill="none" stroke={stroke} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type IconName = 'home' | 'cup' | 'star' | 'bag' | 'plus' | 'close' | 'pin' | 'bell' | 'bean' | 'hot' | 'cold' | 'back'
  | 'chart' | 'receipt' | 'users' | 'box' | 'gear' | 'clock' | 'pos' | 'list' | 'shield' | 'menu' | 'print' | 'grid';
const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-8z" />,
  cup: <path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3" />,
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L3.4 9.3l6-.7L12 3z" />,
  bag: <path d="M5 8h14l-1 11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 8zM9 8V7a3 3 0 0 1 6 0v1" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  pin: <><path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.3" /></>,
  bell: <path d="M6 16v-4a6 6 0 0 1 12 0v4l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0M12 3v3" />,
  bean: <><ellipse cx="12" cy="12" rx="6.5" ry="9" transform="rotate(30 12 12)" /><path d="M8.5 18.5c3-3 1-7 3.5-9.5s3.5-2.5 4-4" /></>,
  hot: <path d="M5 11h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-5zM16 12h1.5a2.5 2.5 0 0 1 0 5H16M8 3c-1 1.5 1 2.5 0 4M12 3c-1 1.5 1 2.5 0 4" />,
  cold: <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h4" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5" /></>,
  box: <path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5v-9zM3 7.5l9 4.5 9-4.5M12 12v9" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pos: <path d="M3 5h18v10H3zM7 19h10M12 15v4M7 9h4" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3zM9 12l2 2 4-4" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  print: <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" />,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
};

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}

export function SheetHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>{title}</h2>
        {sub ? <p className="mute" style={{ fontSize: 13 }}>{sub}</p> : null}
      </div>
      <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
  );
}

/** بطاقة الأختام. tone يحدد ألوانها فوق الزيتي أو الأسود */
export function StampRow({ stamps, need, tone }: { stamps: number; need: number; tone: 'olive' | 'ink' }) {
  const fill = '#EFEBE1';
  const onInk = tone === 'olive' ? '#2F3B25' : '#11120F';
  const offBd = tone === 'olive' ? '#A9B39A' : '#8D9086';
  const offFg = tone === 'olive' ? '#D5D8CC' : '#C9CCC1';
  const ready = stamps >= need;
  return (
    <div className="stamps" role="img" aria-label={stampMessage(stamps, need)}>
      {Array.from({ length: need }, (_, i) => {
        const on = i < stamps;
        return (
          <div key={i} className="stamp" style={{ background: on ? fill : 'transparent', borderColor: on ? fill : offBd, color: on ? onInk : offFg }}>
            <Icon name="bean" size={24} />
          </div>
        );
      })}
      <div className="cup" style={{ background: ready ? fill : 'transparent', borderColor: ready ? fill : offBd, color: ready ? onInk : offFg }}>
        <Icon name="cup" size={20} /> كوب مجاني
      </div>
    </div>
  );
}

export function ServiceBar({ onOpen }: { onOpen: () => void }) {
  const { service } = useApp();
  // مسح رمز الطاولة يعني طلباً محلياً: لا تغيير
  const locked = service.type === 'dinein' && service.table != null && service.tableSource === 'qr';
  return (
    <button type="button" className="service-bar" disabled={locked} onClick={onOpen}>
      <span className="row" style={{ justifyContent: 'flex-start', minWidth: 0 }}>
        <span className="dot"><Icon name="pin" /></span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span className="small mute">طريقة الطلب</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{serviceSummary(service)}</span>
        </span>
      </span>
      <span className="action">{locked ? 'من رمز الطاولة' : 'تغيير'}</span>
    </button>
  );
}

/** نداء النادل: متاح لكل من له طاولة محددة */
export function WaiterButton({ table }: { table: number | null }) {
  const key = 'misdar.waiter.' + table;
  const [called, setCalled] = useState(() => {
    try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
  });
  const [error, setError] = useState('');
  if (table == null) return null;
  const call = async () => {
    try {
      await api.callWaiter(table);
      setCalled(true);
      setError('');
      try { sessionStorage.setItem(key, '1'); } catch { /* نتجاهل */ }
    } catch (e) {
      setError(errorText(e));
    }
  };
  const reset = () => {
    setCalled(false);
    try { sessionStorage.removeItem(key); } catch { /* نتجاهل */ }
  };
  if (called) {
    return (
      <div className="notice row" role="status">
        <span style={{ fontWeight: 600 }}>وصل نداؤك. النادل في طريقه إلى طاولة {table}</span>
        <button type="button" className="btn-text" onClick={reset}>نداء جديد</button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-line" style={{ borderRadius: 18, minHeight: 52 }} onClick={call}>
        <Icon name="bell" size={20} /> نداء النادل
      </button>
      {error ? <div className="error" role="alert">{error}</div> : null}
    </>
  );
}

export function Loading({ text = 'جارٍ التحميل' }: { text?: string }) {
  return <div className="screen"><p className="mute" role="status">{text}</p></div>;
}
