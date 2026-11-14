import { Link } from 'react-router-dom';
import { StampRow, Waves } from '../components/ui';
import { sar, stampMessage, timeAgo } from '../lib/format';
import type { LedgerEntry } from '../lib/types';
import { useApp } from '../state';

function entryText(e: LedgerEntry): { title: string; delta: string } {
  const order = e.orderNumber ? 'طلب ' + e.orderNumber : '';
  switch (e.kind) {
    case 'earn':
      return { title: order, delta: [e.points ? '+' + e.points + ' نقطة' : '', e.stamps ? 'ختم' : ''].filter(Boolean).join('، ') };
    case 'redeem':
      return { title: 'استبدال نقاط' + (order ? ' · ' + order : ''), delta: e.points + ' نقطة' };
    case 'free_cup':
      return { title: 'كوب مجاني' + (order ? ' · ' + order : ''), delta: 'بطاقة جديدة' };
    default:
      return { title: 'إلغاء ' + order, delta: 'أُعيد رصيدك' };
  }
}

export function Rewards() {
  const { menu, session, loyalty, history } = useApp();
  if (!menu) return null;
  const s = menu.settings;
  const free = menu.items.filter((i) => i.freeCupEligible).map((i) => i.name + (i.hot && i.cold ? ' ساخنة أو باردة' : ''));

  return (
    <div className="screen" style={{ gap: 18 }}>
      <div className="row">
        <h1 className="title">مكافآتي</h1>
        <Link to="/login" className="btn-text" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{session ? 'حسابي' : 'تسجيل الدخول'}</Link>
      </div>

      <div className="dark-card">
        <Waves stroke="#2B2E27" />
        <div className="inner" style={{ gap: 18 }}>
          <div className="row">
            <span style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>مسدار</span>
            <span className="small soft">بطاقة القهوة</span>
          </div>
          <StampRow stamps={loyalty?.stamps ?? 0} need={s.stampsForFree} tone="ink" />
          <div style={{ fontWeight: 500 }}>
            {session ? stampMessage(loyalty?.stamps ?? 0, s.stampsForFree) : 'سجّل دخولك لتبدأ بجمع الأختام'}
          </div>
          <div className="row" style={{ alignItems: 'flex-end', paddingTop: 14, borderTop: '1px solid #3A3D35' }}>
            <div>
              <div className="small soft">رصيد النقاط</div>
              <div className="num" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>{loyalty?.points ?? 0}</div>
            </div>
            <span className="soft num" style={{ fontSize: 13 }}>تساوي {sar(Math.floor((loyalty?.points ?? 0) / s.pointsPerRiyalDiscount))}</span>
          </div>
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <h2 className="section-title">طريقة عمل المكافآت</h2>
        <div className="card-sage">كل طلب بقيمة {sar(s.stampMin)} أو أكثر يضيف ختماً بعد الدفع.</div>
        <div className="card-sage">بعد {s.stampsForFree} أختام، طلبك التالي فيه كوب مجاني{free.length ? ': ' + free.join('، أو ') : ''}.</div>
        <div className="card-sage">
          {s.pointsPerRiyal === 1 ? 'كل ريال تدفعه يساوي نقطة.' : 'كل ريال تدفعه يساوي ' + s.pointsPerRiyal + ' نقطة.'} كل {s.pointsPerRiyalDiscount} نقطة تخصم ريالاً من طلبك.
        </div>
      </div>

      {session ? (
        <div>
          <h2 className="section-title">آخر الحركات</h2>
          {history.length === 0 ? <p className="mute" style={{ paddingTop: 8 }}>لا حركات بعد. أول طلب مدفوع يظهر هنا.</p> : null}
          {history.map((e) => {
            const t = entryText(e);
            return (
              <div className="line" key={e.id}>
                <span>{t.title}<br /><span className="small mute">{timeAgo(e.createdAt)}</span></span>
                <span className="num" style={{ fontSize: 13, color: 'var(--sage-ink)' }}>{t.delta}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
