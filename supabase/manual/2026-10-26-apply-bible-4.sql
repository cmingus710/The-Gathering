-- Phase 8 · Step 4 of 6: apply migration 20261026000400_bible_member to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Member reading: plans, enrollment, today's reading, progress, completion, catch-up, bookmarks, highlights, reader settings, and export.
--
-- It copies supabase/migrations/20261026000400_bible_member.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-8).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('bible.translations') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the Phase 8 stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000300') then
    raise exception 'Nothing was changed: the previous step (20261026000300) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000400') then
    raise exception 'Nothing was changed: 20261026000400 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261026000400_bible_member.sql
-- =========================================================================
-- Phase 8 · Member reading: plans, enrollment, today's assignment,
-- progress, completion, catch-up, bookmarks, highlights, reader settings,
-- and the member's own export.
--
-- Rules:
--   * A member sees published plans whose audience includes them, plus
--     archived plans they joined (their history stays readable).
--   * Dates: calendar plans use the plan's time zone; personal plans use
--     the member's chosen time zone and start date. A personal plan's day N
--     is read on start_date + N - 1 (dates, not timestamps, so daylight
--     saving changes never shift a day).
--   * Rest days never count as missed and can't be marked. Catch-up days
--     can be marked but aren't required.
--   * Opening a passage never marks it read; only bible_day_complete does,
--     idempotently, recording the assignment revision that was read.
--   * Leaving a plan keeps its history; deleting it is a separate,
--     confirmed action.
--   * Progress, bookmarks, highlights, and settings are visible only to
--     their owner. No staff function reads them.

-- ---------------------------------------------------------------------------
-- Access and shapes
-- ---------------------------------------------------------------------------
create function bible.member_can_read_plan(p bible.plans, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select bible.plan_visible(p, p_profile)
      or (p.status = 'archived' and bible.is_member(p_profile)
          and (p.audience = 'members' or community.group_member(p.group_id, p_profile))
          and exists (select 1 from bible.enrollments e where e.plan_id = p.id and e.profile_id = p_profile));
$$;

create function bible.day_label(d bible.plan_days)
returns text
language sql
stable
set search_path = ''
as $$
  select case when d.day_date is not null then to_char(d.day_date, 'FMDay, FMMonth FMDD, YYYY') else 'Day ' || d.day_number end;
$$;

create function bible.plan_card(p bible.plans)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'cover_path', p.cover_path, 'cover_alt', p.cover_alt,
    'mode', p.mode, 'timezone', p.timezone, 'audience', p.audience, 'audience_note', p.audience_note,
    'group_name', (select g.name from community.groups g where g.id = p.group_id),
    'status', p.status, 'featured', p.featured,
    'translation', (select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) from bible.translations t where t.id = p.translation_id),
    'reading_days', (select count(*) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null and d.kind = 'reading'),
    'days', (select count(*) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null),
    'first_date', (select min(d.day_date) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null),
    'last_date', (select max(d.day_date) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null),
    'last_day_number', (select max(d.day_number) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null),
    'plan_today', bible.local_today(p.timezone));
$$;

create function bible.enrollment_json(e bible.enrollments)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', e.id, 'status', e.status, 'is_primary', e.is_primary, 'start_date', e.start_date,
                            'expect_from', e.expect_from, 'timezone', e.timezone, 'reminders', e.reminders,
                            'reminder_time', to_char(e.reminder_time, 'HH24:MI'), 'reminders_paused', e.reminders_paused,
                            'joined_at', e.joined_at, 'left_at', e.left_at);
$$;

