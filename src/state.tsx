import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './lib/api';
import { errorText } from './lib/pricing';
import type { CartLine, LedgerEntry, Loyalty, Menu, Service, Session } from './lib/types';

const DEFAULT_SERVICE: Service = { type: 'takeaway', table: null, tableSource: null, later: false, pickup: 'now' };

function load<T>(store: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(store: Storage | undefined, key: string, value: unknown): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch { /* التخزين غير متاح */ }
}
const local = typeof window !== 'undefined' ? window.localStorage : undefined;
const sessionStore = typeof window !== 'undefined' ? window.sessionStorage : undefined;

interface AppState {
  menu: Menu | null;
  menuError: string;
  reloadMenu: () => Promise<void>;
  session: Session | null;
  setSession: (s: Session | null) => void;
  loyalty: Loyalty | null;
  history: LedgerEntry[];
  refreshMe: () => Promise<void>;
  service: Service;
  setService: (p: Partial<Service>) => void;
  cart: CartLine[];
  addLines: (lines: Omit<CartLine, 'key'>[]) => void;
  removeLine: (key: string) => void;
  clearCart: () => void;
  lastOrderId: string | null;
  setLastOrderId: (id: string | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuError, setMenuError] = useState('');
  const [session, setSessionState] = useState<Session | null>(() => load(local, 'misdar.session', null));
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [history, setHistory] = useState<LedgerEntry[]>([]);
  const [service, setServiceState] = useState<Service>(() => load(sessionStore, 'misdar.service', DEFAULT_SERVICE));
  const [cart, setCart] = useState<CartLine[]>(() => load(local, 'misdar.cart', []));
  const [lastOrderId, setLastOrderIdState] = useState<string | null>(() => load(local, 'misdar.lastOrder', null));

  const reloadMenu = useCallback(async () => {
    try {
      setMenu(await api.getMenu());
      setMenuError('');
    } catch (e) {
      setMenuError(errorText(e));
    }
  }, []);
  useEffect(() => { void reloadMenu(); }, [reloadMenu]);

  const setSession = useCallback((s: Session | null) => {
    setSessionState(s);
    save(local, 'misdar.session', s);
    if (!s) {
      setLoyalty(null);
      setHistory([]);
    }
  }, []);

  const refreshMe = useCallback(async () => {
    if (!session) return;
    try {
      const me = await api.me(session.token);
      setLoyalty(me.loyalty);
      setHistory(me.history);
    } catch (e) {
      // جلسة منتهية: نخرج المستخدم بهدوء
      if (String(e instanceof Error ? e.message : e).includes('AUTH')) setSession(null);
    }
  }, [session, setSession]);
  useEffect(() => { void refreshMe(); }, [refreshMe]);

  const setService = useCallback((p: Partial<Service>) => {
    setServiceState((prev) => {
      const next = { ...prev, ...p };
      save(sessionStore, 'misdar.service', next);
      return next;
    });
  }, []);

  const updateCart = useCallback((fn: (c: CartLine[]) => CartLine[]) => {
    setCart((prev) => {
      const next = fn(prev);
      save(local, 'misdar.cart', next);
      return next;
    });
  }, []);
  const addLines = useCallback((lines: Omit<CartLine, 'key'>[]) => {
    updateCart((c) => [...c, ...lines.map((l) => ({ ...l, key: Math.random().toString(36).slice(2) + Date.now().toString(36) }))]);
  }, [updateCart]);
  const removeLine = useCallback((key: string) => updateCart((c) => c.filter((l) => l.key !== key)), [updateCart]);
  const clearCart = useCallback(() => updateCart(() => []), [updateCart]);

  const setLastOrderId = useCallback((id: string | null) => {
    setLastOrderIdState(id);
    save(local, 'misdar.lastOrder', id);
  }, []);

  const value = useMemo<AppState>(() => ({
    menu, menuError, reloadMenu, session, setSession, loyalty, history, refreshMe, service, setService,
    cart, addLines, removeLine, clearCart, lastOrderId, setLastOrderId,
  }), [menu, menuError, reloadMenu, session, setSession, loyalty, history, refreshMe, service, setService,
    cart, addLines, removeLine, clearCart, lastOrderId, setLastOrderId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider مفقود');
  return v;
}
