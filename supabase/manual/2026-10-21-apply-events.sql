-- Phase 4 · Apply the events migrations to the hosted project in one step.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- It applies 20261021000100_events_schema, 20261021000200_events_jobs, and
-- 20261021000300_events_access verbatim from supabase/migrations and records
-- each in the migration history under its repository version, so the
-- reconciled history stays exact. It only adds a new schema, functions,
-- grants, a role/capability, six event categories, and a storage bucket;
-- it changes no existing rows (it adds a trigger on profiles that acts only
-- on future membership-status changes).
--
-- All or nothing: one transaction. A failed run leaves nothing behind and
-- can be rerun; a rerun after success stops at the preflight check.
begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null or to_regclass('giving.payments') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the Phase 3 stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261020000300') then
    raise exception 'Nothing was changed: the Phase 3 migrations are not recorded yet.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version like '20261021%')
     or exists (select 1 from pg_namespace where nspname = 'events') then
    raise exception 'Nothing was changed: the events migrations are already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261021000100_events_schema.sql
-- =========================================================================
-- Phase 4 · Events and calendars: schema, recurrence, and visibility.
--
-- Everything lives in a private `events` schema that the Data API does not
-- expose and that anon/authenticated cannot read. Members, visitors, and
-- event coordinators reach it only through SECURITY DEFINER functions in
-- 20261021000300 that check membership, audience, and capability on every
-- call. The scheduled job and private calendar feeds reach it through the
-- token- or signature-gated functions in 20261021000200.
--
-- Model
--   series        one row per event (a one-off event is a series of one)
--   occurrences   materialized dates of a series, each with a stable id and
--                 an `occurrence_key` (the date the rule generated it), so
--                 registrations and calendar UIDs survive edits
--   registrations one per member per occurrence (confirmed / waitlisted /
--                 canceled), ordered for the waitlist by (queued_at, id)
--
-- Times: a series stores a local start date and wall-clock time plus an IANA
-- time zone. Each occurrence's instant is computed with
-- `(local date + local time) at time zone tz`, so a weekly 9:00 AM gathering
-- stays at 9:00 AM local time across daylight-saving changes. PostgreSQL
-- resolves a nonexistent local time (inside the spring-forward gap) by moving
-- it forward by the gap, and an ambiguous one (the repeated fall-back hour)
-- to the later, standard-time instant. The admin form warns about both.

-- ---------------------------------------------------------------------------
-- Capability and role (separate from membership, finance, and role management)
-- ---------------------------------------------------------------------------
insert into public.capabilities (key, description, available) values
  ('events.manage', 'Create, edit, publish, and cancel events; manage registrations and attendee lists', true);

insert into public.roles (key, name, description, assignable, sort_order) values
  ('event_coordinator', 'Event coordinator',
   'Creates and manages events, registrations, and attendee lists. No membership, finance, or role access.', true, 35);

insert into public.role_capabilities (role_key, capability_key) values
  ('event_coordinator', 'events.manage');

-- ---------------------------------------------------------------------------
-- Schema and types
-- ---------------------------------------------------------------------------
create schema events;
revoke all on schema events from public, anon, authenticated;

create type events.status as enum ('draft', 'published', 'canceled', 'archived');
create type events.audience as enum ('public', 'members', 'group');
create type events.recurrence as enum ('none', 'daily', 'weekly', 'monthly');
create type events.monthly_mode as enum ('day', 'ordinal');
create type events.occurrence_status as enum ('scheduled', 'canceled');
create type events.registration_status as enum ('confirmed', 'waitlisted', 'canceled');

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------
create table events.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 60),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into events.categories (name, sort_order) values
  ('Worship', 10), ('Fellowship', 20), ('Bible Study', 30), ('Youth', 40), ('Outreach', 50), ('Serving', 60);

create function events.valid_reminders(p integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and cardinality(p) <= 3
     and not exists (select 1 from unnest(p) m where m is null or m < 15 or m > 20160);
$$;

-- Singleton.
create table events.settings (
  id boolean primary key default true check (id),
  public_feed_enabled boolean not null default false,
  default_reminder_minutes integer[] not null default '{1440}' check (events.valid_reminders(default_reminder_minutes)),
  -- The one deployment the database scheduler calls to send queued email
  -- (set by the owner with supabase/manual/2026-10-21-events-scheduler.sql).
  job_url text check (job_url is null or job_url ~ '^https://[^/?#@ ]+/api/jobs/events$'),
  updated_at timestamptz not null default now()
);
insert into events.settings default values;

-- Server-only secret for the signed job endpoint (events_job). Set by the
-- owner in the SQL editor; never readable through the API.
create table events.secrets (
  name text primary key,
  value text not null check (char_length(value) >= 32),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Series
-- ---------------------------------------------------------------------------
create table events.series (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  -- Markdown subset; raw HTML is escaped when rendered.
  description text not null default '' check (char_length(description) <= 10000),
  cover_path text check (char_length(cover_path) <= 300),
  cover_alt text check (char_length(cover_alt) <= 300),
  category_id uuid references events.categories (id),
  audience events.audience not null default 'members',
  -- Integration boundary for Phase 5 groups. No group model exists yet, so
  -- the constraint below keeps group audiences unusable until it does.
  group_id uuid,
  timezone text not null,
  all_day boolean not null default false,
  start_date date not null,
  start_time time,
  duration_minutes integer,
  day_count integer,
  location_name text check (char_length(location_name) <= 200),
  location_address text check (char_length(location_address) <= 300),
  online_url text check (char_length(online_url) <= 500 and online_url ~ '^https://[^\s/?#@]+(/[^\s]*)?$'),
  organizer_name text check (char_length(organizer_name) <= 120),
  rsvp_enabled boolean not null default false,
  capacity integer check (capacity between 1 and 10000),
  waitlist_enabled boolean not null default false,
  -- Registration closes this many minutes before each occurrence starts
  -- (null = at the start time).
  rsvp_close_minutes integer check (rsvp_close_minutes between 0 and 525600),
  cancellation_instructions text check (char_length(cancellation_instructions) <= 1000),
  reminder_minutes integer[] not null default '{1440}' check (events.valid_reminders(reminder_minutes)),
  recurrence events.recurrence not null default 'none',
  interval_count integer not null default 1 check (interval_count between 1 and 12),
  weekdays smallint[],
  monthly_mode events.monthly_mode,
  month_ordinal smallint check (month_ordinal in (1, 2, 3, 4, -1)),
  until_date date,
  occurrence_limit integer check (occurrence_limit between 1 and 200),
  status events.status not null default 'draft',
  publish_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  sequence integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_timing check (
    (all_day and start_time is null and duration_minutes is null and day_count between 1 and 14)
    or (not all_day and start_time is not null and duration_minutes between 5 and 10080 and day_count is null)
  ),
  constraint series_groups_unavailable check (audience <> 'group' and group_id is null),
  constraint series_rsvp_settings check (rsvp_enabled or (capacity is null and not waitlist_enabled and rsvp_close_minutes is null)),
  constraint series_waitlist_needs_capacity check (not waitlist_enabled or capacity is not null),
  constraint series_recurrence_end check (
    (recurrence = 'none' and until_date is null and occurrence_limit is null and weekdays is null and monthly_mode is null and month_ordinal is null)
    or (recurrence <> 'none' and (until_date is not null or occurrence_limit is not null))
  ),
  constraint series_weekly check (recurrence <> 'weekly' or (weekdays is not null and cardinality(weekdays) between 1 and 7)),
  constraint series_monthly check (
    recurrence <> 'monthly' or monthly_mode = 'day' or (monthly_mode = 'ordinal' and month_ordinal is not null)
  ),
  constraint series_until_range check (until_date is null or (until_date >= start_date and until_date <= start_date + 731)),
  constraint series_publish_at check (status = 'draft' or publish_at is not null),
  constraint series_cover_alt check (cover_path is null or char_length(btrim(coalesce(cover_alt, ''))) > 0)
);

create index series_status_idx on events.series (status, publish_at);
create index series_category_idx on events.series (category_id);
create index series_created_by_idx on events.series (created_by);
create index series_updated_by_idx on events.series (updated_by);

create function events.series_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Choose a valid time zone.' using errcode = '22023';
  end if;
  if new.weekdays is not null and exists (select 1 from unnest(new.weekdays) w where w is null or w < 0 or w > 6) then
    raise exception 'Choose valid weekdays.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

create trigger series_before_write
  before insert or update on events.series
  for each row execute function events.series_before_write();

-- Audit: state transitions and changed field names, never content.
create function events.series_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'event.created', 'event', new.id::text,
            jsonb_build_object('status', new.status, 'audience', new.audience));
  else
    select jsonb_build_object(
             'fields', coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb),
             'status_from', old.status,
             'status_to', new.status)
      into v_details
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'updated_by', 'sequence');
    if v_details -> 'fields' = '[]'::jsonb then
      return new;
    end if;
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values ((select auth.uid()),
            case when old.status is distinct from new.status then 'event.status_changed' else 'event.updated' end,
            'event', new.id::text, v_details);
  end if;
  return new;