-- Reading days that count for an enrollment: not retired, and (calendar)
-- on or after the date the member chose to count from.
create function bible.progress(e bible.enrollments, p bible.plans)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select bible.enrollment_today(e, p) as d),
  days as (
    select d.id, bible.day_date_for(e, d) as on_date,
           exists (select 1 from bible.completions c where c.enrollment_id = e.id and c.day_id = d.id) as done
      from bible.plan_days d
     where d.plan_id = p.id and d.retired_at is null and d.kind = 'reading'
       and (e.expect_from is null or d.day_date is null or d.day_date >= e.expect_from)
  )
  select jsonb_build_object(
    'today', (select d from today),
    'total', (select count(*) from days),
    'completed', (select count(*) from days where done),
    'remaining', (select count(*) from days where not done),
    'due', (select count(*) from days where on_date <= (select d from today)),
    'behind', (select count(*) from days where not done and on_date < (select d from today)),
    'started', p.mode = 'calendar' and (select min(on_date) from days) <= (select d from today)
               or p.mode = 'personal' and e.start_date <= (select d from today),
    'finished', (select count(*) from days) > 0 and not exists (select 1 from days where not done),
    'day_index', case when p.mode = 'personal' and e.start_date is not null then (select d from today) - e.start_date + 1 end);
$$;

-- A compact summary of the scheduled day for a date.
create function bible.day_summary(e bible.enrollments, p bible.plans, p_day uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'heading', d.heading, 'label', bible.day_label(d), 'day_number', d.day_number,
    'scheduled', bible.day_date_for(e, d),
    'passages', (select coalesce(jsonb_agg(pp.label order by pp.position), '[]'::jsonb) from bible.plan_passages pp where pp.day_id = d.id),
    'completed', exists (select 1 from bible.completions c where c.enrollment_id = e.id and c.day_id = d.id)) end
    from (select 1) one left join bible.plan_days d on d.id = p_day;
$$;

-- ---------------------------------------------------------------------------
-- Hub, plan, day
-- ---------------------------------------------------------------------------
create function public.bible_hub()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  return jsonb_build_object(
    'featured', (select bible.plan_card(p) || jsonb_build_object('enrolled', exists (select 1 from bible.enrollments e
                                                                                       where e.plan_id = p.id and e.profile_id = v_uid and e.status = 'active'))
                   from bible.plans p where p.featured and bible.plan_visible(p, v_uid) limit 1),
    'enrollments', coalesce((
       select jsonb_agg(jsonb_build_object('enrollment', bible.enrollment_json(e), 'plan', bible.plan_card(p),
                                           'progress', bible.progress(e, p),
                                           'today', bible.day_summary(e, p, bible.day_on(e, p, bible.enrollment_today(e, p))))
                        order by e.is_primary desc, e.joined_at)
         from bible.enrollments e join bible.plans p on p.id = e.plan_id
        where e.profile_id = v_uid and e.status = 'active' and bible.member_can_read_plan(p, v_uid)), '[]'::jsonb),
    'available', coalesce((
       select jsonb_agg(bible.plan_card(p) order by p.featured desc, p.published_at desc)
         from bible.plans p
        where bible.plan_visible(p, v_uid)
          and not exists (select 1 from bible.enrollments e where e.plan_id = p.id and e.profile_id = v_uid and e.status = 'active')), '[]'::jsonb),
    'history', coalesce((
       select jsonb_agg(jsonb_build_object('enrollment', bible.enrollment_json(e), 'plan', bible.plan_card(p), 'progress', bible.progress(e, p))
                        order by e.left_at desc)
         from bible.enrollments e join bible.plans p on p.id = e.plan_id
        where e.profile_id = v_uid and e.status = 'left' and bible.member_can_read_plan(p, v_uid)), '[]'::jsonb),
    'member_timezone', community.member_tz(v_uid));
end;
$$;

