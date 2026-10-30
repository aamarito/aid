-- =====================================================================
--  aamaritoaid — database schema for Supabase (Postgres 15+)   v2
--
--  Run this in Supabase: SQL Editor → New query → paste the whole file
--  → Run. It works on a new project AND upgrades an existing v1
--  database in place, keeping all your data. Safe to run again.
--
--  Companies
--    Every expense, task and product belongs to one company. People can
--    belong to one company or to the whole group. Each company has its own
--    expense categories, budgets, product categories and projects.
--    Seeded: aamarito (mother company), intivora, kukarz.
--
--  Roles (editable by admins in the app)
--    admin       everything; cannot be edited or deleted
--    management  default: approvals, all tasks/products/people
--    member      default: own expenses, tasks, products, directory
--    pending     "Waiting" — signed up, not approved: sees nothing
--    Admins can add more roles and tick/untick each permission.
--
--  The FIRST account that signs up becomes admin automatically.
--  All permissions are enforced here (row-level security + triggers).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Clear old triggers and helper functions so they can be replaced
--    (policies that use the helpers are dropped with them and rebuilt
--    in section 7)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists on_auth_user_created on auth.users';
  end if;
  foreach t in array array['profiles','workspace','people','people_private','expenses','tasks','products','companies','roles','role_permissions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I_stamp on public.%I', t, t);
      execute format('drop trigger if exists %I_log on public.%I', t, t);
      execute format('drop trigger if exists %I_guard on public.%I', t, t);
    end if;
  end loop;
  if to_regclass('public.tasks') is not null then
    execute 'drop trigger if exists tasks_done_at on public.tasks';
  end if;
end $$;

drop function if exists public.my_role() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.can_read() cascade;
drop function if exists public.can_write() cascade;
drop function if exists public.sees_all_expenses() cascade;
drop function if exists public.has_perm(text) cascade;
drop function if exists public.can_company(uuid) cascade;

-- ---------------------------------------------------------------------
-- 1. Roles and permissions
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label        text not null check (length(trim(label)) > 0),
  description  text not null default '',
  sort         int  not null default 50,
  system       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

insert into public.roles (key, label, description, sort, system) values
  ('admin',      'Admin',      'Full control of every company, setting and person', 1,  true),
  ('management', 'Management', 'Runs the business day to day and approves expenses', 2,  false),
  ('member',     'Member',     'Logs own expenses, works on tasks and products',     3,  false),
  ('pending',    'Waiting',    'Signed up, waiting for approval: sees nothing',      99, true)
on conflict (key) do nothing;

-- One row = this role has this permission. Admin always has every
-- permission; Waiting never has any. Permission keys:
--   expenses.view      use Expenses and see own claims
--   expenses.create    log new expenses
--   expenses.view_all  see everyone's expenses
--   expenses.approve   approve, reject, pay out
--   expenses.manage    edit or delete anyone's expenses
--   tasks.view / tasks.edit / tasks.delete
--   products.view / products.edit (incl. stock) / products.delete
--   people.view / people.manage / people.hr (salary, NID, bank)
--   reports.export     download CSV files
--   users.manage       approve sign-ups, change roles and company access
--   settings.manage    companies, categories, budgets, options
create table if not exists public.role_permissions (
  role_key  text not null references public.roles (key) on update cascade on delete cascade,
  perm      text not null check (perm ~ '^[a-z_]+\.[a-z_]+$'),
  primary key (role_key, perm)
);

insert into public.role_permissions (role_key, perm)
select 'management', p from unnest(array[
  'expenses.view','expenses.create','expenses.view_all','expenses.approve',
  'tasks.view','tasks.edit','tasks.delete',
  'products.view','products.edit','products.delete',
  'people.view','people.manage','reports.export']) p
where not exists (select 1 from public.role_permissions where role_key = 'management')
on conflict do nothing;

insert into public.role_permissions (role_key, perm)
select 'member', p from unnest(array[
  'expenses.view','expenses.create','tasks.view','tasks.edit',
  'products.view','products.edit','people.view']) p
