import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PrintHost } from '../components/Receipt';
import { Icon, Loading } from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/pricing';
import type { Role, StaffMe } from '../lib/types';
import { Customers } from './Customers';
import { Dashboard } from './Dashboard';
import { Inventory } from './Inventory';
import { Invoices } from './Invoices';
import { MenuAdmin } from './MenuAdmin';
import { Orders } from './Orders';
import { Pos } from './Pos';
import { Reports } from './Reports';
import { SettingsPage } from './Settings';
import { Shifts } from './Shifts';
import { StaffPage } from './Staff';
import { Zatca } from './Zatca';
import { ROLE_LABEL, StaffProvider, rpc } from './shared';

type IconName = Parameters<typeof Icon>[0]['name'];
interface Section { path: string; label: string; icon: IconName; roles: Role[]; el: ReactElement }

const ALL: Role[] = ['owner', 'manager', 'cashier', 'barista'];
const SECTIONS: Section[] = [
  { path: '', label: 'الرئيسية', icon: 'grid', roles: ALL, el: <Dashboard /> },
  { path: 'pos', label: 'الكاشير', icon: 'pos', roles: ['owner', 'manager', 'cashier'], el: <Pos /> },
  { path: 'orders', label: 'الطلبات', icon: 'list', roles: ALL, el: <Orders /> },
  { path: 'invoices', label: 'الفواتير', icon: 'receipt', roles: ['owner', 'manager', 'cashier'], el: <Invoices /> },
  { path: 'shifts', label: 'الورديات والصندوق', icon: 'clock', roles: ['owner', 'manager', 'cashier'], el: <Shifts /> },
  { path: 'reports', label: 'التقارير', icon: 'chart', roles: ['owner', 'manager'], el: <Reports /> },
  { path: 'customers', label: 'العملاء', icon: 'users', roles: ['owner', 'manager', 'cashier'], el: <Customers /> },
  { path: 'inventory', label: 'المخزون', icon: 'box', roles: ['owner', 'manager'], el: <Inventory /> },
  { path: 'menu', label: 'القائمة', icon: 'cup', roles: ['owner', 'manager'], el: <MenuAdmin /> },
  { path: 'staff', label: 'الموظفون', icon: 'users', roles: ['owner'], el: <StaffPage /> },
  { path: 'zatca', label: 'الربط مع الهيئة', icon: 'shield', roles: ['owner', 'manager'], el: <Zatca /> },
  { path: 'settings', label: 'الإعدادات', icon: 'gear', roles: ['owner', 'manager'], el: <SettingsPage /> },
];

export function AdminApp() {
  const [me, setMe] = useState<StaffMe | null | undefined>(undefined);
  const [counts, setCounts] = useState<{ active: number; calls: number }>({ active: 0, calls: 0 });
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => { api.staff.session().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!me) return;
    const load = () => rpc<{ activeOrders: number; waiterCalls: number }>('staff_dashboard')
      .then((d) => setCounts({ active: d.activeOrders, calls: d.waiterCalls })).catch(() => {});
    void load();
    return api.staff.subscribe(load);
  }, [me]);

  if (me === undefined) return <Loading />;
  if (!me) return <StaffLogin onDone={setMe} />;

  const can = (...roles: Role[]) => roles.includes(me.role);
  const sections = SECTIONS.filter((s) => s.roles.includes(me.role));
  const logout = () => void api.staff.logout().then(() => setMe(null));

  return (
    <StaffProvider value={{ me, can, logout }}>
      <div className="adm">
        <div className="adm-top no-print">
          <span className="wordmark">مسدار</span>
          <button type="button" className="icon-btn" style={{ color: 'var(--off)', borderColor: '#3a3d35' }} aria-label="القائمة" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" /></button>
        </div>
        <nav className={'adm-side no-print' + (open ? ' open' : '')} aria-label="أقسام لوحة التحكم">
          <div className="brand"><span className="wordmark">مسدار</span><span className="small">لوحة التحكم</span></div>
          {sections.map((s) => (
            <NavLink key={s.path} to={'/admin' + (s.path ? '/' + s.path : '')} end={!s.path}>
              <Icon name={s.icon} size={20} />{s.label}
              {s.path === 'orders' && counts.active > 0 ? <span className="count">{counts.active}</span> : null}
              {s.path === '' && counts.calls > 0 ? <span className="count" title="نداءات النادل">{counts.calls}</span> : null}
            </NavLink>
          ))}
          <div className="who">
            <span><b style={{ color: 'var(--off)' }}>{me.name || me.email}</b><br />{ROLE_LABEL[me.role]}{api.mode === 'demo' ? ' · وضع تجريبي' : ''}</span>
            <Link to="/" style={{ minHeight: 36, padding: 0 }}>موقع العملاء</Link>
            <button type="button" onClick={logout}>تسجيل الخروج</button>
          </div>
        </nav>
        <main className="adm-main">
          <Routes>
            {sections.map((s) => <Route key={s.path} path={s.path} element={s.el} />)}
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
      <PrintHost />
    </StaffProvider>
  );
}

function StaffLogin({ onDone }: { onDone: (m: StaffMe) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<{ email: string; name: string; role: string }[]>([]);
  useEffect(() => { void api.ready().then((t) => setAccounts(t.demoAccounts ?? [])); }, []);

  const go = async (mail: string, pass: string) => {
    setBusy(true);
    setError('');
    try {
      onDone(await api.staff.login(mail, pass));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void go(email, password); };

  return (
    <form className="admin login-box" onSubmit={submit}>
      <span className="wordmark">مسدار</span>
      <h1 className="title">دخول الموظفين</h1>
      {accounts.length ? (
        <div className="panel sage">
          <b>الوضع التجريبي: ادخل بأي دور</b>
          <div className="wrap">
            {accounts.map((a) => (
              <button key={a.email} type="button" className="btn btn-olive" disabled={busy} onClick={() => void go(a.email, '')}>{a.name}</button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="field"><label htmlFor="staff-email">البريد الإلكتروني</label>
        <input id="staff-email" dir="ltr" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="staff-pass">كلمة المرور</label>
        <input id="staff-pass" dir="ltr" className="input" type="password" autoComplete="current-password" required={api.mode !== 'demo'} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      <button type="submit" className="btn btn-ink btn-block" disabled={busy}>دخول</button>
      <Link to="/" className="btn btn-plain">موقع العملاء</Link>
    </form>
  );
}
