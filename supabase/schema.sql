-- =====================================================================
--  aamaritoaid — database schema for Supabase (Postgres 15+)
--
--  Run this once in Supabase: Dashboard → SQL Editor → New query →
--  paste the whole file → Run. It is safe to run again: every object
--  is created with IF NOT EXISTS / OR REPLACE.
--
--  Roles
--    admin    everything, including approvals, people/HR records,
--             salaries, user access and workspace settings
--    member   works day to day: logs expenses, runs tasks, edits
--             products and stock; sees the people directory
--    viewer   read-only access to the workspace (auditors, owners)
--    pending  signed up but not approved yet: sees nothing
--
--  The FIRST account that signs up becomes admin automatically.
--  Everyone after that starts as "pending" until an admin approves them.
--
--  All permissions are enforced here, in the database (row-level
--  security + triggers). The web app only hides buttons; it is not
--  what keeps data safe.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'member', 'viewer', 'pending');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------

-- One row per login account (mirrors auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        public.app_role not null default 'pending',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Workspace settings: exactly one row (id = 1)
create table if not exists public.workspace (
  id                        smallint primary key default 1 check (id = 1),
  company                   text not null default 'aamaritoaid',
  currency                  text not null default '৳',
  expense_categories        text[] not null default array['Office & rent','Travel & transport','Meals','Software','Marketing','Utilities','Salaries','Equipment','Other'],
  budgets                   jsonb not null default '{}'::jsonb,
  product_categories        text[] not null default array['General'],
  departments               text[] not null default array['Operations','Sales','Marketing','Finance','Engineering','HR'],
  projects                  text[] not null default array['General'],
  members_see_all_expenses  boolean not null default false,
  updated_at                timestamptz not null default now()
);
insert into public.workspace (id) values (1) on conflict (id) do nothing;

-- People: the team directory (employees, contractors). A person may be
-- linked to a login account through profile_id, but does not have to be.
create table if not exists public.people (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  role_title       text,
  department       text,
  employment_type  text,
  status           text not null default 'active' check (status in ('active','leave','inactive')),
  phone            text,
  email            text,
  joined           date,
  manager_id       uuid references public.people (id) on delete set null,
  location         text,
  notes            text,
  profile_id       uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Sensitive HR fields, admins only
create table if not exists public.people_private (
  person_id     uuid primary key references public.people (id) on delete cascade,
  salary        numeric(14,2) check (salary is null or salary >= 0),
  bank_account  text,
  national_id   text,
  notes         text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) > 0),
  amount        numeric(14,2) not null check (amount > 0),
  spent_on      date not null default current_date,
  category      text,
  method        text,
  vendor        text,
  person_id     uuid references public.people (id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','approved','reimbursed','rejected')),
  reference     text,
  notes         text,
  receipt_path  text,
  approved_by   uuid references public.profiles (id) on delete set null,
  approved_at   timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(trim(title)) > 0),
  description  text,
  status       text not null default 'todo' check (status in ('todo','doing','review','done')),
  priority     text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assignee_id  uuid references public.people (id) on delete set null,
  due          date,
  project      text,
  checklist    jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  done_at      timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  sku            text,
  category       text,
  unit           text not null default 'pcs',
  price          numeric(14,2) not null default 0 check (price >= 0),
  cost           numeric(14,2) not null default 0 check (cost >= 0),
  stock          numeric(14,3) not null default 0 check (stock >= 0),
  reorder_level  numeric(14,3) not null default 0 check (reorder_level >= 0),
  supplier       text,
  status         text not null default 'active' check (status in ('active','draft','discontinued')),
  description    text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists products_sku_unique on public.products (lower(sku)) where sku is not null and sku <> '';

-- Every stock change made through adjust_stock()
create table if not exists public.stock_movements (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products (id) on delete cascade,
  delta       numeric(14,3) not null,
  balance     numeric(14,3) not null,
  reason      text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Audit trail, written only by triggers
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid references public.profiles (id) on delete set null,
  entity     text not null,
  entity_id  text,
  action     text not null,          -- created | updated | deleted | status | stock | role
  label      text,
  detail     jsonb not null default '{}'::jsonb
);

-- Indexes for the joins and filters the app uses
create index if not exists expenses_spent_on_idx   on public.expenses (spent_on desc);
create index if not exists expenses_created_by_idx on public.expenses (created_by);
create index if not exists expenses_person_idx     on public.expenses (person_id);
create index if not exists expenses_status_idx     on public.expenses (status);
create index if not exists tasks_assignee_idx      on public.tasks (assignee_id);
create index if not exists tasks_status_idx        on public.tasks (status);
create index if not exists tasks_due_idx           on public.tasks (due);
create index if not exists people_manager_idx      on public.people (manager_id);
create index if not exists people_profile_idx      on public.people (profile_id);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists activity_at_idx         on public.activity (at desc);

-- ---------------------------------------------------------------------
-- 3. Permission helpers (security definer so policies can call them
--    without recursion into profiles' own policies)
-- ---------------------------------------------------------------------
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.active then p.role else 'pending'::public.app_role end
       from public.profiles p where p.id = auth.uid()),
    'pending'::public.app_role)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin'
