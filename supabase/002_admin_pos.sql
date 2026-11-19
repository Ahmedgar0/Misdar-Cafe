-- مسدار: الترحيل الثاني. لوحة التحكم الشاملة، الكاشير، الورديات، الفواتير، الربط مع الهيئة، المخزون، العملاء، التقارير.
-- شغّله مرة واحدة من Supabase › SQL Editor بعد schema.sql. آمن لإعادة التشغيل.
-- كل العمليات تمر بدوال تتحقق من دور المستخدم: owner مالك، manager مدير، cashier كاشير، barista باريستا.

-- ═════════════ الإعدادات وبيانات المنشأة ═════════════

alter table settings add column if not exists store_name text not null default 'مسدار';
alter table settings add column if not exists legal_name text not null default '';
alter table settings add column if not exists cr_number text not null default '';
alter table settings add column if not exists vat_number text not null default '';
alter table settings add column if not exists vat_enabled boolean not null default false;
alter table settings add column if not exists vat_rate numeric not null default 15;
alter table settings add column if not exists address jsonb not null
  default '{"street":"","building":"","district":"","city":"الرياض","postal":"","additional":""}';
alter table settings add column if not exists phone text not null default '';
alter table settings add column if not exists receipt_footer text not null default 'شكراً لزيارتكم';
alter table settings add column if not exists invoice_prefix text not null default 'INV-';

-- ═════════════ الموظفون والأدوار ═════════════

alter table staff add column if not exists name text not null default '';
alter table staff add column if not exists email text not null default '';
alter table staff add column if not exists role text not null default 'owner';
alter table staff add column if not exists active boolean not null default true;
alter table staff add column if not exists created_at timestamptz not null default now();
do $$ begin
  alter table staff add constraint staff_role_check check (role in ('owner','manager','cashier','barista'));
exception when duplicate_object then null; end $$;
update staff s set email = u.email from auth.users u where u.id = s.user_id and s.email = '';

create or replace function staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from staff where user_id = auth.uid() and active;
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select staff_role() is not null;
$$;

create or replace function require_role(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r text := staff_role();
begin
  if r is null then raise exception 'NOT_STAFF'; end if;
  if not (r = any (p_roles)) then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end $$;

-- تعديل القائمة للمالك والمدير فقط
drop policy if exists menu_write on categories;
create policy menu_write on categories for all to authenticated
  using (staff_role() in ('owner','manager')) with check (staff_role() in ('owner','manager'));
drop policy if exists menu_write on option_groups;
create policy menu_write on option_groups for all to authenticated
  using (staff_role() in ('owner','manager')) with check (staff_role() in ('owner','manager'));
drop policy if exists menu_write on items;
create policy menu_write on items for all to authenticated
  using (staff_role() in ('owner','manager')) with check (staff_role() in ('owner','manager'));
drop policy if exists menu_write on settings;
create policy menu_write on settings for all to authenticated
  using (staff_role() = 'owner') with check (staff_role() = 'owner');
drop policy if exists staff_only on private_settings;
create policy staff_only on private_settings for all to authenticated
  using (staff_role() = 'owner') with check (staff_role() = 'owner');

-- ═════════════ الطلبات والمدفوعات والورديات ═════════════

alter table orders alter column customer_id drop not null;
alter table orders add column if not exists channel text not null default 'online';
alter table orders add column if not exists created_by uuid;
alter table orders add column if not exists manual_discount numeric not null default 0;
alter table orders add column if not exists discount_reason text not null default '';
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in
  ('awaiting_payment','waiting_arrival','new','preparing','ready','done','cancelled','refunded'));
alter table loyalty_ledger drop constraint if exists loyalty_ledger_kind_check;
alter table loyalty_ledger add constraint loyalty_ledger_kind_check check (kind in
  ('earn','redeem','free_cup','refund','adjust','reverse'));
alter table loyalty_ledger add column if not exists note text not null default '';

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  opened_at timestamptz not null default now(),
  opening_cash numeric not null default 0 check (opening_cash >= 0),
  closed_at timestamptz,
  counted_cash numeric,
  expected_cash numeric,
  note text not null default ''
);
create unique index if not exists shifts_one_open_idx on shifts (staff_id) where closed_at is null;

create table if not exists payments (
  id bigserial primary key,
  order_id uuid not null references orders (id),
  shift_id uuid references shifts (id),
  method text not null check (method in ('cash','card','online')),
  kind text not null default 'sale' check (kind in ('sale','refund')),
  amount numeric not null check (amount >= 0),
  reference text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists payments_order_idx on payments (order_id);
create index if not exists payments_shift_idx on payments (shift_id);

create table if not exists cash_moves (
  id bigserial primary key,
  shift_id uuid not null references shifts (id),
  kind text not null check (kind in ('in','out')),
  amount numeric not null check (amount > 0),
  reason text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ═════════════ الفواتير ═════════════

create sequence if not exists invoice_seq start 1;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),   -- يُستخدم أيضاً UUID الفاتورة لدى الهيئة ورابط عرضها العام
  number text not null unique,
  seq bigint not null unique,
  kind text not null check (kind in ('invoice','credit_note')),
  order_id uuid not null references orders (id),
  ref_invoice_id uuid references invoices (id),
  ref_number text,
  reason text not null default '',
  issued_at timestamptz not null default now(),
  buyer_phone text,
  vat_enabled boolean not null,
  vat_rate numeric not null,
  seller jsonb not null,
  lines jsonb not null,
  discount_incl numeric not null default 0,
  discount_ex numeric not null default 0,
  total_ex numeric not null,
  vat_amount numeric not null,
  rounding numeric not null default 0,
  total numeric not null,
  payments jsonb not null default '[]',
  created_by uuid,
  zatca_status text not null default 'not_applicable'
    check (zatca_status in ('not_applicable','pending','signed','reported','warning','rejected')),
  icv bigint,
  pih text,
  invoice_hash text,
  qr text,
  xml text,
  signed_at timestamptz,
  reported_at timestamptz,
  report_attempts int not null default 0,
  zatca_response jsonb
);
create index if not exists invoices_issued_idx on invoices (issued_at desc);
create index if not exists invoices_order_idx on invoices (order_id);
create index if not exists invoices_zatca_idx on invoices (zatca_status, seq);
create unique index if not exists invoices_one_per_order_idx on invoices (order_id) where kind = 'invoice';
create unique index if not exists invoices_icv_idx on invoices (icv) where icv is not null;

-- حالة الربط مع الهيئة. تحوي المفتاح الخاص: لا يصلها إلا مفتاح الخادم (service_role).
create table if not exists zatca_state (
  id int primary key default 1 check (id = 1),
  environment text not null default 'sandbox' check (environment in ('sandbox','simulation','production')),
  status text not null default 'none' check (status in ('none','compliance','ready')),
  egs_serial text not null default gen_random_uuid()::text,
  private_key text,
  csr text,
  compliance_cert text,
  compliance_secret text,
  compliance_request_id text,
  production_cert text,
  production_secret text,
  last_icv bigint not null default 0,
  -- PIH الأولي حسب مواصفات الهيئة: تجزئة SHA-256 للرقم 0
  last_hash text not null default 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  lock_holder uuid,
  lock_until timestamptz,
  onboarded_at timestamptz,
  compliance_results jsonb,
  last_error text
);
insert into zatca_state (id) values (1) on conflict do nothing;

-- ═════════════ المخزون ═════════════

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'غرام',
  stock numeric not null default 0,
  reorder_level numeric not null default 0,
  cost numeric not null default 0,
  active boolean not null default true
);

create table if not exists recipes (
  id bigserial primary key,
  item_id uuid not null references items (id) on delete cascade,
  size_index int,                -- null = لكل الأحجام
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  qty numeric not null check (qty > 0)
);
create index if not exists recipes_item_idx on recipes (item_id);

