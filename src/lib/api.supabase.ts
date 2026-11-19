import { createClient } from '@supabase/supabase-js';
import type { Transport } from './api';
import { OrderError } from './pricing';
import type { Order, StaffMe } from './types';

export function createSupabaseTransport(url: string, anonKey: string): Transport {
  const sb = createClient(url, anonKey);

  const me = async (): Promise<StaffMe | null> => {
    const { data, error } = await sb.rpc('staff_me');
    if (error) throw new OrderError(error.message);
    return (data as StaffMe | null) ?? null;
  };

  return {
    mode: 'supabase',

    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new OrderError(error.message);
      return data as T;
    },

    async staffSession() {
      const { data } = await sb.auth.getSession();
      return data.session ? me() : null;
    },
    async staffLogin(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new OrderError('BAD_LOGIN');
      const m = await me();
      if (!m) {
        await sb.auth.signOut();
        throw new OrderError('NOT_STAFF');
      }
      return m;
    },
    async staffLogout() {
      await sb.auth.signOut();
    },

    async fn<T>(name: string, body: object) {
      const { data } = await sb.auth.getSession();
      const res = await fetch('/.netlify/functions/' + name, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (data.session?.access_token ?? '') },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new OrderError(out.error ?? 'SERVER');
      return out as T;
    },

    async confirmPayment(token, orderId, paymentId) {
      const res = await fetch('/.netlify/functions/confirm-payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, orderId, paymentId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new OrderError(body.error ?? 'PAYMENT');
      return body.order as Order;
    },

    subscribe(cb) {
      const channel = sb
        .channel('staff-live-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, cb)
        .subscribe();
      const timer = window.setInterval(cb, 20000);
      return () => {
        window.clearInterval(timer);
        void sb.removeChannel(channel);
      };
    },
  };
}
