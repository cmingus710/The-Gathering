-- Phase 8 · Reading plan administration: drafts, preview, publishing,
-- archiving, featuring, duplication (including "next version" copies),
-- CSV import (preview → confirm, transactional), and changes to published
-- plans.
--
-- Correction and versioning policy (docs/reading-plan-guide.md):
--   * Draft plans are edited freely (reading.edit).
--   * Published plans never change silently. Titles, descriptions, covers,
--     and audience notes may be edited (reading.publish); completions and
--     notes are unaffected.
--   * Assignments of a published plan are revised one day at a time by a
--     publisher, with a reason, after previewing the impact. The day keeps
--     its id; its earlier content is kept as a numbered revision, and every
--     completion and journal entry stays tied to the revision it was made
--     for. Days are retired, never deleted, once published.
--   * Past days of a calendar plan can only be corrected with an explicit
--     "correct-past" confirmation; future days need "revise".
--   * Members whose affected day is still ahead (and not yet read) get one
--     in-app notice per plan ("A reading plan you follow was updated").
--   * Imports apply only to draft plans. To rework a published plan, create
--     its next version as a draft, import into that, and publish it.
--   * Translation, schedule type, time zone, and audience of a published
--     plan don't change; use a new version.

-- ---------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------
create function bible.passages_json(p_day uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pp.id, 'position', pp.position, 'book', pp.book_code,
                                               'sc', pp.start_chapter, 'sv', pp.start_verse, 'ec', pp.end_chapter, 'ev', pp.end_verse,
                                               'label', pp.label) order by pp.position), '[]'::jsonb)
    from bible.plan_passages pp where pp.day_id = p_day;
$$;

-- Staff view of a day (no member data).
create function bible.admin_day_json(d bible.plan_days)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id, 'day_number', d.day_number, 'day_date', d.day_date, 'kind', d.kind, 'heading', d.heading,
    'notes', d.notes, 'questions', to_jsonb(d.questions), 'discussion_thread_id', d.discussion_thread_id,
    'discussion_title', (select t.title from community.threads t where t.id = d.discussion_thread_id),
    'revision', d.revision, 'retired_at', d.retired_at, 'retired_reason', d.retired_reason,
    'passages', bible.passages_json(d.id),
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status) order by l.position)
                         from bible.plan_day_links l join media.items i on i.id = l.media_item_id where l.day_id = d.id), '[]'::jsonb));
$$;

create function bible.admin_plan_json(p bible.plans)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'cover_path', p.cover_path, 'cover_alt', p.cover_alt,
    'translation_id', p.translation_id,
    'translation', (select jsonb_build_object('code', t.code, 'name', t.name, 'status', t.status) from bible.translations t where t.id = p.translation_id),
    'audience', p.audience, 'group_id', p.group_id, 'group_name', (select g.name from community.groups g where g.id = p.group_id),
    'audience_note', p.audience_note, 'mode', p.mode, 'timezone', p.timezone, 'status', p.status, 'featured', p.featured,
    'version', p.version, 'previous_plan_id', p.previous_plan_id,
    'previous_title', (select x.title from bible.plans x where x.id = p.previous_plan_id),
    'published_at', p.published_at, 'archived_at', p.archived_at, 'created_at', p.created_at, 'updated_at', p.updated_at,
    'days', (select count(*) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null),
    'reading_days', (select count(*) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null and d.kind = 'reading'),
    'first_date', (select min(d.day_date) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null),
    'last_date', (select max(d.day_date) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null),
    'last_day_number', (select max(d.day_number) from bible.plan_days d where d.plan_id = p.id and d.retired_at is null),
    -- Aggregate only: never who.
    'enrollments', (select count(*) from bible.enrollments e where e.plan_id = p.id and e.status = 'active'),
    'today', bible.local_today(p.timezone));
$$;

-- ---------------------------------------------------------------------------
-- Lists and details (plan managers)
-- ---------------------------------------------------------------------------
create function public.bible_admin_plans(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform bible.require_member();
  if not bible.is_plan_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(bible.admin_plan_json(p) order by p.status, p.featured desc, p.updated_at desc)
                     from bible.plans p where p_status is null or p.status::text = p_status), '[]'::jsonb);
end;
$$;

create function public.bible_admin_plan(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p bible.plans;
begin
  perform bible.require_member();
  if not bible.is_plan_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  select * into p from bible.plans where id = p_id;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  return bible.admin_plan_json(p) || jsonb_build_object(
    'day_list', coalesce((select jsonb_agg(bible.admin_day_json(d) order by d.retired_at nulls first, d.day_date, d.day_number)
                            from bible.plan_days d where d.plan_id = p.id), '[]'::jsonb),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'action', c.action, 'reason', c.reason, 'day_id', c.day_id,
                                                             'details', c.details, 'created_at', c.created_at,
                                                             'actor', case when c.actor_id is null then null else community.display_name(c.actor_id) end)
                                          order by c.created_at desc)
                           from (select * from bible.plan_changes where plan_id = p.id order by created_at desc limit 100) c), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'file_name', i.file_name, 'rows', jsonb_array_length(i.rows),
                                                             'errors', jsonb_array_length(i.errors), 'created_at', i.created_at) order by i.created_at desc)
                           from (select * from bible.plan_imports where plan_id = p.id order by created_at desc limit 10) i), '[]'::jsonb));
end;
$$;