where not exists (select 1 from public.role_permissions where role_key = 'member')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Accounts
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  full_name    text not null default '',
  role         text not null default 'pending',
  active       boolean not null default true,
  company_ids  uuid[] not null default '{}',     -- empty = all companies
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- upgrade from v1: role was an enum with a 'viewer' value
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles'
               and column_name = 'role' and udt_name = 'app_role') then
    alter table public.profiles alter column role drop default;
    alter table public.profiles alter column role type text using role::text;
    update public.profiles set role = 'member' where role = 'viewer';
  end if;
end $$;
alter table public.profiles alter column role set default 'pending';
alter table public.profiles add column if not exists company_ids uuid[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_fkey') then
    alter table public.profiles add constraint profiles_role_fkey
      foreign key (role) references public.roles (key) on update cascade on delete restrict;
  end if;
end $$;
drop type if exists public.app_role;

-- ---------------------------------------------------------------------
-- 3. Group settings and companies
-- ---------------------------------------------------------------------
create table if not exists public.workspace (
  id          smallint primary key default 1 check (id = 1),
  company     text not null default 'aamarito group',
  currency    text not null default '৳',
  updated_at  timestamptz not null default now()
);
insert into public.workspace (id) values (1) on conflict (id) do nothing;
alter table public.workspace add column if not exists departments      text[] not null default array['Management','Operations','Sales','Marketing','Finance','Production','Warehouse','HR'];
alter table public.workspace add column if not exists payment_methods  text[] not null default array['Cash','bKash','Nagad','Rocket','Bank transfer','Card','Cheque'];
alter table public.workspace add column if not exists units            text[] not null default array['pcs','pair','set','box','pack','kg','g','litre','ml','metre','dozen'];
alter table public.workspace add column if not exists employment_types text[] not null default array['Full-time','Part-time','Contract','Intern','Freelance'];
-- v1 columns kept for upgrades; v2 keeps these per company instead
alter table public.workspace add column if not exists expense_categories text[];
alter table public.workspace add column if not exists budgets            jsonb;
alter table public.workspace add column if not exists product_categories text[];
alter table public.workspace add column if not exists projects           text[];
update public.workspace set company = 'aamarito group' where company = 'aamaritoaid';

create table if not exists public.companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) > 0),
  industry            text not null default '',
  description         text not null default '',
  color               text not null default '#0A7670' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_parent           boolean not null default false,
  active              boolean not null default true,
  sort                int not null default 10,
  expense_categories  text[] not null default array['Office & rent','Travel & transport','Meals','Software','Marketing','Utilities','Salaries','Equipment','Other'],
  budgets             jsonb not null default '{}'::jsonb,
  product_categories  text[] not null default array['General'],
  projects            text[] not null default array['General'],
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists companies_name_unique on public.companies (lower(name));

-- seed the three companies once; aamarito inherits any v1 settings
do $$
declare w record;
begin
  if not exists (select 1 from public.companies) then
    select * into w from public.workspace where id = 1;
    insert into public.companies (name, industry, description, color, is_parent, sort, expense_categories, budgets, product_categories, projects) values
      ('aamarito', 'Leather goods', 'Mother company: leather bags, wallets, belts, footwear and accessories', '#8A5A2B', true, 1,
        coalesce(w.expense_categories, array['Raw leather','Production','Packaging','Shipping & courier','Marketing','Office & rent','Salaries','Utilities','Travel & transport','Other']),
        coalesce(w.budgets, '{}'::jsonb),
        case when w.product_categories is null or w.product_categories = array['General'] then array['Bags','Wallets','Belts','Footwear','Jackets','Accessories'] else w.product_categories end,
        coalesce(w.projects, array['General'])),
      ('intivora', 'Health & wellness', 'Health and wellness products', '#2E7D5B', false, 2,
        array['Product sourcing','Packaging','Shipping & courier','Marketing','Licences & compliance','Office & rent','Salaries','Utilities','Other'],
        '{}'::jsonb, array['Supplements','Personal care','Fitness','Herbal & natural','Health devices'], array['General']),
      ('kukarz', 'Kitchenware & home', 'Kitchenware and home items', '#C2571A', false, 3,
        array['Product sourcing','Packaging','Shipping & courier','Marketing','Warehouse','Office & rent','Salaries','Utilities','Other'],
        '{}'::jsonb, array['Cookware','Kitchen tools','Storage & containers','Tableware','Home décor','Cleaning'], array['General']);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Business records