end;
$$;

create trigger series_audit
  after insert or update on events.series
  for each row execute function events.series_audit();

-- ---------------------------------------------------------------------------
-- Occurrences
-- ---------------------------------------------------------------------------
create table events.occurrences (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references events.series (id) on delete cascade,
  -- The date the recurrence rule generated. Stable identity for this
  -- occurrence, even when it is moved to another date.
  occurrence_key date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status events.occurrence_status not null default 'scheduled',
  -- Individually edited: series edits leave its date, time, and place alone.
  detached boolean not null default false,
  override_date date,
  override_start_time time,
  override_duration integer check (override_duration between 5 and 10080),
  override_location_name text check (char_length(override_location_name) <= 200),
  override_location_address text check (char_length(override_location_address) <= 300),
  override_online_url text check (char_length(override_online_url) <= 500 and override_online_url ~ '^https://[^\s/?#@]+(/[^\s]*)?$'),
  note text check (char_length(note) <= 500),
  -- The rule no longer generates this date, but it was kept (canceled)
  -- because people had registered.
  orphaned boolean not null default false,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, occurrence_key),
  check (ends_at > starts_at)
);

create index occurrences_window_idx on events.occurrences (starts_at, ends_at);
create index occurrences_series_idx on events.occurrences (series_id, starts_at);
create index occurrences_status_idx on events.occurrences (status, starts_at);