create table if not exists stock_moves (
  id bigserial primary key,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  kind text not null check (kind in ('purchase','adjust','sale','waste','refund')),
  qty numeric not null,          -- موجب = إضافة، سالب = خصم
  order_id uuid references orders (id) on delete set null,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists stock_moves_ing_idx on stock_moves (ingredient_id, created_at desc);

-- ═════════════ الصلاحيات على الجداول الجديدة ═════════════

alter table shifts enable row level security;
alter table payments enable row level security;
alter table cash_moves enable row level security;
alter table invoices enable row level security;
alter table zatca_state enable row level security;
alter table ingredients enable row level security;
alter table recipes enable row level security;
alter table stock_moves enable row level security;

drop policy if exists staff_read on payments;
create policy staff_read on payments for select to authenticated using (is_staff());
drop policy if exists staff_read on invoices;
create policy staff_read on invoices for select to authenticated using (staff_role() in ('owner','manager','cashier'));
-- zatca_state بلا أي سياسة: لا يقرؤها إلا الخادم

revoke all on zatca_state from anon, authenticated;
grant select on payments, invoices to authenticated;
grant all on shifts, payments, cash_moves, invoices, zatca_state, ingredients, recipes, stock_moves to service_role;
grant usage, select on all sequences in schema public to service_role;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table invoices; exception when duplicate_object then null; end;
  end if;
end $$;

-- ═════════════ دوال مساعدة ═════════════

create or replace function normalize_phone(p text) returns text
language plpgsql immutable as $$
declare v text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if v like '966%' then v := substr(v, 4); end if;
  if v like '0%' then v := substr(v, 2); end if;
  if v !~ '^5[0-9]{8}$' then raise exception 'BAD_PHONE'; end if;
  return '+966' || v;
end $$;

create or replace function login_with_phone(p_phone text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_phone text := normalize_phone(p_phone); v_id uuid; v_token uuid;
begin
  if p_code is distinct from (select test_otp from private_settings where id = 1) then
    raise exception 'BAD_CODE';
  end if;
  insert into customers (phone) values (v_phone)
    on conflict (phone) do update set phone = excluded.phone returning id into v_id;
  insert into sessions (customer_id) values (v_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'phone', v_phone);
end $$;

create or replace function current_shift_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from shifts where staff_id = auth.uid() and closed_at is null;
$$;

create or replace function staff_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(name, ''), email) from staff where user_id = p_id;
$$;

create or replace function order_json(o orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'status', o.status, 'paymentStatus', o.payment_status,
    'payMethod', o.pay_method, 'serviceType', o.service_type, 'table', o.table_no,
    'later', o.arrive_later, 'pickup', o.pickup, 'lines', o.lines, 'freeCup', o.free_cup,
    'subtotal', o.subtotal, 'discount', o.discount, 'manualDiscount', o.manual_discount,
    'discountReason', o.discount_reason, 'total', o.total,
    'pointsUsed', o.points_used, 'pointsEarned', o.points_earned, 'qualifies', o.qualifies,
    'loyaltySettled', o.loyalty_settled, 'channel', o.channel,
    'customerPhone', (select phone from customers c where c.id = o.customer_id),
    'createdBy', staff_name(o.created_by),
    'invoiceId', (select i.id from invoices i where i.order_id = o.id and i.kind = 'invoice'),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('method', p.method, 'kind', p.kind, 'amount', p.amount) order by p.id)
                          from payments p where p.order_id = o.id), '[]'::jsonb),
    'createdAt', o.created_at
  );
$$;

