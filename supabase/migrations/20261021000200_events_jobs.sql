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