-- ---------------------------------------------------------------------
create table if not exists public.people (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references public.companies (id) on delete restrict,   -- null = whole group
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
  company_id    uuid references public.companies (id) on delete restrict,
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
  company_id   uuid references public.companies (id) on delete restrict,
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
  company_id     uuid references public.companies (id) on delete restrict,
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

create table if not exists public.stock_movements (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products (id) on delete cascade,
  delta       numeric(14,3) not null,
  balance     numeric(14,3) not null,
  reason      text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.activity (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid references public.profiles (id) on delete set null,
  entity      text not null,
  entity_id   text,
  action      text not null,
  label       text,
  detail      jsonb not null default '{}'::jsonb,
  company_id  uuid references public.companies (id) on delete set null
);

-- upgrade from v1: add company to existing records (all go to aamarito)
alter table public.people   add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.expenses add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.tasks    add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.products add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.activity add column if not exists company_id uuid references public.companies (id) on delete set null;
do $$
declare parent uuid;
begin
  select id into parent from public.companies order by is_parent desc, sort, created_at limit 1;
  update public.expenses set company_id = parent where company_id is null;
  update public.tasks    set company_id = parent where company_id is null;
  update public.products set company_id = parent where company_id is null;
end $$;
alter table public.expenses alter column company_id set not null;
alter table public.tasks    alter column company_id set not null;
alter table public.products alter column company_id set not null;

create index if not exists expenses_company_idx    on public.expenses (company_id, spent_on desc);
create index if not exists expenses_created_by_idx on public.expenses (created_by);
create index if not exists expenses_person_idx     on public.expenses (person_id);
create index if not exists expenses_status_idx     on public.expenses (status);
create index if not exists tasks_company_idx       on public.tasks (company_id);
create index if not exists tasks_assignee_idx      on public.tasks (assignee_id);
create index if not exists tasks_due_idx           on public.tasks (due);
create index if not exists products_company_idx    on public.products (company_id);
create index if not exists people_company_idx      on public.people (company_id);
create index if not exists people_manager_idx      on public.people (manager_id);
create index if not exists people_profile_idx      on public.people (profile_id);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists activity_at_idx         on public.activity (at desc);

-- ---------------------------------------------------------------------
-- 5. Permission helpers (security definer: they read profiles and
--    role_permissions without recursing into those tables' policies)
-- ---------------------------------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.active then p.role else 'pending' end from public.profiles p where p.id = auth.uid()),
    'pending')
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin'
$$;

create or replace function public.can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() <> 'pending'
$$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin'
      or (public.my_role() <> 'pending'
          and exists (select 1 from public.role_permissions rp
                      where rp.role_key = public.my_role() and rp.perm = p))
$$;

-- Can the current user work with this company? (null = group-wide record)
create or replace function public.can_company(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select cid is null
      or public.my_role() = 'admin'
      or exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.active
                   and (cardinality(p.company_ids) = 0 or cid = any (p.company_ids)))
$$;

-- ---------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------

-- New login account → profile. First account becomes admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when exists (select 1 from public.profiles where role = 'admin') then 'pending' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
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

-- Expenses: approval needs expenses.approve; editing someone else's
-- claim needs expenses.manage (approvers may only change the status)
create or replace function public.expenses_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  staff boolean := auth.uid() is null;          -- SQL editor / service role
  skip  text[]  := array['status','approved_by','approved_at','updated_at'];
begin
  if tg_op = 'INSERT' then
    if not (staff or public.has_perm('expenses.approve')) then
      new.status := 'pending'; new.approved_by := null; new.approved_at := null;
    end if;
  else
    if not staff then
      if new.status is distinct from old.status and not public.has_perm('expenses.approve') then
        raise exception 'You don''t have permission to approve, reject or pay out expenses' using errcode = '42501';
      end if;
      if not public.has_perm('expenses.manage')
         and not (old.created_by = auth.uid() and old.status = 'pending')
         and (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip) then
        raise exception 'You can only change the status of this expense' using errcode = '42501';
      end if;
      if not public.has_perm('expenses.approve') then
        new.approved_by := old.approved_by; new.approved_at := old.approved_at;
      end if;
    end if;
  end if;
  if new.status in ('approved','reimbursed')
     and (tg_op = 'INSERT' or old.status not in ('approved','reimbursed')) then
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif new.status = 'pending' then
    new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;

create or replace function public.tasks_done_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.done_at := now();
  elsif new.status <> 'done' then new.done_at := null; end if;
  return new;
end $$;

-- Accounts: role/access changes need users.manage; only admins grant or
-- remove admin; nobody but an admin changes their own access; the group
-- always keeps one active admin
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role is distinct from old.role or new.active is distinct from old.active
          or new.company_ids is distinct from old.company_ids or new.email is distinct from old.email) then
    if not public.has_perm('users.manage') then
      raise exception 'You don''t have permission to change roles or access' using errcode = '42501';
    end if;
    if old.id = auth.uid() then
      raise exception 'You can''t change your own role or access' using errcode = '42501';
    end if;
    if old.role = 'admin' or new.role = 'admin' then
      raise exception 'Only admins can give or remove the admin role' using errcode = '42501';
    end if;
  end if;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'The workspace needs at least one active admin' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Roles: built-in roles keep their key; nobody creates system roles