-- ---------------------------------------------------------------------------
-- Registrations, member preferences, private feed tokens
-- ---------------------------------------------------------------------------
create table events.registrations (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references events.occurrences (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  status events.registration_status not null,
  -- Waitlist order: (queued_at, id). Reset when someone registers again.
  queued_at timestamptz not null default now(),
  confirmed_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text check (cancel_reason in ('member', 'admin', 'ineligible')),
  source text not null default 'member' check (source in ('member', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (occurrence_id, profile_id),
  check ((status = 'canceled') = (canceled_at is not null)),
  check (status <> 'confirmed' or confirmed_at is not null)
);

create index registrations_queue_idx on events.registrations (occurrence_id, status, queued_at, id);
create index registrations_profile_idx on events.registrations (profile_id, status);

create table events.member_prefs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  reminders boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Only a SHA-256 of the bearer token is stored; the token is shown once.
create table events.feed_tokens (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Email outbox: durable delivery records with deduplication and retries.
-- Messages are rendered at send time from current data, after rechecking
-- that the recipient may still see the event.
-- ---------------------------------------------------------------------------
create table events.outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  kind text not null check (kind in (
    'rsvp_confirmed', 'waitlisted', 'rsvp_canceled', 'promoted', 'changed', 'occurrence_canceled', 'event_canceled', 'reminder')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  occurrence_id uuid not null references events.occurrences (id) on delete cascade,
  -- Field names or flags only (e.g. which details changed, reminder offset).
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'suppressed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 300),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index outbox_due_idx on events.outbox (status, next_attempt_at);
create index outbox_profile_idx on events.outbox (profile_id);
create index outbox_occurrence_idx on events.outbox (occurrence_id);

alter table events.categories enable row level security;
alter table events.settings enable row level security;
alter table events.secrets enable row level security;
alter table events.series enable row level security;
alter table events.occurrences enable row level security;
alter table events.registrations enable row level security;
alter table events.member_prefs enable row level security;
alter table events.feed_tokens enable row level security;
alter table events.outbox enable row level security;

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------

-- Phase 5 boundary: group membership. No group model exists yet, so nobody
-- is a member of any group (and group audiences are blocked by constraint).
create function events.group_member(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select false;
$$;

create function events.audience_allows(p_audience events.audience, p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_audience
    when 'public' then true
    when 'members' then exists (
      select 1 from public.profiles p where p.id = p_profile and p.membership_status = 'approved')
    else exists (
      select 1 from public.profiles p where p.id = p_profile and p.membership_status = 'approved')
      and events.group_member(p_group, p_profile)
  end;
$$;

-- Live = published (or canceled after publishing) and past its publish time.
-- Drafts and archived events are never live.
create function events.is_live(p_status events.status, p_publish_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('published', 'canceled') and p_publish_at is not null and p_publish_at <= now();
$$;

create function events.visible_to(p_series uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from events.series s
     where s.id = p_series
       and events.is_live(s.status, s.publish_at)
       and events.audience_allows(s.audience, s.group_id, p_profile));
$$;

-- ---------------------------------------------------------------------------
-- Recurrence
-- ---------------------------------------------------------------------------

-- Dates generated by a series' rule. Bounded to 731 days after the start
-- date and 200 dates. Monthly-by-date skips months without that date (the
-- 31st occurs only in 31-day months); ordinal 5ths are not offered, and
-- "last" means the last such weekday of the month.
create function events.rule_dates(p_series uuid)
returns table (d date)
language plpgsql
stable
set search_path = ''
as $$
declare
  s events.series;
  v_end date;
  v_limit integer;
  v_count integer := 0;
  v_day date;
  v_dow integer;
  v_week0 date;
  v_months integer;
  v_match boolean;
begin
  select * into s from events.series where id = p_series;
  if not found then
    return;
  end if;
  if s.recurrence = 'none' then
    d := s.start_date;
    return next;
    return;
  end if;
  v_end := least(coalesce(s.until_date, s.start_date + 731), s.start_date + 731);
  v_limit := least(coalesce(s.occurrence_limit, 200), 200);
  v_week0 := s.start_date - extract(dow from s.start_date)::integer;
  for v_day in select g::date from generate_series(s.start_date::timestamp, v_end::timestamp, interval '1 day') g loop
    v_dow := extract(dow from v_day)::integer;
    if s.recurrence = 'daily' then
      v_match := (v_day - s.start_date) % s.interval_count = 0;
    elsif s.recurrence = 'weekly' then
      v_match := v_dow = any (s.weekdays) and ((v_day - v_week0) / 7) % s.interval_count = 0;
    else
      v_months := ((extract(year from v_day) - extract(year from s.start_date)) * 12
                   + extract(month from v_day) - extract(month from s.start_date))::integer;
      if v_months % s.interval_count <> 0 then
        v_match := false;
      elsif s.monthly_mode = 'day' then
        v_match := extract(day from v_day) = extract(day from s.start_date);
      else
        v_match := v_dow = extract(dow from s.start_date)::integer
          and case when s.month_ordinal = -1
                   then extract(month from v_day + 7) <> extract(month from v_day)
                   else (extract(day from v_day)::integer - 1) / 7 + 1 = s.month_ordinal end;
      end if;
    end if;
    if v_match then
      d := v_day;
      return next;
      v_count := v_count + 1;
      exit when v_count >= v_limit;
    end if;
  end loop;
end;
$$;

-- Effective instant range of an occurrence (overrides apply to detached ones).
create function events.occurrence_times(
  p_series events.series, p_key date, p_override_date date, p_override_time time, p_override_duration integer)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_date date := coalesce(p_override_date, p_key);
begin
  if p_series.all_day then
    starts_at := v_date::timestamp at time zone p_series.timezone;
    ends_at := (v_date + p_series.day_count)::timestamp at time zone p_series.timezone;
  else
    starts_at := (v_date + coalesce(p_override_time, p_series.start_time)) at time zone p_series.timezone;
    ends_at := starts_at + make_interval(mins => coalesce(p_override_duration, p_series.duration_minutes));
  end if;
  return next;
end;
$$;

revoke execute on all functions in schema events from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261021000100', 'events_schema', 'phase-4');

-- =========================================================================
-- 20261021000200_events_jobs.sql
-- =========================================================================
-- Phase 4 · Events: occurrence sync, waitlist promotion, notifications, the
-- scheduled job, and membership-change handling.
--
-- Registration rules (also in docs/architecture.md):
--   * Capacity is checked with the occurrence row locked, so concurrent
--     requests can never overbook.
--   * Waitlist order is (queued_at, id). When a place opens, the first
--     waitlisted member who is still eligible is promoted and CONFIRMED
--     automatically (and emailed). Ineligible entries are canceled and skipped.
--   * Reducing capacity never removes confirmed people; new confirmations wait
--     until the count falls below the new capacity.
--   * A member who stops being an approved member (suspended or pending) has
--     their registrations for current and future occurrences canceled
--     ("ineligible"), their waitlist places released, and their queued emails
--     dropped. Reinstatement does not restore registrations.
--   * If an event's audience narrows, registrations of people who can no
--     longer see it are canceled the same way.

-- ---------------------------------------------------------------------------
-- Outbox helpers
-- ---------------------------------------------------------------------------
create function events.enqueue(p_kind text, p_profile uuid, p_occurrence uuid, p_key text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into events.outbox (dedupe_key, kind, profile_id, occurrence_id, detail)
  values (p_key, p_kind, p_profile, p_occurrence, coalesce(p_detail, '{}'::jsonb))
  on conflict (dedupe_key) do nothing;
$$;

-- Tell everyone currently registered (confirmed or waitlisted) for a future
-- occurrence of a live event about a meaningful change or a cancellation.
create function events.notify_registrants(p_occurrence uuid, p_kind text, p_detail jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into events.outbox (dedupe_key, kind, profile_id, occurrence_id, detail)
  select p_kind || ':' || o.id || ':' || r.profile_id || ':' || (s.sequence + o.sequence),
         p_kind, r.profile_id, o.id, coalesce(p_detail, '{}'::jsonb)
    from events.occurrences o
    join events.series s on s.id = o.series_id
    join events.registrations r on r.occurrence_id = o.id and r.status in ('confirmed', 'waitlisted')
   where o.id = p_occurrence
     and o.ends_at > now()
     and events.is_live(s.status, s.publish_at)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Waitlist promotion (call with nothing else holding the occurrence lock
-- in a conflicting order; it takes the lock itself).
-- ---------------------------------------------------------------------------
create function events.promote(p_occurrence uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o events.occurrences;
  s events.series;
  v_confirmed integer;
  v_reg events.registrations;
  v_promoted integer := 0;
begin
  select * into o from events.occurrences where id = p_occurrence for update;
  if not found then
    return 0;
  end if;
  select * into s from events.series where id = o.series_id;
  if o.status <> 'scheduled' or s.status <> 'published' or o.starts_at <= now() or not s.rsvp_enabled then
    return 0;
  end if;
  loop
    select count(*) into v_confirmed from events.registrations where occurrence_id = o.id and status = 'confirmed';
    exit when s.capacity is not null and v_confirmed >= s.capacity;
    select * into v_reg from events.registrations
     where occurrence_id = o.id and status = 'waitlisted'
     order by queued_at, id
     limit 1
     for update;
    exit when not found;
    -- Recheck eligibility at promotion time.
    if events.visible_to(s.id, v_reg.profile_id) then
      update events.registrations
         set status = 'confirmed', confirmed_at = now(), updated_at = now()
       where id = v_reg.id;
      perform events.enqueue('promoted', v_reg.profile_id, o.id,
        'promoted:' || v_reg.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
      v_promoted := v_promoted + 1;
    else
      update events.registrations
         set status = 'canceled', canceled_at = now(), cancel_reason = 'ineligible', updated_at = now()
       where id = v_reg.id;
    end if;
  end loop;
  return v_promoted;
end;
$$;

-- Cancel registrations of people who can no longer see the event, then
-- refill from the waitlist.
create function events.recheck_series(p_series uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_occ uuid;
begin
  with gone as (
    update events.registrations r
       set status = 'canceled', canceled_at = now(), cancel_reason = 'ineligible', updated_at = now()
      from events.occurrences o
     where o.id = r.occurrence_id
       and o.series_id = p_series
       and o.ends_at > now()
       and r.status <> 'canceled'
       and not events.visible_to(p_series, r.profile_id)
    returning r.occurrence_id
  )
  select count(*) into v_count from gone;
  for v_occ in select id from events.occurrences where series_id = p_series and ends_at > now() loop
    perform events.promote(v_occ);
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Materialize occurrences from the rule. Existing occurrences keep their id
-- (and therefore their registrations and calendar UIDs). Dates the rule no
-- longer produces are deleted only if nobody is registered; otherwise they
-- are kept, marked canceled ("orphaned"), and registrants are told.
-- ---------------------------------------------------------------------------
create function events.sync_occurrences(p_series uuid, p_notify boolean, p_place_changed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s events.series;
  r events.occurrences;
  v_keys date[];
  v_starts timestamptz;
  v_ends timestamptz;
  v_added integer := 0;
  v_removed integer := 0;
  v_kept integer := 0;
  v_changed integer := 0;
  v_notified integer := 0;
  v_material boolean;
  v_fields text[];
begin
  select * into s from events.series where id = p_series for update;
  select coalesce(array_agg(d order by d), '{}') into v_keys from events.rule_dates(p_series);

  -- Dates no longer in the rule.
  for r in select * from events.occurrences where series_id = p_series and not (occurrence_key = any (v_keys)) loop
    if exists (select 1 from events.registrations where occurrence_id = r.id and status <> 'canceled') then
      if not r.orphaned then
        update events.occurrences
           set orphaned = true,
               status = 'canceled',
               cancel_reason = coalesce(cancel_reason, 'This date was removed from the schedule.'),
               sequence = sequence + 1,
               updated_at = now()
         where id = r.id;
        if p_notify and r.status = 'scheduled' then
          v_notified := v_notified + events.notify_registrants(r.id, 'occurrence_canceled');
        end if;
        v_kept := v_kept + 1;
      end if;
    else
      delete from events.occurrences where id = r.id;
      v_removed := v_removed + 1;
    end if;
  end loop;

  -- New dates.
  insert into events.occurrences (series_id, occurrence_key, starts_at, ends_at)
  select p_series, k, t.starts_at, t.ends_at
    from unnest(v_keys) k
    cross join lateral events.occurrence_times(s, k, null, null, null) t
  on conflict (series_id, occurrence_key) do nothing;
  get diagnostics v_added = row_count;

  -- Recompute every occurrence; detached ones keep their own date and time.
  for r in select * from events.occurrences where series_id = p_series loop
    select t.starts_at, t.ends_at into v_starts, v_ends
      from events.occurrence_times(s, r.occurrence_key,
             case when r.detached then r.override_date end,
             case when r.detached then r.override_start_time end,
             case when r.detached then r.override_duration end) t;
    v_fields := '{}';
    if v_starts is distinct from r.starts_at or v_ends is distinct from r.ends_at then
      v_fields := v_fields || 'time'::text;
    end if;
    if p_place_changed and not (r.detached and (r.override_location_name is not null or r.override_online_url is not null)) then
      v_fields := v_fields || 'place'::text;
    end if;
    v_material := cardinality(v_fields) > 0;
    if v_starts is distinct from r.starts_at or v_ends is distinct from r.ends_at or (v_material and r.status = 'scheduled')
       or (r.orphaned and r.occurrence_key = any (v_keys)) then
      update events.occurrences
         set starts_at = v_starts,
             ends_at = v_ends,
             orphaned = orphaned and not (occurrence_key = any (v_keys)),
             sequence = sequence + case when v_material then 1 else 0 end,
             updated_at = now()
       where id = r.id;
      if v_material then
        v_changed := v_changed + 1;
        if p_notify and r.status = 'scheduled' and greatest(v_ends, r.ends_at) > now() then
          v_notified := v_notified + events.notify_registrants(r.id, 'changed', jsonb_build_object('fields', to_jsonb(v_fields)));
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'removed', v_removed, 'kept_with_registrations', v_kept,
                            'changed', v_changed, 'notified', v_notified);
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler tick: queue due reminders. Runs under a transaction-level
-- advisory lock so overlapping calls (the database cron and any deployment)
-- never queue twice; the outbox dedupe key makes it idempotent anyway.
-- Reminders are skipped for members who opted out, for registrations made
-- after the reminder time, and when more than 6 hours late (e.g. an outage).
-- ---------------------------------------------------------------------------
create function events.tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued integer;
  v_pending integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('events.tick')) then
    return jsonb_build_object('skipped', true);
  end if;
  insert into events.outbox (dedupe_key, kind, profile_id, occurrence_id, detail)
  select 'reminder:' || r.id || ':' || m || ':' || floor(extract(epoch from o.starts_at))::bigint,
         'reminder', r.profile_id, o.id, jsonb_build_object('minutes', m)
    from events.occurrences o
    join events.series s on s.id = o.series_id
    join events.registrations r on r.occurrence_id = o.id and r.status = 'confirmed'
    left join events.member_prefs p on p.profile_id = r.profile_id
    cross join lateral unnest(s.reminder_minutes) m
   where o.status = 'scheduled'
     and s.status = 'published'
     and o.starts_at > now()
     and o.starts_at <= now() + interval '15 days'
     and coalesce(p.reminders, true)
     and o.starts_at - make_interval(mins => m) <= now()
     and o.starts_at - make_interval(mins => m) > now() - interval '6 hours'
     and r.confirmed_at <= o.starts_at - make_interval(mins => m)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_queued = row_count;
  select count(*) into v_pending from events.outbox
   where status in ('pending', 'failed') and attempts < 5 and next_attempt_at <= now();
  return jsonb_build_object('queued', v_queued, 'pending', v_pending);
end;
$$;

-- ---------------------------------------------------------------------------
-- Email claim/result. A claimed message is rechecked before anything about
-- the event is released: the recipient must still be an approved member who
-- can see the event, and (for registration-specific messages) still hold the
-- matching registration. Otherwise it is marked "skipped" and not sent.
-- ---------------------------------------------------------------------------
create function events.message_allowed(m events.outbox)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from events.occurrences o
      join events.series s on s.id = o.series_id
      join public.profiles p on p.id = m.profile_id and p.membership_status = 'approved'
      left join events.registrations r on r.occurrence_id = o.id and r.profile_id = m.profile_id
     where o.id = m.occurrence_id
       and events.visible_to(s.id, m.profile_id)
       and case m.kind
             when 'reminder' then r.status = 'confirmed' and o.status = 'scheduled' and s.status = 'published' and o.starts_at > now()
             when 'rsvp_confirmed' then r.status = 'confirmed' and o.ends_at > now()
             when 'promoted' then r.status = 'confirmed' and o.ends_at > now()
             when 'waitlisted' then r.status = 'waitlisted' and o.ends_at > now()
             when 'rsvp_canceled' then r.status = 'canceled' and r.cancel_reason in ('member', 'admin')
             when 'changed' then r.status in ('confirmed', 'waitlisted') and o.status = 'scheduled' and o.ends_at > now()
             else r.status in ('confirmed', 'waitlisted') and o.ends_at > now()
           end);
$$;

create function events.op_email_claim(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((v ->> 'limit')::integer, 10), 1), 50);
  v_ids uuid[];
  v_out jsonb;
begin
  with picked as (
    select id from events.outbox
     where (nullif(v ->> 'occurrence', '') is null or occurrence_id = (v ->> 'occurrence')::uuid)
       and next_attempt_at <= now()
       and (status = 'pending'
            or (status = 'failed' and attempts < 5)
            or (status = 'sending' and updated_at < now() - interval '10 minutes'))
     order by created_at
     limit v_limit
     for update skip locked
  ), claimed as (
    update events.outbox e
       set status = case when events.message_allowed(e) then 'sending' else 'skipped' end,
           attempts = e.attempts + 1,
           updated_at = now()
      from picked
     where e.id = picked.id
    returning e.id, e.status
  )
  select coalesce(array_agg(id) filter (where status = 'sending'), '{}') into v_ids from claimed;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'kind', e.kind,
           'dedupe_key', e.dedupe_key,
           'detail', e.detail,
           'to', p.email,
           'first_name', coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.first_name), ''),
                                  nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '')),
           'occurrence', events.occurrence_json(e.occurrence_id, e.profile_id)) order by e.created_at), '[]'::jsonb)
    into v_out
    from events.outbox e
    join public.profiles p on p.id = e.profile_id
   where e.id = any (v_ids);
  return v_out;
end;
$$;

create function events.op_email_result(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := v ->> 'status';
begin
  if v_status not in ('sent', 'failed', 'suppressed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  update events.outbox
     set status = v_status,
         last_error = left(v ->> 'error', 300),
         provider_message_id = left(v ->> 'provider_id', 200),
         sent_at = case when v_status = 'sent' then now() end,
         next_attempt_at = case when v_status = 'failed' then now() + make_interval(mins => 10 * attempts) else next_attempt_at end,
         updated_at = now()
   where id = (v ->> 'id')::uuid and status = 'sending';
  return jsonb_build_object('ok', found);
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership changes: someone who stops being an approved member loses
-- their current and future registrations (no email: they can no longer see
-- member events) and any queued messages; places go to the waitlist.
-- ---------------------------------------------------------------------------
create function events.on_profile_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ uuid;
begin
  if old.membership_status = 'approved' and new.membership_status <> 'approved' then
    update events.outbox set status = 'skipped', updated_at = now()
     where profile_id = new.id and status in ('pending', 'failed');
    for v_occ in
      update events.registrations r
         set status = 'canceled', canceled_at = now(), cancel_reason = 'ineligible', updated_at = now()
        from events.occurrences o
       where o.id = r.occurrence_id
         and r.profile_id = new.id
         and r.status <> 'canceled'
         and o.ends_at > now()
      returning r.occurrence_id
    loop
      perform events.promote(v_occ);
    end loop;
  end if;
  return new;
end;
$$;

create trigger events_on_profile_status
  after update of membership_status on public.profiles
  for each row execute function events.on_profile_status();

revoke execute on all functions in schema events from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261021000200', 'events_jobs', 'phase-4');

-- =========================================================================
-- 20261021000300_events_access.sql
-- =========================================================================
-- Phase 4 · Events: the functions the app calls, and event image storage.
--
-- Member and visitor functions return only live events whose audience
-- includes the caller (public events for everyone; members-only events for
-- approved members). Drafts and archived events are never returned to them.
-- No member function returns attendee identities: only the caller's own
-- registration and, when a capacity is set, the number of places left.
-- Administrative functions require events.manage (super administrators hold
-- it implicitly; the "Event coordinator" role grants it alone).

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create function events.require_manager()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.has_capability('events.manage')) then
    raise exception 'You do not have permission to manage events.' using errcode = '42501';
  end if;
end;
$$;

-- One occurrence as JSON. p_viewer adds that person's own registration.
create function events.occurrence_json(p_occurrence uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'series_id', s.id,
    'occurrence_key', o.occurrence_key,
    'starts_at', o.starts_at,
    'ends_at', o.ends_at,
    'local_date', coalesce(case when o.detached then o.override_date end, o.occurrence_key),
    'status', case when s.status = 'canceled' then 'canceled' else o.status::text end,
    'series_status', s.status,
    'title', s.title,
    'description', s.description,
    'cover_path', s.cover_path,
    'cover_alt', s.cover_alt,
    'category', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end,
    'audience', s.audience,
    'timezone', s.timezone,
    'all_day', s.all_day,
    'day_count', s.day_count,
    'location_name', case when po then o.override_location_name else s.location_name end,
    'location_address', case when po then o.override_location_address else s.location_address end,
    'online_url', case when po then o.override_online_url else s.online_url end,
    'organizer_name', s.organizer_name,
    'note', o.note,
    'cancel_reason', coalesce(case when s.status = 'canceled' then s.cancel_reason end, o.cancel_reason),
    'cancellation_instructions', s.cancellation_instructions,
    'rsvp_enabled', s.rsvp_enabled,
    'waitlist_enabled', s.waitlist_enabled,
    'rsvp_closes_at', o.starts_at - make_interval(mins => coalesce(s.rsvp_close_minutes, 0)),
    'spots_left', case when s.capacity is null then null
                       else greatest(s.capacity - (select count(*) from events.registrations x
                                                    where x.occurrence_id = o.id and x.status = 'confirmed'), 0) end,
    'recurring', s.recurrence <> 'none',
    'sequence', s.sequence + o.sequence,
    'updated_at', greatest(s.updated_at, o.updated_at),
    'my_status', r.status,
    'my_position', case when r.status = 'waitlisted' then (
                     select count(*) from events.registrations w
                      where w.occurrence_id = o.id and w.status = 'waitlisted'
                        and (w.queued_at, w.id) <= (r.queued_at, r.id)) end)
  from events.occurrences o
  join events.series s on s.id = o.series_id
  left join events.categories c on c.id = s.category_id
  left join events.registrations r on r.occurrence_id = o.id and r.profile_id = p_viewer
  cross join lateral (select o.detached and (o.override_location_name is not null or o.override_location_address is not null
                              or o.override_online_url is not null) as po) x
  where o.id = p_occurrence;
$$;

-- ---------------------------------------------------------------------------
-- Visitors and members
-- ---------------------------------------------------------------------------
create function public.events_categories()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order, name), '[]'::jsonb)
    from events.categories where active;
$$;

create function public.events_list(p_from timestamptz, p_to timestamptz, p_category uuid default null, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Choose a date range of up to 400 days.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(events.occurrence_json(x.id, v_uid) order by x.starts_at, x.id), '[]'::jsonb)
    into v_out
    from (
      select o.id, o.starts_at
        from events.occurrences o
        join events.series s on s.id = o.series_id
       where o.starts_at < p_to
         and o.ends_at > p_from
         and events.is_live(s.status, s.publish_at)
         and events.audience_allows(s.audience, s.group_id, v_uid)
         and (p_category is null or s.category_id = p_category)
       order by o.starts_at, o.id
       limit least(greatest(coalesce(p_limit, 200), 1), 500)
    ) x;
  return v_out;
end;
$$;

-- Detail; null when the event doesn't exist or isn't visible to the caller.
create function public.events_occurrence(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_series uuid;
begin
  select series_id into v_series from events.occurrences where id = p_id;
  if v_series is null or not events.visible_to(v_series, v_uid) then
    return null;
  end if;
  return events.occurrence_json(p_id, v_uid) || jsonb_build_object(
    'more', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'status', o.status)
                       order by o.starts_at)
        from (select * from events.occurrences
               where series_id = v_series and id <> p_id and ends_at > now()
               order by starts_at limit 8) o), '[]'::jsonb));