$$;

create or replace function public.can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin','member','viewer')
$$;

create or replace function public.can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin','member')
$$;

-- Can the current user see every expense, or only their own?
create or replace function public.sees_all_expenses() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin','viewer')
      or (public.my_role() = 'member'
          and coalesce((select members_see_all_expenses from public.workspace where id = 1), false))
$$;

-- ---------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------

-- New login account → profile. First account ever becomes admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when exists (select 1 from public.profiles where role = 'admin')
         then 'pending'::public.app_role else 'admin'::public.app_role end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stamp created_by / created_at / updated_at; callers cannot forge them
create or replace function public.stamp_row() returns trigger
language plpgsql as $$
declare j jsonb := to_jsonb(new);
begin
  if tg_op = 'INSERT' then
    if j ? 'created_by' and auth.uid() is not null then new := jsonb_populate_record(new, jsonb_build_object('created_by', auth.uid())); end if;
    if j ? 'created_at' then new := jsonb_populate_record(new, jsonb_build_object('created_at', now())); end if;
  else
    if j ? 'created_by' then new := jsonb_populate_record(new, jsonb_build_object('created_by', to_jsonb(old) -> 'created_by')); end if;
    if j ? 'created_at' then new := jsonb_populate_record(new, jsonb_build_object('created_at', to_jsonb(old) -> 'created_at')); end if;
  end if;
  if j ? 'updated_at' then new := jsonb_populate_record(new, jsonb_build_object('updated_at', now())); end if;
  return new;
end $$;

-- Expenses: only admins approve, reject or pay out
create or replace function public.expenses_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare is_staff boolean := auth.uid() is null;   -- SQL editor / service role
begin
  if tg_op = 'INSERT' then
    if not (is_staff or public.is_admin()) then
      new.status := 'pending';
      new.approved_by := null;
      new.approved_at := null;
    end if;
  else
    if new.status is distinct from old.status and not (is_staff or public.is_admin()) then
      raise exception 'Only admins can approve, reject or pay out expenses' using errcode = '42501';
    end if;
    if not (is_staff or public.is_admin()) then
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
    end if;
  end if;
  if new.status in ('approved','reimbursed')
     and (tg_op = 'INSERT' or old.status not in ('approved','reimbursed')) then
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status = 'pending' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;

-- Tasks: record when work was finished
create or replace function public.tasks_done_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.done_at := now();
  elsif new.status <> 'done' then
    new.done_at := null;
  end if;
  return new;
end $$;

-- Profiles: only admins change roles/access; never remove the last admin
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.email is distinct from old.email then
      raise exception 'Only admins can change roles or access' using errcode = '42501';
    end if;
  end if;
  if old.role = 'admin' and old.active
     and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles
                     where role = 'admin' and active and id <> old.id) then
    raise exception 'The workspace needs at least one active admin' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Audit trail
create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r       jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  o       jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_act   text;
  v_det   jsonb := '{}'::jsonb;
  v_label text := coalesce(r ->> 'title', r ->> 'name', r ->> 'full_name', r ->> 'company', '');
begin
  if tg_op = 'INSERT' then
    v_act := 'created';
  elsif tg_op = 'DELETE' then
    v_act := 'deleted';
  elsif tg_table_name = 'profiles' and ((r ->> 'role') is distinct from (o ->> 'role') or (r ->> 'active') is distinct from (o ->> 'active')) then
    v_act := 'role';
    v_det := jsonb_build_object('from', o ->> 'role', 'to', r ->> 'role', 'active', (r ->> 'active')::boolean);
  elsif tg_table_name = 'profiles' then
    return null;  -- name edits are not worth a log line
  elsif (r ->> 'status') is distinct from (o ->> 'status') then
    v_act := 'status';
    v_det := jsonb_build_object('from', o ->> 'status', 'to', r ->> 'status');
  elsif tg_table_name = 'products' and (r ->> 'stock') is distinct from (o ->> 'stock') then
    v_act := 'stock';
    v_det := jsonb_build_object('from', (o ->> 'stock')::numeric, 'to', (r ->> 'stock')::numeric);
  else
    v_act := 'updated';
  end if;
  if tg_table_name = 'expenses' then
    v_det := v_det || jsonb_build_object('amount', (r ->> 'amount')::numeric);
  end if;
  insert into public.activity (actor, entity, entity_id, action, label, detail)
  values (auth.uid(), tg_table_name, coalesce(r ->> 'id', r ->> 'person_id'), v_act, v_label, v_det);
  return null;
end $$;

-- Attach triggers (drop first so re-running the file is clean)
do $$
declare t text;
begin
  foreach t in array array['people','people_private','expenses','tasks','products','workspace'] loop
    execute format('drop trigger if exists %I_stamp on public.%I', t, t);
    execute format('create trigger %I_stamp before insert or update on public.%I for each row execute function public.stamp_row()', t, t);
  end loop;
  foreach t in array array['people','expenses','tasks','products','workspace','profiles'] loop
    execute format('drop trigger if exists %I_log on public.%I', t, t);
    execute format('create trigger %I_log after insert or update or delete on public.%I for each row execute function public.log_activity()', t, t);
  end loop;