create or replace function public.roles_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.key <> old.key then raise exception 'A role''s key can''t change' using errcode = '42501'; end if;
    if new.system <> old.system then raise exception 'Built-in roles can''t be changed that way' using errcode = '42501'; end if;
  elsif tg_op = 'INSERT' and new.system and auth.uid() is not null then
    raise exception 'New roles can''t be built-in' using errcode = '42501';
  elsif tg_op = 'DELETE' then
    if old.system then raise exception 'Admin and Waiting can''t be deleted' using errcode = '42501'; end if;
    if exists (select 1 from public.profiles where role = old.key) then
      raise exception 'Move everyone off this role before deleting it' using errcode = '42501';
    end if;
    return old;
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
  v_label text := coalesce(r ->> 'title', r ->> 'name', r ->> 'full_name', r ->> 'label', '');
  v_cid   uuid := nullif(r ->> 'company_id', '')::uuid;
begin
  if tg_table_name = 'role_permissions' then
    v_label := (r ->> 'role_key') || ': ' || (r ->> 'perm');
  elsif tg_table_name = 'companies' then
    v_cid := (r ->> 'id')::uuid;
  end if;
  if tg_op = 'INSERT' then v_act := 'created';
  elsif tg_op = 'DELETE' then v_act := 'deleted';
  elsif tg_table_name = 'profiles' then
    if (r ->> 'role') is distinct from (o ->> 'role') or (r ->> 'active') is distinct from (o ->> 'active')
       or (r -> 'company_ids') is distinct from (o -> 'company_ids') then
      v_act := 'role';
      v_det := jsonb_build_object('from', o ->> 'role', 'to', r ->> 'role', 'active', (r ->> 'active')::boolean);
    else
      return null;
    end if;
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
  insert into public.activity (actor, entity, entity_id, action, label, detail, company_id)
  values (auth.uid(), tg_table_name, coalesce(r ->> 'id', r ->> 'person_id', r ->> 'key', r ->> 'role_key'), v_act, v_label, v_det, v_cid);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['people','people_private','expenses','tasks','products','workspace','companies'] loop
    execute format('create trigger %I_stamp before insert or update on public.%I for each row execute function public.stamp_row()', t, t);
  end loop;
  foreach t in array array['people','expenses','tasks','products','workspace','profiles','companies','roles','role_permissions'] loop
    execute format('create trigger %I_log after insert or update or delete on public.%I for each row execute function public.log_activity()', t, t);
  end loop;
