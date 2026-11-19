import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/pricing';
import type { Role, StaffMe } from '../lib/types';

export const ROLE_LABEL: Record<Role, string> = { owner: 'المالك', manager: 'مدير', cashier: 'كاشير', barista: 'باريستا' };

interface StaffCtx { me: StaffMe; can: (...roles: Role[]) => boolean; logout: () => void }
const Ctx = createContext<StaffCtx | null>(null);
export const StaffProvider = Ctx.Provider;
export function useStaff(): StaffCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('StaffProvider مفقود');
  return v;
}

/** استدعاء دالة قاعدة بيانات بصلاحية الموظف */
export const rpc = <T,>(fn: string, args: Record<string, unknown> = {}) => api.staff.rpc<T>(fn, args);

/** يحوّل نتيجة الاستدعاء إلى true عند النجاح (للدوال التي لا تعيد قيمة) */
export const ok = (p: Promise<unknown>): Promise<true> => p.then(() => true as const);

/** يحمّل بيانات ويعيد تحميلها عند التغيّر الحي إن طُلب */
export function useData<T>(load: () => Promise<T>, deps: unknown[], live = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(load);
  ref.current = load;
  const reload = useCallback(async () => {
    try {
      setData(await ref.current());
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => (live ? api.staff.subscribe(() => void reload()) : undefined), [live, reload]);
  return { data, error, loaded, reload, setData };
}

/** ينفذ عملية ويعرض خطأها */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="dlg-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'dlg' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dlg-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return text ? <div className="error" role="alert">{text}</div> : null;
}

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="adm-head">
        <h1>{title}</h1>
        {actions ? <div className="toolbar">{actions}</div> : null}
      </div>
      {children}
    </>
  );
}

/** تاريخ اليوم بتوقيت الرياض بصيغة yyyy-mm-dd */
export function riyadhDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
}

export const time = (iso: string) => new Date(iso).toLocaleTimeString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false });
export const dateTime = (iso: string) => new Date(iso).toLocaleString('ar-SA-u-nu-latn', {
  timeZone: 'Asia/Riyadh', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

export const METHOD_LABEL: Record<string, string> = { cash: 'نقدي', card: 'شبكة', online: 'إلكتروني' };

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((r) => r.map((c) => {
    const v = c == null ? '' : String(c);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\n');
}

export function download(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