create or replace function record_payment(p_order uuid, p_method text, p_amount numeric, p_kind text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then return; end if;
  insert into payments (order_id, shift_id, method, kind, amount, reference, created_by)
  values (p_order, case when p_method = 'online' then null else current_shift_id() end,
          p_method, p_kind, p_amount, p_ref, auth.uid());
end $$;

-- يخصم مكونات الوصفات من المخزون (p_sign = -1 للبيع، +1 للاسترجاع)
create or replace function apply_stock(p_order uuid, p_sign int, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; l jsonb; r record; v_item uuid; v_size int; v_qty int;
begin
  select * into o from orders where id = p_order;
  for l in select * from jsonb_array_elements(o.lines) loop
    v_item := (l->>'itemId')::uuid; v_size := (l->>'sizeIndex')::int; v_qty := (l->>'qty')::int;
    for r in
      select rc.ingredient_id, rc.qty from recipes rc
      where rc.item_id = v_item and (rc.size_index = v_size or
        (rc.size_index is null and not exists (select 1 from recipes x where x.item_id = v_item and x.size_index = v_size)))
    loop
      update ingredients set stock = stock + p_sign * r.qty * v_qty where id = r.ingredient_id;
      insert into stock_moves (ingredient_id, kind, qty, order_id, created_by)
      values (r.ingredient_id, p_kind, p_sign * r.qty * v_qty, o.id, auth.uid());
    end loop;
  end loop;
end $$;

create or replace function settle_loyalty(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; c customers; s settings; v_stamp int := 0;
begin
  select * into o from orders where id = p_order for update;
  if o.loyalty_settled then return; end if;
  if o.customer_id is null then
    update orders set loyalty_settled = true where id = o.id;
    return;
  end if;
  select * into s from settings where id = 1;
  select * into c from customers where id = o.customer_id for update;
  if o.qualifies and o.free_cup is null and c.stamps < s.stamps_for_free then v_stamp := 1; end if;
  update customers set points = points + o.points_earned, stamps = stamps + v_stamp where id = c.id;
  update orders set loyalty_settled = true where id = o.id;
  if o.points_earned > 0 or v_stamp > 0 then
    insert into loyalty_ledger (customer_id, order_id, kind, points, stamps)
    values (c.id, o.id, 'earn', o.points_earned, v_stamp);
  end if;
end $$;

-- يبني الفاتورة من الطلب. الأسعار في القائمة شاملة الضريبة، فتُستخرج الضريبة منها عند تفعيلها.
create or replace function issue_invoice(p_order uuid, p_kind text default 'invoice', p_ref uuid default null, p_reason text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o orders; s settings; v_id uuid; v_seq bigint; v_rate numeric; v_vat boolean;
  l jsonb; v_lines jsonb := '[]'::jsonb; v_name text; v_qty int; v_unit numeric; v_incl numeric; v_ex numeric; v_lvat numeric;
  v_sum_ex numeric := 0; v_disc numeric; v_disc_ex numeric; v_total_ex numeric; v_vat_amt numeric; v_ref invoices;
begin
  if p_kind = 'invoice' then
    select id into v_id from invoices where order_id = p_order and kind = 'invoice';
    if v_id is not null then return v_id; end if;
  end if;
  select * into o from orders where id = p_order;
  select * into s from settings where id = 1;

  if p_kind = 'credit_note' then
    -- إشعار الدائن ينسخ بنود الفاتورة الأصلية ومبالغها
    select * into v_ref from invoices where id = p_ref;
    v_seq := nextval('invoice_seq');
    insert into invoices (number, seq, kind, order_id, ref_invoice_id, ref_number, reason, buyer_phone, vat_enabled, vat_rate,
      seller, lines, discount_incl, discount_ex, total_ex, vat_amount, rounding, total, payments, created_by, zatca_status)
    values (s.invoice_prefix || 'CN-' || lpad(v_seq::text, 6, '0'), v_seq, 'credit_note', o.id, v_ref.id, v_ref.number, p_reason,
      v_ref.buyer_phone, v_ref.vat_enabled, v_ref.vat_rate, v_ref.seller, v_ref.lines, v_ref.discount_incl, v_ref.discount_ex,
      v_ref.total_ex, v_ref.vat_amount, v_ref.rounding, v_ref.total,
      coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amount)) from payments
                where order_id = o.id and kind = 'refund'), '[]'::jsonb),
      auth.uid(), case when v_ref.vat_enabled then 'pending' else 'not_applicable' end)
    returning id into v_id;
    return v_id;
  end if;

  v_vat := s.vat_enabled;
  v_rate := case when v_vat then s.vat_rate else 0 end;
  for l in select * from jsonb_array_elements(o.lines) loop
    v_qty := (l->>'qty')::int;
    v_unit := (l->>'unitPrice')::numeric;
    v_name := (l->>'name') || case when coalesce(l->>'sizeLabel', '') <> '' then ' · ' || (l->>'sizeLabel') else '' end
      || case l->>'temp' when 'hot' then ' · ساخن' when 'cold' then ' · بارد' else '' end;
    v_incl := v_unit * v_qty;
    v_ex := case when v_vat then round(v_incl / (1 + v_rate / 100), 2) else v_incl end;
    v_lvat := case when v_vat then round(v_ex * v_rate / 100, 2) else 0 end;
    v_sum_ex := v_sum_ex + v_ex;
    v_lines := v_lines || jsonb_build_object('name', v_name, 'qty', v_qty, 'unitIncl', v_unit, 'incl', v_incl, 'ex', v_ex, 'vat', v_lvat);
  end loop;
  if o.free_cup is not null then
    v_lines := v_lines || jsonb_build_object('name', (o.free_cup->>'name')
      || case o.free_cup->>'temp' when 'hot' then ' · ساخن' when 'cold' then ' · بارد' else '' end || ' (كوب مجاني)',
      'qty', 1, 'unitIncl', 0, 'incl', 0, 'ex', 0, 'vat', 0);
  end if;
  v_disc := o.discount + o.manual_discount;
  v_disc_ex := case when v_vat then round(v_disc / (1 + v_rate / 100), 2) else v_disc end;
  v_total_ex := v_sum_ex - v_disc_ex;
  v_vat_amt := case when v_vat then round(v_total_ex * v_rate / 100, 2) else 0 end;

  v_seq := nextval('invoice_seq');
  insert into invoices (number, seq, kind, order_id, buyer_phone, vat_enabled, vat_rate, seller, lines,
    discount_incl, discount_ex, total_ex, vat_amount, rounding, total, payments, created_by, zatca_status)
  values (s.invoice_prefix || lpad(v_seq::text, 6, '0'), v_seq, 'invoice', o.id,
    (select phone from customers where id = o.customer_id), v_vat, v_rate,
    jsonb_build_object('name', coalesce(nullif(s.legal_name, ''), s.store_name), 'storeName', s.store_name,
      'vatNumber', s.vat_number, 'crNumber', s.cr_number, 'address', s.address, 'phone', s.phone, 'footer', s.receipt_footer),
    v_lines, v_disc, v_disc_ex, v_total_ex, v_vat_amt, o.total - (v_total_ex + v_vat_amt), o.total,
    coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amount)) from payments
              where order_id = o.id and kind = 'sale'), '[]'::jsonb),
    auth.uid(), case when v_vat then 'pending' else 'not_applicable' end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function pay_order(p_order uuid, p_payment_id text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; v_status text;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.payment_status = 'paid' then return; end if;
  v_status := o.status;
  if o.status = 'awaiting_payment' then
    v_status := case
      when o.table_no is null and (o.service_type = 'dinein' or o.pickup = 'arrive') then 'waiting_arrival'
      else 'new' end;
  end if;
  update orders set payment_status = 'paid', payment_id = coalesce(p_payment_id, payment_id),
    status = v_status, updated_at = now() where id = o.id;
  if p_payment_id is not null then perform record_payment(o.id, 'online', o.total, 'sale', p_payment_id); end if;
  perform settle_loyalty(o.id);
  perform apply_stock(o.id, -1, 'sale');
  perform issue_invoice(o.id);
end $$;

-- ═════════════ إنشاء الطلب (مشترك بين الموقع والكاشير) ═════════════

create or replace function create_order(p_customer uuid, p_input jsonb, p_channel text) returns orders
language plpgsql security definer set search_path = public as $$
declare
  v_cust customers; v_set settings; v_order orders;
  v_type text; v_table int; v_later boolean; v_pickup text; v_pay text; v_use_points boolean;
  v_line jsonb; v_item items; v_size jsonb; v_size_index int; v_temp text; v_unit numeric; v_qty int;
  v_choice jsonb; v_group option_groups; v_idx int; v_labels text[]; v_idxs int[]; v_choices jsonb;
  v_lines jsonb := '[]'::jsonb; v_subtotal numeric := 0;
  v_free jsonb; v_used_free boolean := false;
  v_discount numeric := 0; v_manual numeric := 0; v_reason text := ''; v_total numeric;
  v_points_used int; v_earn int; v_qual boolean; v_needs boolean; v_status text;
begin
  if p_customer is not null then
    select * into v_cust from customers where id = p_customer for update;
  end if;
  select * into v_set from settings where id = 1;

  v_type := p_input->'service'->>'type';
  if v_type is null or v_type not in ('dinein', 'takeaway') then raise exception 'SERVICE'; end if;
  v_table := nullif(p_input->'service'->>'table', '')::int;
  v_later := coalesce((p_input->'service'->>'later')::boolean, false);
  v_pickup := coalesce(p_input->'service'->>'pickup', 'now');
  if v_pickup not in ('now', '15', '30', 'arrive') then v_pickup := 'now'; end if;
  if v_type = 'takeaway' then v_table := null; end if;
  if p_channel = 'online' and v_type = 'dinein' and v_table is null and not v_later then raise exception 'TABLE_REQUIRED'; end if;
  v_pay := coalesce(p_input->>'payMethod', 'cashier');
  if v_pay not in ('online', 'cashier') then raise exception 'PAY'; end if;
  v_use_points := coalesce((p_input->>'usePoints')::boolean, false) and v_cust.id is not null;

  for v_line in select * from jsonb_array_elements(coalesce(p_input->'lines', '[]'::jsonb)) loop
    select * into v_item from items where id = (v_line->>'itemId')::uuid;
    if not found or not v_item.available then raise exception 'ITEM_UNAVAILABLE'; end if;
    v_size_index := (v_line->>'sizeIndex')::int;
    v_size := v_item.sizes -> v_size_index;
    if v_size is null or (v_size->>'price') is null then raise exception 'SIZE'; end if;
    if v_item.hot and v_item.cold then
      v_temp := v_line->>'temp';
      if v_temp is null or v_temp not in ('hot', 'cold') then raise exception 'TEMP'; end if;
    else
      v_temp := null;
    end if;
    v_unit := (v_size->>'price')::numeric;
    v_choices := '[]'::jsonb;
    for v_choice in select * from jsonb_array_elements(coalesce(v_line->'choices', '[]'::jsonb)) loop
      select * into v_group from option_groups where id = (v_choice->>'groupId')::uuid;
      continue when not found;
      continue when not (v_group.id = any (v_item.group_ids));
      continue when v_group.cold_only and v_temp is distinct from 'cold';
      v_labels := '{}'; v_idxs := '{}';
      for v_idx in select value::int from jsonb_array_elements_text(coalesce(v_choice->'optionIndexes', '[]'::jsonb)) loop
        if (v_group.options -> v_idx) is null then raise exception 'OPTION'; end if;
        v_unit := v_unit + coalesce(nullif(v_group.options -> v_idx ->> 'price', '')::numeric, 0);
        v_labels := v_labels || (v_group.options -> v_idx ->> 'label');
        v_idxs := v_idxs || v_idx;
        exit when not v_group.multi;
      end loop;
      v_choices := v_choices || jsonb_build_object('groupId', v_group.id, 'groupName', v_group.name,
        'labels', to_jsonb(v_labels), 'optionIndexes', to_jsonb(v_idxs));
    end loop;
    v_qty := greatest(1, least(50, coalesce((v_line->>'qty')::int, 1)));
    v_subtotal := v_subtotal + v_unit * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'itemId', v_item.id, 'sizeIndex', v_size_index, 'name', v_item.name,
      'sizeLabel', case when jsonb_array_length(v_item.sizes) > 1 then v_size->>'label' else '' end,
      'temp', v_temp, 'choices', v_choices,
      'note', case when v_item.note_title <> '' or p_channel = 'pos' then left(coalesce(v_line->>'note', ''), 160) else '' end,
      'qty', v_qty, 'unitPrice', v_unit);
  end loop;

  v_free := p_input->'freeCup';
  if v_free is not null and jsonb_typeof(v_free) = 'object' then
    if v_cust.id is null or v_cust.stamps < v_set.stamps_for_free then raise exception 'FREE_NOT_READY'; end if;
    select * into v_item from items where id = (v_free->>'itemId')::uuid;
    if not found or not v_item.free_cup_eligible or not v_item.available then raise exception 'FREE_ITEM'; end if;
    v_free := jsonb_build_object('name', v_item.name,
      'temp', case when v_item.hot and v_item.cold then coalesce(v_free->>'temp', 'hot') end);
    v_used_free := true;
  else
    v_free := null;
  end if;
  if jsonb_array_length(v_lines) = 0 and not v_used_free then raise exception 'EMPTY'; end if;

  if v_use_points then
    v_discount := least(floor(v_cust.points / v_set.points_per_riyal_discount), floor(v_subtotal));
  end if;
  if p_channel = 'pos' and coalesce((p_input->'manualDiscount'->>'amount')::numeric, 0) > 0 then
    if staff_role() not in ('owner', 'manager') then raise exception 'FORBIDDEN'; end if;
    v_manual := least(round((p_input->'manualDiscount'->>'amount')::numeric, 2), v_subtotal - v_discount);
    v_reason := left(coalesce(p_input->'manualDiscount'->>'reason', ''), 120);
  end if;
  v_total := v_subtotal - v_discount - v_manual;
  v_points_used := (v_discount * v_set.points_per_riyal_discount)::int;
  v_earn := case when v_cust.id is null then 0 else floor(v_total * v_set.points_per_riyal)::int end;
  v_qual := v_cust.id is not null and v_total >= v_set.stamp_min;
  v_needs := v_table is null and (v_type = 'dinein' or v_pickup = 'arrive' or v_pay = 'cashier');
  v_status := case
    when p_channel = 'pos' then 'new'
    when v_pay = 'online' and v_total > 0 then 'awaiting_payment'
    when v_needs then 'waiting_arrival'
    else 'new' end;

  if v_cust.id is not null then
    update customers set points = points - v_points_used,
      stamps = case when v_used_free then 0 else stamps end where id = v_cust.id;
  end if;

  insert into orders (number, customer_id, status, pay_method, service_type, table_no, arrive_later, pickup,
    lines, free_cup, subtotal, discount, manual_discount, discount_reason, total, points_used, points_earned, qualifies,
    channel, created_by)
  values ('M-' || nextval('order_number_seq'), v_cust.id, v_status, v_pay, v_type, v_table, v_later, v_pickup,
    v_lines, v_free, v_subtotal, v_discount, v_manual, v_reason, v_total, v_points_used, v_earn, v_qual,
    p_channel, case when p_channel = 'pos' then auth.uid() end)
  returning * into v_order;

  if v_points_used > 0 then
    insert into loyalty_ledger (customer_id, order_id, kind, points) values (v_cust.id, v_order.id, 'redeem', -v_points_used);
  end if;
  if v_used_free then
    insert into loyalty_ledger (customer_id, order_id, kind, stamps) values (v_cust.id, v_order.id, 'free_cup', -v_set.stamps_for_free);
  end if;
  return v_order;
