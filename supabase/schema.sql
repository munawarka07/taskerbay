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

-- =====================================================================
-- v2 additions (Nov 2026): status timeline, popup notifications, access code
-- =====================================================================
alter table public.tasks add column if not exists status_note text not null default '';
alter table public.tasks add column if not exists status_at timestamptz;
alter table public.tasks add column if not exists reminded_at timestamptz;
alter table public.task_updates add column if not exists new_due_date date;
alter table public.task_updates add column if not exists new_due_time time;
create or replace function public.reset_task_reminder() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then new.reminded_at := null; end if;
  return new;
end $$;
drop trigger if exists tasks_reset_reminder on public.tasks;
create trigger tasks_reset_reminder before update on public.tasks for each row execute function public.reset_task_reminder();

alter table public.profiles add column if not exists last_digest_on date;
alter table public.routine_items add column if not exists last_reminded_on date;
alter table public.notifications add column if not exists pushed_at timestamptz;
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null unique, p256dh text not null, auth text not null,
  user_agent text not null default '', created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
-- policies: each person can only see/add/change/remove their own devices (see live database)

-- Private settings (never exposed to the website): VAPID keys, cron secret, sign-up access code (hashed).
-- private.push_config(vapid_public, vapid_private, cron_secret), private.signup_code(code_hash)
-- public.push_config() is callable by service_role only. auth.users has a BEFORE INSERT trigger
-- (private.require_signup_code) that rejects sign-ups without the right access code.
-- pg_cron job 'taskerbay-push' calls the Edge Function supabase/functions/push every 5 minutes.

-- v3 (Nov 2026): owner approval for new accounts
-- profiles.approved / profiles.is_admin (people can't change these themselves: column-level UPDATE grant only on
-- full_name, avatar_url, timezone, last_digest_on). public.is_approved() + a RESTRICTIVE policy "approved only" on every
-- table, so an unapproved account sees nothing but its own profile. Trigger zz_signup_access (private.signup_access)
-- makes the first account the admin and alerts admins about every later sign-up. Admin RPCs: access_requests(),
-- set_access(target, allow) (allow=false deletes the account). TRUNCATE/TRIGGER/REFERENCES revoked from app roles.

-- v4 (Nov 2026): chat. public.chat_messages (task_id null = workspace team chat), public.chat_reads (unread tracking).
-- Members of the workspace can read/send; authors can delete their own; RESTRICTIVE "approved only" applies.
-- Trigger chat_notify (private.chat_notify) sends one Inbox alert per room until read (assignee, creator and
-- earlier chatters for task chats; all members for team chat). Both tables are in the realtime publication.

-- v5 (Nov 2026): instant popups. private.push_now(payload) posts to the push Edge Function via pg_net.
-- Triggers: notification_push (new or refreshed Inbox alert -> {notification_id}) and task_push (task saved or
-- rescheduled close to now -> {task_id}). pg_cron 'taskerbay-push' now runs every minute for time-based
-- reminders and the 9 AM summary. The function claims a row (pushed_at / reminded_at) before sending, so nothing
-- is sent twice.

-- v6 (Nov 2026): tasks.remind_before (minutes before due; -1 none, 0 at time, 5/15/30/60/120/1440), reminders can fire
-- the day before. Popup links carry the workspace (#task=<id>&ws=<ws>). Private storage bucket "backups" (no
-- policies = no app access) filled nightly at 03:00 Dubai by Edge Function "backup" (pg_cron 'taskerbay-backup'),
-- 30 days kept; the admin downloads via the same function (public.is_site_admin(uid), service_role only).

-- v7 (Nov 2026): tasks.due_alerted_at; every task with a time pops up AT its due time ("Due now"), plus an optional
-- earlier heads-up (remind_before > 0). Default remind_before is now 0. pg_cron 'taskerbay-push' runs every 20 seconds.
-- TaskerBay v8: Fund tracker (projects / events with a budget, people who collect and spend, owner approval)
-- The person who creates a fund project is its admin. They add people (TaskerBay users or just a name),
-- give each a spending limit, and approve every entry other people add.

