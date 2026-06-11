-- 桿弟 agent：playbook 儲存表
-- 在 Supabase SQL Editor 執行一次（與 supabase-schema.sql 同一個專案）

create table if not exists public.caddie_playbooks (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

alter table public.caddie_playbooks enable row level security;

drop policy if exists "Users can read their own caddie playbooks" on public.caddie_playbooks;
create policy "Users can read their own caddie playbooks"
on public.caddie_playbooks
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own caddie playbooks" on public.caddie_playbooks;
create policy "Users can insert their own caddie playbooks"
on public.caddie_playbooks
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own caddie playbooks" on public.caddie_playbooks;
create policy "Users can update their own caddie playbooks"
on public.caddie_playbooks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own caddie playbooks" on public.caddie_playbooks;
create policy "Users can delete their own caddie playbooks"
on public.caddie_playbooks
for delete
to authenticated
using (auth.uid() = user_id);
