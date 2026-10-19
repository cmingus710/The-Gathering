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