end;
$$;

create function public.events_rsvp(p_occurrence uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o events.occurrences;
  s events.series;
  r events.registrations;
  v_confirmed integer;
  v_waiting boolean;
  v_status events.registration_status;
begin
  if not (select public.is_approved_member()) then
    raise exception 'Only approved members can register.' using errcode = '42501';
  end if;
  -- Lock the occurrence: every capacity decision for it is serialized here.
  select * into o from events.occurrences where id = p_occurrence for update;
  if not found or not events.visible_to(o.series_id, v_uid) then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  select * into s from events.series where id = o.series_id;
  if s.status <> 'published' or o.status <> 'scheduled' then
    raise exception 'This event has been canceled.' using errcode = '22023';
  end if;
  if not s.rsvp_enabled then
    raise exception 'This event doesn''t take registrations.' using errcode = '22023';
  end if;
  if now() >= o.starts_at - make_interval(mins => coalesce(s.rsvp_close_minutes, 0)) then
    raise exception 'Registration for this event has closed.' using errcode = '22023';
  end if;

  select * into r from events.registrations where occurrence_id = o.id and profile_id = v_uid for update;
  if found and r.status <> 'canceled' then
    return jsonb_build_object('status', r.status, 'already', true);
  end if;

  select count(*) into v_confirmed from events.registrations where occurrence_id = o.id and status = 'confirmed';
  select exists (select 1 from events.registrations where occurrence_id = o.id and status = 'waitlisted') into v_waiting;
  if s.capacity is null or (v_confirmed < s.capacity and not v_waiting) then
    v_status := 'confirmed';
  elsif s.waitlist_enabled then
    v_status := 'waitlisted';
  else
    raise exception 'This event is full.' using errcode = '22023';
  end if;

  insert into events.registrations (occurrence_id, profile_id, status, queued_at, confirmed_at, source)
  values (o.id, v_uid, v_status, clock_timestamp(), case when v_status = 'confirmed' then now() end, 'member')
  on conflict (occurrence_id, profile_id) do update
    set status = excluded.status,
        queued_at = excluded.queued_at,
        confirmed_at = excluded.confirmed_at,
        canceled_at = null,
        cancel_reason = null,
        source = 'member',
        updated_at = now()
  returning * into r;

  perform events.enqueue(case when v_status = 'confirmed' then 'rsvp_confirmed' else 'waitlisted' end,
                         v_uid, o.id, v_status || ':' || r.id || ':' || floor(extract(epoch from r.queued_at) * 1000)::bigint);
  if v_status = 'waitlisted' then
    perform events.promote(o.id);
    select * into r from events.registrations where id = r.id;
  end if;
  return jsonb_build_object('status', r.status, 'registration_id', r.id);
end;
$$;

create function public.events_cancel_rsvp(p_occurrence uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o events.occurrences;
  r events.registrations;
begin
  if v_uid is null then
    raise exception 'Sign in to manage your registration.' using errcode = '42501';
  end if;
  select * into o from events.occurrences where id = p_occurrence for update;
  if not found or not events.visible_to(o.series_id, v_uid) then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  select * into r from events.registrations
   where occurrence_id = o.id and profile_id = v_uid and status <> 'canceled' for update;
  if not found then
    return jsonb_build_object('status', 'canceled', 'already', true);
  end if;
  if o.starts_at <= now() then
    raise exception 'This event has already started.' using errcode = '22023';
  end if;
  update events.registrations
     set status = 'canceled', canceled_at = now(), cancel_reason = 'member', updated_at = now()
   where id = r.id;
  perform events.enqueue('rsvp_canceled', v_uid, o.id, 'rsvp_canceled:' || r.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
  if r.status = 'confirmed' then
    perform events.promote(o.id);
  end if;
  return jsonb_build_object('status', 'canceled');
end;
$$;

create function public.events_my_registrations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(events.occurrence_json(o.id, r.profile_id) order by o.starts_at), '[]'::jsonb)
    from events.registrations r
    join events.occurrences o on o.id = r.occurrence_id
   where r.profile_id = (select auth.uid())
     and (select public.is_approved_member())
     and r.status <> 'canceled'
     and o.ends_at > now()
     and events.visible_to(o.series_id, r.profile_id);
$$;

create function public.events_my_prefs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reminders', coalesce((select reminders from events.member_prefs where profile_id = (select auth.uid())), true),
    'feed_created_at', (select created_at from events.feed_tokens where profile_id = (select auth.uid())));
$$;

create function public.events_set_reminders(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_approved_member()) then
    raise exception 'Only approved members can change event preferences.' using errcode = '42501';
  end if;
  insert into events.member_prefs (profile_id, reminders) values ((select auth.uid()), coalesce(p_enabled, true))
  on conflict (profile_id) do update set reminders = excluded.reminders, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Calendar feeds
-- ---------------------------------------------------------------------------

-- Creates or replaces the caller's private feed token and returns it once.
-- Only its SHA-256 is stored; the previous URL stops working immediately.
create function public.events_feed_token_rotate()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
begin
  if not (select public.is_approved_member()) then
    raise exception 'Only approved members can create a calendar feed.' using errcode = '42501';
  end if;
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into events.feed_tokens (profile_id, token_hash)
  values (v_uid, extensions.digest(v_token, 'sha256'))
  on conflict (profile_id) do update set token_hash = excluded.token_hash, created_at = now();
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_uid, 'event.feed_token_created', 'profile', v_uid::text, '{}'::jsonb);
  return v_token;