create table if not exists public.fund_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  total_budget numeric(14,2) not null default 0 check (total_budget >= 0),
  currency text not null default 'AED' check (length(currency) between 1 and 8),
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.fund_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.fund_projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 80),
  limit_amount numeric(14,2) check (limit_amount is null or limit_amount >= 0),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create table if not exists public.fund_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.fund_projects(id) on delete cascade,
  member_id uuid not null references public.fund_members(id) on delete cascade,
  kind text not null check (kind in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  title text not null default '',
  category text not null default 'General',
  date date not null default current_date,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text not null default '',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fund_projects_owner_idx on public.fund_projects(owner_id);
create index if not exists fund_members_project_idx on public.fund_members(project_id);
create index if not exists fund_members_user_idx on public.fund_members(user_id);
create index if not exists fund_entries_project_idx on public.fund_entries(project_id, date);
create index if not exists fund_entries_member_idx on public.fund_entries(member_id);
create index if not exists fund_entries_created_by_idx on public.fund_entries(created_by);
create index if not exists fund_entries_reviewed_by_idx on public.fund_entries(reviewed_by);

-- 'owner', 'member' or null for the signed-in person
create or replace function public.fund_role(p uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.fund_projects f where f.id = p and f.owner_id = (select auth.uid())) then 'owner'
              when exists (select 1 from public.fund_members m where m.project_id = p and m.user_id = (select auth.uid())) then 'member' end
$$;
revoke all on function public.fund_role(uuid) from public, anon;
grant execute on function public.fund_role(uuid) to authenticated;

-- find an approved TaskerBay user by exact email, to add them to a fund project
create or replace function public.fund_find_user(addr text) returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1))
  from public.profiles p
  where (select public.is_approved()) and length(addr) > 3 and lower(p.email) = lower(btrim(addr)) and p.approved
  limit 1
$$;
revoke all on function public.fund_find_user(text) from public, anon;
grant execute on function public.fund_find_user(text) to authenticated;

alter table public.fund_projects enable row level security;
alter table public.fund_members enable row level security;
alter table public.fund_entries enable row level security;

do $$ declare t text; begin
  foreach t in array array['fund_projects','fund_members','fund_entries'] loop
    execute format('drop policy if exists "approved only" on public.%I', t);
    execute format('create policy "approved only" on public.%I as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
  end loop;
end $$;

drop policy if exists "fp read" on public.fund_projects;
drop policy if exists "fp insert" on public.fund_projects;
drop policy if exists "fp update" on public.fund_projects;
drop policy if exists "fp delete" on public.fund_projects;
create policy "fp read" on public.fund_projects for select to authenticated using (owner_id = (select auth.uid()) or public.fund_role(id) is not null);
create policy "fp insert" on public.fund_projects for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "fp update" on public.fund_projects for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "fp delete" on public.fund_projects for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "fm read" on public.fund_members;
drop policy if exists "fm write" on public.fund_members;
create policy "fm read" on public.fund_members for select to authenticated using (public.fund_role(project_id) is not null);
create policy "fm write" on public.fund_members for all to authenticated using (public.fund_role(project_id) = 'owner') with check (public.fund_role(project_id) = 'owner');

drop policy if exists "fe read" on public.fund_entries;
drop policy if exists "fe insert" on public.fund_entries;
drop policy if exists "fe update owner" on public.fund_entries;
drop policy if exists "fe update own pending" on public.fund_entries;
drop policy if exists "fe delete" on public.fund_entries;
create policy "fe read" on public.fund_entries for select to authenticated using (public.fund_role(project_id) is not null);
create policy "fe insert" on public.fund_entries for insert to authenticated with check (
  created_by = (select auth.uid()) and (
    public.fund_role(project_id) = 'owner'
    or (status = 'pending' and exists (select 1 from public.fund_members m where m.id = member_id and m.project_id = fund_entries.project_id and m.user_id = (select auth.uid())))));
create policy "fe update owner" on public.fund_entries for update to authenticated
  using (public.fund_role(project_id) = 'owner') with check (public.fund_role(project_id) = 'owner');
create policy "fe update own pending" on public.fund_entries for update to authenticated
  using (created_by = (select auth.uid()) and status = 'pending')
  with check (created_by = (select auth.uid()) and status = 'pending'
    and exists (select 1 from public.fund_members m where m.id = member_id and m.project_id = fund_entries.project_id and m.user_id = (select auth.uid())));
create policy "fe delete" on public.fund_entries for delete to authenticated
  using (public.fund_role(project_id) = 'owner' or (created_by = (select auth.uid()) and status = 'pending'));

-- integrity: the person belongs to the same project; closed projects take no new entries from members;
-- review fields are stamped by the server
create or replace function private.fund_entry_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st text; own uuid;
begin
  if not exists (select 1 from public.fund_members m where m.id = new.member_id and m.project_id = new.project_id) then
    raise exception 'That person is not part of this fund';
  end if;
  select status, owner_id into st, own from public.fund_projects where id = new.project_id;
  if st = 'closed' and auth.uid() is distinct from own then raise exception 'This fund is closed'; end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now(); new.created_by := old.created_by; new.created_at := old.created_at;
    if new.status is distinct from old.status then
      new.reviewed_by := auth.uid(); new.reviewed_at := case when new.status = 'pending' then null else now() end;
      if new.status = 'pending' then new.reviewed_by := null; end if;
    else new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; end if;
  else
    if new.status <> 'pending' then new.reviewed_by := auth.uid(); new.reviewed_at := now(); else new.reviewed_by := null; new.reviewed_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists fund_entry_guard on public.fund_entries;
create trigger fund_entry_guard before insert or update on public.fund_entries for each row execute function private.fund_entry_guard();

create or replace function private.fund_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); if tg_op = 'UPDATE' then new.owner_id := old.owner_id; end if; return new; end $$;
drop trigger if exists fund_touch on public.fund_projects;
create trigger fund_touch before update on public.fund_projects for each row execute function private.fund_touch();

