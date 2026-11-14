-- مسدار: قاعدة البيانات.
-- شغّل هذا الملف مرة واحدة من Supabase › SQL Editor.
-- العملاء لا يقرؤون الجداول مباشرة: كل عملياتهم تمر بدوال security definer تتحقق من رمز الجلسة.
-- الموظفون يدخلون بحساب Supabase Auth مسجل في جدول staff.

-- ───────────── الجداول ─────────────

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort int not null default 0,
  visible boolean not null default true
);

create table if not exists option_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  multi boolean not null default false,
  cold_only boolean not null default false,
  default_index int not null default 0,
  options jsonb not null default '[]'   -- [{ "label": text, "price": number }]
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories (id) on delete restrict,
  name text not null,
  description text not null default '',
  sizes jsonb not null default '[]',    -- [{ "label": text, "price": number | null }]
  hot boolean not null default true,
  cold boolean not null default false,
  group_ids uuid[] not null default '{}',
  note_title text not null default '',
  available boolean not null default true,
  free_cup_eligible boolean not null default false,
  sort int not null default 0
);

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  stamp_min numeric not null default 6,
  stamps_for_free int not null default 3,
  points_per_riyal numeric not null default 1,
  points_per_riyal_discount int not null default 20,
  delivery_enabled boolean not null default false
);

-- رمز التحقق التجريبي. يُستبدل بمزود SMS قبل الافتتاح (انظر README).
create table if not exists private_settings (
  id int primary key default 1 check (id = 1),
  test_otp text not null default '1234'
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  stamps int not null default 0,
  points int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  created_at timestamptz not null default now()
);

create sequence if not exists order_number_seq start 1001;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references customers (id),
  status text not null check (status in ('awaiting_payment','waiting_arrival','new','preparing','ready','done','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid')),
  pay_method text not null check (pay_method in ('online','cashier')),
  payment_id text,
  service_type text not null check (service_type in ('dinein','takeaway')),
  table_no int,
  arrive_later boolean not null default false,
  pickup text not null default 'now' check (pickup in ('now','15','30','arrive')),
  lines jsonb not null default '[]',
  free_cup jsonb,
  subtotal numeric not null,
  discount numeric not null default 0,
  total numeric not null,
  points_used int not null default 0,
  points_earned int not null default 0,
  qualifies boolean not null default false,
  loyalty_settled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_customer_idx on orders (customer_id, created_at desc);
create index if not exists orders_created_idx on orders (created_at desc);
-- عملية الدفع الواحدة لا تُستخدم لطلبين
create unique index if not exists orders_payment_id_idx on orders (payment_id) where payment_id is not null;