-- Choices for the plan and day editors: translations, groups, discussions
-- the editor can read, and teaching content to link.
create function public.bible_admin_plan_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  if not bible.is_plan_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'translations', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'status', t.status) order by t.name)
                                from bible.translations t where t.status <> 'retired'), '[]'::jsonb),
    'default_translation_id', (select default_translation_id from bible.settings),
    'church_timezone', bible.church_tz(),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                          from community.groups g where g.status = 'active' and community.can_see_group(g.id, v_uid)), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'group_id', t.group_id) order by t.created_at desc)
                           from (select * from community.threads x
                                  where x.status = 'visible' and community.can_read_thread(x.id, v_uid)
                                  order by x.created_at desc limit 200) t), '[]'::jsonb),
    'content', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title) order by i.publish_at desc)
                           from (select * from media.items x
                                  where x.kind in ('devotional', 'lesson') and media.item_visible(x, v_uid)
                                  order by x.publish_at desc limit 300) i), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Plan metadata
-- ---------------------------------------------------------------------------
create function public.bible_admin_plan_save(p_id uuid, p jsonb, p_client_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  x bible.plans;
  v_new bible.plans;
  v_fields text[];
  v_tz text;
begin
  if p_id is null then
    if not public.has_capability('reading.edit') then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    select * into x from bible.plans where created_by = v_uid and client_key = p_client_key and p_client_key is not null;
    if found then
      return bible.admin_plan_json(x);
    end if;
    v_tz := coalesce(nullif(p ->> 'timezone', ''), bible.church_tz());
    if not bible.valid_tz(v_tz) then
      raise exception 'Choose a valid time zone.' using errcode = '22023';
    end if;
    if not exists (select 1 from bible.translations where id = (p ->> 'translation_id')::uuid and status <> 'retired') then
      raise exception 'Choose a translation.' using errcode = '22023';
    end if;
    if coalesce(p ->> 'audience', 'members') = 'group'
       and not exists (select 1 from community.groups g where g.id = (p ->> 'group_id')::uuid and g.status = 'active' and community.can_see_group(g.id, v_uid)) then
      raise exception 'Choose an active group.' using errcode = '22023';
    end if;
    insert into bible.plans (title, description, translation_id, audience, group_id, audience_note, mode, timezone, client_key, created_by, updated_by)
    values (btrim(p ->> 'title'), coalesce(p ->> 'description', ''), (p ->> 'translation_id')::uuid,
            coalesce(nullif(p ->> 'audience', ''), 'members'),
            case when p ->> 'audience' = 'group' then (p ->> 'group_id')::uuid end,
            nullif(btrim(p ->> 'audience_note'), ''), (p ->> 'mode')::bible.plan_mode, v_tz, p_client_key, v_uid, v_uid)
    returning * into v_new;
    insert into bible.plan_changes (plan_id, action, actor_id) values (v_new.id, 'created', v_uid);
    perform bible.audit('bible.plan_created', 'bible_plan', v_new.id, jsonb_build_object('mode', v_new.mode));
    return bible.admin_plan_json(v_new);
  end if;

  select * into x from bible.plans where id = p_id for update;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  if x.status = 'draft' then
    if not public.has_capability('reading.edit') then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    v_tz := coalesce(nullif(p ->> 'timezone', ''), x.timezone);
    if not bible.valid_tz(v_tz) then
      raise exception 'Choose a valid time zone.' using errcode = '22023';
    end if;
    if p ? 'mode' and (p ->> 'mode')::bible.plan_mode <> x.mode
       and exists (select 1 from bible.plan_days where plan_id = x.id) then
      raise exception 'Remove the plan''s days before changing between dated and numbered days.' using errcode = '22023';
    end if;
    if p ? 'translation_id' and not exists (select 1 from bible.translations where id = (p ->> 'translation_id')::uuid and status <> 'retired') then
      raise exception 'Choose a translation.' using errcode = '22023';
    end if;
    if coalesce(p ->> 'audience', x.audience) = 'group'
       and not exists (select 1 from community.groups g
                        where g.id = coalesce((p ->> 'group_id')::uuid, x.group_id) and g.status = 'active' and community.can_see_group(g.id, v_uid)) then
      raise exception 'Choose an active group.' using errcode = '22023';
    end if;
    update bible.plans set
      title = coalesce(nullif(btrim(p ->> 'title'), ''), title),
      description = coalesce(p ->> 'description', description),
      translation_id = coalesce((p ->> 'translation_id')::uuid, translation_id),
      audience = coalesce(nullif(p ->> 'audience', ''), audience),
      group_id = case when coalesce(nullif(p ->> 'audience', ''), audience) = 'group' then coalesce((p ->> 'group_id')::uuid, group_id) end,
      audience_note = case when p ? 'audience_note' then nullif(btrim(p ->> 'audience_note'), '') else audience_note end,
      mode = coalesce((p ->> 'mode')::bible.plan_mode, mode),
      timezone = v_tz,
      cover_alt = case when p ? 'cover_alt' then nullif(btrim(p ->> 'cover_alt'), '') else cover_alt end,
      updated_by = v_uid, updated_at = now()
    where id = x.id
    returning * into v_new;
  else
    -- Published or archived: presentation only, and only for publishers.
    if not public.has_capability('reading.publish') then
      raise exception 'Only a reading plan publisher can edit a published plan.' using errcode = '42501';
    end if;
    if (p ? 'translation_id' and (p ->> 'translation_id')::uuid <> x.translation_id)
       or (p ? 'mode' and (p ->> 'mode')::bible.plan_mode <> x.mode)
       or (p ? 'timezone' and p ->> 'timezone' <> x.timezone)
       or (p ? 'audience' and p ->> 'audience' <> x.audience)
       or (p ? 'group_id' and (p ->> 'group_id')::uuid is distinct from x.group_id) then
      raise exception 'The translation, schedule, time zone, and audience of a published plan can''t change. Create a new version instead.' using errcode = '22023';
    end if;
    update bible.plans set
      title = coalesce(nullif(btrim(p ->> 'title'), ''), title),
      description = coalesce(p ->> 'description', description),
      audience_note = case when p ? 'audience_note' then nullif(btrim(p ->> 'audience_note'), '') else audience_note end,
      cover_alt = case when p ? 'cover_alt' then nullif(btrim(p ->> 'cover_alt'), '') else cover_alt end,
      updated_by = v_uid, updated_at = now()
    where id = x.id
    returning * into v_new;
  end if;
  select array_agg(k) into v_fields from (
    select k from unnest(array['title', 'description', 'translation_id', 'audience', 'group_id', 'audience_note', 'mode', 'timezone', 'cover_alt']) k
     where to_jsonb(x) -> k is distinct from to_jsonb(v_new) -> k) f;
  if v_fields is not null then
    insert into bible.plan_changes (plan_id, action, details, actor_id) values (x.id, 'details_edited', jsonb_build_object('fields', to_jsonb(v_fields)), v_uid);
    perform bible.audit('bible.plan_updated', 'bible_plan', x.id, jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return bible.admin_plan_json(v_new);
end;
$$;

-- Records a new cover (already processed and stored by the server) and
-- returns the previous path so the server can delete it.
create function public.bible_admin_plan_cover(p_id uuid, p_path text, p_alt text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  x bible.plans;
begin
  select * into x from bible.plans where id = p_id for update;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  if not public.has_capability(case when x.status = 'draft' then 'reading.edit' else 'reading.publish' end) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if p_path is not null and p_path not like 'covers/' || x.id || '/%' then
    raise exception 'That cover doesn''t belong to this plan.' using errcode = '22023';
  end if;
  update bible.plans set cover_path = p_path, cover_alt = case when p_path is null then null else nullif(btrim(p_alt), '') end,
                         updated_by = v_uid, updated_at = now()
   where id = x.id;
  insert into bible.plan_changes (plan_id, action, actor_id) values (x.id, case when p_path is null then 'cover_removed' else 'cover_changed' end, v_uid);
  return jsonb_build_object('previous_path', x.cover_path);
end;
$$;

-- ---------------------------------------------------------------------------
-- Days of a draft plan
-- ---------------------------------------------------------------------------
-- Validates and writes a day's passages, links, and discussion. Raises a
-- member-safe message naming the first problem.
create function bible.write_day_content(d bible.plan_days, x bible.plans, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_problem text;
  v_thread uuid := nullif(p ->> 'discussion_thread_id', '')::uuid;
begin
  if p ? 'passages' then
    if jsonb_typeof(p -> 'passages') <> 'array' or jsonb_array_length(p -> 'passages') > 20 then
      raise exception 'A day can have at most 20 passages.' using errcode = '22023';
    end if;
    if d.kind <> 'reading' and jsonb_array_length(p -> 'passages') > 0 and d.kind = 'rest' then
      raise exception 'A rest day has no passages.' using errcode = '22023';
    end if;
    delete from bible.plan_passages where day_id = d.id;
    for r in select v, n from jsonb_array_elements(p -> 'passages') with ordinality a(v, n) loop
      v_problem := bible.passage_problem(x.translation_id, r.v ->> 'book', (r.v ->> 'sc')::integer, (r.v ->> 'sv')::integer,
                                         (r.v ->> 'ec')::integer, (r.v ->> 'ev')::integer);
      if v_problem is not null then
        raise exception 'Passage %: %', r.n, v_problem using errcode = '22023';
      end if;
      insert into bible.plan_passages (day_id, position, book_code, start_chapter, start_verse, end_chapter, end_verse, label)
      values (d.id, r.n, r.v ->> 'book', (r.v ->> 'sc')::integer, (r.v ->> 'sv')::integer, (r.v ->> 'ec')::integer, (r.v ->> 'ev')::integer,
              bible.passage_label(r.v ->> 'book', (r.v ->> 'sc')::integer, (r.v ->> 'sv')::integer, (r.v ->> 'ec')::integer, (r.v ->> 'ev')::integer));
    end loop;
  end if;
  if d.kind = 'reading' and not exists (select 1 from bible.plan_passages where day_id = d.id) then
    raise exception 'A reading day needs at least one passage.' using errcode = '22023';
  end if;
  if p ? 'links' then
    if jsonb_typeof(p -> 'links') <> 'array' or jsonb_array_length(p -> 'links') > 10 then
      raise exception 'Link at most 10 devotionals or lessons.' using errcode = '22023';
    end if;
    delete from bible.plan_day_links where day_id = d.id;
    insert into bible.plan_day_links (day_id, media_item_id, position)
    select d.id, i.id, a.n from jsonb_array_elements_text(p -> 'links') with ordinality a(v, n)
      join media.items i on i.id = a.v::uuid and i.kind in ('devotional', 'lesson')
    on conflict do nothing;
  end if;
  if p ? 'discussion_thread_id' then
    -- A discussion is never broader than the plan: church-wide plans link
    -- church-wide discussions; group plans link their own group's.
    if v_thread is not null and not exists (
         select 1 from community.threads t
          where t.id = v_thread and t.status = 'visible'
            and community.can_read_thread(t.id, (select auth.uid()))
            and ((x.audience = 'members' and t.group_id is null) or (x.audience = 'group' and t.group_id = x.group_id))) then
      raise exception 'Choose a discussion that the plan''s readers (and only they) can open.' using errcode = '22023';
    end if;
    update bible.plan_days set discussion_thread_id = v_thread where id = d.id;
  end if;
end;
$$;

create function bible.clean_questions(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select left(btrim(q), 500) from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) q
                         where btrim(q) <> '' limit 5), '{}');
$$;

create function public.bible_admin_day_save(p_plan uuid, p_day uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.edit');
  x bible.plans;
  d bible.plan_days;
  v_number integer := nullif(p ->> 'day_number', '')::integer;
  v_date date := nullif(p ->> 'day_date', '')::date;
begin
  select * into x from bible.plans where id = p_plan for update;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  if x.status <> 'draft' then
    raise exception 'This plan is published. Use "Revise" to change an assignment.' using errcode = '22023';
  end if;
  if (x.mode = 'calendar' and v_date is null) or (x.mode = 'personal' and v_number is null) then
    raise exception '%', case when x.mode = 'calendar' then 'Choose the date for this day.' else 'Enter the day number.' end using errcode = '22023';
  end if;
  if exists (select 1 from bible.plan_days o where o.plan_id = x.id and o.id is distinct from p_day and o.retired_at is null
               and (o.day_date = v_date or o.day_number = v_number)) then
    raise exception 'Another day already uses that %.', case when x.mode = 'calendar' then 'date' else 'number' end using errcode = '22023';
  end if;
  if p_day is null then
    insert into bible.plan_days (plan_id, day_number, day_date, kind, heading, notes, questions)
    values (x.id, case when x.mode = 'personal' then v_number end, case when x.mode = 'calendar' then v_date end,
            coalesce(nullif(p ->> 'kind', ''), 'reading')::bible.day_kind, nullif(btrim(p ->> 'heading'), ''),
            coalesce(p ->> 'notes', ''), bible.clean_questions(p -> 'questions'))
    returning * into d;
  else
    update bible.plan_days set
      day_number = case when x.mode = 'personal' then v_number end,
      day_date = case when x.mode = 'calendar' then v_date end,
      kind = coalesce(nullif(p ->> 'kind', ''), kind::text)::bible.day_kind,
      heading = case when p ? 'heading' then nullif(btrim(p ->> 'heading'), '') else heading end,
      notes = coalesce(p ->> 'notes', notes),
      questions = case when p ? 'questions' then bible.clean_questions(p -> 'questions') else questions end,
      updated_at = now()
    where id = p_day and plan_id = x.id
    returning * into d;
    if not found then
      raise exception 'Day not found.' using errcode = 'P0002';
    end if;
  end if;
  if d.kind = 'rest' then
    delete from bible.plan_passages where day_id = d.id;
    perform bible.write_day_content(d, x, p - 'passages');
  else
    perform bible.write_day_content(d, x, p);
  end if;
  update bible.plans set updated_at = now(), updated_by = v_uid where id = x.id;
  select * into d from bible.plan_days where id = d.id;
  return bible.admin_day_json(d);
end;
$$;

create function public.bible_admin_day_delete(p_day uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.edit');
  v_plan uuid;
begin
  select d.plan_id into v_plan from bible.plan_days d join bible.plans p on p.id = d.plan_id
   where d.id = p_day and p.status = 'draft';
  if v_plan is null then
    raise exception 'Only days of a draft plan can be deleted. Retire a published day instead.' using errcode = '22023';
  end if;
  delete from bible.plan_days where id = p_day and plan_id = v_plan;
  update bible.plans set updated_at = now(), updated_by = v_uid where id = v_plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publishing, archiving, featuring
-- ---------------------------------------------------------------------------
create function public.bible_admin_plan_status(p_id uuid, p_action text, p_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.publish');
  x bible.plans;
  v_bad integer;
begin
  select * into x from bible.plans where id = p_id for update;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  case p_action
    when 'publish' then
      if x.status <> 'draft' then
        raise exception 'This plan is already published.' using errcode = '22023';
      end if;
      if p_confirm is distinct from 'publish' then
        raise exception 'Confirm publishing after previewing the plan.' using errcode = '22023';
      end if;
      if not bible.translation_active(x.translation_id) then
        raise exception 'The plan''s translation isn''t active yet.' using errcode = '22023';
      end if;
      if x.audience = 'group' and not exists (select 1 from community.groups where id = x.group_id and status = 'active') then
        raise exception 'The plan''s group isn''t active.' using errcode = '22023';
      end if;
      if not exists (select 1 from bible.plan_days where plan_id = x.id and kind = 'reading') then
        raise exception 'Add at least one reading day first.' using errcode = '22023';
      end if;
      select count(*) into v_bad from bible.plan_passages pp join bible.plan_days d on d.id = pp.day_id
       where d.plan_id = x.id
         and bible.passage_problem(x.translation_id, pp.book_code, pp.start_chapter, pp.start_verse, pp.end_chapter, pp.end_verse) is not null;
      if v_bad > 0 then
        raise exception '% passages don''t match the translation. Fix them before publishing.', v_bad using errcode = '22023';
      end if;
      if exists (select 1 from bible.plan_days d where d.plan_id = x.id and d.kind = 'reading'
                    and not exists (select 1 from bible.plan_passages pp where pp.day_id = d.id)) then
        raise exception 'Every reading day needs at least one passage.' using errcode = '22023';
      end if;
      update bible.plans set status = 'published', published_at = now(), published_by = v_uid, updated_at = now(), updated_by = v_uid where id = x.id;
    when 'archive' then
      if x.status <> 'published' then
        raise exception 'Only a published plan can be archived.' using errcode = '22023';
      end if;
      update bible.plans set status = 'archived', featured = false, archived_at = now(), updated_at = now(), updated_by = v_uid where id = x.id;
    when 'restore' then
      if x.status <> 'archived' then
        raise exception 'Only an archived plan can be restored.' using errcode = '22023';
      end if;
      if not bible.translation_active(x.translation_id) then
        raise exception 'The plan''s translation isn''t active.' using errcode = '22023';
      end if;
      update bible.plans set status = 'published', archived_at = null, updated_at = now(), updated_by = v_uid where id = x.id;
    when 'feature' then
      if x.status <> 'published' or x.audience <> 'members' then
        raise exception 'Only a published plan for all members can be the featured church plan.' using errcode = '22023';
      end if;
      update bible.plans set featured = false where featured and id <> x.id;
      update bible.plans set featured = true, updated_at = now(), updated_by = v_uid where id = x.id;
    when 'unfeature' then
      update bible.plans set featured = false, updated_at = now(), updated_by = v_uid where id = x.id;
    else
      raise exception 'Unknown action.' using errcode = '22023';
  end case;
  insert into bible.plan_changes (plan_id, action, actor_id) values (x.id, p_action, v_uid);
  perform bible.audit('bible.plan_' || p_action, 'bible_plan', x.id, '{}'::jsonb);
  select * into x from bible.plans where id = p_id;
  return bible.admin_plan_json(x);
end;
$$;

-- Copies a plan (current, non-retired days) into a new draft. As a "new
-- version", it records the plan it replaces; calendar plans can be shifted
-- by a number of days (for example to next year).
create function public.bible_admin_plan_duplicate(p_id uuid, p_title text, p_new_version boolean, p_shift_days integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.edit');
  x bible.plans;
  n bible.plans;
  d record;
  v_day uuid;
begin
  select * into x from bible.plans where id = p_id;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  if coalesce(p_shift_days, 0) not between -800 and 800 then
    raise exception 'Shift dates by at most 800 days.' using errcode = '22023';
  end if;
  insert into bible.plans (title, description, translation_id, audience, group_id, audience_note, mode, timezone,
                           previous_plan_id, created_by, updated_by)
  values (coalesce(nullif(btrim(p_title), ''), left(x.title || ' (copy)', 120)), x.description, x.translation_id, x.audience, x.group_id,
          x.audience_note, x.mode, x.timezone, case when p_new_version then x.id end, v_uid, v_uid)
  returning * into n;
  for d in select * from bible.plan_days where plan_id = x.id and retired_at is null loop
    insert into bible.plan_days (plan_id, day_number, day_date, kind, heading, notes, questions, discussion_thread_id)
    values (n.id, d.day_number, d.day_date + coalesce(p_shift_days, 0), d.kind, d.heading, d.notes, d.questions, d.discussion_thread_id)
    returning id into v_day;
    insert into bible.plan_passages (day_id, position, book_code, start_chapter, start_verse, end_chapter, end_verse, label)
    select v_day, position, book_code, start_chapter, start_verse, end_chapter, end_verse, label from bible.plan_passages where day_id = d.id;
    insert into bible.plan_day_links (day_id, media_item_id, position)
    select v_day, media_item_id, position from bible.plan_day_links where day_id = d.id;
  end loop;
  insert into bible.plan_changes (plan_id, action, details, actor_id)
  values (n.id, case when p_new_version then 'created_as_version' else 'duplicated' end, jsonb_build_object('from', x.id), v_uid);
  perform bible.audit('bible.plan_duplicated', 'bible_plan', n.id, jsonb_build_object('from', x.id, 'new_version', coalesce(p_new_version, false)));
  return bible.admin_plan_json(n);
end;
$$;

create function public.bible_admin_plan_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x bible.plans;
begin
  perform bible.require_cap('reading.edit');
  select * into x from bible.plans where id = p_id for update;
  if not found or x.status <> 'draft' or exists (select 1 from bible.enrollments where plan_id = x.id) then
    raise exception 'Only an unused draft can be deleted. Archive a published plan instead.' using errcode = '22023';
  end if;
  delete from bible.plans where id = x.id and status = 'draft';
  perform bible.audit('bible.plan_deleted', 'bible_plan', x.id, '{}'::jsonb);
  return jsonb_build_object('cover_path', x.cover_path);
end;
$$;

-- ---------------------------------------------------------------------------
-- Changes to published plans
-- ---------------------------------------------------------------------------
-- Whether a day's date has passed for its plan (calendar plans only;
-- personal plans have no shared "past").
create function bible.day_is_past(d bible.plan_days, x bible.plans)
returns boolean
language sql
stable
set search_path = ''
as $$
  select x.mode = 'calendar' and d.day_date < bible.local_today(x.timezone);
$$;

-- Active enrollments for whom this day is still ahead or today and unread.
create function bible.upcoming_readers(d bible.plan_days, x bible.plans)
returns table (enrollment_id uuid, profile_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.profile_id from bible.enrollments e
   where e.plan_id = x.id and e.status = 'active'
     and bible.day_date_for(e, d) >= bible.enrollment_today(e, x)
     and not exists (select 1 from bible.completions c where c.enrollment_id = e.id and c.day_id = d.id);
$$;

create function public.bible_admin_day_impact(p_day uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d bible.plan_days;
  x bible.plans;
begin
  perform bible.require_member();
  if not bible.is_plan_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  select * into d from bible.plan_days where id = p_day;
  if not found then
    raise exception 'Day not found.' using errcode = 'P0002';
  end if;
  select * into x from bible.plans where id = d.plan_id;
  -- Counts only. Journal entries are never counted or listed for staff;
  -- they always keep their link to the revision they were written for.
  return jsonb_build_object(
    'plan_status', x.status, 'is_past', bible.day_is_past(d, x), 'revision', d.revision, 'retired', d.retired_at is not null,
    'active_enrollments', (select count(*) from bible.enrollments e where e.plan_id = x.id and e.status = 'active'),
    'completions', (select count(*) from bible.completions c where c.day_id = d.id),
    'upcoming_readers', (select count(*) from bible.upcoming_readers(d, x)),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('revision', r.revision, 'snapshot', r.snapshot, 'reason', r.reason,
                                                               'changed_at', r.changed_at) order by r.revision desc)
                             from bible.day_revisions r where r.day_id = d.id), '[]'::jsonb));
end;
$$;

create function bible.day_snapshot(d bible.plan_days)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('kind', d.kind, 'heading', d.heading, 'day_number', d.day_number, 'day_date', d.day_date,
                            'questions', to_jsonb(d.questions),
                            'passages', (select coalesce(jsonb_agg(jsonb_build_object('book', pp.book_code, 'sc', pp.start_chapter, 'sv', pp.start_verse,
                                                                                      'ec', pp.end_chapter, 'ev', pp.end_verse, 'label', pp.label)
                                                                   order by pp.position), '[]'::jsonb)
                                           from bible.plan_passages pp where pp.day_id = d.id));
$$;

create function bible.require_change(p_reason text, p_confirm text, d bible.plan_days, x bible.plans)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if x.status = 'draft' then
    raise exception 'Edit days of a draft plan directly.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a short reason for the change (members'' history keeps the earlier version).' using errcode = '22023';
  end if;
  if bible.day_is_past(d, x) then
    if p_confirm is distinct from 'correct-past' then
      raise exception 'This day has already passed. Confirm that you are correcting a past assignment.' using errcode = '22023';
    end if;
  elsif p_confirm is distinct from 'revise' and p_confirm is distinct from 'correct-past' then
    raise exception 'Confirm the change after reviewing its impact.' using errcode = '22023';
  end if;
end;
$$;

-- One notice per plan for readers whose affected day is still ahead.
create function bible.notify_change(d bible.plan_days, x bible.plans)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  select count(community.notify(u.profile_id, 'reading_plan_changed', null,
                                jsonb_build_object('bible_plan_id', x.id), 'reading_plan_changed:' || x.id))
    into v_n
    from bible.upcoming_readers(d, x) u
   where bible.plan_visible(x, u.profile_id);
  return v_n;
end;
$$;

create function public.bible_admin_day_revise(p_day uuid, p jsonb, p_reason text, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.publish');
  d bible.plan_days;
  x bible.plans;
  v_before jsonb;
  v_after jsonb;
  v_number integer := nullif(p ->> 'day_number', '')::integer;
  v_date date := nullif(p ->> 'day_date', '')::date;
  v_material boolean;
  v_notified integer := 0;
  v_moved bible.plan_days;
begin
  select * into d from bible.plan_days where id = p_day for update;
  if not found or d.retired_at is not null then
    raise exception 'Day not found.' using errcode = 'P0002';
  end if;
  select * into x from bible.plans where id = d.plan_id for update;
  perform bible.require_change(p_reason, p_confirm, d, x);
  -- Moving a day: the new date must also be acceptable.
  if x.mode = 'calendar' and v_date is not null and v_date <> d.day_date then
    v_moved := d;
    v_moved.day_date := v_date;
    if bible.day_is_past(v_moved, x) and p_confirm is distinct from 'correct-past' then
      raise exception 'The new date has already passed. Confirm that you are correcting a past assignment.' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from bible.plan_days o where o.plan_id = x.id and o.id <> d.id and o.retired_at is null
               and ((x.mode = 'calendar' and o.day_date = coalesce(v_date, d.day_date))
                    or (x.mode = 'personal' and o.day_number = coalesce(v_number, d.day_number)))) then
    raise exception 'Another day already uses that %.', case when x.mode = 'calendar' then 'date' else 'number' end using errcode = '22023';
  end if;

  v_before := bible.day_snapshot(d);
  insert into bible.day_revisions (day_id, revision, snapshot, reason, changed_by)
  values (d.id, d.revision, v_before, left(btrim(p_reason), 500), v_uid)
  on conflict (day_id, revision) do nothing;

  update bible.plan_days set
    day_number = case when x.mode = 'personal' then coalesce(v_number, day_number) end,
    day_date = case when x.mode = 'calendar' then coalesce(v_date, day_date) end,
    kind = coalesce(nullif(p ->> 'kind', ''), kind::text)::bible.day_kind,
    heading = case when p ? 'heading' then nullif(btrim(p ->> 'heading'), '') else heading end,
    notes = coalesce(p ->> 'notes', notes),
    questions = case when p ? 'questions' then bible.clean_questions(p -> 'questions') else questions end,
    revision = revision + 1, updated_at = now()
  where id = d.id
  returning * into d;
  if d.kind = 'rest' then
    delete from bible.plan_passages where day_id = d.id;
    perform bible.write_day_content(d, x, p - 'passages');
  else
    perform bible.write_day_content(d, x, p);
  end if;
  select * into d from bible.plan_days where id = d.id;
  v_after := bible.day_snapshot(d);
  v_material := (v_before -> 'passages') is distinct from (v_after -> 'passages') or (v_before ->> 'kind') is distinct from (v_after ->> 'kind')
                or (v_before ->> 'day_date') is distinct from (v_after ->> 'day_date') or (v_before ->> 'day_number') is distinct from (v_after ->> 'day_number');

  update bible.plans set version = version + 1, updated_at = now(), updated_by = v_uid where id = x.id;
  if v_material and x.status = 'published' then
    v_notified := bible.notify_change(d, x);
  end if;
  insert into bible.plan_changes (plan_id, day_id, action, reason, details, actor_id)
  values (x.id, d.id, case when p_confirm = 'correct-past' then 'day_corrected' else 'day_revised' end, left(btrim(p_reason), 500),
          jsonb_build_object('from_revision', d.revision - 1, 'to_revision', d.revision, 'material', v_material, 'notified', v_notified,
                             'before', v_before, 'after', v_after), v_uid);
  perform bible.audit('bible.plan_day_revised', 'bible_plan', x.id,
                      jsonb_build_object('day', d.id, 'revision', d.revision, 'material', v_material, 'past', p_confirm = 'correct-past'));
  return bible.admin_day_json(d) || jsonb_build_object('notified', v_notified, 'material', v_material);
end;
$$;

-- Adds a day to a published plan (calendar: today or later).
create function public.bible_admin_day_add(p_plan uuid, p jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.publish');
  x bible.plans;
  d bible.plan_days;
  v_number integer := nullif(p ->> 'day_number', '')::integer;
  v_date date := nullif(p ->> 'day_date', '')::date;
begin
  select * into x from bible.plans where id = p_plan for update;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  if x.status = 'draft' then
    raise exception 'Edit days of a draft plan directly.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a short reason for the change.' using errcode = '22023';
  end if;
  if (x.mode = 'calendar' and (v_date is null or v_date < bible.local_today(x.timezone))) or (x.mode = 'personal' and v_number is null) then
    raise exception '%', case when x.mode = 'calendar' then 'Choose today or a later date.' else 'Enter the day number.' end using errcode = '22023';
  end if;
  if exists (select 1 from bible.plan_days o where o.plan_id = x.id and o.retired_at is null and (o.day_date = v_date or o.day_number = v_number)) then
    raise exception 'Another day already uses that %.', case when x.mode = 'calendar' then 'date' else 'number' end using errcode = '22023';
  end if;
  insert into bible.plan_days (plan_id, day_number, day_date, kind, heading, notes, questions)
  values (x.id, case when x.mode = 'personal' then v_number end, case when x.mode = 'calendar' then v_date end,
          coalesce(nullif(p ->> 'kind', ''), 'reading')::bible.day_kind, nullif(btrim(p ->> 'heading'), ''),
          coalesce(p ->> 'notes', ''), bible.clean_questions(p -> 'questions'))
  returning * into d;
  if d.kind = 'rest' then
    perform bible.write_day_content(d, x, p - 'passages');
  else
    perform bible.write_day_content(d, x, p);
  end if;
  update bible.plans set version = version + 1, updated_at = now(), updated_by = v_uid where id = x.id;
  insert into bible.plan_changes (plan_id, day_id, action, reason, details, actor_id)
  values (x.id, d.id, 'day_added', left(btrim(p_reason), 500), jsonb_build_object('after', bible.day_snapshot(d)), v_uid);
  perform bible.audit('bible.plan_day_added', 'bible_plan', x.id, jsonb_build_object('day', d.id));
  select * into d from bible.plan_days where id = d.id;
  return bible.admin_day_json(d);
end;
$$;

-- Retires a published day: hidden from schedules, kept for history.
create function public.bible_admin_day_retire(p_day uuid, p_reason text, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.publish');
  d bible.plan_days;
  x bible.plans;
  v_notified integer := 0;
begin
  select * into d from bible.plan_days where id = p_day for update;
  if not found or d.retired_at is not null then
    raise exception 'Day not found.' using errcode = 'P0002';
  end if;
  select * into x from bible.plans where id = d.plan_id for update;
  perform bible.require_change(p_reason, p_confirm, d, x);
  if d.kind = 'reading' and x.status = 'published' then
    v_notified := bible.notify_change(d, x);
  end if;
  update bible.plan_days set retired_at = now(), retired_reason = left(btrim(p_reason), 500), updated_at = now() where id = d.id;
  update bible.plans set version = version + 1, updated_at = now(), updated_by = v_uid where id = x.id;
  insert into bible.plan_changes (plan_id, day_id, action, reason, details, actor_id)
  values (x.id, d.id, 'day_retired', left(btrim(p_reason), 500), jsonb_build_object('before', bible.day_snapshot(d), 'notified', v_notified), v_uid);
  perform bible.audit('bible.plan_day_retired', 'bible_plan', x.id, jsonb_build_object('day', d.id));
  return jsonb_build_object('id', d.id, 'retired', true, 'notified', v_notified);
end;
$$;

-- ---------------------------------------------------------------------------
-- CSV import (draft plans only): the server parses and validates the file,
-- stores the preview here, and applies it in one transaction on
-- confirmation, revalidating every row.
-- ---------------------------------------------------------------------------
create function public.bible_admin_plan_import_stage(p_plan uuid, p_file_name text, p_rows jsonb, p_errors jsonb, p_warnings jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.edit');
  v_id uuid;
begin
  if not exists (select 1 from bible.plans where id = p_plan and status = 'draft') then
    raise exception 'Imports go into a draft plan. Create a new version to rework a published plan.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'An import can contain at most 2000 days.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'bible_plan_import', 30, interval '1 hour');
  -- Earlier previews of this plan expire.
  update bible.plan_imports set status = 'discarded' where plan_id = p_plan and status = 'previewed';
  insert into bible.plan_imports (plan_id, file_name, rows, errors, warnings, created_by)
  values (p_plan, left(p_file_name, 200), p_rows, coalesce(p_errors, '[]'::jsonb), coalesce(p_warnings, '[]'::jsonb), v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.bible_admin_plan_import(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i bible.plan_imports;
begin
  perform bible.require_cap('reading.edit');
  select * into i from bible.plan_imports where id = p_id;
  if not found then
    raise exception 'Import not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', i.id, 'plan_id', i.plan_id, 'status', i.status, 'file_name', i.file_name, 'rows', i.rows,
                            'errors', i.errors, 'warnings', i.warnings, 'mode', i.mode, 'created_at', i.created_at,
                            'expired', i.created_at < now() - interval '1 day',
                            'existing_days', (select count(*) from bible.plan_days d where d.plan_id = i.plan_id and d.retired_at is null));
end;
$$;

create function public.bible_admin_plan_import_apply(p_id uuid, p_mode text, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('reading.edit');
  i bible.plan_imports;
  x bible.plans;
  r record;
  d bible.plan_days;
  v_conflicts text;
  v_n integer := 0;
begin
  select * into i from bible.plan_imports where id = p_id for update;
  if not found or i.status <> 'previewed' then
    raise exception 'This preview was already applied or discarded.' using errcode = '22023';
  end if;
  if i.created_at < now() - interval '1 day' then
    raise exception 'This preview has expired. Upload the file again.' using errcode = '22023';
  end if;
  if jsonb_array_length(i.errors) > 0 then
    raise exception 'Fix the errors in the file and upload it again.' using errcode = '22023';
  end if;
  if p_mode not in ('add', 'replace') or p_confirm is distinct from p_mode then
    raise exception 'Choose whether to add to or replace the draft''s days, and confirm.' using errcode = '22023';
  end if;
  select * into x from bible.plans where id = i.plan_id for update;
  if x.status <> 'draft' then
    raise exception 'Imports go into a draft plan only.' using errcode = '22023';
  end if;
  -- Keys must match the plan's schedule and be unique within the file.
  if exists (select 1 from jsonb_array_elements(i.rows) e
              where (x.mode = 'calendar' and nullif(e ->> 'day_date', '') is null)
                 or (x.mode = 'personal' and nullif(e ->> 'day_number', '') is null)) then
    raise exception 'Every row needs a % for this plan.', case when x.mode = 'calendar' then 'date' else 'day number' end using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(i.rows)) <>
     (select count(distinct coalesce(e ->> 'day_date', e ->> 'day_number')) from jsonb_array_elements(i.rows) e) then
    raise exception 'The file assigns the same day more than once.' using errcode = '22023';
  end if;
  if p_mode = 'replace' then
    delete from bible.plan_days where plan_id = x.id;
  else
    select string_agg(coalesce(e ->> 'day_date', 'day ' || (e ->> 'day_number')), ', ') into v_conflicts
      from (select e from jsonb_array_elements(i.rows) e
             where exists (select 1 from bible.plan_days o where o.plan_id = x.id and o.retired_at is null
                             and (o.day_date = nullif(e ->> 'day_date', '')::date or o.day_number = nullif(e ->> 'day_number', '')::integer))
             limit 10) c;
    if v_conflicts is not null then
      raise exception 'These days are already in the draft: %. Choose "Replace" or remove them from the file.', v_conflicts using errcode = '22023';
    end if;
  end if;
  for r in select e, n from jsonb_array_elements(i.rows) with ordinality a(e, n) loop
    begin
      insert into bible.plan_days (plan_id, day_number, day_date, kind, heading, notes, questions)
      values (x.id, case when x.mode = 'personal' then (r.e ->> 'day_number')::integer end,
              case when x.mode = 'calendar' then (r.e ->> 'day_date')::date end,
              coalesce(nullif(r.e ->> 'kind', ''), 'reading')::bible.day_kind, nullif(btrim(r.e ->> 'heading'), ''),
              coalesce(r.e ->> 'notes', ''), bible.clean_questions(r.e -> 'questions'))
      returning * into d;
      if d.kind = 'rest' then
        perform bible.write_day_content(d, x, jsonb_build_object('passages', '[]'::jsonb));
      else
        perform bible.write_day_content(d, x, jsonb_build_object('passages', coalesce(r.e -> 'passages', '[]'::jsonb)));
      end if;
    exception when sqlstate '22023' or sqlstate '22P02' or sqlstate '22007' or sqlstate '22008' or sqlstate '23514' then
      raise exception 'Row %: %', coalesce(r.e ->> 'row', r.n::text), sqlerrm using errcode = '22023';
    end;
    v_n := v_n + 1;
  end loop;
  update bible.plan_imports set status = 'applied', mode = p_mode, applied_at = now() where id = i.id;
  update bible.plans set updated_at = now(), updated_by = v_uid where id = x.id;
  insert into bible.plan_changes (plan_id, action, details, actor_id)
  values (x.id, 'imported', jsonb_build_object('rows', v_n, 'mode', p_mode, 'file', i.file_name), v_uid);
  perform bible.audit('bible.plan_imported', 'bible_plan', x.id, jsonb_build_object('rows', v_n, 'mode', p_mode));
  return jsonb_build_object('applied', v_n, 'plan_id', x.id);
end;
$$;

create function public.bible_admin_plan_import_discard(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform bible.require_cap('reading.edit');
  update bible.plan_imports set status = 'discarded' where id = p_id and status = 'previewed';
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