create function public.bible_plan(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  p bible.plans;
  e bible.enrollments;
  v_today date;
begin
  select * into p from bible.plans where id = p_id;
  if not found or not bible.member_can_read_plan(p, v_uid) then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  select * into e from bible.enrollments where plan_id = p.id and profile_id = v_uid;
  v_today := case when e.id is not null then bible.enrollment_today(e, p) else bible.local_today(case when p.mode = 'calendar' then p.timezone else community.member_tz(v_uid) end) end;
  return bible.plan_card(p) || jsonb_build_object(
    'enrollment', case when e.id is not null then bible.enrollment_json(e) end,
    'progress', case when e.id is not null then bible.progress(e, p) end,
    'today', v_today,
    'member_timezone', community.member_tz(v_uid),
    'today_day', case when e.id is not null and e.status = 'active' then bible.day_summary(e, p, bible.day_on(e, p, v_today)) end,
    'day_list', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', d.id, 'day_number', d.day_number, 'day_date', d.day_date, 'kind', d.kind, 'heading', d.heading,
                'label', bible.day_label(d),
                'scheduled', case when e.id is not null then bible.day_date_for(e, d) else d.day_date end,
                'passages', (select coalesce(jsonb_agg(pp.label order by pp.position), '[]'::jsonb) from bible.plan_passages pp where pp.day_id = d.id),
                'completed', e.id is not null and exists (select 1 from bible.completions c where c.enrollment_id = e.id and c.day_id = d.id),
                'counted', e.id is null or e.expect_from is null or d.day_date is null or d.day_date >= e.expect_from)
              order by d.day_date, d.day_number)
         from bible.plan_days d where d.plan_id = p.id and d.retired_at is null), '[]'::jsonb));
end;
$$;

create function public.bible_day(p_day uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  d bible.plan_days;
  p bible.plans;
  e bible.enrollments;
  c bible.completions;
  v_prev uuid;
  v_next uuid;
begin
  select * into d from bible.plan_days where id = p_day;
  if found then
    select * into p from bible.plans where id = d.plan_id;
  end if;
  if d.id is null or not bible.member_can_read_plan(p, v_uid) then
    raise exception 'Reading not found.' using errcode = 'P0002';
  end if;
  select * into e from bible.enrollments where plan_id = p.id and profile_id = v_uid;
  if e.id is not null then
    select * into c from bible.completions where enrollment_id = e.id and day_id = d.id;
  end if;
  -- Previous/next current days in schedule order.
  select x.id into v_prev from bible.plan_days x
   where x.plan_id = p.id and x.retired_at is null
     and (coalesce(x.day_date, '-infinity'::date), coalesce(x.day_number, 0)) < (coalesce(d.day_date, '-infinity'::date), coalesce(d.day_number, 0))
   order by x.day_date desc nulls last, x.day_number desc nulls last limit 1;
  select x.id into v_next from bible.plan_days x
   where x.plan_id = p.id and x.retired_at is null
     and (coalesce(x.day_date, '-infinity'::date), coalesce(x.day_number, 0)) > (coalesce(d.day_date, '-infinity'::date), coalesce(d.day_number, 0))
   order by x.day_date nulls last, x.day_number nulls last limit 1;
  return jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'heading', d.heading, 'notes', d.notes, 'questions', to_jsonb(d.questions),
    'label', bible.day_label(d), 'day_number', d.day_number, 'day_date', d.day_date, 'revision', d.revision,
    'retired', d.retired_at is not null,
    'scheduled', case when e.id is not null then bible.day_date_for(e, d) else d.day_date end,
    'today', case when e.id is not null then bible.enrollment_today(e, p) else bible.local_today(p.timezone) end,
    'plan', bible.plan_card(p),
    'enrollment', case when e.id is not null then bible.enrollment_json(e) end,
    'completed', c.day_id is not null,
    'completed_revision', c.revision,
    -- What the member read, if the assignment has changed since.
    'completed_snapshot', case when c.day_id is not null and c.revision <> d.revision
                               then (select r.snapshot from bible.day_revisions r where r.day_id = d.id and r.revision = c.revision) end,
    'passages', bible.passages_json(d.id),
    'prev_id', v_prev, 'next_id', v_next,
    'discussion', (select jsonb_build_object('id', t.id, 'title', t.title) from community.threads t
                    where t.id = d.discussion_thread_id and t.status = 'visible' and community.can_read_thread(t.id, v_uid)),
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title) order by l.position)
                         from bible.plan_day_links l join media.items i on i.id = l.media_item_id
                        where l.day_id = d.id and media.item_visible(i, v_uid)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Enrollment