create table if not exists loyalty_ledger (
  id bigserial primary key,
  customer_id uuid not null references customers (id) on delete cascade,
  order_id uuid references orders (id) on delete set null,
  kind text not null check (kind in ('earn','redeem','free_cup','refund')),
  points int not null default 0,
  stamps int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists waiter_calls (
  id uuid primary key default gen_random_uuid(),
  table_no int not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists staff (
  user_id uuid primary key
);

insert into settings (id) values (1) on conflict do nothing;
insert into private_settings (id) values (1) on conflict do nothing;

-- ───────────── الصلاحيات ─────────────

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid());
$$;

alter table categories enable row level security;
alter table option_groups enable row level security;
alter table items enable row level security;
alter table settings enable row level security;
alter table private_settings enable row level security;
alter table customers enable row level security;
alter table sessions enable row level security;
alter table orders enable row level security;
alter table loyalty_ledger enable row level security;
alter table waiter_calls enable row level security;
alter table staff enable row level security;

drop policy if exists menu_read on categories;
create policy menu_read on categories for select using (true);
drop policy if exists menu_write on categories;
create policy menu_write on categories for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists menu_read on option_groups;
create policy menu_read on option_groups for select using (true);
drop policy if exists menu_write on option_groups;
create policy menu_write on option_groups for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists menu_read on items;
create policy menu_read on items for select using (true);
drop policy if exists menu_write on items;
create policy menu_write on items for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists menu_read on settings;
create policy menu_read on settings for select using (true);
drop policy if exists menu_write on settings;
create policy menu_write on settings for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_only on private_settings;
create policy staff_only on private_settings for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_only on orders;
create policy staff_only on orders for select to authenticated using (is_staff());

drop policy if exists staff_only on waiter_calls;
create policy staff_only on waiter_calls for select to authenticated using (is_staff());

drop policy if exists staff_self on staff;
create policy staff_self on staff for select to authenticated using (user_id = auth.uid());

-- customers و sessions و loyalty_ledger: لا سياسات، فلا يصلها إلا الدوال أدناه.

-- ───────────── دوال مساعدة ─────────────

create or replace function order_json(o orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'status', o.status, 'paymentStatus', o.payment_status,
    'payMethod', o.pay_method, 'serviceType', o.service_type, 'table', o.table_no,
    'later', o.arrive_later, 'pickup', o.pickup, 'lines', o.lines, 'freeCup', o.free_cup,
    'subtotal', o.subtotal, 'discount', o.discount, 'total', o.total,
    'pointsUsed', o.points_used, 'pointsEarned', o.points_earned, 'qualifies', o.qualifies,
    'loyaltySettled', o.loyalty_settled,
    'customerPhone', (select phone from customers c where c.id = o.customer_id),
    'createdAt', o.created_at
  );
$$;

create or replace function session_customer(p_token uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  select customer_id into v_id from sessions where token = p_token;
  if v_id is null then raise exception 'AUTH'; end if;
  return v_id;
end $$;

-- تُضاف النقاط والختم مرة واحدة عند تأكيد الدفع.
create or replace function settle_loyalty(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; c customers; s settings; v_stamp int := 0;
begin
  select * into o from orders where id = p_order for update;
  if o.loyalty_settled then return; end if;
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
  perform settle_loyalty(o.id);
end $$;

-- ───────────── دوال العميل ─────────────

create or replace function login_with_phone(p_phone text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_phone text; v_id uuid; v_token uuid;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_phone like '966%' then v_phone := substr(v_phone, 4); end if;
  if v_phone like '0%' then v_phone := substr(v_phone, 2); end if;
  if v_phone !~ '^5[0-9]{8}$' then raise exception 'BAD_PHONE'; end if;
  v_phone := '+966' || v_phone;
  if p_code is distinct from (select test_otp from private_settings where id = 1) then
    raise exception 'BAD_CODE';
  end if;
  insert into customers (phone) values (v_phone)
    on conflict (phone) do update set phone = excluded.phone returning id into v_id;
  insert into sessions (customer_id) values (v_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'phone', v_phone);
end $$;

create or replace function customer_me(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid := session_customer(p_token);
begin
  return jsonb_build_object(
    'loyalty', (select jsonb_build_object('stamps', stamps, 'points', points) from customers where id = v_id),
    'history', coalesce((
      select jsonb_agg(h) from (
        select jsonb_build_object('id', l.id::text, 'kind', l.kind, 'points', l.points, 'stamps', l.stamps,
          'orderNumber', coalesce(o.number, ''), 'createdAt', l.created_at) as h
        from loyalty_ledger l left join orders o on o.id = l.order_id
        where l.customer_id = v_id order by l.created_at desc, l.id desc limit 20
      ) t), '[]'::jsonb)
  );
end $$;

create or replace function place_order(p_token uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cust customers; v_set settings; v_order orders;
  v_type text; v_table int; v_later boolean; v_pickup text; v_pay text; v_use_points boolean;
  v_line jsonb; v_item items; v_size jsonb; v_size_index int; v_temp text; v_unit numeric; v_qty int;
  v_choice jsonb; v_group option_groups; v_idx int; v_labels text[]; v_idxs int[]; v_choices jsonb;
  v_lines jsonb := '[]'::jsonb; v_subtotal numeric := 0;
  v_free jsonb; v_used_free boolean := false;
  v_discount numeric := 0; v_total numeric; v_points_used int; v_earn int; v_qual boolean;
  v_needs boolean; v_status text;
begin
  select c.* into v_cust from sessions s join customers c on c.id = s.customer_id
    where s.token = p_token for update of c;
  if not found then raise exception 'AUTH'; end if;
  select * into v_set from settings where id = 1;

  v_type := p_input->'service'->>'type';
  if v_type is null or v_type not in ('dinein', 'takeaway') then raise exception 'SERVICE'; end if;
  v_table := nullif(p_input->'service'->>'table', '')::int;
  v_later := coalesce((p_input->'service'->>'later')::boolean, false);
  v_pickup := coalesce(p_input->'service'->>'pickup', 'now');
  if v_pickup not in ('now', '15', '30', 'arrive') then v_pickup := 'now'; end if;
  if v_type = 'takeaway' then v_table := null; end if;
  if v_type = 'dinein' and v_table is null and not v_later then raise exception 'TABLE_REQUIRED'; end if;
  v_pay := p_input->>'payMethod';
  if v_pay is null or v_pay not in ('online', 'cashier') then raise exception 'PAY'; end if;
  v_use_points := coalesce((p_input->>'usePoints')::boolean, false);

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
      'note', case when v_item.note_title <> '' then left(coalesce(v_line->>'note', ''), 160) else '' end,
      'qty', v_qty, 'unitPrice', v_unit);
  end loop;

  v_free := p_input->'freeCup';
  if v_free is not null and jsonb_typeof(v_free) = 'object' then
    if v_cust.stamps < v_set.stamps_for_free then raise exception 'FREE_NOT_READY'; end if;
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
  v_total := v_subtotal - v_discount;
  v_points_used := (v_discount * v_set.points_per_riyal_discount)::int;
  v_earn := floor(v_total * v_set.points_per_riyal)::int;
  v_qual := v_total >= v_set.stamp_min;
  v_needs := v_table is null and (v_type = 'dinein' or v_pickup = 'arrive' or v_pay = 'cashier');
  v_status := case
    when v_pay = 'online' and v_total > 0 then 'awaiting_payment'
    when v_needs then 'waiting_arrival'
    else 'new' end;

  update customers set points = points - v_points_used,
    stamps = case when v_used_free then 0 else stamps end where id = v_cust.id;

  insert into orders (number, customer_id, status, pay_method, service_type, table_no, arrive_later, pickup,
    lines, free_cup, subtotal, discount, total, points_used, points_earned, qualifies)
  values ('M-' || nextval('order_number_seq'), v_cust.id, v_status, v_pay, v_type, v_table, v_later, v_pickup,
    v_lines, v_free, v_subtotal, v_discount, v_total, v_points_used, v_earn, v_qual)
  returning * into v_order;

  if v_points_used > 0 then
    insert into loyalty_ledger (customer_id, order_id, kind, points) values (v_cust.id, v_order.id, 'redeem', -v_points_used);
  end if;
  if v_used_free then
    insert into loyalty_ledger (customer_id, order_id, kind, stamps) values (v_cust.id, v_order.id, 'free_cup', -v_set.stamps_for_free);
  end if;
  if v_total = 0 then
    perform pay_order(v_order.id, null);
    select * into v_order from orders where id = v_order.id;
  end if;
  return order_json(v_order);
end $$;

create or replace function get_order(p_token uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid := session_customer(p_token); o orders;
begin
  select * into o from orders where id = p_id and customer_id = v_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return order_json(o);
end $$;

create or replace function my_orders(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid := session_customer(p_token);
begin
  return coalesce((
    select jsonb_agg(j) from (
      select order_json(o) as j from orders o where o.customer_id = v_id order by o.created_at desc limit 10
    ) t), '[]'::jsonb);
end $$;

create or replace function mark_arrived(p_token uuid, p_id uuid, p_table int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := session_customer(p_token); o orders;
begin
  select * into o from orders where id = p_id and customer_id = v_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'waiting_arrival' then
    if o.service_type = 'dinein' then
      if p_table is null then raise exception 'TABLE_REQUIRED'; end if;
      update orders set table_no = p_table, status = 'new', updated_at = now() where id = o.id returning * into o;
    else
      update orders set status = 'new', updated_at = now() where id = o.id returning * into o;
    end if;
  end if;
  return order_json(o);
end $$;

create or replace function call_waiter(p_table int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_table is null or p_table < 1 or p_table > 500 then raise exception 'TABLE_REQUIRED'; end if;
  if not exists (select 1 from waiter_calls where table_no = p_table and resolved_at is null) then
    insert into waiter_calls (table_no) values (p_table);
  end if;
end $$;

-- ───────────── دوال الموظفين ─────────────

create or replace function staff_set_order_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; s settings;
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  select * into o from orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_status = 'cancelled' and o.status <> 'cancelled' and not o.loyalty_settled then
    select * into s from settings where id = 1;
    update customers set points = points + o.points_used,
      stamps = case when o.free_cup is not null then s.stamps_for_free else stamps end
      where id = o.customer_id;
    if o.points_used > 0 or o.free_cup is not null then
      insert into loyalty_ledger (customer_id, order_id, kind, points, stamps)
      values (o.customer_id, o.id, 'refund', o.points_used, case when o.free_cup is not null then s.stamps_for_free else 0 end);
    end if;
  end if;
  update orders set status = p_status, updated_at = now() where id = o.id;
  if p_status = 'done' and o.payment_status <> 'paid' then perform pay_order(o.id, null); end if;
end $$;

create or replace function staff_mark_paid(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  perform pay_order(p_id, null);
end $$;

create or replace function staff_resolve_call(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  update waiter_calls set resolved_at = now() where id = p_id;
end $$;

create or replace function staff_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'NOT_STAFF'; end if;
  return coalesce((
    select jsonb_agg(j) from (
      select order_json(o) as j from orders o order by o.created_at desc limit 60
    ) t), '[]'::jsonb);
end $$;

-- تستدعيها دالة Netlify بمفتاح service_role بعد التحقق من ميسر. المبلغ بالهللة.
create or replace function confirm_payment(p_order uuid, p_payment_id text, p_amount int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'NOT_FOUND'; end if;
  if round(o.total * 100)::int <> p_amount then raise exception 'AMOUNT'; end if;
  perform pay_order(o.id, p_payment_id);
  select * into o from orders where id = p_order;
  return order_json(o);
end $$;

revoke execute on function confirm_payment(uuid, text, int) from public, anon, authenticated;
revoke execute on function pay_order(uuid, text) from public, anon, authenticated;
revoke execute on function settle_loyalty(uuid) from public, anon, authenticated;
revoke execute on function session_customer(uuid) from public, anon, authenticated;
grant execute on function confirm_payment(uuid, text, int) to service_role;

-- التحديث اللحظي للوحة الطلبات
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table orders; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table waiter_calls; exception when duplicate_object then null; end;
  end if;
end $$;

-- ───────────── القائمة الأولية ─────────────

do $$
declare
  c_sudani uuid; c_coffee uuid; c_sweets uuid;
  g_sugar uuid; g_milk uuid; g_ice uuid;
begin
  if exists (select 1 from categories) then return; end if;

  insert into categories (name, sort) values ('القهوة السودانية والشاي', 0) returning id into c_sudani;
  insert into categories (name, sort) values ('القهوة', 1) returning id into c_coffee;
  insert into categories (name, sort) values ('الحلويات', 2) returning id into c_sweets;

  insert into option_groups (name, default_index, options) values ('السكر', 2,
    '[{"label":"بدون سكر","price":0},{"label":"سكر خفيف","price":0},{"label":"سكر متوسط","price":0},{"label":"سكر زيادة","price":0}]')
    returning id into g_sugar;
  insert into option_groups (name, options) values ('الحليب',
    '[{"label":"حليب كامل الدسم","price":0},{"label":"حليب قليل الدسم","price":0},{"label":"حليب شوفان","price":0}]')
    returning id into g_milk;
  insert into option_groups (name, cold_only, options) values ('الثلج', true,
    '[{"label":"ثلج عادي","price":0},{"label":"ثلج قليل","price":0},{"label":"بدون ثلج","price":0}]')
    returning id into g_ice;

  insert into items (category_id, name, description, sizes, hot, cold, group_ids, note_title, free_cup_eligible, sort) values
    (c_sudani, 'قهوة سودانية', 'جبنة',
      '[{"label":"كوب","price":5},{"label":"كوب كبير","price":7},{"label":"جبنة صغيرة","price":null},{"label":"جبنة متوسطة","price":null},{"label":"جبنة كبيرة","price":null}]',
      true, false, array[g_sugar], 'صف قهوتك', true, 0),
    (c_sudani, 'شاي أحمر', '', '[{"label":"عادي","price":3},{"label":"كبير","price":5}]', true, false, array[g_sugar], '', false, 1),
    (c_sudani, 'شاي مقنن', '', '[{"label":"عادي","price":5},{"label":"كبير","price":7}]', true, false, array[g_sugar], '', false, 2),
    (c_sudani, 'شاي بالحليب', '', '[{"label":"عادي","price":5},{"label":"كبير","price":7}]', true, false, array[g_sugar], '', false, 3),
    (c_coffee, 'إسبريسو', '', '[{"label":"عادي","price":4}]', true, false, '{}', '', false, 4),
    (c_coffee, 'قهوة اليوم', '', '[{"label":"عادي","price":4},{"label":"كبير","price":7}]', true, true, array[g_sugar, g_ice], '', true, 5),
    (c_coffee, 'نسكافيه', '', '[{"label":"عادي","price":7},{"label":"كبير","price":9}]', true, false, array[g_sugar], '', false, 6),
    (c_coffee, 'كابتشينو', '', '[{"label":"عادي","price":7},{"label":"كبير","price":9}]', true, false, array[g_sugar, g_milk], '', false, 7),
    (c_coffee, 'لاتيه', '', '[{"label":"عادي","price":7},{"label":"كبير","price":9}]', true, false, array[g_sugar, g_milk], '', false, 8),
    (c_coffee, 'سبانيش لاتيه', '', '[{"label":"عادي","price":7},{"label":"كبير","price":9}]', true, true, array[g_milk, g_ice], '', false, 9),
    (c_coffee, 'أمريكانو', '', '[{"label":"عادي","price":8},{"label":"كبير","price":10}]', true, false, array[g_sugar], '', false, 10),
    (c_coffee, 'ماتشا', '', '[{"label":"عادي","price":10}]', true, false, array[g_sugar, g_milk], '', false, 11),
    (c_sweets, 'لقيمات', '', '[{"label":"صغير","price":5},{"label":"متوسط","price":10},{"label":"كبير","price":15}]', false, false, '{}', '', false, 12),
    (c_sweets, 'كوكيز', '', '[{"label":"عادي","price":5}]', false, false, '{}', '', false, 13),
    (c_sweets, 'مديدة', '', '[{"label":"عادي","price":5},{"label":"كبير","price":7}]', false, false, '{}', '', false, 14);
end $$;
