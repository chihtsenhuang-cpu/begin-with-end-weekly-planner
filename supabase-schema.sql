create extension if not exists pgcrypto;

create table if not exists public.weekly_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  plan jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.weekly_plans enable row level security;

drop policy if exists "Users can read their own weekly plans" on public.weekly_plans;
create policy "Users can read their own weekly plans"
on public.weekly_plans
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own weekly plans" on public.weekly_plans;
create policy "Users can insert their own weekly plans"
on public.weekly_plans
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own weekly plans" on public.weekly_plans;
create policy "Users can update their own weekly plans"
on public.weekly_plans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own weekly plans" on public.weekly_plans;
create policy "Users can delete their own weekly plans"
on public.weekly_plans
for delete
to authenticated
using (auth.uid() = user_id);

create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text,
  name text not null,
  current_stage text not null default '尚未聯絡',
  location text,
  category text,
  birthday date,
  occupation text,
  pretax_income text,
  policies text,
  policy_status text,
  background text,
  next_step text,
  next_follow_up_date date,
  notes text,
  legacy_visit_count integer,
  source_raw jsonb not null default '{}'::jsonb,
  last_contact_date date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create table if not exists public.crm_account_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  product_type text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, account_id, product_type)
);

create table if not exists public.crm_visit_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  contact_date date not null,
  method text not null default '面訪',
  summary text,
  result text,
  next_step text,
  next_follow_up_date date,
  stage_after text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.crm_stage_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  stage text not null,
  changed_at date not null default current_date,
  source text not null default 'manual',
  visit_id uuid references public.crm_visit_records(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null default 'csv',
  source_name text,
  source_url text,
  sheet_name text,
  row_count integer not null default 0,
  status text not null default 'imported',
  imported_at timestamptz not null default now()
);

create table if not exists public.crm_import_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.crm_import_batches(id) on delete cascade,
  row_number integer not null,
  account_id uuid references public.crm_accounts(id) on delete set null,
  raw_data jsonb not null default '{}'::jsonb,
  import_status text not null default 'imported',
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists crm_accounts_user_stage_idx
on public.crm_accounts (user_id, current_stage);

create index if not exists crm_accounts_user_follow_up_idx
on public.crm_accounts (user_id, next_follow_up_date);

create index if not exists crm_account_products_user_account_idx
on public.crm_account_products (user_id, account_id);

create index if not exists crm_visit_records_user_account_idx
on public.crm_visit_records (user_id, account_id, contact_date desc);

create index if not exists crm_stage_history_user_stage_idx
on public.crm_stage_history (user_id, stage, changed_at desc);

create index if not exists crm_import_rows_batch_idx
on public.crm_import_rows (batch_id, row_number);

alter table public.crm_accounts enable row level security;
alter table public.crm_account_products enable row level security;
alter table public.crm_visit_records enable row level security;
alter table public.crm_stage_history enable row level security;
alter table public.crm_import_batches enable row level security;
alter table public.crm_import_rows enable row level security;

drop policy if exists "Users can read their own CRM accounts" on public.crm_accounts;
create policy "Users can read their own CRM accounts"
on public.crm_accounts
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own CRM accounts" on public.crm_accounts;
create policy "Users can insert their own CRM accounts"
on public.crm_accounts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own CRM accounts" on public.crm_accounts;
create policy "Users can update their own CRM accounts"
on public.crm_accounts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own CRM accounts" on public.crm_accounts;
create policy "Users can delete their own CRM accounts"
on public.crm_accounts
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read their own CRM account products" on public.crm_account_products;
create policy "Users can read their own CRM account products"
on public.crm_account_products
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own CRM account products" on public.crm_account_products;
create policy "Users can insert their own CRM account products"
on public.crm_account_products
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own CRM account products" on public.crm_account_products;
create policy "Users can update their own CRM account products"
on public.crm_account_products
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own CRM account products" on public.crm_account_products;
create policy "Users can delete their own CRM account products"
on public.crm_account_products
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read their own CRM visit records" on public.crm_visit_records;
create policy "Users can read their own CRM visit records"
on public.crm_visit_records
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own CRM visit records" on public.crm_visit_records;
create policy "Users can insert their own CRM visit records"
on public.crm_visit_records
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own CRM visit records" on public.crm_visit_records;
create policy "Users can update their own CRM visit records"
on public.crm_visit_records
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own CRM visit records" on public.crm_visit_records;
create policy "Users can delete their own CRM visit records"
on public.crm_visit_records
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read their own CRM stage history" on public.crm_stage_history;
create policy "Users can read their own CRM stage history"
on public.crm_stage_history
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own CRM stage history" on public.crm_stage_history;
create policy "Users can insert their own CRM stage history"
on public.crm_stage_history
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own CRM stage history" on public.crm_stage_history;
create policy "Users can update their own CRM stage history"
on public.crm_stage_history
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own CRM stage history" on public.crm_stage_history;
create policy "Users can delete their own CRM stage history"
on public.crm_stage_history
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read their own CRM import batches" on public.crm_import_batches;
create policy "Users can read their own CRM import batches"
on public.crm_import_batches
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own CRM import batches" on public.crm_import_batches;
create policy "Users can insert their own CRM import batches"
on public.crm_import_batches
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own CRM import batches" on public.crm_import_batches;
create policy "Users can update their own CRM import batches"
on public.crm_import_batches
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own CRM import batches" on public.crm_import_batches;
create policy "Users can delete their own CRM import batches"
on public.crm_import_batches
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read their own CRM import rows" on public.crm_import_rows;
create policy "Users can read their own CRM import rows"
on public.crm_import_rows
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own CRM import rows" on public.crm_import_rows;
create policy "Users can insert their own CRM import rows"
on public.crm_import_rows
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own CRM import rows" on public.crm_import_rows;
create policy "Users can update their own CRM import rows"
on public.crm_import_rows
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own CRM import rows" on public.crm_import_rows;
create policy "Users can delete their own CRM import rows"
on public.crm_import_rows
for delete
to authenticated
using (auth.uid() = user_id);