end $$;

create or replace function place_order(p_token uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := session_customer(p_token); v_order orders;
begin
  v_order := create_order(v_id, p_input, 'online');
  if v_order.total = 0 then
    perform pay_order(v_order.id, null);
    select * into v_order from orders where id = v_order.id;
  end if;
  return order_json(v_order);
end $$;

-- ═════════════ الكاشير ═════════════

-- البيع المباشر: الدفع نقداً أو بالشبكة أو بهما معاً
create or replace function staff_pos_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner','manager','cashier']);
  v_shift uuid := current_shift_id(); v_cust uuid; v_order orders;
  v_card numeric := 0; v_cash numeric; v_tendered numeric; v_change numeric := 0; v_pay jsonb;
begin
  if v_shift is null then raise exception 'NO_SHIFT'; end if;
  if coalesce(p->>'customerPhone', '') <> '' then
    insert into customers (phone) values (normalize_phone(p->>'customerPhone'))
      on conflict (phone) do update set phone = excluded.phone returning id into v_cust;
  end if;
  v_order := create_order(v_cust, jsonb_set(p, '{payMethod}', '"cashier"'), 'pos');

  for v_pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    if v_pay->>'method' = 'card' then v_card := v_card + coalesce((v_pay->>'amount')::numeric, 0); end if;
  end loop;
  v_card := round(least(greatest(v_card, 0), v_order.total), 2);
  v_cash := v_order.total - v_card;
  v_tendered := coalesce((p->>'tendered')::numeric, v_cash);
  if v_cash > 0 then
    if v_tendered < v_cash then raise exception 'TENDERED'; end if;
    v_change := v_tendered - v_cash;
  end if;
  perform record_payment(v_order.id, 'card', v_card, 'sale', null);
  perform record_payment(v_order.id, 'cash', v_cash, 'sale', null);
  perform pay_order(v_order.id, null);
  select * into v_order from orders where id = v_order.id;
  return jsonb_build_object('order', order_json(v_order), 'change', v_change,
    'invoiceId', (select id from invoices where order_id = v_order.id and kind = 'invoice'));
end $$;

-- تسجيل دفع طلب «عند الكاشير» القادم من الموقع
drop function if exists staff_mark_paid(uuid);
create or replace function staff_mark_paid(p_id uuid, p_method text default 'cash') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner','manager','cashier']); o orders;
begin
  if p_method not in ('cash', 'card') then raise exception 'PAY'; end if;
  select * into o from orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' then raise exception 'CANCELLED'; end if;
  if o.payment_status = 'paid' then return order_json(o); end if;
  if p_method = 'cash' and current_shift_id() is null then raise exception 'NO_SHIFT'; end if;
  perform record_payment(o.id, p_method, o.total, 'sale', null);
  perform pay_order(o.id, null);
  select * into o from orders where id = p_id;
  return order_json(o);
end $$;

create or replace function staff_set_order_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; s settings; v_role text := staff_role();
begin
  if v_role is null then raise exception 'NOT_STAFF'; end if;
  if p_status not in ('preparing', 'ready', 'done', 'cancelled', 'new') then raise exception 'STATUS'; end if;
  select * into o from orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status in ('cancelled', 'refunded') then raise exception 'CLOSED'; end if;
  if p_status = 'done' and o.payment_status <> 'paid' then raise exception 'UNPAID'; end if;
  if p_status = 'cancelled' then
    if v_role = 'barista' then raise exception 'FORBIDDEN'; end if;
    if o.payment_status = 'paid' then raise exception 'PAID_REFUND'; end if;
    if not o.loyalty_settled and o.customer_id is not null then
      select * into s from settings where id = 1;
      update customers set points = points + o.points_used,
        stamps = case when o.free_cup is not null then s.stamps_for_free else stamps end
        where id = o.customer_id;
      if o.points_used > 0 or o.free_cup is not null then
        insert into loyalty_ledger (customer_id, order_id, kind, points, stamps)
        values (o.customer_id, o.id, 'refund', o.points_used, case when o.free_cup is not null then s.stamps_for_free else 0 end);
      end if;
    end if;
  end if;
  update orders set status = p_status, updated_at = now() where id = o.id;
end $$;

-- استرجاع طلب مدفوع: إشعار دائن، رد المبلغ، عكس المكافآت، إرجاع المخزون
create or replace function staff_refund(p_id uuid, p_reason text, p_method text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner','manager']); o orders; s settings; inv invoices; e loyalty_ledger;
  v_method text; v_cn uuid; v_pts int := 0; v_stamps int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON'; end if;
  select * into o from orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.payment_status <> 'paid' then raise exception 'UNPAID'; end if;
  if o.status = 'refunded' then raise exception 'CLOSED'; end if;
  select * into inv from invoices where order_id = o.id and kind = 'invoice';
  select * into s from settings where id = 1;
  v_method := coalesce(p_method, (select method from payments where order_id = o.id and kind = 'sale' order by amount desc limit 1), 'cash');
  if v_method not in ('cash', 'card', 'online') then raise exception 'PAY'; end if;
  if v_method = 'cash' and current_shift_id() is null then raise exception 'NO_SHIFT'; end if;
  perform record_payment(o.id, v_method, o.total, 'refund', null);

  if o.customer_id is not null then
    for e in select * from loyalty_ledger where order_id = o.id loop
      v_pts := v_pts - e.points; v_stamps := v_stamps - e.stamps;
    end loop;
    -- free_cup سُجّل بسالب عدد الأختام؛ عكسه يعيد البطاقة مكتملة
    update customers set points = greatest(0, points + v_pts),
      stamps = least(s.stamps_for_free, greatest(0, stamps + v_stamps)) where id = o.customer_id;
    if v_pts <> 0 or v_stamps <> 0 then
      insert into loyalty_ledger (customer_id, order_id, kind, points, stamps, note)
      values (o.customer_id, o.id, 'reverse', v_pts, v_stamps, p_reason);
    end if;
  end if;
  perform apply_stock(o.id, 1, 'refund');
  update orders set status = 'refunded', updated_at = now() where id = o.id;
  if inv.id is not null then
    v_cn := issue_invoice(o.id, 'credit_note', inv.id, p_reason);
  end if;
  select * into o from orders where id = p_id;
  return jsonb_build_object('order', order_json(o), 'creditNoteId', v_cn);
end $$;

create or replace function staff_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  return coalesce((
    select jsonb_agg(j) from (
      select order_json(o) as j from orders o
      where o.status not in ('done', 'cancelled', 'refunded') or o.created_at > now() - interval '18 hours'
      order by o.created_at desc limit 120
    ) t), '[]'::jsonb);
end $$;

create or replace function staff_find_orders(p_search text, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager','cashier']);
  return coalesce((
    select jsonb_agg(j) from (
      select order_json(o) as j from orders o
      left join customers c on c.id = o.customer_id
      where coalesce(p_search, '') = '' or o.number ilike '%' || p_search || '%' or c.phone like '%' || p_search || '%'
      order by o.created_at desc limit least(greatest(p_limit, 1), 200)
    ) t), '[]'::jsonb);
end $$;

-- ═════════════ الورديات والصندوق ═════════════

create or replace function shift_json(p_shift uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with sh as (select * from shifts where id = p_shift),
  pay as (
    select
      coalesce(sum(amount) filter (where method = 'cash' and kind = 'sale'), 0) as cash_sales,
      coalesce(sum(amount) filter (where method = 'card' and kind = 'sale'), 0) as card_sales,
      coalesce(sum(amount) filter (where method = 'cash' and kind = 'refund'), 0) as cash_refunds,
      coalesce(sum(amount) filter (where method <> 'cash' and kind = 'refund'), 0) as other_refunds,
      count(distinct order_id) filter (where kind = 'sale') as orders
    from payments where shift_id = p_shift),
  mv as (
    select coalesce(sum(amount) filter (where kind = 'in'), 0) as cash_in,
           coalesce(sum(amount) filter (where kind = 'out'), 0) as cash_out
    from cash_moves where shift_id = p_shift)
  select jsonb_build_object(
    'id', sh.id, 'staffName', staff_name(sh.staff_id), 'openedAt', sh.opened_at, 'closedAt', sh.closed_at,
    'openingCash', sh.opening_cash, 'cashSales', pay.cash_sales, 'cardSales', pay.card_sales,
    'cashRefunds', pay.cash_refunds, 'otherRefunds', pay.other_refunds, 'cashIn', mv.cash_in, 'cashOut', mv.cash_out,
    'orders', pay.orders,
    'expectedCash', coalesce(sh.expected_cash, sh.opening_cash + pay.cash_sales - pay.cash_refunds + mv.cash_in - mv.cash_out),
    'countedCash', sh.counted_cash,
    'difference', case when sh.counted_cash is null then null else sh.counted_cash - sh.expected_cash end,
    'note', sh.note,
    'moves', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'reason', reason, 'at', created_at)
                       order by id) from cash_moves where shift_id = p_shift), '[]'::jsonb))
  from sh, pay, mv;