-- the creator is always a person in their own fund
create or replace function private.fund_add_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fund_members (project_id, user_id, name)
  select new.id, new.owner_id, coalesce(nullif(p.full_name, ''), 'Me') from public.profiles p where p.id = new.owner_id
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists fund_add_owner on public.fund_projects;
create trigger fund_add_owner after insert on public.fund_projects for each row execute function private.fund_add_owner();

-- Inbox alerts (they also pop up instantly through the existing notification_push trigger)
create or replace function private.fund_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f record; who text; mname text; lim numeric; spent numeric; msg text; amt text;
begin
  select * into f from public.fund_projects where id = new.project_id;
  select name, limit_amount into mname, lim from public.fund_members where id = new.member_id;
  amt := f.currency || ' ' || to_char(new.amount, 'FM999,999,990.00');
  if tg_op = 'INSERT' and new.status = 'pending' and new.created_by is distinct from f.owner_id then
    select coalesce(nullif(full_name, ''), 'Someone') into who from public.profiles where id = new.created_by;
    msg := format('💰 %s added %s %s (%s) in “%s”. Waiting for your approval.', who, case when new.kind = 'out' then 'a spend of' else 'a collection of' end, amt, coalesce(nullif(new.title, ''), new.category), f.name);
    if new.kind = 'out' and lim is not null then
      select coalesce(sum(amount), 0) into spent from public.fund_entries where member_id = new.member_id and kind = 'out' and status <> 'rejected';
      if spent > lim then msg := msg || format(' ⚠️ %s is over their limit: %s of %s.', mname, to_char(spent, 'FM999,999,990.00'), to_char(lim, 'FM999,999,990.00')); end if;
    end if;
    insert into public.notifications (user_id, actor_id, body) values (f.owner_id, new.created_by, msg);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected')
        and new.created_by is not null and new.created_by is distinct from new.reviewed_by then
    msg := format('💰 %s: your %s %s (%s) in “%s”%s', case when new.status = 'approved' then '✅ Approved' else '❌ Rejected' end,
                  case when new.kind = 'out' then 'spend of' else 'collection of' end, amt, coalesce(nullif(new.title, ''), new.category), f.name,
                  case when new.review_note <> '' then ' · ' || left(new.review_note, 120) else '' end);
    insert into public.notifications (user_id, actor_id, body) values (new.created_by, new.reviewed_by, msg);
  end if;
  return null;