end $$;
create trigger expenses_guard before insert or update on public.expenses for each row execute function public.expenses_guard();
create trigger tasks_done_at  before insert or update on public.tasks    for each row execute function public.tasks_done_at();
create trigger profiles_guard before update on public.profiles           for each row execute function public.profiles_guard();
create trigger roles_guard    before insert or update or delete on public.roles for each row execute function public.roles_guard();

-- Atomic stock change with a movement record
create or replace function public.adjust_stock(p_product uuid, p_delta numeric, p_reason text default null)
returns public.products
language plpgsql security definer set search_path = public as $$
declare r public.products;
begin
  select * into r from public.products where id = p_product;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if not (public.has_perm('products.edit') and public.can_company(r.company_id)) then
    raise exception 'You don''t have permission to change stock' using errcode = '42501';
  end if;
  if p_delta = 0 then return r; end if;
  update public.products set stock = stock + p_delta where id = p_product returning * into r;
  insert into public.stock_movements (product_id, delta, balance, reason, created_by)
  values (p_product, p_delta, r.stock, nullif(trim(p_reason), ''), auth.uid());
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 7. Row-level security
-- ---------------------------------------------------------------------
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles         enable row level security;
alter table public.workspace        enable row level security;
alter table public.companies        enable row level security;
alter table public.people           enable row level security;
alter table public.people_private   enable row level security;
alter table public.expenses         enable row level security;
alter table public.tasks            enable row level security;
alter table public.products         enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.activity         enable row level security;

do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('roles','role_permissions','profiles','workspace','companies','people','people_private','expenses','tasks','products','stock_movements','activity')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- roles & permissions: everyone signed in reads; admins edit
create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_insert on public.roles for insert to authenticated with check (public.is_admin());
create policy roles_update on public.roles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy roles_delete on public.roles for delete to authenticated using (public.is_admin() and not system);

create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (public.is_admin() and role_key not in ('admin','pending'));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (public.is_admin() and role_key not in ('admin','pending'));

-- accounts
create policy profiles_select on public.profiles for select to authenticated
  using (public.can_read() or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_perm('users.manage'))
  with check (id = auth.uid() or public.has_perm('users.manage'));

-- group settings & companies
create policy workspace_select on public.workspace for select to authenticated using (public.can_read());
create policy workspace_update on public.workspace for update to authenticated
  using (public.has_perm('settings.manage')) with check (public.has_perm('settings.manage'));

create policy companies_select on public.companies for select to authenticated
  using (public.can_read() and public.can_company(id));
create policy companies_insert on public.companies for insert to authenticated with check (public.has_perm('settings.manage'));
create policy companies_update on public.companies for update to authenticated
  using (public.has_perm('settings.manage') and public.can_company(id))
  with check (public.has_perm('settings.manage'));
create policy companies_delete on public.companies for delete to authenticated using (public.is_admin());

-- people
create policy people_select on public.people for select to authenticated
  using (public.has_perm('people.view') and public.can_company(company_id));
create policy people_insert on public.people for insert to authenticated
  with check (public.has_perm('people.manage') and public.can_company(company_id));
create policy people_update on public.people for update to authenticated
  using (public.has_perm('people.manage') and public.can_company(company_id))
  with check (public.has_perm('people.manage') and public.can_company(company_id));
create policy people_delete on public.people for delete to authenticated
  using (public.has_perm('people.manage') and public.can_company(company_id));

