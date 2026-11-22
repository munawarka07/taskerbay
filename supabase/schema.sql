-- =====================================================================
-- TaskerBay database schema (Supabase / PostgreSQL)
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- People & workspaces ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text not null default '',
  avatar_url  text,
  timezone    text not null default 'Asia/Dubai',
  created_at  timestamptz not null default now()
);

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon        text not null default '🏠',
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','admin','member')),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,
  role         text not null default 'member' check (role in ('admin','member')),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, email)
);

-- ---------- Workflows, tasks & updates ----------
-- stages: [{ "key":"todo", "name":"To do", "color":"#64748B", "type":"todo|active|done" }, ...]
create table if not exists public.workflows (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  icon         text not null default '🔀',
  stages       jsonb not null,
  is_default   boolean not null default false,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id    uuid references public.tasks(id) on delete cascade,   -- steps nest to any depth
  workflow_id  uuid references public.workflows(id) on delete set null,
  stage        text not null default 'todo',
  title        text not null,
  notes        text not null default '',
  area         text not null default 'Personal',
  priority     text not null default 'Medium' check (priority in ('High','Medium','Low')),
  due_date     date,
  due_time     time,
  start_date   date,
  estimate_min int,
  repeat       text not null default '' check (repeat in ('','daily','weekdays','weekly','monthly')),
  starred      boolean not null default false,
  assignee_id  uuid references auth.users(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  position     double precision not null default 0,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_ws_idx      on public.tasks(workspace_id);
create index if not exists tasks_parent_idx  on public.tasks(parent_id);
create index if not exists tasks_due_idx     on public.tasks(workspace_id, due_date);
create index if not exists tasks_assignee_idx on public.tasks(assignee_id);

-- Status updates, comments and the automatic activity log
create table if not exists public.task_updates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id      uuid not null references public.tasks(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null default auth.uid(),
  kind         text not null default 'comment' check (kind in ('comment','status','system')),
  body         text not null default '',
  from_stage   text,
  to_stage     text,
  created_at   timestamptz not null default now()
);
create index if not exists task_updates_task_idx on public.task_updates(task_id, created_at);
create index if not exists task_updates_ws_idx   on public.task_updates(workspace_id, created_at desc);

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  task_id      uuid references public.tasks(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null default auth.uid(),
  body         text not null,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, read, created_at desc);

-- Automations: "When <trigger> (and <conditions>) then <actions>"
-- trigger:    task_created | stage_changed | all_steps_done | overdue | assigned
-- conditions: { "to_stage": "...", "area": "...", "priority": "...", "workflow_id": "..." }
-- actions:    [ { "type": "set_stage|set_priority|assign|set_due_in_days|star|add_steps|comment|notify|set_workflow|advance_parent", "value": ... } ]
create table if not exists public.automations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  enabled      boolean not null default true,
  trigger      text not null,
  conditions   jsonb not null default '{}'::jsonb,
  actions      jsonb not null default '[]'::jsonb,
  run_count    int not null default 0,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

-- ---------- Personal: routine, journal, focus, money ----------
create table if not exists public.routine_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null,
  icon        text not null default '✅',
  time_of_day time,                                   -- null = any time
  days        int[] not null default '{0,1,2,3,4,5,6}', -- 0 = Sunday
  position    int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create table if not exists public.routine_logs (
  item_id   uuid not null references public.routine_items(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade default auth.uid(),
  day       date not null,
  primary key (item_id, day)
);

create table if not exists public.journal (
  user_id  uuid not null references auth.users(id) on delete cascade default auth.uid(),
  day      date not null,
  mood     int check (mood between 0 and 4),
  win      text not null default '',
  note     text not null default '',
  primary key (user_id, day)
);

create table if not exists public.focus_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  task_id    uuid references public.tasks(id) on delete set null,
  minutes    int not null default 25,
  day        date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title      text not null,
  amount     numeric(12,2) not null check (amount >= 0),
  flow       text not null default 'out' check (flow in ('out','in')),
  category   text not null default 'Other',
  date       date not null default current_date,
  paid_by    text not null default 'Card',
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists expenses_user_date_idx on public.expenses(user_id, date desc);

create table if not exists public.budgets (
  user_id   uuid not null references auth.users(id) on delete cascade default auth.uid(),
  category  text not null,
  amount    numeric(12,2) not null check (amount > 0),
  primary key (user_id, category)
);

-- =====================================================================
-- Helper functions
-- =====================================================================
create or replace function public.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_admin(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role in ('owner','admin'));
$$;

-- Two people share a workspace (lets teammates see each other's names)
create or replace function public.shares_workspace(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members a join workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();


-- Default workflows, automations and routine for a new workspace / user
create or replace function public.seed_workspace(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from workflows where workspace_id = ws) then return; end if;
  insert into workflows (workspace_id, name, icon, is_default, position, stages) values
  (ws, 'Simple', '✅', true, 0, '[{"key":"todo","name":"To do","color":"#64748B","type":"todo"},{"key":"doing","name":"In progress","color":"#3B6FD4","type":"active"},{"key":"waiting","name":"Waiting","color":"#E39B2D","type":"active"},{"key":"done","name":"Done","color":"#2E9B5B","type":"done"}]'),
  (ws, 'Approval', '🖊️', false, 1, '[{"key":"draft","name":"Draft","color":"#64748B","type":"todo"},{"key":"review","name":"In review","color":"#8B5CF6","type":"active"},{"key":"approved","name":"Approved","color":"#0E9AA7","type":"active"},{"key":"done","name":"Done","color":"#2E9B5B","type":"done"}]'),
  (ws, 'Payroll cycle', '💰', false, 2, '[{"key":"inputs","name":"Collect inputs","color":"#64748B","type":"todo"},{"key":"validate","name":"Validate","color":"#3B6FD4","type":"active"},{"key":"approval","name":"Approval","color":"#8B5CF6","type":"active"},{"key":"bankfile","name":"Bank file","color":"#E39B2D","type":"active"},{"key":"payslips","name":"Payslips","color":"#0E9AA7","type":"active"},{"key":"done","name":"Done","color":"#2E9B5B","type":"done"}]');
  insert into automations (workspace_id, name, trigger, conditions, actions) values
  (ws, 'Finish a task when all its steps are done', 'all_steps_done', '{}', '[{"type":"set_stage","value":"done"}]'),
  (ws, 'Overdue tasks become High priority and starred', 'overdue', '{}', '[{"type":"set_priority","value":"High"},{"type":"star","value":true}]'),
  (ws, 'Tell everyone when something needs review', 'stage_changed', '{"to_stage":"review"}', '[{"type":"notify","value":"workspace","message":"needs your review"}]');
end $$;

create or replace function public.seed_user_routine(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from routine_items where user_id = uid) then return; end if;
  insert into routine_items (user_id, name, icon, time_of_day, days, position) values
  (uid, 'Fajr & morning walk', '🌅', '05:30', '{0,1,2,3,4,5,6}', 0),
  (uid, 'Plan the day', '🗓️', '08:00', '{0,1,2,3,4,5,6}', 1),
  (uid, 'Workout', '💪', '18:30', '{0,1,2,3,4}', 2),
  (uid, 'Arabic practice', '🗣️', '20:00', '{0,1,2,3,4,5,6}', 3),
  (uid, 'Read 20 min', '📖', '22:00', '{0,1,2,3,4,5,6}', 4);
end $$;

-- New sign-up: create profile, a personal workspace, and accept any pending invites
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), coalesce(new.email, ''))
  on conflict (id) do nothing;

  insert into workspaces (name, icon, owner_id) values ('Personal', '🏠', new.id) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');
  perform seed_workspace(ws);
  perform seed_user_routine(new.id);

  insert into workspace_members (workspace_id, user_id, role)
    select i.workspace_id, new.id, i.role from workspace_invites i where lower(i.email) = lower(new.email)
  on conflict do nothing;
  delete from workspace_invites where lower(email) = lower(new.email);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing users accept invites the next time they open the app
create or replace function public.accept_my_invites()
returns int language plpgsql security definer set search_path = public as $$
declare n int; my_email text;
begin
  select email into my_email from auth.users where id = auth.uid();
  insert into workspace_members (workspace_id, user_id, role)
    select i.workspace_id, auth.uid(), i.role from workspace_invites i where lower(i.email) = lower(my_email)
  on conflict do nothing;
  get diagnostics n = row_count;
  delete from workspace_invites where lower(email) = lower(my_email);
  return n;
end $$;

-- Create a shared workspace and become its owner in one call
create or replace function public.create_workspace(ws_name text, ws_icon text default '👥')
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into workspaces (name, icon, owner_id) values (ws_name, coalesce(ws_icon, '👥'), auth.uid()) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  perform seed_workspace(ws);
  return ws;
end $$;

-- =====================================================================
-- Row-level security: you only ever see your own data and your workspaces
-- =====================================================================
alter table public.profiles           enable row level security;
alter table public.workspaces         enable row level security;
alter table public.workspace_members  enable row level security;
alter table public.workspace_invites  enable row level security;
alter table public.workflows          enable row level security;
alter table public.tasks              enable row level security;
alter table public.task_updates       enable row level security;
alter table public.notifications      enable row level security;
alter table public.automations        enable row level security;
alter table public.routine_items      enable row level security;
alter table public.routine_logs       enable row level security;
alter table public.journal            enable row level security;
alter table public.focus_sessions     enable row level security;
alter table public.expenses           enable row level security;
alter table public.budgets            enable row level security;

-- profiles
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (id = auth.uid() or public.shares_workspace(id));
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
drop policy if exists "ws read" on public.workspaces;
create policy "ws read" on public.workspaces for select using (public.is_member(id));
drop policy if exists "ws update" on public.workspaces;
create policy "ws update" on public.workspaces for update using (public.is_admin(id));
drop policy if exists "ws delete" on public.workspaces;
create policy "ws delete" on public.workspaces for delete using (owner_id = auth.uid());

-- members
drop policy if exists "members read" on public.workspace_members;
create policy "members read" on public.workspace_members for select using (public.is_member(workspace_id));
drop policy if exists "members manage" on public.workspace_members;
create policy "members manage" on public.workspace_members for update using (public.is_admin(workspace_id));
drop policy if exists "members remove" on public.workspace_members;
create policy "members remove" on public.workspace_members for delete using (public.is_admin(workspace_id) or user_id = auth.uid());

-- invites
drop policy if exists "invites read" on public.workspace_invites;
create policy "invites read" on public.workspace_invites for select using (public.is_member(workspace_id));
drop policy if exists "invites write" on public.workspace_invites;
create policy "invites write" on public.workspace_invites for insert with check (public.is_admin(workspace_id));
drop policy if exists "invites delete" on public.workspace_invites;
create policy "invites delete" on public.workspace_invites for delete using (public.is_admin(workspace_id));

-- workspace-shared tables
do $$
declare t text;
begin
  foreach t in array array['workflows','tasks','task_updates','automations'] loop
    execute format('drop policy if exists "%1$s member all" on public.%1$s', t);
    execute format('create policy "%1$s member all" on public.%1$s for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
  end loop;
end $$;

-- notifications: read your own; any workspace member may notify another member
drop policy if exists "notif read" on public.notifications;
create policy "notif read" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "notif update" on public.notifications;
create policy "notif update" on public.notifications for update using (user_id = auth.uid());
drop policy if exists "notif delete" on public.notifications;
create policy "notif delete" on public.notifications for delete using (user_id = auth.uid());
drop policy if exists "notif insert" on public.notifications;
create policy "notif insert" on public.notifications for insert with check (
  user_id = auth.uid() or (workspace_id is not null and public.is_member(workspace_id) and public.shares_workspace(user_id))
);

-- personal tables: owner only
do $$
declare t text;
begin
  foreach t in array array['routine_items','routine_logs','journal','focus_sessions','expenses','budgets'] loop
    execute format('drop policy if exists "%1$s own" on public.%1$s', t);
    execute format('create policy "%1$s own" on public.%1$s for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- =====================================================================
-- Live sync across devices
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['tasks','task_updates','notifications','workflows','automations','routine_items','routine_logs','journal','expenses','budgets','focus_sessions','workspace_members'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Realtime needs full rows on delete for filtered subscriptions
alter table public.tasks replica identity full;
alter table public.task_updates replica identity full;

-- =====================================================================
-- Hardening: who may call which helper, and table access for signed-in users
-- =====================================================================
-- Internal setup functions: only the database itself may run them
revoke execute on function public.seed_workspace(uuid) from public, anon, authenticated;
revoke execute on function public.seed_user_routine(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- App functions: signed-in users only
revoke execute on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
revoke execute on function public.accept_my_invites() from public, anon;
grant execute on function public.accept_my_invites() to authenticated;
-- Membership checks used by the security rules
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.shares_workspace(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_admin(uuid), public.shares_workspace(uuid) to authenticated;

-- Signed-in users can reach the tables (row-level security above still limits every row); visitors who aren't signed in get nothing
do $$
declare t text;
begin
  foreach t in array array['profiles','workspaces','workspace_members','workspace_invites','workflows','tasks','task_updates','notifications','automations','routine_items','routine_logs','journal','focus_sessions','expenses','budgets'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
