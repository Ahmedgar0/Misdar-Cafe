// المالك يضيف موظفاً جديداً: ينشئ حساب الدخول ويسجّله بدوره في خطوة واحدة.
import { HttpError, handle, json, requireStaff, serviceClient } from '../lib/server';

export default handle(async (req) => {
  const sb = serviceClient();
  await requireStaff(req, sb, ['owner']);
  const { email, password, name, role } = await req.json().catch(() => ({}));
  const mail = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new HttpError(400, 'EMAIL');
  if (String(password ?? '').length < 8) throw new HttpError(400, 'PASSWORD');
  if (!['owner', 'manager', 'cashier', 'barista'].includes(role)) throw new HttpError(400, 'ROLE');

  const created = await sb.auth.admin.createUser({ email: mail, password, email_confirm: true });
  if (created.error || !created.data.user) throw new HttpError(409, 'EMAIL_TAKEN');
  const { error } = await sb.from('staff').upsert({ user_id: created.data.user.id, email: mail, name: String(name ?? ''), role, active: true });
  if (error) throw new HttpError(500, error.message);
  return json(200, { userId: created.data.user.id });
});