$$;

create or replace function staff_current_shift() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  v := current_shift_id();
  return case when v is null then null else shift_json(v) end;
end $$;

create or replace function staff_open_shift(p_opening numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner','manager','cashier']); v uuid;
begin
  if current_shift_id() is not null then raise exception 'SHIFT_OPEN'; end if;
  insert into shifts (staff_id, opening_cash) values (v_uid, greatest(coalesce(p_opening, 0), 0)) returning id into v;
  return shift_json(v);
end $$;

create or replace function staff_cash_move(p_kind text, p_amount numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner','manager','cashier']); v uuid := current_shift_id();
begin
  if v is null then raise exception 'NO_SHIFT'; end if;
  if p_kind not in ('in', 'out') or coalesce(p_amount, 0) <= 0 then raise exception 'AMOUNT'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON'; end if;
  insert into cash_moves (shift_id, kind, amount, reason, created_by) values (v, p_kind, p_amount, p_reason, v_uid);
  return shift_json(v);
end $$;

create or replace function staff_close_shift(p_counted numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner','manager','cashier']); v uuid := current_shift_id(); v_expected numeric;
begin
  if v is null then raise exception 'NO_SHIFT'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'AMOUNT'; end if;
  v_expected := (shift_json(v)->>'expectedCash')::numeric;
  update shifts set closed_at = now(), counted_cash = p_counted, expected_cash = v_expected, note = coalesce(p_note, '')
  where id = v;
  return shift_json(v);
end $$;

create or replace function staff_shifts(p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  return coalesce((select jsonb_agg(shift_json(id) order by opened_at desc)
    from (select id, opened_at from shifts order by opened_at desc limit least(greatest(p_limit, 1), 200)) t), '[]'::jsonb);
end $$;

-- ═════════════ القائمة والإعدادات ═════════════

create or replace function get_menu() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort, 'visible', visible) order by sort)
                            from categories), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'multi', multi, 'coldOnly', cold_only,
                          'defaultIndex', default_index, 'options', options) order by name) from option_groups), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'categoryId', category_id, 'name', name,
                          'description', description, 'sizes', sizes, 'hot', hot, 'cold', cold, 'groupIds', to_jsonb(group_ids),
                          'noteTitle', note_title, 'available', available, 'freeCupEligible', free_cup_eligible, 'sort', sort)
                          order by sort) from items), '[]'::jsonb),
    'settings', (select jsonb_build_object('stampMin', stamp_min, 'stampsForFree', stamps_for_free,
                   'pointsPerRiyal', points_per_riyal, 'pointsPerRiyalDiscount', points_per_riyal_discount,
                   'deliveryEnabled', delivery_enabled, 'storeName', store_name, 'legalName', legal_name,
                   'crNumber', cr_number, 'vatNumber', vat_number, 'vatEnabled', vat_enabled, 'vatRate', vat_rate,
                   'address', address, 'phone', phone, 'receiptFooter', receipt_footer, 'invoicePrefix', invoice_prefix)
                 from settings where id = 1)
  );
$$;

