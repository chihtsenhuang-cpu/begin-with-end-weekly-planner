create table if not exists public.weekly_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  plan jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.weekly_plans enable row level security;

create policy "Users can read their own weekly plans"
on public.weekly_plans
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own weekly plans"
on public.weekly_plans
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own weekly plans"
on public.weekly_plans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own weekly plans"
on public.weekly_plans
for delete
to authenticated
using (auth.uid() = user_id);
