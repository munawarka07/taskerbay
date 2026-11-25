-- TaskerBay v9: one-way Outlook / Microsoft 365 calendar feed (Outlook -> TaskerBay)
-- The private published-calendar link is kept in the private schema (never readable by the app);
-- a server function reads it every 10 minutes and stores your upcoming meetings for you only.

create table if not exists private.calendar_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text,
  event_count int not null default 0,
  last_hash text
);
revoke all on private.calendar_feeds from public, anon, authenticated;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  uid text not null default '',
  title text not null default 'Busy',
  location text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  busy text not null default 'BUSY',
  recurring boolean not null default false
);
create index if not exists calendar_events_user_start_idx on public.calendar_events(user_id, start_at);
alter table public.calendar_events enable row level security;
drop policy if exists "approved only" on public.calendar_events;
create policy "approved only" on public.calendar_events as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
drop policy if exists "calendar own read" on public.calendar_events;
create policy "calendar own read" on public.calendar_events for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.calendar_events from anon;
revoke insert, update, delete, truncate, trigger, references on public.calendar_events from authenticated;

-- signed-in person: connect / check / disconnect their own feed
create or replace function public.calendar_feed_set(feed_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare u text := btrim(coalesce(feed_url, '')); host text;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not allowed'; end if;
  u := regexp_replace(u, '^webcals?://', 'https://', 'i');
  host := lower(substring(u from '^https://([^/:?#]+)'));
  if host is null or length(u) > 2000 then raise exception 'Paste the full ICS link that starts with https://'; end if;
  if host not in ('outlook.office365.com', 'outlook.office.com', 'outlook.live.com', 'outlook.office365.us', 'outlook.office.de', 'calendar.google.com') then
    raise exception 'That link isn''t an Outlook calendar link. Use the ICS link from Outlook → Settings → Calendar → Shared calendars → Publish a calendar.';
  end if;
  insert into private.calendar_feeds (user_id, url) values (auth.uid(), u)
  on conflict (user_id) do update set url = excluded.url, last_error = null, last_synced_at = null, last_hash = null;
end $$;

create or replace function public.calendar_feed_status() returns table (connected boolean, host text, last_synced_at timestamptz, last_error text, event_count int)
language sql stable security definer set search_path = '' as $$
  select true, substring(f.url from '^https://([^/:?#]+)'), f.last_synced_at, f.last_error, f.event_count
  from private.calendar_feeds f where f.user_id = auth.uid()
$$;

create or replace function public.calendar_feed_clear() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  delete from private.calendar_feeds where user_id = auth.uid();
  delete from public.calendar_events where user_id = auth.uid();
end $$;

revoke all on function public.calendar_feed_set(text), public.calendar_feed_status(), public.calendar_feed_clear() from public, anon;
grant execute on function public.calendar_feed_set(text), public.calendar_feed_status(), public.calendar_feed_clear() to authenticated;

-- server only (service role): list feeds, save results
create or replace function public.calendar_feeds_for_sync(only_user uuid default null) returns table (user_id uuid, url text, tz text)
language sql stable security definer set search_path = '' as $$
  select f.user_id, f.url, coalesce(nullif(p.timezone, ''), 'Asia/Dubai')
  from private.calendar_feeds f left join public.profiles p on p.id = f.user_id
  where only_user is null or f.user_id = only_user
$$;
create or replace function public.calendar_save(target_user uuid, events jsonb, err text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if err is not null then
    update private.calendar_feeds set last_error = left(err, 300), last_synced_at = now() where user_id = target_user;
    return;
  end if;
  -- nothing changed since last time: just note the check (avoids rewriting rows and pinging devices)
  if exists (select 1 from private.calendar_feeds where user_id = target_user and last_hash = md5(coalesce(events, '[]'::jsonb)::text)) then
    update private.calendar_feeds set last_error = null, last_synced_at = now() where user_id = target_user;
    return;
  end if;
  delete from public.calendar_events where user_id = target_user;
  insert into public.calendar_events (user_id, uid, title, location, start_at, end_at, all_day, busy, recurring)
  select target_user, coalesce(e->>'uid', ''), left(coalesce(nullif(e->>'title', ''), 'Busy'), 300), left(coalesce(e->>'location', ''), 300),
         (e->>'start')::timestamptz, (e->>'end')::timestamptz, coalesce((e->>'all_day')::boolean, false), coalesce(nullif(e->>'busy', ''), 'BUSY'), coalesce((e->>'recurring')::boolean, false)
  from jsonb_array_elements(coalesce(events, '[]'::jsonb)) e;
  update private.calendar_feeds set last_error = null, last_synced_at = now(), event_count = jsonb_array_length(coalesce(events, '[]'::jsonb)), last_hash = md5(coalesce(events, '[]'::jsonb)::text) where user_id = target_user;
end $$;
revoke all on function public.calendar_feeds_for_sync(uuid), public.calendar_save(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.calendar_feeds_for_sync(uuid), public.calendar_save(uuid, jsonb, text) to service_role;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calendar_events') then
    alter publication supabase_realtime add table public.calendar_events;
  end if;
end $$;

select cron.schedule('taskerbay-calendar', '*/10 * * * *', $c$
  select net.http_post(url := 'https://qjuhoknmsveumdxadsgz.supabase.co/functions/v1/calendar',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select cron_secret from private.push_config where id = 1)),
    body := '{}'::jsonb, timeout_milliseconds := 60000) $c$);
