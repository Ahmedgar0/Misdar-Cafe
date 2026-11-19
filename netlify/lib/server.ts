// أدوات مشتركة لدوال Netlify: عميل Supabase بمفتاح الخادم، والتحقق من الموظف وصلاحيته.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serviceClient(): SupabaseClient<any, any, any> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(500, 'CONFIG');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export type Role = 'owner' | 'manager' | 'cashier' | 'barista';

/** يتحقق من جلسة الموظف المرسلة في ترويسة Authorization ومن دوره */
export async function requireStaff(req: Request, sb: ReturnType<typeof serviceClient>, roles: Role[]): Promise<{ userId: string; role: Role }> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'NOT_STAFF');
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'NOT_STAFF');
  const { data: row } = await sb.from('staff').select('role, active').eq('user_id', data.user.id).maybeSingle();
  if (!row || !row.active) throw new HttpError(403, 'NOT_STAFF');
  if (!roles.includes(row.role)) throw new HttpError(403, 'FORBIDDEN');
  return { userId: data.user.id, role: row.role };
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'METHOD' });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code });
      return json(500, { error: e instanceof Error ? e.message : 'ERROR' });
    }
  };
}