end $$;

drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard before insert or update on public.expenses
  for each row execute function public.expenses_guard();

drop trigger if exists tasks_done_at on public.tasks;
create trigger tasks_done_at before insert or update on public.tasks
  for each row execute function public.tasks_done_at();

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------
-- 5. Functions the app calls
-- ---------------------------------------------------------------------

-- Atomic stock change with a movement record (safe when two people
-- adjust the same product at once)
create or replace function public.adjust_stock(p_product uuid, p_delta numeric, p_reason text default null)
returns public.products
language plpgsql security definer set search_path = public as $$
declare r public.products;
begin
  if not public.can_write() then
    raise exception 'You do not have permission to change stock' using errcode = '42501';
  end if;
  if p_delta = 0 then
    select * into r from public.products where id = p_product;
    return r;
  end if;
  update public.products set stock = stock + p_delta where id = p_product returning * into r;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  insert into public.stock_movements (product_id, delta, balance, reason, created_by)
  values (p_product, p_delta, r.stock, nullif(trim(p_reason), ''), auth.uid());
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 6. Row-level security
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.workspace       enable row level security;
alter table public.people          enable row level security;
alter table public.people_private  enable row level security;
alter table public.expenses        enable row level security;
alter table public.tasks           enable row level security;
alter table public.products        enable row level security;
alter table public.stock_movements enable row level security;
alter table public.activity        enable row level security;

-- helper to drop a policy if it exists (keeps the file re-runnable)
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','workspace','people','people_private','expenses','tasks','products','stock_movements','activity')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- profiles: approved users see everyone; pending users see only themselves
create policy profiles_select on public.profiles for select to authenticated
  using (public.can_read() or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- workspace
create policy workspace_select on public.workspace for select to authenticated
  using (public.can_read());
create policy workspace_update on public.workspace for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- people directory: everyone approved reads, admins manage
create policy people_select on public.people for select to authenticated using (public.can_read());
create policy people_insert on public.people for insert to authenticated with check (public.is_admin());
create policy people_update on public.people for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy people_delete on public.people for delete to authenticated using (public.is_admin());

-- salaries and other HR fields: admins only
create policy people_private_all on public.people_private for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- expenses
create policy expenses_select on public.expenses for select to authenticated
  using (public.can_read() and (public.sees_all_expenses() or created_by = auth.uid()));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.can_write());
create policy expenses_update on public.expenses for update to authenticated
  using (public.is_admin() or (public.can_write() and created_by = auth.uid() and status = 'pending'))
  with check (public.is_admin() or (public.can_write() and created_by = auth.uid() and status = 'pending'));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.is_admin() or (public.can_write() and created_by = auth.uid() and status = 'pending'));

-- tasks: everyone approved reads; admins and members work on them
create policy tasks_select on public.tasks for select to authenticated using (public.can_read());
create policy tasks_insert on public.tasks for insert to authenticated with check (public.can_write());
create policy tasks_update on public.tasks for update to authenticated using (public.can_write()) with check (public.can_write());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_admin() or (public.can_write() and created_by = auth.uid()));

-- products
create policy products_select on public.products for select to authenticated using (public.can_read());
create policy products_insert on public.products for insert to authenticated with check (public.can_write());
create policy products_update on public.products for update to authenticated using (public.can_write()) with check (public.can_write());
create policy products_delete on public.products for delete to authenticated using (public.is_admin());

-- stock movements: read only (written by adjust_stock)
create policy stock_movements_select on public.stock_movements for select to authenticated using (public.can_read());

-- activity: read only (written by triggers); hides other people's
-- expense lines from members who can only see their own expenses
create policy activity_select on public.activity for select to authenticated
  using (public.can_read() and (entity <> 'expenses' or public.sees_all_expenses() or actor = auth.uid())
         and (entity <> 'profiles' or public.is_admin()));

-- ---------------------------------------------------------------------
-- 7. Grants (anon gets nothing; signed-in users go through RLS)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.people, public.people_private, public.expenses, public.tasks, public.products
  to authenticated;
grant select, update on public.profiles, public.workspace to authenticated;
grant select on public.stock_movements, public.activity to authenticated;
revoke execute on function public.adjust_stock(uuid, numeric, text) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text) to authenticated;
grant execute on function public.my_role(), public.is_admin(), public.can_read(), public.can_write(), public.sees_all_expenses() to authenticated;

-- ---------------------------------------------------------------------
-- 8. Receipts storage (private bucket)
--    Files live at receipts/<user id>/<expense id>/<file name>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

drop policy if exists receipts_read   on storage.objects;
drop policy if exists receipts_upload on storage.objects;
drop policy if exists receipts_delete on storage.objects;

create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.can_read()
         and (public.sees_all_expenses() or (storage.foldername(name))[1] = auth.uid()::text));
create policy receipts_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.can_write()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts'
         and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- ---------------------------------------------------------------------
-- 9. Realtime: push changes to every open browser (RLS still applies)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','workspace','people','people_private','expenses','tasks','products','activity'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
