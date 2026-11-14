import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { errorText } from '../lib/pricing';
import { useApp } from '../state';

const showTestCode = api.mode === 'demo' || import.meta.env.VITE_SHOW_TEST_OTP === '1';

export function Login() {
  const { session, setSession } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSession(await api.login(phone, code));
      nav(next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  if (session) {
    return (
      <div className="screen">
        <h1 className="title">حسابي</h1>
        <div className="card row">
          <span>رقم الجوال<br /><b dir="ltr" className="ltr num">{session.phone}</b></span>
          <button type="button" className="btn btn-plain" onClick={() => setSession(null)}>تسجيل الخروج</button>
        </div>
      </div>
    );
  }

  return (
    <form className="screen" onSubmit={submit}>
      <h1 className="title">تسجيل الدخول</h1>
      <p className="mute">رقم جوالك هو حسابك. به تُحفظ أختامك ونقاطك وطلباتك.</p>
      <div className="field">
        <label htmlFor="phone">رقم الجوال</label>
        <input id="phone" dir="ltr" className="input ltr num" type="tel" inputMode="tel" autoComplete="tel" placeholder="05XXXXXXXX" required
          value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="code">رمز التحقق</label>
        <input id="code" dir="ltr" className="input ltr num" type="text" inputMode="numeric" autoComplete="one-time-code" required
          value={code} onChange={(e) => setCode(e.target.value)} />
        {showTestCode ? <span className="small mute">مرحلة الاختبار: الرمز 1234. يُستبدل برسالة SMS قبل الافتتاح.</span> : null}
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      <button type="submit" className="btn btn-ink btn-block" disabled={busy}>{busy ? 'جارٍ التحقق' : 'دخول'}</button>
    </form>
  );
}