create policy people_private_all on public.people_private for all to authenticated
  using (public.has_perm('people.hr')) with check (public.has_perm('people.hr'));

-- expenses
create policy expenses_select on public.expenses for select to authenticated
  using (public.can_company(company_id) and (
    public.has_perm('expenses.view_all') or public.has_perm('expenses.approve') or public.has_perm('expenses.manage')
    or (created_by = auth.uid() and public.has_perm('expenses.view'))));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.has_perm('expenses.create') and public.can_company(company_id));
create policy expenses_update on public.expenses for update to authenticated
  using (public.can_company(company_id) and (
    public.has_perm('expenses.manage') or public.has_perm('expenses.approve')
    or (created_by = auth.uid() and status = 'pending' and public.has_perm('expenses.create'))))
  with check (public.can_company(company_id) and (
    public.has_perm('expenses.manage') or public.has_perm('expenses.approve')
    or (created_by = auth.uid() and public.has_perm('expenses.create'))));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.can_company(company_id) and (
    public.has_perm('expenses.manage')
    or (created_by = auth.uid() and status = 'pending' and public.has_perm('expenses.create'))));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (public.has_perm('tasks.view') and public.can_company(company_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_perm('tasks.edit') and public.can_company(company_id));
create policy tasks_update on public.tasks for update to authenticated
  using (public.has_perm('tasks.edit') and public.can_company(company_id))
  with check (public.has_perm('tasks.edit') and public.can_company(company_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.can_company(company_id) and (public.has_perm('tasks.delete')
         or (created_by = auth.uid() and public.has_perm('tasks.edit'))));

-- products
create policy products_select on public.products for select to authenticated
  using (public.has_perm('products.view') and public.can_company(company_id));
create policy products_insert on public.products for insert to authenticated
  with check (public.has_perm('products.edit') and public.can_company(company_id));
create policy products_update on public.products for update to authenticated
  using (public.has_perm('products.edit') and public.can_company(company_id))
  with check (public.has_perm('products.edit') and public.can_company(company_id));
create policy products_delete on public.products for delete to authenticated
  using (public.has_perm('products.delete') and public.can_company(company_id));

create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.has_perm('products.view'));

-- audit trail: read only, filtered by company and by what you may see
create policy activity_select on public.activity for select to authenticated
  using (public.can_read() and public.can_company(company_id) and (
    case entity
      when 'expenses' then public.has_perm('expenses.view_all') or public.has_perm('expenses.approve')
                        or public.has_perm('expenses.manage') or actor = auth.uid()
      when 'people' then public.has_perm('people.view')
      when 'tasks' then public.has_perm('tasks.view')
      when 'products' then public.has_perm('products.view')
      when 'profiles' then public.has_perm('users.manage')
      when 'roles' then public.has_perm('users.manage')
      when 'role_permissions' then public.has_perm('users.manage')
      else true
    end));

-- ---------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.people, public.people_private, public.expenses, public.tasks, public.products,
  public.companies, public.roles, public.role_permissions
  to authenticated;
grant select, update on public.profiles, public.workspace to authenticated;
grant select on public.stock_movements, public.activity to authenticated;
revoke execute on function public.adjust_stock(uuid, numeric, text) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text) to authenticated;
grant execute on function public.my_role(), public.is_admin(), public.can_read(), public.has_perm(text), public.can_company(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Receipts storage (private bucket): receipts/<user id>/<expense id>/<file>
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
         and (public.has_perm('expenses.view_all') or public.has_perm('expenses.approve') or public.has_perm('expenses.manage')
              or (storage.foldername(name))[1] = auth.uid()::text));
create policy receipts_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.has_perm('expenses.create')
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts'
         and (public.has_perm('expenses.manage') or (storage.foldername(name))[1] = auth.uid()::text));

-- ---------------------------------------------------------------------
-- 10. Realtime: push changes to every open browser (RLS still applies)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','workspace','companies','roles','role_permissions','people','people_private','expenses','tasks','products','activity'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