end;
$$;

create function public.events_feed_token_revoke()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in to manage your calendar feed.' using errcode = '42501';
  end if;
  delete from events.feed_tokens where profile_id = v_uid;
  if found then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (v_uid, 'event.feed_token_revoked', 'profile', v_uid::text, '{}'::jsonb);
  end if;
end;
$$;

-- A member's private feed: their confirmed registrations, rechecked against
-- current membership and audience on every request. Null for an unknown or
-- revoked token or a member who is no longer approved.
create function public.events_feed_private(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select t.profile_id into v_profile
    from events.feed_tokens t
    join public.profiles p on p.id = t.profile_id and p.membership_status = 'approved'
   where t.token_hash = extensions.digest(p_token, 'sha256');
  if v_profile is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(events.occurrence_json(x.id, null) order by x.starts_at)
      from (select o.id, o.starts_at
              from events.registrations r
              join events.occurrences o on o.id = r.occurrence_id
             where r.profile_id = v_profile
               and r.status = 'confirmed'
               and o.starts_at > now() - interval '60 days'
               and o.starts_at < now() + interval '400 days'
               and events.visible_to(o.series_id, v_profile)
             order by o.starts_at
             limit 500) x), '[]'::jsonb);
end;
$$;

-- The church's public calendar (public events only), when enabled.
create function public.events_feed_public()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public_feed_enabled from events.settings), false) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(events.occurrence_json(x.id, null) order by x.starts_at)
      from (select o.id, o.starts_at
              from events.occurrences o
              join events.series s on s.id = o.series_id
             where s.audience = 'public'
               and events.is_live(s.status, s.publish_at)
               and o.starts_at > now() - interval '30 days'
               and o.starts_at < now() + interval '400 days'
             order by o.starts_at
             limit 500) x), '[]'::jsonb);
end;
$$;

create function public.events_public_feed_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public_feed_enabled from events.settings), false);
$$;

-- ---------------------------------------------------------------------------
-- Signed job entry point (scheduler and email delivery). Same HMAC scheme as
-- giving_ingest: hex HMAC-SHA256 of "op.ts.payload" with events.secrets('job').
-- ---------------------------------------------------------------------------
create function public.events_job(p_op text, p_payload text, p_ts bigint, p_sig text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v jsonb;
begin
  select value into v_key from events.secrets where name = 'job';
  if v_key is null then
    raise exception 'Event jobs are not configured.' using errcode = '42501';
  end if;
  if p_ts is null or abs(extract(epoch from now()) - p_ts) > 300 then
    raise exception 'Request expired.' using errcode = '42501';
  end if;
  if p_sig is null
     or p_sig <> encode(extensions.hmac(coalesce(p_op, '') || '.' || p_ts::text || '.' || coalesce(p_payload, ''), v_key, 'sha256'), 'hex') then
    raise exception 'Invalid signature.' using errcode = '42501';
  end if;
  v := coalesce(nullif(p_payload, ''), '{}')::jsonb;
  return case p_op
    when 'tick' then events.tick()
    when 'email_claim' then events.op_email_claim(v)
    when 'email_result' then events.op_email_result(v)
    else null
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration (events.manage)
-- ---------------------------------------------------------------------------
create function public.events_admin_list(p_filter text default 'current')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'title', s.title, 'status', s.status, 'publish_at', s.publish_at, 'audience', s.audience,
             'category', c.name, 'recurrence', s.recurrence, 'timezone', s.timezone,
             'next_start', (select min(o.starts_at) from events.occurrences o
                             where o.series_id = s.id and o.ends_at > now() and o.status = 'scheduled'),
             'first_start', (select min(o.starts_at) from events.occurrences o where o.series_id = s.id),
             'occurrences', (select count(*) from events.occurrences o where o.series_id = s.id),
             'registrations', (select count(*) from events.registrations r join events.occurrences o on o.id = r.occurrence_id
                                where o.series_id = s.id and r.status <> 'canceled' and o.ends_at > now()),
             'updated_at', s.updated_at)
           order by (s.status = 'draft') desc, coalesce((select min(o.starts_at) from events.occurrences o
                                                          where o.series_id = s.id and o.ends_at > now()), s.updated_at) )
      from events.series s
      left join events.categories c on c.id = s.category_id
     where case when p_filter = 'archived' then s.status = 'archived' else s.status <> 'archived' end), '[]'::jsonb);