create or replace function staff_save_category(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  insert into categories (id, name, sort, visible)
  values ((p->>'id')::uuid, p->>'name', coalesce((p->>'sort')::int, 0), coalesce((p->>'visible')::boolean, true))
  on conflict (id) do update set name = excluded.name, sort = excluded.sort, visible = excluded.visible;
end $$;

create or replace function staff_delete_category(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  if exists (select 1 from items where category_id = p_id) then raise exception 'HAS_ITEMS'; end if;
  delete from categories where id = p_id;
end $$;

create or replace function staff_save_group(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  insert into option_groups (id, name, multi, cold_only, default_index, options)
  values ((p->>'id')::uuid, p->>'name', coalesce((p->>'multi')::boolean, false), coalesce((p->>'coldOnly')::boolean, false),
          coalesce((p->>'defaultIndex')::int, 0), coalesce(p->'options', '[]'::jsonb))
  on conflict (id) do update set name = excluded.name, multi = excluded.multi, cold_only = excluded.cold_only,
    default_index = excluded.default_index, options = excluded.options;
end $$;

create or replace function staff_delete_group(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  update items set group_ids = array_remove(group_ids, p_id) where p_id = any (group_ids);
  delete from option_groups where id = p_id;
end $$;

create or replace function staff_save_item(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  insert into items (id, category_id, name, description, sizes, hot, cold, group_ids, note_title, available, free_cup_eligible, sort)
  values ((p->>'id')::uuid, (p->>'categoryId')::uuid, p->>'name', coalesce(p->>'description', ''), coalesce(p->'sizes', '[]'::jsonb),
    coalesce((p->>'hot')::boolean, true), coalesce((p->>'cold')::boolean, false),
    coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(p->'groupIds')), '{}'),
    coalesce(p->>'noteTitle', ''), coalesce((p->>'available')::boolean, true),
    coalesce((p->>'freeCupEligible')::boolean, false), coalesce((p->>'sort')::int, 0))
  on conflict (id) do update set category_id = excluded.category_id, name = excluded.name, description = excluded.description,
    sizes = excluded.sizes, hot = excluded.hot, cold = excluded.cold, group_ids = excluded.group_ids,
    note_title = excluded.note_title, available = excluded.available, free_cup_eligible = excluded.free_cup_eligible,
    sort = excluded.sort;
end $$;

create or replace function staff_delete_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  delete from items where id = p_id;
end $$;

-- كل الموظفين يستطيعون تعليم صنف بأنه نفد
create or replace function staff_set_item_available(p_id uuid, p_available boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  update items set available = p_available where id = p_id;
end $$;

create or replace function staff_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text := staff_role(); v_vat text;
begin
  if v_role is null then raise exception 'NOT_STAFF'; end if;
  if v_role not in ('owner', 'manager') then raise exception 'FORBIDDEN'; end if;
  update settings set
    stamp_min = coalesce((p->>'stampMin')::numeric, stamp_min),
    stamps_for_free = coalesce((p->>'stampsForFree')::int, stamps_for_free),
    points_per_riyal = coalesce((p->>'pointsPerRiyal')::numeric, points_per_riyal),
    points_per_riyal_discount = coalesce((p->>'pointsPerRiyalDiscount')::int, points_per_riyal_discount),
    receipt_footer = coalesce(p->>'receiptFooter', receipt_footer)
  where id = 1;
  -- بيانات المنشأة والضريبة للمالك فقط
  if v_role = 'owner' then
    v_vat := regexp_replace(coalesce(p->>'vatNumber', (select vat_number from settings where id = 1)), '\s', '', 'g');
    if coalesce((p->>'vatEnabled')::boolean, false) and v_vat !~ '^3[0-9]{13}3$' then raise exception 'VAT_NUMBER'; end if;
    update settings set
      store_name = coalesce(p->>'storeName', store_name),
      legal_name = coalesce(p->>'legalName', legal_name),
      cr_number = coalesce(p->>'crNumber', cr_number),
      vat_number = v_vat,
      vat_enabled = coalesce((p->>'vatEnabled')::boolean, vat_enabled),
      vat_rate = coalesce((p->>'vatRate')::numeric, vat_rate),
      address = coalesce(p->'address', address),
      phone = coalesce(p->>'phone', phone),
      invoice_prefix = coalesce(nullif(p->>'invoicePrefix', ''), invoice_prefix),
      delivery_enabled = coalesce((p->>'deliveryEnabled')::boolean, delivery_enabled)
    where id = 1;
  end if;
end $$;

-- ═════════════ الموظفون ═════════════

create or replace function staff_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('userId', user_id, 'name', name, 'email', email, 'role', role)
  from staff where user_id = auth.uid() and active;
$$;

create or replace function staff_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner']);
  return coalesce((select jsonb_agg(jsonb_build_object('userId', user_id, 'name', name, 'email', email, 'role', role,
    'active', active, 'createdAt', created_at) order by created_at) from staff), '[]'::jsonb);
end $$;

create or replace function staff_save_member(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner']); v_target uuid := (p->>'userId')::uuid;
begin
  if (p->>'role') not in ('owner', 'manager', 'cashier', 'barista') then raise exception 'ROLE'; end if;
  update staff set name = coalesce(p->>'name', name), role = p->>'role', active = coalesce((p->>'active')::boolean, active)
  where user_id = v_target;
  if not exists (select 1 from staff where role = 'owner' and active) then raise exception 'LAST_OWNER'; end if;
end $$;

-- يضيف حساباً موجوداً في Authentication › Users كموظف
create or replace function staff_add_member(p_email text, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner']); v_user uuid;
begin
  if p_role not in ('owner', 'manager', 'cashier', 'barista') then raise exception 'ROLE'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'NO_USER'; end if;
  insert into staff (user_id, name, email, role) values (v_user, coalesce(p_name, ''), lower(trim(p_email)), p_role)
  on conflict (user_id) do update set name = excluded.name, role = excluded.role, active = true;
end $$;

-- ═════════════ العملاء ═════════════

create or replace function staff_customers(p_search text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager','cashier']);
  return coalesce((select jsonb_agg(j) from (
    select jsonb_build_object('id', c.id, 'phone', c.phone, 'stamps', c.stamps, 'points', c.points,
      'createdAt', c.created_at,
      'orders', (select count(*) from orders o where o.customer_id = c.id and o.payment_status = 'paid' and o.status <> 'refunded'),
      'spent', (select coalesce(sum(total), 0) from orders o where o.customer_id = c.id and o.payment_status = 'paid' and o.status <> 'refunded'),
      'lastOrder', (select max(created_at) from orders o where o.customer_id = c.id)) as j
    from customers c
    where coalesce(p_search, '') = ''
       or c.phone like '%' || regexp_replace(regexp_replace(p_search, '[^0-9]', '', 'g'), '^(966|0)', '') || '%'
    order by (select max(created_at) from orders o where o.customer_id = c.id) desc nulls last
    limit 100) t), '[]'::jsonb);
end $$;

create or replace function staff_customer_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager','cashier']);
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(order_json(o) order by o.created_at desc) from
      (select * from orders where customer_id = p_id order by created_at desc limit 20) o), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'points', l.points, 'stamps', l.stamps,
      'note', l.note, 'orderNumber', coalesce(o.number, ''), 'createdAt', l.created_at) order by l.id desc)
      from (select * from loyalty_ledger where customer_id = p_id order by id desc limit 30) l
      left join orders o on o.id = l.order_id), '[]'::jsonb));
end $$;

create or replace function staff_adjust_loyalty(p_id uuid, p_points int, p_stamps int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s settings;
begin
  perform require_role(array['owner','manager']);
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON'; end if;
  select * into s from settings where id = 1;
  update customers set points = greatest(0, points + coalesce(p_points, 0)),
    stamps = least(s.stamps_for_free, greatest(0, stamps + coalesce(p_stamps, 0))) where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into loyalty_ledger (customer_id, kind, points, stamps, note)
  values (p_id, 'adjust', coalesce(p_points, 0), coalesce(p_stamps, 0), p_reason);
end $$;

-- ═════════════ المخزون ═════════════

create or replace function staff_ingredients() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'stock', stock,
    'reorderLevel', reorder_level, 'cost', cost, 'active', active, 'low', stock <= reorder_level) order by name)
    from ingredients where active), '[]'::jsonb);
end $$;

