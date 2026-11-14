// يتحقق من عملية الدفع لدى ميسر بالمفتاح السري ثم يعتمد الطلب.
// المتغيرات المطلوبة في Netlify: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MOYASAR_SECRET_KEY
import { createClient } from '@supabase/supabase-js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MOYASAR_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MOYASAR_SECRET_KEY) return json(500, { error: 'CONFIG' });

  let body: { token?: string; orderId?: string; paymentId?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'BODY' });
  }
  const { token, orderId, paymentId } = body;
  if (!token || !orderId || !paymentId) return json(400, { error: 'BODY' });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // الطلب يجب أن يخص صاحب الجلسة
  const owned = await sb.rpc('get_order', { p_token: token, p_id: orderId });
  if (owned.error) return json(404, { error: 'NOT_FOUND' });

  const auth = Buffer.from(MOYASAR_SECRET_KEY + ':').toString('base64');
  const res = await fetch('https://api.moyasar.com/v1/payments/' + encodeURIComponent(paymentId), {
    headers: { authorization: 'Basic ' + auth },
  });
  if (!res.ok) return json(402, { error: 'PAYMENT' });
  const payment = (await res.json()) as {
    status?: string; amount?: number; currency?: string; metadata?: Record<string, string> | null;
  };

  if (payment.status !== 'paid' || payment.currency !== 'SAR') return json(402, { error: 'PAYMENT' });
  // العملية يجب أن تكون أُنشئت لهذا الطلب بالذات
  if (payment.metadata?.order_id !== orderId) return json(402, { error: 'PAYMENT' });

  const done = await sb.rpc('confirm_payment', {
    p_order: orderId, p_payment_id: paymentId, p_amount: payment.amount ?? -1,
  });
  if (done.error) return json(402, { error: done.error.message.includes('AMOUNT') ? 'AMOUNT' : 'PAYMENT' });
  return json(200, { order: done.data });
};
