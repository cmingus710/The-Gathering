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