create or replace function staff_save_ingredient(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  insert into ingredients (id, name, unit, reorder_level, cost, active)
  values (coalesce((p->>'id')::uuid, gen_random_uuid()), p->>'name', coalesce(p->>'unit', 'غرام'),
    coalesce((p->>'reorderLevel')::numeric, 0), coalesce((p->>'cost')::numeric, 0), coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set name = excluded.name, unit = excluded.unit, reorder_level = excluded.reorder_level,
    cost = excluded.cost, active = excluded.active;
end $$;

create or replace function staff_stock_move(p_ingredient uuid, p_kind text, p_qty numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner','manager']); v_delta numeric;
begin
  if p_kind not in ('purchase', 'waste', 'adjust') or p_qty is null then raise exception 'AMOUNT'; end if;
  v_delta := case p_kind when 'purchase' then abs(p_qty) when 'waste' then -abs(p_qty) else p_qty end;
  update ingredients set stock = stock + v_delta where id = p_ingredient;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into stock_moves (ingredient_id, kind, qty, note, created_by) values (p_ingredient, p_kind, v_delta, coalesce(p_note, ''), v_uid);
end $$;

create or replace function staff_recipes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  return coalesce((select jsonb_agg(jsonb_build_object('itemId', item_id, 'sizeIndex', size_index,
    'ingredientId', ingredient_id, 'qty', qty) order by id) from recipes), '[]'::jsonb);
end $$;

create or replace function staff_save_recipe(p_item uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  delete from recipes where item_id = p_item;
  insert into recipes (item_id, size_index, ingredient_id, qty)
  select p_item, nullif(r->>'sizeIndex', '')::int, (r->>'ingredientId')::uuid, (r->>'qty')::numeric
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r where coalesce((r->>'qty')::numeric, 0) > 0;
end $$;

create or replace function staff_stock_moves(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'ingredient', i.name, 'unit', i.unit, 'kind', m.kind,
    'qty', m.qty, 'note', m.note, 'orderNumber', o.number, 'by', staff_name(m.created_by), 'createdAt', m.created_at) order by m.id desc)
    from (select * from stock_moves order by id desc limit least(greatest(p_limit, 1), 300)) m
    join ingredients i on i.id = m.ingredient_id left join orders o on o.id = m.order_id), '[]'::jsonb);
end $$;

-- ═════════════ الفواتير ═════════════

create or replace function invoice_json(i invoices, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'number', i.number, 'kind', i.kind, 'refNumber', i.ref_number, 'reason', i.reason,
    'issuedAt', i.issued_at, 'buyerPhone', i.buyer_phone, 'vatEnabled', i.vat_enabled, 'vatRate', i.vat_rate,
    'seller', i.seller, 'lines', i.lines, 'discountIncl', i.discount_incl, 'discountEx', i.discount_ex,
    'totalEx', i.total_ex, 'vatAmount', i.vat_amount, 'rounding', i.rounding, 'total', i.total, 'payments', i.payments,
    'orderNumber', (select number from orders where id = i.order_id),
    'serviceType', (select service_type from orders where id = i.order_id),
    'table', (select table_no from orders where id = i.order_id),
    'zatcaStatus', i.zatca_status, 'qr', i.qr, 'icv', i.icv,
    'cashier', case when p_full then staff_name(i.created_by) end,
    'zatcaResponse', case when p_full then i.zatca_response end,
    'reportedAt', i.reported_at);
$$;

-- رابط عرض الفاتورة العام: المعرّف عشوائي غير قابل للتخمين
create or replace function get_invoice(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select invoice_json(i, false) from invoices i where i.id = p_id;
$$;

create or replace function staff_invoices(p_from date, p_to date, p_search text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager','cashier']);
  return coalesce((select jsonb_agg(invoice_json(i, true) order by i.seq desc) from (
    select * from invoices
    where (issued_at at time zone 'Asia/Riyadh')::date between coalesce(p_from, '2000-01-01') and coalesce(p_to, '2999-01-01')
      and (coalesce(p_search, '') = '' or number ilike '%' || p_search || '%' or buyer_phone like '%' || p_search || '%'
           or order_id in (select id from orders where number ilike '%' || p_search || '%'))
    order by seq desc limit 300) i), '[]'::jsonb);
end $$;

create or replace function staff_invoice_xml(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  return (select xml from invoices where id = p_id);
end $$;

-- ═════════════ التقارير ولوحة المؤشرات ═════════════

create or replace function staff_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz; v_to timestamptz;
begin
  perform require_role(array['owner','manager']);
  v_from := (p_from::timestamp) at time zone 'Asia/Riyadh';
  v_to := ((p_to + 1)::timestamp) at time zone 'Asia/Riyadh';
  return (
    with inv as (select *, case when kind = 'credit_note' then -1 else 1 end as sgn from invoices where issued_at >= v_from and issued_at < v_to),
    ord as (select o.* from orders o join invoices i on i.order_id = o.id and i.kind = 'invoice' where i.issued_at >= v_from and i.issued_at < v_to),
    lines as (select (l->>'name') as name, (l->>'qty')::int as qty, (l->>'incl')::numeric as incl
              from inv, jsonb_array_elements(inv.lines) l where inv.kind = 'invoice'),
    ilines as (select o.id, l->>'itemId' as item_id, (l->>'qty')::int as qty, (l->>'unitPrice')::numeric * (l->>'qty')::int as amount
               from ord o, jsonb_array_elements(o.lines) l where o.status <> 'refunded'),
    pay as (select p.* from payments p where p.created_at >= v_from and p.created_at < v_to)
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'invoices', (select count(*) from inv where kind = 'invoice'),
        'creditNotes', (select count(*) from inv where kind = 'credit_note'),
        'gross', (select coalesce(sum(total + discount_incl), 0) from inv where kind = 'invoice'),
        'discounts', (select coalesce(sum(discount_incl), 0) from inv where kind = 'invoice'),
        'refunds', (select coalesce(sum(total), 0) from inv where kind = 'credit_note'),
        'net', (select coalesce(sum(sgn * total), 0) from inv),
        'netEx', (select coalesce(sum(sgn * total_ex), 0) from inv),
        'vat', (select coalesce(sum(sgn * vat_amount), 0) from inv),
        'avgTicket', (select coalesce(round(avg(total), 2), 0) from inv where kind = 'invoice')),
      'byMethod', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'sales', sales, 'refunds', refunds))
        from (select method, sum(amount) filter (where kind = 'sale') as sales, coalesce(sum(amount) filter (where kind = 'refund'), 0) as refunds
              from pay group by method) t), '[]'::jsonb),
      'byChannel', coalesce((select jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'total', t))
        from (select channel, count(*) as n, sum(total) as t from ord group by channel) x), '[]'::jsonb),
      'byDay', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'total', t, 'invoices', n) order by d)
        from (select (issued_at at time zone 'Asia/Riyadh')::date as d, sum(sgn * total) as t, count(*) filter (where kind = 'invoice') as n
              from inv group by 1) x), '[]'::jsonb),
      'byHour', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'total', t, 'invoices', n) order by h)
        from (select extract(hour from issued_at at time zone 'Asia/Riyadh')::int as h, sum(total) as t, count(*) as n
              from inv where kind = 'invoice' group by 1) x), '[]'::jsonb),
      'topItems', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'amount', a) order by q desc, a desc)
        from (select it.name, sum(il.qty) as q, sum(il.amount) as a from ilines il join items it on it.id::text = il.item_id
              group by it.name order by q desc limit 15) x), '[]'::jsonb),
      'byCategory', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'amount', a) order by a desc)
        from (select c.name, sum(il.qty) as q, sum(il.amount) as a from ilines il join items it on it.id::text = il.item_id
              join categories c on c.id = it.category_id group by c.name) x), '[]'::jsonb),
      'vatReport', jsonb_build_object(
        'enabled', (select vat_enabled from settings where id = 1),
        'taxableSales', (select coalesce(sum(total_ex), 0) from inv where kind = 'invoice' and vat_enabled),
        'vatOnSales', (select coalesce(sum(vat_amount), 0) from inv where kind = 'invoice' and vat_enabled),
        'taxableReturns', (select coalesce(sum(total_ex), 0) from inv where kind = 'credit_note' and vat_enabled),
        'vatOnReturns', (select coalesce(sum(vat_amount), 0) from inv where kind = 'credit_note' and vat_enabled),
        'nonTaxableSales', (select coalesce(sum(sgn * total), 0) from inv where not vat_enabled))
    )
  );
end $$;