-- ---------------------------------------------------------------------------
create function public.bible_plan_join(p_plan uuid, p_start_date date default null, p_timezone text default null, p_from_start boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  p bible.plans;
  e bible.enrollments;
  v_tz text := coalesce(nullif(p_timezone, ''), community.member_tz(v_uid));
  v_start date;
  v_expect date;
  v_primary boolean;
begin
  select * into p from bible.plans where id = p_plan;
  if not found or not bible.plan_visible(p, v_uid) then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  if not bible.valid_tz(v_tz) then
    raise exception 'Choose a valid time zone.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'bible_join', 30, interval '1 hour');
  if p.mode = 'personal' then
    v_start := coalesce(p_start_date, bible.local_today(v_tz));
    if v_start not between bible.local_today(v_tz) - 400 and bible.local_today(v_tz) + 400 then
      raise exception 'Choose a start date within about a year of today.' using errcode = '22023';
    end if;
  else
    -- Joining a dated plan after it began: count from today unless the
    -- member chooses to catch up from the beginning.
    if not coalesce(p_from_start, true) then
      v_expect := bible.local_today(p.timezone);
    end if;
  end if;
  v_primary := not exists (select 1 from bible.enrollments x where x.profile_id = v_uid and x.is_primary);
  select * into e from bible.enrollments where plan_id = p.id and profile_id = v_uid for update;
  if found then
    update bible.enrollments set status = 'active', left_at = null,
           is_primary = is_primary or v_primary,
           start_date = case when p.mode = 'personal' then coalesce(p_start_date, start_date, v_start) end,
           expect_from = case when p.mode = 'calendar' then v_expect end,
           timezone = v_tz, updated_at = now()
     where id = e.id
    returning * into e;
  else
    insert into bible.enrollments (plan_id, profile_id, is_primary, start_date, expect_from, timezone)
    values (p.id, v_uid, v_primary, v_start, v_expect, v_tz)
    returning * into e;
  end if;
  return bible.enrollment_json(e);
end;
$$;

create function public.bible_enrollment_update(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  e bible.enrollments;
  x bible.plans;
  v_tz text;
begin
  select * into e from bible.enrollments where id = p_id and profile_id = v_uid for update;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  select * into x from bible.plans where id = e.plan_id;
  if e.status <> 'active' or not bible.member_can_read_plan(x, v_uid) then
    raise exception 'Join the plan again to change its settings.' using errcode = '22023';
  end if;
  v_tz := coalesce(nullif(p ->> 'timezone', ''), e.timezone);
  if not bible.valid_tz(v_tz) then
    raise exception 'Choose a valid time zone.' using errcode = '22023';
  end if;
  if coalesce((p ->> 'reminders')::boolean, false) and not bible.plan_visible(x, v_uid) then
    raise exception 'Reminders are available while the plan is published.' using errcode = '22023';
  end if;
  if p ? 'start_date' and x.mode = 'personal'
     and (p ->> 'start_date')::date not between bible.local_today(v_tz) - 400 and bible.local_today(v_tz) + 400 then
    raise exception 'Choose a start date within about a year of today.' using errcode = '22023';
  end if;
  if coalesce((p ->> 'is_primary')::boolean, false) then
    update bible.enrollments set is_primary = false, updated_at = now() where profile_id = v_uid and is_primary and id <> e.id;
  end if;
  update bible.enrollments set
    is_primary = coalesce((p ->> 'is_primary')::boolean, is_primary),
    reminders = coalesce((p ->> 'reminders')::boolean, reminders),
    reminder_time = coalesce(nullif(p ->> 'reminder_time', '')::time, reminder_time),
    reminders_paused = coalesce((p ->> 'reminders_paused')::boolean, reminders_paused),
    timezone = v_tz,
    start_date = case when x.mode = 'personal' and p ? 'start_date' then (p ->> 'start_date')::date else start_date end,
    expect_from = case when x.mode = 'calendar' and p ? 'count_from'
                       then case p ->> 'count_from' when 'today' then bible.local_today(x.timezone) else null end
                       else expect_from end,
    updated_at = now()
  where id = e.id
  returning * into e;
  return bible.enrollment_json(e);
end;
$$;

-- Leaving keeps the history (and journal entries); reminders stop.
create function public.bible_plan_leave(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  e bible.enrollments;
begin
  update bible.enrollments set status = 'left', left_at = now(), is_primary = false, reminders = false, updated_at = now()
   where id = p_id and profile_id = v_uid and status = 'active'
  returning * into e;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  -- Another active plan becomes primary.
  update bible.enrollments set is_primary = true, updated_at = now()
   where id = (select id from bible.enrollments where profile_id = v_uid and status = 'active' order by joined_at limit 1)
     and not exists (select 1 from bible.enrollments where profile_id = v_uid and is_primary);
  delete from community.notifications n
   where n.profile_id = v_uid and n.read_at is null and n.category = 'reading' and not community.notification_visible(n);
  return bible.enrollment_json(e);
end;
$$;

-- Deletes the enrollment and its completions. Journal entries are separate
-- and kept (their link to the plan day stays).
create function public.bible_enrollment_delete(p_id uuid, p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  if p_confirm is distinct from 'delete' then
    raise exception 'Confirm that you want to delete this plan''s history.' using errcode = '22023';
  end if;
  delete from bible.enrollments where id = p_id and profile_id = v_uid;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  update bible.enrollments set is_primary = true, updated_at = now()
   where id = (select id from bible.enrollments where profile_id = v_uid and status = 'active' order by joined_at limit 1)
     and not exists (select 1 from bible.enrollments where profile_id = v_uid and is_primary);
end;
$$;

-- ---------------------------------------------------------------------------
-- Completion (idempotent both ways)
-- ---------------------------------------------------------------------------
create function public.bible_day_complete(p_day uuid, p_done boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  d bible.plan_days;
  p bible.plans;
  e bible.enrollments;
begin
  select * into d from bible.plan_days where id = p_day;
  if found then
    select * into p from bible.plans where id = d.plan_id;
  end if;
  if d.id is null or not bible.member_can_read_plan(p, v_uid) then
    raise exception 'Reading not found.' using errcode = 'P0002';
  end if;
  select * into e from bible.enrollments where plan_id = p.id and profile_id = v_uid and status = 'active';
  if not found then
    raise exception 'Join this plan to keep track of your reading.' using errcode = '22023';
  end if;
  if d.kind = 'rest' then
    raise exception 'Rest days don''t need to be marked.' using errcode = '22023';
  end if;
  if d.retired_at is not null and p_done then
    raise exception 'This reading was removed from the plan.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'bible_complete', 300, interval '10 minutes');
  if p_done then
    insert into bible.completions (enrollment_id, day_id, revision) values (e.id, d.id, d.revision)
    on conflict (enrollment_id, day_id) do nothing;
  else
    delete from bible.completions where enrollment_id = e.id and day_id = d.id;
  end if;
  return jsonb_build_object('completed', exists (select 1 from bible.completions where enrollment_id = e.id and day_id = d.id),
                            'progress', bible.progress(e, p));
end;
$$;

-- The home card: the primary plan's reading for today (or nothing).
create function public.bible_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  e bible.enrollments;
  p bible.plans;
begin
  select x.* into e from bible.enrollments x join bible.plans y on y.id = x.plan_id
   where x.profile_id = v_uid and x.status = 'active' and bible.plan_visible(y, v_uid)
   order by x.is_primary desc, x.joined_at limit 1;
  if not found then
    return null;
  end if;
  select * into p from bible.plans where id = e.plan_id;
  return jsonb_build_object('plan', jsonb_build_object('id', p.id, 'title', p.title), 'enrollment_id', e.id,
                            'today', bible.enrollment_today(e, p),
                            'day', bible.day_summary(e, p, bible.day_on(e, p, bible.enrollment_today(e, p))),
                            'progress', bible.progress(e, p));
end;
$$;

-- Earlier readings not yet marked (from the member's count-from date).
create function public.bible_catch_up(p_enrollment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  e bible.enrollments;
  p bible.plans;
begin
  select * into e from bible.enrollments where id = p_enrollment and profile_id = v_uid and status = 'active';
  if found then
    select * into p from bible.plans where id = e.plan_id;
  end if;
  if e.id is null or not bible.member_can_read_plan(p, v_uid) then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'plan', bible.plan_card(p), 'enrollment', bible.enrollment_json(e), 'progress', bible.progress(e, p),
    'days', coalesce((
       select jsonb_agg(bible.day_summary(e, p, x.id) order by x.on_date)
         from (select d.id, bible.day_date_for(e, d) as on_date from bible.plan_days d
                where d.plan_id = p.id and d.retired_at is null and d.kind = 'reading'
                  and (e.expect_from is null or d.day_date is null or d.day_date >= e.expect_from)
                  and bible.day_date_for(e, d) < bible.enrollment_today(e, p)
                  and not exists (select 1 from bible.completions c where c.enrollment_id = e.id and c.day_id = d.id)
                order by 2 limit 400) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Bookmarks and highlights
-- ---------------------------------------------------------------------------
create function bible.bookmark_json(b bible.bookmarks, p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'kind', b.kind, 'label', b.label, 'created_at', b.created_at,
    'translation_id', b.translation_id, 'book', b.book_code, 'chapter', b.chapter, 'start_verse', b.start_verse, 'end_verse', b.end_verse,
    'translation_code', (select t.code from bible.translations t where t.id = b.translation_id),
    'available', case when b.kind = 'passage' then bible.translation_active(b.translation_id)
                      else exists (select 1 from bible.plan_days d join bible.plans p on p.id = d.plan_id
                                    where d.id = b.day_id and bible.member_can_read_plan(p, p_profile)) end,
    'reference', case when b.kind = 'passage'
                      then bible.passage_label(b.book_code, b.chapter, b.start_verse, b.chapter, coalesce(b.end_verse, b.start_verse)) end,
    'day', (select jsonb_build_object('id', d.id, 'label', bible.day_label(d), 'plan_id', p.id, 'plan_title', p.title)
              from bible.plan_days d join bible.plans p on p.id = d.plan_id
             where d.id = b.day_id and bible.member_can_read_plan(p, p_profile)));
$$;

create function public.bible_bookmarks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  return coalesce((select jsonb_agg(bible.bookmark_json(b, v_uid) order by b.created_at desc)
                     from bible.bookmarks b where b.profile_id = v_uid), '[]'::jsonb);
end;
$$;

-- Adds the bookmark, or removes it when it already exists.
create function public.bible_bookmark_toggle(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_kind text := p ->> 'kind';
  v_tr uuid := nullif(p ->> 'translation_id', '')::uuid;
  v_book text := nullif(p ->> 'book', '');
  v_ch integer := nullif(p ->> 'chapter', '')::integer;
  v_sv integer := nullif(p ->> 'start_verse', '')::integer;
  v_ev integer := nullif(p ->> 'end_verse', '')::integer;
  v_day uuid := nullif(p ->> 'day_id', '')::uuid;
  v_id uuid;
begin
  if v_kind = 'passage' then
    v_day := null;
    if not bible.translation_active(v_tr)
       or bible.passage_problem(v_tr, v_book, v_ch, v_sv, v_ch, coalesce(v_ev, v_sv)) is not null then
      raise exception 'That passage can''t be bookmarked.' using errcode = '22023';
    end if;
  elsif v_kind = 'assignment' then
    v_tr := null; v_book := null; v_ch := null; v_sv := null; v_ev := null;
    if not exists (select 1 from bible.plan_days d join bible.plans x on x.id = d.plan_id
                    where d.id = v_day and bible.member_can_read_plan(x, v_uid)) then
      raise exception 'That reading can''t be bookmarked.' using errcode = '22023';
    end if;
  else
    raise exception 'Unknown bookmark.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'bible_annotate', 300, interval '10 minutes');
  delete from bible.bookmarks b
   where b.profile_id = v_uid and b.kind = v_kind
     and b.translation_id is not distinct from v_tr and b.book_code is not distinct from v_book and b.chapter is not distinct from v_ch
     and b.start_verse is not distinct from v_sv and b.end_verse is not distinct from v_ev and b.day_id is not distinct from v_day
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('bookmarked', false);
  end if;
  if (select count(*) from bible.bookmarks where profile_id = v_uid) >= 2000 then
    raise exception 'You have reached the bookmark limit. Remove some first.' using errcode = '22023';
  end if;
  insert into bible.bookmarks (profile_id, kind, translation_id, book_code, chapter, start_verse, end_verse, day_id, label)
  values (v_uid, v_kind, v_tr, v_book, v_ch, v_sv, v_ev, v_day, left(nullif(btrim(p ->> 'label'), ''), 120))
  returning id into v_id;
  return jsonb_build_object('bookmarked', true, 'id', v_id);
end;
$$;

create function public.bible_bookmark_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  delete from bible.bookmarks where id = p_id and profile_id = v_uid;
end;
$$;

create function public.bible_highlights(p_translation uuid, p_book text, p_chapter integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('verse', h.verse, 'color', h.color) order by h.verse)
                     from bible.highlights h
                    where h.profile_id = v_uid and h.translation_id = p_translation and h.book_code = p_book and h.chapter = p_chapter), '[]'::jsonb);
end;
$$;

-- Sets (or with a null color, removes) the highlight of some verses.
create function public.bible_highlight_set(p_translation uuid, p_book text, p_chapter integer, p_verses integer[], p_color text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_last integer;
begin
  if not bible.translation_active(p_translation) then
    raise exception 'That translation isn''t available.' using errcode = 'P0002';
  end if;
  v_last := bible.chapter_last_verse(p_translation, p_book, p_chapter);
  if v_last is null or cardinality(p_verses) is null or cardinality(p_verses) > 200
     or exists (select 1 from unnest(p_verses) v where v < 1 or v > v_last) then
    raise exception 'Choose verses in this chapter.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'bible_annotate', 300, interval '10 minutes');
  if p_color is null or p_color = '' then
    delete from bible.highlights
     where profile_id = v_uid and translation_id = p_translation and book_code = p_book and chapter = p_chapter and verse = any (p_verses);
  else
    if (select count(*) from bible.highlights where profile_id = v_uid) >= 10000 then
      raise exception 'You have reached the highlight limit. Remove some first.' using errcode = '22023';
    end if;
    insert into bible.highlights (profile_id, translation_id, book_code, chapter, verse, color)
    select v_uid, p_translation, p_book, p_chapter, v, p_color::bible.highlight_color from unnest(p_verses) v
    on conflict (profile_id, translation_id, book_code, chapter, verse) do update set color = excluded.color, created_at = now();
  end if;
  return public.bible_highlights(p_translation, p_book, p_chapter);
end;
$$;

-- Removes all of the member's bookmarks or highlights.
create function public.bible_annotations_clear(p_kind text, p_confirm text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_n integer;
begin
  if p_confirm is distinct from p_kind then
    raise exception 'Confirm what to remove.' using errcode = '22023';
  end if;
  if p_kind = 'bookmarks' then
    delete from bible.bookmarks where profile_id = v_uid;
  elsif p_kind = 'highlights' then
    delete from bible.highlights where profile_id = v_uid;
  else
    raise exception 'Unknown option.' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reader settings
-- ---------------------------------------------------------------------------
create function public.bible_reader_prefs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  r bible.reader_prefs;
begin
  select * into r from bible.reader_prefs where profile_id = v_uid;
  return jsonb_build_object('text_size', coalesce(r.text_size, 100), 'line_spacing', coalesce(r.line_spacing, 1.70),
                            'verse_numbers', coalesce(r.verse_numbers, true),
                            'translation_id', case when bible.translation_active(r.translation_id) then r.translation_id end);
end;
$$;

create function public.bible_reader_prefs_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  if p ? 'translation_id' and nullif(p ->> 'translation_id', '') is not null and not bible.translation_active((p ->> 'translation_id')::uuid) then
    raise exception 'That translation isn''t available.' using errcode = '22023';
  end if;
  insert into bible.reader_prefs (profile_id, text_size, line_spacing, verse_numbers, translation_id)
  values (v_uid, coalesce((p ->> 'text_size')::smallint, 100), coalesce((p ->> 'line_spacing')::numeric, 1.70),
          coalesce((p ->> 'verse_numbers')::boolean, true), nullif(p ->> 'translation_id', '')::uuid)
  on conflict (profile_id) do update set
    text_size = coalesce((p ->> 'text_size')::smallint, bible.reader_prefs.text_size),
    line_spacing = coalesce((p ->> 'line_spacing')::numeric, bible.reader_prefs.line_spacing),
    verse_numbers = coalesce((p ->> 'verse_numbers')::boolean, bible.reader_prefs.verse_numbers),
    translation_id = case when p ? 'translation_id' then nullif(p ->> 'translation_id', '')::uuid else bible.reader_prefs.translation_id end,
    updated_at = now();
  return public.bible_reader_prefs();
end;
$$;

-- ---------------------------------------------------------------------------
-- Export of the member's own reading data (journal entries export separately)
-- ---------------------------------------------------------------------------
create function public.bible_my_reading_export()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  perform community.rate_limit(v_uid, 'bible_export', 10, interval '1 hour');
  return jsonb_build_object(
    'exported_at', now(),
    'plans', coalesce((
       select jsonb_agg(jsonb_build_object(
                'plan', p.title, 'schedule', p.mode, 'status', e.status, 'joined_at', e.joined_at, 'left_at', e.left_at,
                'start_date', e.start_date, 'counting_from', e.expect_from, 'timezone', e.timezone,
                'reminders', e.reminders, 'reminder_time', to_char(e.reminder_time, 'HH24:MI'), 'reminders_paused', e.reminders_paused,
                'completed', coalesce((select jsonb_agg(jsonb_build_object(
                                         'day', bible.day_label(d), 'revision', c.revision, 'completed_at', c.completed_at,
                                         'passages', (select coalesce(jsonb_agg(pp.label order by pp.position), '[]'::jsonb)
                                                        from bible.plan_passages pp where pp.day_id = d.id))
                                       order by d.day_date, d.day_number)
                                         from bible.completions c join bible.plan_days d on d.id = c.day_id
                                        where c.enrollment_id = e.id), '[]'::jsonb))
              order by e.joined_at)
         from bible.enrollments e join bible.plans p on p.id = e.plan_id where e.profile_id = v_uid), '[]'::jsonb),
    'bookmarks', coalesce((select jsonb_agg(bible.bookmark_json(b, v_uid) - 'id' - 'translation_id' order by b.created_at)
                             from bible.bookmarks b where b.profile_id = v_uid), '[]'::jsonb),
    'highlights', coalesce((select jsonb_agg(jsonb_build_object('translation', t.code,
                                                                'reference', bible.passage_label(h.book_code, h.chapter, h.verse, h.chapter, h.verse),
                                                                'color', h.color, 'created_at', h.created_at)
                                             order by b.ordinal, h.chapter, h.verse)
                              from bible.highlights h join bible.translations t on t.id = h.translation_id join bible.books b on b.code = h.book_code
                             where h.profile_id = v_uid), '[]'::jsonb),
    'reader_settings', public.bible_reader_prefs() - 'translation_id');
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema bible from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'bible\_%' or p.proname like 'journal\_%')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261026000400', 'bible_member', 'phase-8');

commit;
