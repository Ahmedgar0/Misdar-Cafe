import { useState } from 'react';
import { api } from '../lib/api';
import type { Role } from '../lib/types';
import { Dialog, ErrorBox, Page, ROLE_LABEL, dateTime, ok, rpc, useAction, useData, useStaff } from './shared';

interface Member { userId: string; name: string; email: string; role: Role; active: boolean; createdAt: string }

const ROLES: Role[] = ['owner', 'manager', 'cashier', 'barista'];
const ROLE_HELP: Record<Role, string> = {
  owner: 'كل شيء: الموظفون، بيانات المنشأة والضريبة، والربط مع الهيئة.',
  manager: 'الكاشير والطلبات والفواتير والاسترجاع والتقارير والقائمة والمخزون والإعدادات العامة.',
  cashier: 'البيع المباشر، تحصيل الطلبات، الوردية والصندوق، العملاء.',
  barista: 'لوحة الطلبات ونداءات النادل وتوفّر الأصناف.',
};

export function StaffPage() {
  const { me } = useStaff();
  const list = useData(() => rpc<Member[]>('staff_list'), []);
  const [edit, setEdit] = useState<Member | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <Page title="الموظفون والصلاحيات" actions={<button type="button" className="btn btn-ink" onClick={() => setAdding(true)}>موظف جديد</button>}>
      <ErrorBox text={list.error} />
      <div className="grid">
        {ROLES.map((r) => <div className="stat" key={r}><span className="label">{ROLE_LABEL[r]}</span><span className="small">{ROLE_HELP[r]}</span></div>)}
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>أضيف</th><th /></tr></thead>
          <tbody>
            {(list.data ?? []).map((m) => (
              <tr key={m.userId}>
                <td><b>{m.name || '—'}</b>{m.userId === me.userId ? <span className="small mute"> (أنت)</span> : null}</td>
                <td dir="ltr">{m.email}</td>
                <td>{ROLE_LABEL[m.role]}</td>
                <td>{m.active ? <span className="badge ok">نشط</span> : <span className="badge">موقوف</span>}</td>
                <td>{dateTime(m.createdAt)}</td>
                <td><button type="button" className="pill-btn" onClick={() => setEdit(m)}>تعديل</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit ? <EditMember m={edit} self={edit.userId === me.userId} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void list.reload(); }} /> : null}
      {adding ? <AddMember onClose={() => setAdding(false)} onDone={() => { setAdding(false); void list.reload(); }} /> : null}
    </Page>
  );
}

function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="field">
      <span className="small">الدور</span>
      <div className="seg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {ROLES.map((r) => <button key={r} type="button" className={value === r ? 'on' : ''} onClick={() => onChange(r)}>{ROLE_LABEL[r]}</button>)}
      </div>
      <span className="small mute">{ROLE_HELP[value]}</span>
    </div>
  );
}

function EditMember({ m, self, onClose, onDone }: { m: Member; self: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(m.name);
  const [role, setRole] = useState<Role>(m.role);
  const [active, setActive] = useState(m.active);
  const act = useAction();
  return (
    <Dialog title={m.email} onClose={onClose}>
      <div className="field"><label htmlFor="m-name">الاسم</label><input id="m-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <RolePicker value={role} onChange={setRole} />
      {!self ? (
        <label className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> الحساب نشط (إيقافه يمنع الدخول للوحة فوراً)
        </label>
      ) : null}
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-ink" disabled={act.busy}
        onClick={() => void act.run(() => ok(rpc('staff_save_member', { p: { userId: m.userId, name: name.trim(), role, active } }))).then((r) => { if (r) onDone(); })}>حفظ</button>
    </Dialog>
  );
}

function AddMember({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('cashier');
  const act = useAction();
  const submit = () => void act.run(async () => {
    await api.staff.fn('staff-create', { email: email.trim(), password, name: name.trim(), role });
    return true;
  }).then((ok) => { if (ok) onDone(); });
  return (
    <Dialog title="موظف جديد" onClose={onClose}>
      <div className="field"><label htmlFor="n-name">الاسم</label><input id="n-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label htmlFor="n-email">البريد الإلكتروني (للدخول)</label><input id="n-email" className="input" dir="ltr" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="n-pass">كلمة مرور مبدئية (8 أحرف على الأقل)</label><input id="n-pass" className="input" dir="ltr" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <RolePicker value={role} onChange={setRole} />
      <span className="small mute">سلّم كلمة المرور للموظف شخصياً. يستطيع المالك إيقاف الحساب في أي وقت.</span>
      <ErrorBox text={act.error} />
      <button type="button" className="btn btn-ink" disabled={act.busy || !email.trim() || password.length < 8} onClick={submit}>إنشاء الحساب</button>
    </Dialog>
  );
}