end;
$$;

create function public.events_admin_get(p_series uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform events.require_manager();
  select to_jsonb(s) - 'created_by' - 'updated_by' || jsonb_build_object(
           'occurrences', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', o.id, 'occurrence_key', o.occurrence_key, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
                      'status', o.status, 'detached', o.detached, 'orphaned', o.orphaned, 'note', o.note,
                      'cancel_reason', o.cancel_reason,
                      'confirmed', (select count(*) from events.registrations r where r.occurrence_id = o.id and r.status = 'confirmed'),
                      'waitlisted', (select count(*) from events.registrations r where r.occurrence_id = o.id and r.status = 'waitlisted'))
                    order by o.starts_at)
               from events.occurrences o where o.series_id = s.id), '[]'::jsonb))
    into v_out
    from events.series s where s.id = p_series;
  return v_out;
end;
$$;

-- Admin view of one occurrence regardless of status (preview and attendee pages).
create function public.events_admin_occurrence(p_occurrence uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  return (select events.occurrence_json(o.id, null) || jsonb_build_object(
            'detached', o.detached, 'orphaned', o.orphaned,
            'override_date', o.override_date, 'override_start_time', o.override_start_time,
            'override_duration', o.override_duration,
            'override_location_name', o.override_location_name, 'override_location_address', o.override_location_address,
            'override_online_url', o.override_online_url,
            'capacity', s.capacity,
            'confirmed_count', (select count(*) from events.registrations r where r.occurrence_id = o.id and r.status = 'confirmed'),
            'waitlist_count', (select count(*) from events.registrations r where r.occurrence_id = o.id and r.status = 'waitlisted'))
            from events.occurrences o join events.series s on s.id = o.series_id
           where o.id = p_occurrence);
end;
$$;

-- Create or edit a series. Status and publication are changed only through
-- events_admin_status. Editing a published event notifies registrants of
-- occurrences whose date, time, or place changed (not of wording changes).
create function public.events_admin_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_fields jsonb := p - array['id', 'status', 'publish_at', 'sequence', 'created_by', 'updated_by', 'created_at',
                              'updated_at', 'canceled_at', 'cancel_reason', 'group_id'];
  x events.series;
  old events.series;
  v_new events.series;
  v_result jsonb;
  v_occ uuid;
begin
  perform events.require_manager();
  if v_id is null then
    x := jsonb_populate_record(null::events.series, v_fields);
    insert into events.series (title, description, cover_path, cover_alt, category_id, audience, timezone, all_day,
                               start_date, start_time, duration_minutes, day_count, location_name, location_address,
                               online_url, organizer_name, rsvp_enabled, capacity, waitlist_enabled, rsvp_close_minutes,
                               cancellation_instructions, reminder_minutes, recurrence, interval_count, weekdays,
                               monthly_mode, month_ordinal, until_date, occurrence_limit)
    values (x.title, coalesce(x.description, ''), x.cover_path, x.cover_alt, x.category_id, coalesce(x.audience, 'members'),
            x.timezone, coalesce(x.all_day, false), x.start_date, x.start_time, x.duration_minutes, x.day_count,
            x.location_name, x.location_address, x.online_url, x.organizer_name, coalesce(x.rsvp_enabled, false),
            x.capacity, coalesce(x.waitlist_enabled, false), x.rsvp_close_minutes, x.cancellation_instructions,
            coalesce(x.reminder_minutes, (select default_reminder_minutes from events.settings)),
            coalesce(x.recurrence, 'none'), coalesce(x.interval_count, 1), x.weekdays, x.monthly_mode, x.month_ordinal,
            x.until_date, x.occurrence_limit)
    returning id into v_id;
    v_result := events.sync_occurrences(v_id, false);
    return v_result || jsonb_build_object('id', v_id);
  end if;

  select * into old from events.series where id = v_id for update;
  if not found then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  if old.status in ('canceled', 'archived') then
    raise exception 'Canceled or archived events can''t be edited.' using errcode = '22023';
  end if;
  x := jsonb_populate_record(old, v_fields);
  update events.series
     set title = x.title, description = coalesce(x.description, ''), cover_path = x.cover_path, cover_alt = x.cover_alt,
         category_id = x.category_id, audience = x.audience, timezone = x.timezone, all_day = x.all_day,
         start_date = x.start_date, start_time = x.start_time, duration_minutes = x.duration_minutes, day_count = x.day_count,
         location_name = x.location_name, location_address = x.location_address, online_url = x.online_url,
         organizer_name = x.organizer_name, rsvp_enabled = x.rsvp_enabled, capacity = x.capacity,
         waitlist_enabled = x.waitlist_enabled, rsvp_close_minutes = x.rsvp_close_minutes,
         cancellation_instructions = x.cancellation_instructions, reminder_minutes = x.reminder_minutes,
         recurrence = x.recurrence, interval_count = x.interval_count, weekdays = x.weekdays, monthly_mode = x.monthly_mode,
         month_ordinal = x.month_ordinal, until_date = x.until_date, occurrence_limit = x.occurrence_limit,
         sequence = sequence + case when old.status = 'published' then 1 else 0 end
   where id = v_id
  returning * into v_new;

  v_result := events.sync_occurrences(
    v_id,
    old.status = 'published',
    (old.location_name, old.location_address, old.online_url) is distinct from (v_new.location_name, v_new.location_address, v_new.online_url));

  if old.status = 'published' and old.audience is distinct from v_new.audience then
    v_result := v_result || jsonb_build_object('removed_ineligible', events.recheck_series(v_id));
  end if;
  if old.status = 'published' and v_new.rsvp_enabled
     and (v_new.capacity is null or old.capacity is null or v_new.capacity > old.capacity or not old.rsvp_enabled) then
    for v_occ in select id from events.occurrences where series_id = v_id and ends_at > now() loop
      perform events.promote(v_occ);
    end loop;
  end if;
  return v_result || jsonb_build_object('id', v_id);
end;
$$;

-- publish (optionally scheduled), unpublish, cancel, archive, restore.
create function public.events_admin_status(p_series uuid, p_action text, p_publish_at timestamptz default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s events.series;
  v_occ uuid;
  v_active boolean;
  v_notified integer := 0;
begin
  perform events.require_manager();
  select * into s from events.series where id = p_series for update;
  if not found then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  select exists (select 1 from events.registrations r join events.occurrences o on o.id = r.occurrence_id
                  where o.series_id = s.id and r.status <> 'canceled' and o.ends_at > now()) into v_active;

  if p_action = 'publish' then
    if s.status <> 'draft' then
      raise exception 'Only drafts can be published.' using errcode = '22023';
    end if;
    if not exists (select 1 from events.occurrences where series_id = s.id and ends_at > now()) then
      raise exception 'This event has no upcoming dates.' using errcode = '22023';
    end if;
    update events.series set status = 'published', publish_at = greatest(coalesce(p_publish_at, now()), now()) where id = s.id;
  elsif p_action = 'unpublish' then
    if s.status <> 'published' then
      raise exception 'Only published events can be unpublished.' using errcode = '22023';
    end if;
    if v_active then
      raise exception 'People have registered for this event. Cancel it instead, so they are told.' using errcode = '22023';
    end if;
    update events.series set status = 'draft', publish_at = null where id = s.id;
  elsif p_action = 'cancel' then
    if s.status <> 'published' then
      raise exception 'Only published events can be canceled.' using errcode = '22023';
    end if;
    update events.series
       set status = 'canceled', canceled_at = now(), cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           sequence = sequence + 1
     where id = s.id;
    for v_occ in
      update events.occurrences set sequence = sequence + 1, updated_at = now()
       where series_id = s.id and status = 'scheduled' and ends_at > now()
      returning id
    loop
      v_notified := v_notified + events.notify_registrants(v_occ, 'event_canceled');
    end loop;
  elsif p_action = 'archive' then
    if s.status = 'archived' then
      return jsonb_build_object('status', 'archived');
    end if;
    if s.status = 'published' and v_active then
      raise exception 'People are registered for upcoming dates. Cancel the event before archiving it.' using errcode = '22023';
    end if;
    update events.series set status = 'archived', publish_at = coalesce(publish_at, now()) where id = s.id;
  elsif p_action = 'restore' then
    if s.status <> 'archived' then
      raise exception 'Only archived events can be restored.' using errcode = '22023';
    end if;
    update events.series set status = 'draft', publish_at = null, canceled_at = null, cancel_reason = null where id = s.id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  return jsonb_build_object('status', (select status from events.series where id = s.id), 'notified', v_notified);
end;
$$;

-- Edit one occurrence. Passing no overrides re-attaches it to the series.
create function public.events_admin_occurrence_save(p_occurrence uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o events.occurrences;
  s events.series;
  v_date date := nullif(p ->> 'override_date', '')::date;
  v_time time := nullif(p ->> 'override_start_time', '')::time;
  v_duration integer := nullif(p ->> 'override_duration', '')::integer;
  v_lname text := nullif(btrim(coalesce(p ->> 'override_location_name', '')), '');
  v_laddr text := nullif(btrim(coalesce(p ->> 'override_location_address', '')), '');
  v_url text := nullif(btrim(coalesce(p ->> 'override_online_url', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  v_detached boolean;
  v_starts timestamptz;
  v_ends timestamptz;
  v_fields text[] := '{}';
  v_notified integer := 0;
begin
  perform events.require_manager();
  select * into o from events.occurrences where id = p_occurrence for update;
  if not found then
    raise exception 'That date wasn''t found.' using errcode = 'P0002';
  end if;
  select * into s from events.series where id = o.series_id;
  if s.status in ('canceled', 'archived') then
    raise exception 'Canceled or archived events can''t be edited.' using errcode = '22023';
  end if;
  if o.ends_at <= now() then
    raise exception 'Past dates can''t be edited.' using errcode = '22023';
  end if;
  if s.all_day then
    v_time := null;
    v_duration := null;
  end if;
  v_detached := v_date is not null or v_time is not null or v_duration is not null
                or coalesce(v_lname, v_laddr, v_url) is not null;
  select t.starts_at, t.ends_at into v_starts, v_ends
    from events.occurrence_times(s, o.occurrence_key, v_date, v_time, v_duration) t;
  if v_starts <= now() then
    raise exception 'Choose a date and time in the future.' using errcode = '22023';
  end if;
  if v_starts is distinct from o.starts_at or v_ends is distinct from o.ends_at then
    v_fields := v_fields || 'time'::text;
  end if;
  if (v_lname, v_laddr, v_url) is distinct from (o.override_location_name, o.override_location_address, o.override_online_url) then
    v_fields := v_fields || 'place'::text;
  end if;
  update events.occurrences
     set detached = v_detached, override_date = v_date, override_start_time = v_time, override_duration = v_duration,
         override_location_name = v_lname, override_location_address = v_laddr, override_online_url = v_url,
         note = v_note, starts_at = v_starts, ends_at = v_ends,
         sequence = sequence + case when cardinality(v_fields) > 0 or v_note is distinct from o.note then 1 else 0 end,
         updated_at = now()
   where id = o.id;
  if cardinality(v_fields) > 0 and o.status = 'scheduled' then
    v_notified := events.notify_registrants(o.id, 'changed', jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.occurrence_updated', 'event_occurrence', o.id::text,
          jsonb_build_object('series', s.id, 'fields', to_jsonb(v_fields), 'detached', v_detached));
  return jsonb_build_object('notified', v_notified);
end;
$$;

create function public.events_admin_occurrence_cancel(p_occurrence uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o events.occurrences;
  v_notified integer;
begin
  perform events.require_manager();
  select * into o from events.occurrences where id = p_occurrence for update;
  if not found then
    raise exception 'That date wasn''t found.' using errcode = 'P0002';
  end if;
  if o.status = 'canceled' then
    return jsonb_build_object('notified', 0);
  end if;
  update events.occurrences
     set status = 'canceled', cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), sequence = sequence + 1, updated_at = now()
   where id = o.id;
  v_notified := events.notify_registrants(o.id, 'occurrence_canceled');
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.occurrence_canceled', 'event_occurrence', o.id::text, jsonb_build_object('series', o.series_id));
  return jsonb_build_object('notified', v_notified);
end;
$$;

create function public.events_admin_occurrence_restore(p_occurrence uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o events.occurrences;
  s events.series;
  v_notified integer;
begin
  perform events.require_manager();
  select * into o from events.occurrences where id = p_occurrence for update;
  if not found then
    raise exception 'That date wasn''t found.' using errcode = 'P0002';
  end if;
  select * into s from events.series where id = o.series_id;
  if s.status in ('canceled', 'archived') then
    raise exception 'Restore the event before restoring one of its dates.' using errcode = '22023';
  end if;
  if o.orphaned then
    raise exception 'This date is no longer on the event''s schedule.' using errcode = '22023';
  end if;
  if o.status = 'scheduled' then
    return jsonb_build_object('notified', 0);
  end if;
  if o.starts_at <= now() then
    raise exception 'Past dates can''t be restored.' using errcode = '22023';
  end if;
  update events.occurrences
     set status = 'scheduled', cancel_reason = null, sequence = sequence + 1, updated_at = now()
   where id = o.id;
  v_notified := events.notify_registrants(o.id, 'changed', jsonb_build_object('fields', jsonb_build_array('restored')));
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.occurrence_restored', 'event_occurrence', o.id::text, jsonb_build_object('series', o.series_id));
  return jsonb_build_object('notified', v_notified);
end;
$$;

-- Attendees and waitlist for one occurrence (organizers only).
create function public.events_admin_attendees(p_occurrence uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'profile_id', r.profile_id,
             'name', coalesce(nullif(btrim(p.preferred_name), '') || ' ' || coalesce(p.last_name, ''), p.full_name, p.email),
             'email', p.email,
             'status', r.status,
             'position', case when r.status = 'waitlisted' then
                           (select count(*) from events.registrations w where w.occurrence_id = r.occurrence_id
                              and w.status = 'waitlisted' and (w.queued_at, w.id) <= (r.queued_at, r.id)) end,
             'queued_at', r.queued_at, 'confirmed_at', r.confirmed_at, 'canceled_at', r.canceled_at,
             'cancel_reason', r.cancel_reason, 'source', r.source)
           order by case r.status when 'confirmed' then 0 when 'waitlisted' then 1 else 2 end, r.queued_at, r.id)
      from events.registrations r
      join public.profiles p on p.id = r.profile_id
     where r.occurrence_id = p_occurrence), '[]'::jsonb);
end;
$$;

create function public.events_admin_export(p_occurrence uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform events.require_manager();
  v_rows := public.events_admin_attendees(p_occurrence);
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.attendees_exported', 'event_occurrence', p_occurrence::text,
          jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

create function public.events_admin_member_search(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
begin
  perform events.require_manager();
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.full_name, p.email), 'email', p.email)
                     order by p.full_name nulls last)
      from (select * from public.profiles p
             where p.membership_status = 'approved' and p.account_kind = 'adult'
               and (p.full_name ilike v_like or p.preferred_name ilike v_like or p.email ilike v_like)
             order by p.full_name nulls last
             limit 20) p), '[]'::jsonb);
end;
$$;

-- Administrative registration: ignores the registration deadline; respects
-- capacity unless p_override_capacity. Audited with the reason.
create function public.events_admin_register(p_occurrence uuid, p_profile uuid, p_reason text, p_override_capacity boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o events.occurrences;
  s events.series;
  r events.registrations;
  v_confirmed integer;
  v_waiting boolean;
  v_status events.registration_status;
begin
  perform events.require_manager();
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Enter a reason.' using errcode = '22023';
  end if;
  select * into o from events.occurrences where id = p_occurrence for update;
  if not found then
    raise exception 'That date wasn''t found.' using errcode = 'P0002';
  end if;
  select * into s from events.series where id = o.series_id;
  if s.status <> 'published' or o.status <> 'scheduled' or o.ends_at <= now() then
    raise exception 'Registrations can only be added to upcoming dates of published events.' using errcode = '22023';
  end if;
  if not s.rsvp_enabled then
    raise exception 'This event doesn''t take registrations.' using errcode = '22023';
  end if;
  if not events.visible_to(s.id, p_profile) then
    raise exception 'That person isn''t an approved member who can attend this event.' using errcode = '22023';
  end if;
  select * into r from events.registrations where occurrence_id = o.id and profile_id = p_profile for update;
  if found and r.status <> 'canceled' then
    raise exception 'That person is already registered.' using errcode = '22023';
  end if;
  select count(*) into v_confirmed from events.registrations where occurrence_id = o.id and status = 'confirmed';
  select exists (select 1 from events.registrations where occurrence_id = o.id and status = 'waitlisted') into v_waiting;
  if s.capacity is null or coalesce(p_override_capacity, false) or (v_confirmed < s.capacity and not v_waiting) then
    v_status := 'confirmed';
  elsif s.waitlist_enabled then
    v_status := 'waitlisted';
  else
    raise exception 'This date is full. Choose "allow over capacity" to add them anyway.' using errcode = '22023';
  end if;
  insert into events.registrations (occurrence_id, profile_id, status, queued_at, confirmed_at, source)
  values (o.id, p_profile, v_status, clock_timestamp(), case when v_status = 'confirmed' then now() end, 'admin')
  on conflict (occurrence_id, profile_id) do update
    set status = excluded.status, queued_at = excluded.queued_at, confirmed_at = excluded.confirmed_at,
        canceled_at = null, cancel_reason = null, source = 'admin', updated_at = now()
  returning * into r;
  perform events.enqueue(case when v_status = 'confirmed' then 'rsvp_confirmed' else 'waitlisted' end,
                         p_profile, o.id, v_status || ':' || r.id || ':' || floor(extract(epoch from r.queued_at) * 1000)::bigint,
                         jsonb_build_object('by_admin', true));
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.registration_added', 'event_occurrence', o.id::text,
          jsonb_build_object('registration', r.id, 'status', v_status, 'over_capacity',
                             coalesce(p_override_capacity, false) and s.capacity is not null and v_confirmed >= s.capacity,
                             'reason', left(btrim(p_reason), 250)));
  return jsonb_build_object('status', v_status, 'registration_id', r.id);
end;
$$;

create function public.events_admin_cancel_registration(p_registration uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r events.registrations;
  v_occ uuid;
begin
  perform events.require_manager();
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Enter a reason.' using errcode = '22023';
  end if;
  select occurrence_id into v_occ from events.registrations where id = p_registration;
  if v_occ is null then
    raise exception 'That registration wasn''t found.' using errcode = 'P0002';
  end if;
  perform 1 from events.occurrences where id = v_occ for update;
  select * into r from events.registrations where id = p_registration for update;
  if r.status = 'canceled' then
    return jsonb_build_object('status', 'canceled', 'already', true);
  end if;
  update events.registrations
     set status = 'canceled', canceled_at = now(), cancel_reason = 'admin', updated_at = now()
   where id = r.id;
  perform events.enqueue('rsvp_canceled', r.profile_id, r.occurrence_id,
    'rsvp_canceled:' || r.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    jsonb_build_object('by_admin', true));
  if r.status = 'confirmed' then
    perform events.promote(r.occurrence_id);
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.registration_canceled', 'event_occurrence', r.occurrence_id::text,
          jsonb_build_object('registration', r.id, 'status_from', r.status, 'reason', left(btrim(p_reason), 250)));
  return jsonb_build_object('status', 'canceled');
end;
$$;

create function public.events_admin_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'active', c.active, 'sort_order', c.sort_order,
                                                       'events', (select count(*) from events.series s where s.category_id = c.id))
                                    order by c.sort_order, c.name)
                     from events.categories c), '[]'::jsonb);