create or replace function staff_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text := staff_role(); v_from timestamptz; v_money boolean;
begin
  if v_role is null then raise exception 'NOT_STAFF'; end if;
  v_money := v_role in ('owner', 'manager');
  v_from := ((now() at time zone 'Asia/Riyadh')::date::timestamp) at time zone 'Asia/Riyadh';
  return jsonb_build_object(
    'role', v_role,
    'todaySales', case when v_money then (select coalesce(sum(case when kind = 'credit_note' then -total else total end), 0)
                  from invoices where issued_at >= v_from) end,
    'todayInvoices', (select count(*) from invoices where issued_at >= v_from and kind = 'invoice'),
    'todayAvg', case when v_money then (select coalesce(round(avg(total), 2), 0) from invoices where issued_at >= v_from and kind = 'invoice') end,
    'yesterdaySales', case when v_money then (select coalesce(sum(case when kind = 'credit_note' then -total else total end), 0)
                  from invoices where issued_at >= v_from - interval '1 day' and issued_at < v_from) end,
    'activeOrders', (select count(*) from orders where status in ('new', 'preparing', 'ready')),
    'waitingArrival', (select count(*) from orders where status = 'waiting_arrival'),
    'unpaidCashier', (select count(*) from orders where payment_status = 'unpaid' and pay_method = 'cashier' and status not in ('cancelled')),
    'waiterCalls', (select count(*) from waiter_calls where resolved_at is null),
    'lowStock', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'stock', stock, 'unit', unit)) from ingredients
                where active and stock <= reorder_level), '[]'::jsonb),
    'unavailableItems', (select count(*) from items where not available),
    'shift', (select shift_json(current_shift_id())),
    'openShifts', (select count(*) from shifts where closed_at is null),
    'zatca', case when v_money then jsonb_build_object(
      'vatEnabled', (select vat_enabled from settings where id = 1),
      'status', (select status from zatca_state where id = 1),
      'environment', (select environment from zatca_state where id = 1),
      'pending', (select count(*) from invoices where zatca_status in ('pending', 'signed')),
      'overdue', (select count(*) from invoices where zatca_status in ('pending', 'signed') and issued_at < now() - interval '20 hours'),
      'rejected', (select count(*) from invoices where zatca_status = 'rejected')) end
  );
end $$;

create or replace function staff_waiter_calls() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'table', table_no, 'createdAt', created_at) order by created_at)
    from waiter_calls where resolved_at is null), '[]'::jsonb);
end $$;

-- ═════════════ الهيئة: دوال للوحة التحكم ═════════════

create or replace function staff_zatca_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['owner','manager']);
  return (select jsonb_build_object(
    'environment', environment, 'status', status, 'egsSerial', egs_serial, 'onboardedAt', onboarded_at,
    'lastError', last_error, 'lastIcv', last_icv, 'complianceResults', compliance_results,
    'hasCertificate', production_cert is not null,
    'pending', (select count(*) from invoices where zatca_status = 'pending'),
    'signed', (select count(*) from invoices where zatca_status = 'signed'),
    'reported', (select count(*) from invoices where zatca_status = 'reported'),
    'warning', (select count(*) from invoices where zatca_status = 'warning'),
    'rejected', (select count(*) from invoices where zatca_status = 'rejected'),
    'oldestPending', (select min(issued_at) from invoices where zatca_status in ('pending', 'signed')))
    from zatca_state where id = 1);
end $$;

-- ═════════════ الهيئة: دوال الخادم فقط (service_role) ═════════════

-- قفل يضمن توقيع الفواتير بالتسلسل: كل فاتورة تحمل تجزئة سابقتها
create or replace function zatca_try_lock(p_holder uuid, p_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update zatca_state set lock_holder = p_holder, lock_until = now() + make_interval(secs => p_seconds)
  where id = 1 and (lock_until is null or lock_until < now() or lock_holder = p_holder);
  return found;
end $$;

create or replace function zatca_unlock(p_holder uuid) returns void
language sql security definer set search_path = public as $$
  update zatca_state set lock_holder = null, lock_until = null where id = 1 and lock_holder = p_holder;
$$;

-- يحفظ الفاتورة الموقعة ويحرك سلسلة التجزئة في عملية واحدة
create or replace function zatca_save_signed(p_id uuid, p_holder uuid, p_icv bigint, p_pih text, p_hash text, p_qr text, p_xml text)
returns void language plpgsql security definer set search_path = public as $$
declare st zatca_state;
begin
  select * into st from zatca_state where id = 1 for update;
  if st.lock_holder is distinct from p_holder then raise exception 'LOCK'; end if;
  if p_icv <> st.last_icv + 1 or p_pih <> st.last_hash then raise exception 'CHAIN'; end if;
  update invoices set zatca_status = 'signed', icv = p_icv, pih = p_pih, invoice_hash = p_hash, qr = p_qr, xml = p_xml,
    signed_at = now() where id = p_id and zatca_status = 'pending';
  if not found then raise exception 'STATE'; end if;
  update zatca_state set last_icv = p_icv, last_hash = p_hash where id = 1;
end $$;

revoke execute on function zatca_try_lock(uuid, int) from public, anon, authenticated;
revoke execute on function zatca_unlock(uuid) from public, anon, authenticated;
revoke execute on function zatca_save_signed(uuid, uuid, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function zatca_try_lock(uuid, int) to service_role;
grant execute on function zatca_unlock(uuid) to service_role;
grant execute on function zatca_save_signed(uuid, uuid, bigint, text, text, text, text) to service_role;

-- الدوال الداخلية لا تُستدعى من المتصفح
revoke execute on function create_order(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function issue_invoice(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function record_payment(uuid, text, numeric, text, text) from public, anon, authenticated;
revoke execute on function apply_stock(uuid, int, text) from public, anon, authenticated;
revoke execute on function settle_loyalty(uuid) from public, anon, authenticated;
revoke execute on function pay_order(uuid, text) from public, anon, authenticated;

-- ═════════════ صلاحيات تنفيذ الدوال العامة ═════════════

grant execute on function get_menu() to anon, authenticated;
grant execute on function get_invoice(uuid) to anon, authenticated;
grant execute on function login_with_phone(text, text) to anon, authenticated;
grant execute on function place_order(uuid, jsonb) to anon, authenticated;
grant execute on function staff_role() to authenticated;
grant execute on function staff_me() to authenticated;
grant execute on function staff_pos_sale(jsonb) to authenticated;
grant execute on function staff_mark_paid(uuid, text) to authenticated;
grant execute on function staff_set_order_status(uuid, text) to authenticated;
grant execute on function staff_refund(uuid, text, text) to authenticated;
grant execute on function staff_orders() to authenticated;
grant execute on function staff_find_orders(text, int) to authenticated;
grant execute on function staff_current_shift() to authenticated;
grant execute on function staff_open_shift(numeric) to authenticated;
grant execute on function staff_cash_move(text, numeric, text) to authenticated;
grant execute on function staff_close_shift(numeric, text) to authenticated;
grant execute on function staff_shifts(int) to authenticated;
grant execute on function staff_save_category(jsonb) to authenticated;
grant execute on function staff_delete_category(uuid) to authenticated;
grant execute on function staff_save_group(jsonb) to authenticated;
grant execute on function staff_delete_group(uuid) to authenticated;
grant execute on function staff_save_item(jsonb) to authenticated;
grant execute on function staff_delete_item(uuid) to authenticated;
grant execute on function staff_set_item_available(uuid, boolean) to authenticated;
grant execute on function staff_save_settings(jsonb) to authenticated;
grant execute on function staff_list() to authenticated;
grant execute on function staff_save_member(jsonb) to authenticated;
grant execute on function staff_add_member(text, text, text) to authenticated;
grant execute on function staff_customers(text) to authenticated;
grant execute on function staff_customer_detail(uuid) to authenticated;
grant execute on function staff_adjust_loyalty(uuid, int, int, text) to authenticated;
grant execute on function staff_ingredients() to authenticated;
grant execute on function staff_save_ingredient(jsonb) to authenticated;
grant execute on function staff_stock_move(uuid, text, numeric, text) to authenticated;
grant execute on function staff_recipes() to authenticated;
grant execute on function staff_save_recipe(uuid, jsonb) to authenticated;
grant execute on function staff_stock_moves(int) to authenticated;
grant execute on function staff_invoices(date, date, text) to authenticated;
grant execute on function staff_invoice_xml(uuid) to authenticated;
grant execute on function staff_report(date, date) to authenticated;
grant execute on function staff_dashboard() to authenticated;
grant execute on function staff_zatca_status() to authenticated;
grant execute on function staff_waiter_calls() to authenticated;
grant execute on function get_order(uuid, uuid) to service_role;