end $$;
drop trigger if exists fund_notify on public.fund_entries;
create trigger fund_notify after insert or update on public.fund_entries for each row execute function private.fund_notify();

create or replace function private.fund_member_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  if new.user_id is null or (tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id) then return null; end if;
  select * into f from public.fund_projects where id = new.project_id;
  if new.user_id = f.owner_id then return null; end if;
  insert into public.notifications (user_id, actor_id, body)
  values (new.user_id, f.owner_id, format('💰 You were added to the fund “%s”%s. Open Money → Funds to add what you collect and spend.', f.name,
          case when new.limit_amount is not null then format(' with a spending limit of %s %s', f.currency, to_char(new.limit_amount, 'FM999,999,990.00')) else '' end));
  return null;
end $$;
drop trigger if exists fund_member_notify on public.fund_members;
create trigger fund_member_notify after insert or update on public.fund_members for each row execute function private.fund_member_notify();

revoke all on function private.fund_entry_guard(), private.fund_touch(), private.fund_add_owner(), private.fund_notify(), private.fund_member_notify() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['fund_projects','fund_members','fund_entries'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- v10: permanent access or time-limited trial
alter table public.profiles add column if not exists access_until timestamptz;
alter table public.profiles add column if not exists trial_notified boolean not null default false;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select approved and (is_admin or access_until is null or access_until > now()) from public.profiles where id = (select auth.uid())), false)
$$;

drop function if exists public.set_access(uuid, boolean);
create or replace function public.set_access(target uuid, allow boolean, days integer default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false) then raise exception 'Only admins can approve accounts'; end if;
  if target = (select auth.uid()) then raise exception 'You can''t change your own access'; end if;
  if days is not null and (days < 1 or days > 365) then raise exception 'Trial length must be 1 to 365 days'; end if;
  if allow then
    update public.profiles set approved = true, trial_notified = false,
      access_until = case when days is null then null else now() + make_interval(days => days) end
    where id = target;
    insert into public.notifications (user_id, body, actor_id) values (target,
      case when days is null then 'Your TaskerBay access was approved. Welcome!'
           else format('Your TaskerBay trial is active until %s (Dubai time). Welcome!', to_char((now() + make_interval(days => days)) at time zone 'Asia/Dubai', 'Dy DD Mon, HH12:MI AM')) end,
      (select auth.uid()));
  else
    delete from auth.users where id = target;
  end if;
end $$;
revoke all on function public.set_access(uuid, boolean, integer) from public, anon;
grant execute on function public.set_access(uuid, boolean, integer) to authenticated;

drop function if exists public.access_requests();
create or replace function public.access_requests() returns table(id uuid, full_name text, email text, approved boolean, is_admin boolean, created_at timestamptz, access_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false) then raise exception 'Only admins can see access requests'; end if;
  return query select p.id, p.full_name, coalesce(nullif(p.email, ''), u.email::text), p.approved, p.is_admin, p.created_at, p.access_until
    from public.profiles p left join auth.users u on u.id = p.id order by p.approved, p.created_at desc;
end $$;
revoke all on function public.access_requests() from public, anon;
grant execute on function public.access_requests() to authenticated;

-- every 10 minutes: tell the admin when a trial has ended (access already stops at that moment)
create or replace function private.trial_check() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select p.id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)) nm, p.email from public.profiles p
           where p.approved and not p.is_admin and p.access_until is not null and p.access_until <= now() and not p.trial_notified loop
    update public.profiles set trial_notified = true where id = r.id;
    insert into public.notifications (user_id, body, actor_id)
    select a.id, format('Trial ended: %s (%s) can no longer use TaskerBay. Open Settings → Access requests to extend it, make it permanent or remove the account.', r.nm, r.email), null
    from public.profiles a where a.is_admin;
  end loop;
end $$;
revoke all on function private.trial_check() from public, anon, authenticated;
select cron.schedule('taskerbay-trials', '*/10 * * * *', 'select private.trial_check()');
