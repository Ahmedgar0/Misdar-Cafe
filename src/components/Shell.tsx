import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../state';
import { Icon, Loading, Waves } from './ui';

export function Shell() {
  const { menu, menuError, reloadMenu, cart } = useApp();
  const count = cart.reduce((a, l) => a + l.qty, 0);
  return (
    <div className="shop">
      <Waves stroke="#DCD7CA" className="bg-waves" />
      {api.mode === 'demo' ? <div className="demo-strip">وضع تجريبي: البيانات محفوظة في هذا المتصفح فقط</div> : null}
      {menuError ? (
        <div className="screen">
          <div className="error" role="alert">{menuError}</div>
          <button type="button" className="btn btn-olive" onClick={() => void reloadMenu()}>إعادة المحاولة</button>
        </div>
      ) : menu ? <Outlet /> : <Loading />}
      <nav className="nav" aria-label="التنقل الرئيسي">
        <NavLink to="/" end><Icon name="home" />الرئيسية</NavLink>
        <NavLink to="/menu"><Icon name="cup" />القائمة</NavLink>
        <NavLink to="/rewards"><Icon name="star" />المكافآت</NavLink>
        <NavLink to="/cart"><Icon name="bag" />{count > 0 ? `السلة (${count})` : 'السلة'}</NavLink>
      </nav>
    </div>
  );
}