end;
$$;

create function public.events_admin_category_save(p_id uuid, p_name text, p_active boolean, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform events.require_manager();
  if p_id is null then
    insert into events.categories (name, active, sort_order) values (btrim(p_name), coalesce(p_active, true), coalesce(p_sort, 0))
    returning id into v_id;
  else
    update events.categories
       set name = btrim(p_name), active = coalesce(p_active, active), sort_order = coalesce(p_sort, sort_order), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'That category wasn''t found.' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), case when p_id is null then 'event.category_created' else 'event.category_updated' end,
          'event_category', v_id::text, jsonb_build_object('active', coalesce(p_active, true)));
  return v_id;
exception when unique_violation then
  raise exception 'A category with that name already exists.' using errcode = '22023';
end;
$$;

create function public.events_admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  return (select jsonb_build_object(
            'public_feed_enabled', s.public_feed_enabled,
            'default_reminder_minutes', s.default_reminder_minutes,
            'scheduler_configured', s.job_url is not null,
            'jobs_configured', exists (select 1 from events.secrets where name = 'job'),
            'outbox', (select jsonb_object_agg(status, n) from (select status, count(*) n from events.outbox group by status) t))
            from events.settings s);
end;
$$;

create function public.events_admin_settings_save(p_public_feed boolean, p_default_reminders integer[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  update events.settings
     set public_feed_enabled = coalesce(p_public_feed, false),
         default_reminder_minutes = coalesce(p_default_reminders, default_reminder_minutes),
         updated_at = now();
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.settings_updated', 'event_settings', 'events',
          jsonb_build_object('public_feed_enabled', coalesce(p_public_feed, false)));
end;
$$;

-- Messages that failed or are still queued (no addresses, no content).
create function public.events_admin_outbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'status', e.status, 'attempts', e.attempts,
                                        'last_error', e.last_error, 'created_at', e.created_at, 'event', s.title,
                                        'starts_at', o.starts_at) order by e.created_at desc)
      from (select * from events.outbox where status in ('failed', 'pending', 'sending') order by created_at desc limit 100) e
      join events.occurrences o on o.id = e.occurrence_id
      join events.series s on s.id = o.series_id), '[]'::jsonb);
end;
$$;

create function public.events_admin_email_retry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  update events.outbox set status = 'pending', attempts = 0, next_attempt_at = now(), updated_at = now()
   where id = p_id and status = 'failed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Event images: private bucket; readable only while the image belongs to an
-- event the caller can see (or by event managers). Images are re-encoded by
-- the app to WebP without metadata before upload.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-images', 'event-images', false, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.can_view_event_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.has_capability('events.manage'))
      or exists (
        select 1 from events.series s
         where s.cover_path = p_name
           and events.is_live(s.status, s.publish_at)
           and events.audience_allows(s.audience, s.group_id, (select auth.uid())));
$$;

create policy "Event images follow event visibility"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'event-images' and (select public.can_view_event_image(storage.objects.name)));

create policy "Event managers upload event images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'event-images' and (select public.has_capability('events.manage')));

create policy "Event managers delete event images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'event-images' and (select public.has_capability('events.manage')));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema events from public, anon, authenticated;

revoke execute on function
  public.events_categories(), public.events_list(timestamptz, timestamptz, uuid, integer), public.events_occurrence(uuid),
  public.events_rsvp(uuid), public.events_cancel_rsvp(uuid), public.events_my_registrations(), public.events_my_prefs(),
  public.events_set_reminders(boolean), public.events_feed_token_rotate(), public.events_feed_token_revoke(),
  public.events_feed_private(text), public.events_feed_public(), public.events_public_feed_enabled(), public.events_job(text, text, bigint, text),
  public.events_admin_list(text), public.events_admin_get(uuid), public.events_admin_occurrence(uuid),
  public.events_admin_save(jsonb), public.events_admin_status(uuid, text, timestamptz, text),
  public.events_admin_occurrence_save(uuid, jsonb), public.events_admin_occurrence_cancel(uuid, text),
  public.events_admin_occurrence_restore(uuid), public.events_admin_attendees(uuid), public.events_admin_export(uuid),
  public.events_admin_member_search(text), public.events_admin_register(uuid, uuid, text, boolean),
  public.events_admin_cancel_registration(uuid, text), public.events_admin_categories(),
  public.events_admin_category_save(uuid, text, boolean, integer), public.events_admin_settings(),
  public.events_admin_settings_save(boolean, integer[]), public.events_admin_outbox(), public.events_admin_email_retry(uuid),
  public.can_view_event_image(text)
from public;

-- Visitors (public events only) and members.
grant execute on function
  public.events_categories(), public.events_list(timestamptz, timestamptz, uuid, integer), public.events_occurrence(uuid),
  public.events_feed_private(text), public.events_feed_public(), public.events_public_feed_enabled(),
  public.events_job(text, text, bigint, text), public.can_view_event_image(text)
to anon, authenticated;

-- Signed-in only (each function re-checks membership or events.manage).
grant execute on function
  public.events_rsvp(uuid), public.events_cancel_rsvp(uuid), public.events_my_registrations(), public.events_my_prefs(),
  public.events_set_reminders(boolean), public.events_feed_token_rotate(), public.events_feed_token_revoke(),
  public.events_admin_list(text), public.events_admin_get(uuid), public.events_admin_occurrence(uuid),
  public.events_admin_save(jsonb), public.events_admin_status(uuid, text, timestamptz, text),
  public.events_admin_occurrence_save(uuid, jsonb), public.events_admin_occurrence_cancel(uuid, text),
  public.events_admin_occurrence_restore(uuid), public.events_admin_attendees(uuid), public.events_admin_export(uuid),
  public.events_admin_member_search(text), public.events_admin_register(uuid, uuid, text, boolean),
  public.events_admin_cancel_registration(uuid, text), public.events_admin_categories(),
  public.events_admin_category_save(uuid, text, boolean, integer), public.events_admin_settings(),
  public.events_admin_settings_save(boolean, integer[]), public.events_admin_outbox(), public.events_admin_email_retry(uuid)
to authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261021000300', 'events_access', 'phase-4');

commit;
