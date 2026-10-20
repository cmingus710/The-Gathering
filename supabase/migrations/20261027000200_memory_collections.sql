-- Phase 9 · Memory verse collections: administration (church and group
-- collections), passage selection from the approved source, assignments
-- and multiweek sequences, publishing and scheduling, archive, duplicate,
-- text-version updates, group-leader authorization, covers, and preview.
--
-- Who can do what (every function rechecks):
--   memory.manage   draft collections and their items
--   memory.publish  everything above, plus publish/schedule/archive,
--                   changes to published collections, text updates,
--                   authorizing group leaders
--   authorized group leaders: the same as memory.publish, for collections
--                   whose audience is a group they actively lead and that
--                   a publisher authorized, and nothing else
-- No function here reads cards, sessions, attempts, settings, or awards.
-- Personal collections are never returned to staff.

-- ---------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------
create function memory.item_json(i memory.items, p_with_text boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'collection_id', i.collection_id, 'position', i.position,
    'title', i.title, 'note', i.note, 'hint', i.hint,
    'starts_on', i.starts_on, 'ends_on', i.ends_on, 'retired', i.retired_at is not null,
    'passage', memory.passage_json(p, p_with_text))
    from memory.passages p where p.id = i.passage_id;
$$;

create function memory.collection_json(c memory.collections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'description', c.description, 'cover_path', c.cover_path, 'cover_alt', c.cover_alt,
    'audience', c.audience, 'group_id', c.group_id,
    'group_name', (select g.name from community.groups g where g.id = c.group_id),
    'translation', (select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) from bible.translations t where t.id = c.translation_id),
    'kind', c.kind, 'status', c.status, 'publish_at', c.publish_at,
    'scheduled', c.status = 'published' and c.publish_at > now(),
    'sort_order', c.sort_order, 'goal_note', c.goal_note, 'goal_sessions_per_week', c.goal_sessions_per_week,
    'timezone', c.timezone, 'previous_collection_id', c.previous_collection_id,
    'published_at', c.published_at, 'archived_at', c.archived_at, 'updated_at', c.updated_at,
    'item_count', (select count(*) from memory.items i where i.collection_id = c.id and i.retired_at is null));
$$;

-- Suitability notes for one passage (shown to editors; never blocking
-- beyond the hard limits in memory.passage_problem).
create function memory.suitability(p memory.passages)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(w) filter (where w is not null), '[]'::jsonb) from (values
    (case when p.word_count > 80 then 'Longer than 80 words: typing, word order, and missing words use one part at a time ('
          || jsonb_array_length(p.segments) || ' parts).' end),
    (case when jsonb_array_length(p.short_segments) > 1 then 'Kids presentation practices it in '
          || jsonb_array_length(p.short_segments) || ' shorter parts.' end),
    (case when p.word_count < 4 then 'Very short: word order and missing words have little to practice.' end),
    (case when exists (select 1 from bible.verses v
                        where v.translation_id = p.translation_id and v.book_code = p.book_code and v.omitted
                          and (v.chapter, v.verse) >= (p.start_chapter, p.start_verse) and (v.chapter, v.verse) <= (p.end_chapter, p.end_verse))
          then 'Includes a verse this version leaves out; it isn''t part of the practice text.' end),
    (case when not memory.passage_current(p) then 'The source text for this reference has changed since it was added. Review the update.' end)
  ) x(w);
$$;

create function memory.load_collection(p_id uuid)
returns memory.collections
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c memory.collections;
begin
  select * into c from memory.collections where id = p_id and audience <> 'personal';
  if c.id is null or not memory.can_edit(c) then
    raise exception 'Collection not found.' using errcode = 'P0002';
  end if;
  return c;
end;
$$;

-- Changes to a published (or scheduled) collection need publishing rights.
create function memory.require_change(c memory.collections)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if c.status <> 'draft' and not memory.can_publish(c) then
    raise exception 'Only a memory verse publisher can change a published collection.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Overview
-- ---------------------------------------------------------------------------
create function public.memory_admin_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  v_staff boolean := public.has_capability('memory.manage') or public.has_capability('memory.publish');
  v_publish boolean := public.has_capability('memory.publish');
  v_led uuid[];
begin
  select coalesce(array_agg(a.group_id), '{}') into v_led
    from memory.group_authorizations a where community.group_leader(a.group_id, v_uid);
  if not v_staff and cardinality(v_led) = 0 then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_manage', v_staff, 'can_publish', v_publish,
    'led_groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                              from community.groups g where g.id = any(v_led)), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(memory.collection_json(c) order by c.status = 'archived', c.sort_order, c.title)
                               from memory.collections c
                              where c.audience <> 'personal'
                                and (v_staff or (c.audience = 'group' and c.group_id = any(v_led)))), '[]'::jsonb),
    'translations', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) order by t.name)
                                from bible.translations t where t.status = 'active' and t.source_kind = 'database'), '[]'::jsonb),
    'default_translation_id', (select s.default_translation_id from bible.settings s
                                 join bible.translations t on t.id = s.default_translation_id and t.status = 'active' and t.source_kind = 'database'),
    -- Groups a publisher may authorize, with their current state.
    'groups', case when v_publish then coalesce((
                select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'visibility', g.visibility,
                                                    'authorized', a.group_id is not null) order by g.name)
                  from community.groups g left join memory.group_authorizations a on a.group_id = g.id
                 where g.status = 'active'), '[]'::jsonb)
              else (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'visibility', g.visibility, 'authorized', true)), '[]'::jsonb)
                      from community.groups g where g.id = any(v_led)) end,
    'church_timezone', memory.church_tz());
end;
$$;

create function public.memory_admin_collection(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c memory.collections;
begin
  perform memory.require_member();
  c := memory.load_collection(p_id);
  return memory.collection_json(c) || jsonb_build_object(
    'can_publish', memory.can_publish(c),
    'description_full', c.description,
    'items', coalesce((select jsonb_agg(memory.item_json(i) || jsonb_build_object(
                                 'suitability', memory.suitability(p),
                                 'current', memory.passage_current(p),
                                 'in_use', exists (select 1 from memory.cards k where k.item_id = i.id),
                                 'versions', coalesce((select jsonb_agg(jsonb_build_object('reason', v.reason, 'changed_at', v.changed_at,
                                                                                          'from_version', fp.version, 'to_version', tp.version) order by v.changed_at desc)
                                                         from memory.item_versions v
                                                         join memory.passages fp on fp.id = v.from_passage_id
                                                         join memory.passages tp on tp.id = v.to_passage_id
                                                        where v.item_id = i.id), '[]'::jsonb))
                               order by i.retired_at is not null, i.position)
                         from memory.items i join memory.passages p on p.id = i.passage_id
                        where i.collection_id = c.id), '[]'::jsonb),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'title', ch.title, 'status', ch.status,
                                                                'starts_on', ch.starts_on, 'ends_on', ch.ends_on) order by ch.starts_on desc)
                              from memory.challenges ch where ch.collection_id = c.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'details', a.details) order by a.created_at desc)
                           from (select * from public.audit_log a
                                  where a.target_type = 'memory_collection' and a.target_id = c.id::text
                                  order by a.created_at desc limit 50) a), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
-- p: title, description, audience ('members'|'group'), group_id,
--    translation_id, kind, sort_order, goal_note, goal_sessions_per_week,
--    timezone. Drafts accept everything; published collections accept
--    presentation fields only (audience, translation, and kind are locked).
create function public.memory_admin_collection_save(p_id uuid, p jsonb, p_client_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections;
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_audience text := coalesce(p ->> 'audience', 'members');
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_translation uuid := nullif(p ->> 'translation_id', '')::uuid;
  v_kind text := coalesce(p ->> 'kind', 'collection');
  v_tz text := coalesce(nullif(p ->> 'timezone', ''), memory.church_tz());
  v_goal_sessions integer := nullif(p ->> 'goal_sessions_per_week', '')::integer;
  v_changed text[];
begin
  perform community.rate_limit(v_uid, 'memory_admin', 300, interval '10 minutes');
  if char_length(v_title) not between 1 and 120 then
    raise exception 'Give the collection a title (up to 120 characters).' using errcode = '22023';
  end if;
  if char_length(coalesce(p ->> 'description', '')) > 2000 or char_length(coalesce(p ->> 'goal_note', '')) > 300 then
    raise exception 'The description or goal is too long.' using errcode = '22023';
  end if;
  if v_goal_sessions is not null and v_goal_sessions not between 1 and 50 then
    raise exception 'Choose between 1 and 50 suggested sessions a week, or leave it blank.' using errcode = '22023';
  end if;
  if not memory.valid_tz(v_tz) then
    raise exception 'Choose a valid time zone.' using errcode = '22023';
  end if;

  if p_id is null then
    if p_client_key is not null then
      select * into c from memory.collections where created_by = v_uid and client_key = p_client_key;
      if c.id is not null then
        return memory.collection_json(c);
      end if;
    end if;
    if v_audience not in ('members', 'group') or v_kind not in ('collection', 'sequence') then
      raise exception 'Choose who the collection is for.' using errcode = '22023';
    end if;
    if v_audience = 'group' and (v_group is null or not exists (select 1 from community.groups where id = v_group and status = 'active')) then
      raise exception 'Choose an active group.' using errcode = '22023';
    end if;
    if v_audience = 'members' then
      v_group := null;
    end if;
    if not (public.has_capability('memory.manage') or public.has_capability('memory.publish')
            or (v_audience = 'group' and memory.leader_authorized(v_group, v_uid))) then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    if v_translation is null or not exists (select 1 from bible.translations t where t.id = v_translation and t.status = 'active' and t.source_kind = 'database') then
      raise exception 'Choose an available Bible version with stored text.' using errcode = '22023';
    end if;
    insert into memory.collections (title, description, audience, group_id, translation_id, kind, sort_order, goal_note,
                                    goal_sessions_per_week, timezone, client_key, created_by, updated_by)
    values (v_title, coalesce(p ->> 'description', ''), v_audience::memory.audience, v_group, v_translation, v_kind,
            coalesce(nullif(p ->> 'sort_order', '')::integer, 100), nullif(btrim(coalesce(p ->> 'goal_note', '')), ''),
            v_goal_sessions, v_tz, p_client_key, v_uid, v_uid)
    returning * into c;
    perform memory.audit('memory.collection_created', 'memory_collection', c.id, jsonb_build_object('audience', v_audience));
    return memory.collection_json(c);
  end if;

  c := memory.load_collection(p_id);
  perform memory.require_change(c);
  if c.status <> 'draft' and (
       (p ? 'audience' and p ->> 'audience' <> c.audience::text)
       or (p ? 'group_id' and nullif(p ->> 'group_id', '')::uuid is distinct from c.group_id)
       or (p ? 'translation_id' and v_translation is distinct from c.translation_id)
       or (p ? 'kind' and v_kind <> c.kind)) then
    raise exception 'Audience, Bible version, and kind can''t change after publishing. Duplicate the collection to make a new version.' using errcode = '22023';
  end if;
  if c.status = 'draft' then
    if p ? 'audience' and v_audience not in ('members', 'group') then
      raise exception 'Choose who the collection is for.' using errcode = '22023';
    end if;
    if p ? 'audience' and v_audience = 'group' and (v_group is null or not exists (select 1 from community.groups where id = v_group and status = 'active')) then
      raise exception 'Choose an active group.' using errcode = '22023';
    end if;
    -- A leader can't move a collection outside their authorized group.
    if p ? 'audience' and not (public.has_capability('memory.manage') or public.has_capability('memory.publish'))
       and (v_audience <> 'group' or not memory.leader_authorized(v_group, v_uid)) then
      raise exception 'You can manage only your authorized group''s collections.' using errcode = '42501';
    end if;
    if p ? 'translation_id' and v_translation is distinct from c.translation_id then
      if not exists (select 1 from bible.translations t where t.id = v_translation and t.status = 'active' and t.source_kind = 'database') then
        raise exception 'Choose an available Bible version with stored text.' using errcode = '22023';
      end if;
      if exists (select 1 from memory.items i where i.collection_id = c.id) then
        raise exception 'Remove the verses before changing the Bible version; passages are never switched to another version.' using errcode = '22023';
      end if;
    end if;
  end if;
  v_changed := array_remove(array[
    case when v_title <> c.title then 'title' end,
    case when coalesce(p ->> 'description', c.description) <> c.description then 'description' end,
    case when p ? 'goal_note' and nullif(btrim(p ->> 'goal_note'), '') is distinct from c.goal_note then 'goal' end,
    case when p ? 'sort_order' and nullif(p ->> 'sort_order', '')::integer is distinct from c.sort_order then 'order' end], null);
  update memory.collections set
    title = v_title,
    description = coalesce(p ->> 'description', description),
    audience = case when status = 'draft' and p ? 'audience' then v_audience::memory.audience else audience end,
    group_id = case when status = 'draft' and p ? 'audience' then case when v_audience = 'group' then v_group end else group_id end,
    translation_id = case when status = 'draft' and v_translation is not null then v_translation else translation_id end,
    kind = case when status = 'draft' and p ? 'kind' and v_kind in ('collection', 'sequence') then v_kind else kind end,
    sort_order = coalesce(nullif(p ->> 'sort_order', '')::integer, sort_order),
    goal_note = case when p ? 'goal_note' then nullif(btrim(p ->> 'goal_note'), '') else goal_note end,
    goal_sessions_per_week = case when p ? 'goal_sessions_per_week' then v_goal_sessions else goal_sessions_per_week end,
    timezone = case when p ? 'timezone' then v_tz else timezone end,
    updated_by = v_uid, updated_at = now()
  where id = c.id
  returning * into c;
  if cardinality(v_changed) > 0 then
    perform memory.audit('memory.collection_updated', 'memory_collection', c.id, jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return memory.collection_json(c);
end;
$$;

-- publish (now, or at p_at = scheduled), unschedule (scheduled → draft),
-- archive, restore (archived → published).
create function public.memory_admin_collection_status(p_id uuid, p_action text, p_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections := memory.load_collection(p_id);
begin
  if not memory.can_publish(c) then
    raise exception 'Only a memory verse publisher can do that.' using errcode = '42501';
  end if;
  case p_action
    when 'publish' then
      if c.status = 'archived' then
        raise exception 'Restore the collection instead.' using errcode = '22023';
      end if;
      if not exists (select 1 from memory.items i where i.collection_id = c.id and i.retired_at is null) then
        raise exception 'Add at least one verse before publishing.' using errcode = '22023';
      end if;
      if not bible.translation_active(c.translation_id) then
        raise exception 'This collection''s Bible version isn''t active.' using errcode = '22023';
      end if;
      if c.audience = 'group' and not exists (select 1 from community.groups g where g.id = c.group_id and g.status = 'active') then
        raise exception 'This collection''s group isn''t active.' using errcode = '22023';
      end if;
      if p_at is not null and p_at > now() + interval '1 year' then
        raise exception 'Schedule within the next year.' using errcode = '22023';
      end if;
      update memory.collections
         set status = 'published', publish_at = greatest(coalesce(p_at, now()), now() - interval '1 minute'),
             published_at = coalesce(published_at, now()), published_by = v_uid, updated_by = v_uid, updated_at = now()
       where id = c.id returning * into c;
      perform memory.audit(case when p_at is not null and p_at > now() then 'memory.collection_scheduled' else 'memory.collection_published' end,
                           'memory_collection', c.id, jsonb_build_object('publish_at', c.publish_at));
    when 'unschedule' then
      if c.status <> 'published' or c.publish_at <= now() then
        raise exception 'Only a scheduled collection can be returned to draft.' using errcode = '22023';
      end if;
      update memory.collections set status = 'draft', publish_at = null, updated_by = v_uid, updated_at = now()
       where id = c.id returning * into c;
      perform memory.audit('memory.collection_unscheduled', 'memory_collection', c.id);
    when 'archive' then
      if c.status = 'archived' then
        return memory.collection_json(c);
      end if;
      update memory.collections
         set status = 'archived', archived_at = now(), publish_at = coalesce(publish_at, now()), updated_by = v_uid, updated_at = now()
       where id = c.id returning * into c;
      perform memory.audit('memory.collection_archived', 'memory_collection', c.id);
    when 'restore' then
      if c.status <> 'archived' then
        raise exception 'Only an archived collection can be restored.' using errcode = '22023';
      end if;
      update memory.collections
         set status = case when published_at is null then 'draft'::memory.collection_status else 'published'::memory.collection_status end,
             publish_at = case when published_at is null then null else publish_at end,
             archived_at = null, updated_by = v_uid, updated_at = now()
       where id = c.id returning * into c;
      perform memory.audit('memory.collection_restored', 'memory_collection', c.id);
    else
      raise exception 'Unknown action.' using errcode = '22023';
  end case;
  return memory.collection_json(c);
end;
$$;

-- A new draft with the same details and verses (each captured from the
-- source's current text). Practice history stays with the original.
create function public.memory_admin_collection_duplicate(p_id uuid, p_title text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections := memory.load_collection(p_id);
  n memory.collections;
  i record;
  v_pos integer := 0;
begin
  perform community.rate_limit(v_uid, 'memory_admin', 300, interval '10 minutes');
  if not bible.translation_active(c.translation_id) then
    raise exception 'This collection''s Bible version isn''t active.' using errcode = '22023';
  end if;
  insert into memory.collections (title, description, audience, group_id, translation_id, kind, sort_order, goal_note,
                                  goal_sessions_per_week, timezone, previous_collection_id, created_by, updated_by)
  values (left(coalesce(nullif(btrim(p_title), ''), c.title || ' (copy)'), 120), c.description, c.audience, c.group_id,
          c.translation_id, c.kind, c.sort_order, c.goal_note, c.goal_sessions_per_week, c.timezone, c.id, v_uid, v_uid)
  returning * into n;
  for i in select x.*, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse
             from memory.items x join memory.passages p on p.id = x.passage_id
            where x.collection_id = c.id and x.retired_at is null order by x.position loop
    v_pos := v_pos + 1;
    insert into memory.items (collection_id, passage_id, position, title, note, hint)
    values (n.id, memory.capture_passage(n.translation_id, i.book_code, i.start_chapter, i.start_verse, i.end_chapter, i.end_verse),
            v_pos, i.title, i.note, i.hint);
  end loop;
  perform memory.audit('memory.collection_duplicated', 'memory_collection', n.id, jsonb_build_object('from', c.id));
  return memory.collection_json(n);
end;
$$;

-- Only a draft nobody has practiced from can be deleted; anything else is
-- archived instead.
create function public.memory_admin_collection_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections := memory.load_collection(p_id);
begin
  if c.status <> 'draft' or c.published_at is not null then
    raise exception 'Published collections are archived, not deleted.' using errcode = '22023';
  end if;
  if exists (select 1 from memory.cards k join memory.items i on i.id = k.item_id where i.collection_id = c.id)
     or exists (select 1 from memory.challenges ch where ch.collection_id = c.id) then
    raise exception 'This collection is in use. Archive it instead.' using errcode = '22023';
  end if;
  delete from memory.collections where id = c.id;
  perform memory.audit('memory.collection_deleted', 'memory_collection', c.id);
  return jsonb_build_object('deleted', true, 'previous_path', c.cover_path);
end;
$$;

create function public.memory_admin_cover(p_id uuid, p_path text, p_alt text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections := memory.load_collection(p_id);
  v_prev text := c.cover_path;
begin
  perform memory.require_change(c);
  if p_path is not null and p_path !~ ('^covers/' || c.id::text || '/[A-Za-z0-9_-]{8,64}\.webp$') then
    raise exception 'That cover can''t be used.' using errcode = '22023';
  end if;
  update memory.collections set cover_path = p_path, cover_alt = case when p_path is null then null else left(nullif(btrim(p_alt), ''), 300) end,
         updated_by = v_uid, updated_at = now()
   where id = c.id;
  perform memory.audit('memory.collection_updated', 'memory_collection', c.id, jsonb_build_object('fields', jsonb_build_array('cover')));
  return jsonb_build_object('previous_path', case when v_prev is distinct from p_path then v_prev end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Items (verses and assignments)
-- ---------------------------------------------------------------------------
create function memory.check_window(p_start date, p_end date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if (p_start is null) <> (p_end is null) then
    raise exception 'Give both a first and a last day for the assignment, or neither.' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'The assignment ends before it starts.' using errcode = '22023';
  end if;
  if p_end - p_start > 92 then
    raise exception 'An assignment can last at most 13 weeks.' using errcode = '22023';
  end if;
end;
$$;

-- p: book, sc, sv, ec, ev, title, note, hint, starts_on, ends_on
create function public.memory_admin_item_add(p_collection uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections := memory.load_collection(p_collection);
  v_passage uuid;
  v_start date := nullif(p ->> 'starts_on', '')::date;
  v_end date := nullif(p ->> 'ends_on', '')::date;
  i memory.items;
begin
  perform community.rate_limit(v_uid, 'memory_admin', 300, interval '10 minutes');
  perform memory.require_change(c);
  if c.status = 'archived' then
    raise exception 'Restore the collection before adding verses.' using errcode = '22023';
  end if;
  if (select count(*) from memory.items x where x.collection_id = c.id and x.retired_at is null) >= 200 then
    raise exception 'A collection can hold at most 200 verses.' using errcode = '22023';
  end if;
  perform memory.check_window(v_start, v_end);
  if char_length(coalesce(p ->> 'title', '')) > 120 or char_length(coalesce(p ->> 'note', '')) > 2000 or char_length(coalesce(p ->> 'hint', '')) > 300 then
    raise exception 'The title, note, or hint is too long.' using errcode = '22023';
  end if;
  v_passage := memory.capture_passage(c.translation_id, p ->> 'book', (p ->> 'sc')::integer, (p ->> 'sv')::integer,
                                      (p ->> 'ec')::integer, (p ->> 'ev')::integer);
  insert into memory.items (collection_id, passage_id, position, title, note, hint, starts_on, ends_on)
  values (c.id, v_passage,
          coalesce((select max(x.position) from memory.items x where x.collection_id = c.id and x.retired_at is null), 0) + 1,
          nullif(btrim(coalesce(p ->> 'title', '')), ''), coalesce(p ->> 'note', ''), nullif(btrim(coalesce(p ->> 'hint', '')), ''),
          v_start, v_end)
  returning * into i;
  update memory.collections set updated_by = v_uid, updated_at = now() where id = c.id;
  perform memory.audit('memory.item_added', 'memory_collection', c.id, jsonb_build_object('item', i.id));
  return memory.item_json(i);
end;
$$;

-- Editorial fields and the assignment window. Scripture is never edited
-- here (see memory_admin_item_update_text).
create function public.memory_admin_item_save(p_item uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  c memory.collections;
  v_start date;
  v_end date;
begin
  select * into i from memory.items where id = p_item;
  c := memory.load_collection(i.collection_id);
  perform memory.require_change(c);
  v_start := case when p ? 'starts_on' then nullif(p ->> 'starts_on', '')::date else i.starts_on end;
  v_end := case when p ? 'ends_on' then nullif(p ->> 'ends_on', '')::date else i.ends_on end;
  perform memory.check_window(v_start, v_end);
  if char_length(coalesce(p ->> 'title', '')) > 120 or char_length(coalesce(p ->> 'note', '')) > 2000 or char_length(coalesce(p ->> 'hint', '')) > 300 then
    raise exception 'The title, note, or hint is too long.' using errcode = '22023';
  end if;
  update memory.items set
    title = case when p ? 'title' then nullif(btrim(p ->> 'title'), '') else title end,
    note = coalesce(p ->> 'note', note),
    hint = case when p ? 'hint' then nullif(btrim(p ->> 'hint'), '') else hint end,
    starts_on = v_start, ends_on = v_end, updated_at = now()
  where id = i.id
  returning * into i;
  update memory.collections set updated_by = v_uid, updated_at = now() where id = c.id;
  perform memory.audit('memory.item_updated', 'memory_collection', c.id, jsonb_build_object('item', i.id));
  return memory.item_json(i);
end;
$$;

-- Move a verse up (-1) or down (+1). Ids, cards, and history are untouched.
create function public.memory_admin_item_move(p_item uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  o memory.items;
  c memory.collections;
begin
  select * into i from memory.items where id = p_item and retired_at is null;
  c := memory.load_collection(i.collection_id);
  perform memory.require_change(c);
  select * into o from memory.items
   where collection_id = i.collection_id and retired_at is null
     and case when p_direction < 0 then position < i.position else position > i.position end
   order by case when p_direction < 0 then -position else position end
   limit 1;
  if o.id is null then
    return;
  end if;
  update memory.items set position = 500 where id = i.id;
  update memory.items set position = i.position, updated_at = now() where id = o.id;
  update memory.items set position = o.position, updated_at = now() where id = i.id;
  update memory.collections set updated_by = v_uid, updated_at = now() where id = c.id;
  perform memory.audit('memory.item_moved', 'memory_collection', c.id, jsonb_build_object('item', i.id));
end;
$$;

-- Unused verses in drafts are deleted; anything members practiced from, or
-- in a published collection, is retired (kept for their history).
create function public.memory_admin_item_remove(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  c memory.collections;
  v_deleted boolean := false;
begin
  select * into i from memory.items where id = p_item and retired_at is null;
  c := memory.load_collection(i.collection_id);
  perform memory.require_change(c);
  if c.status = 'draft' and c.published_at is null and not exists (select 1 from memory.cards k where k.item_id = i.id) then
    delete from memory.items where id = i.id;
    v_deleted := true;
  else
    update memory.items set retired_at = now(), updated_at = now() where id = i.id;
  end if;
  -- Close the gap so positions stay 1..n.
  update memory.items x set position = x.position - 1, updated_at = now()
   where x.collection_id = c.id and x.retired_at is null and x.position > i.position;
  update memory.collections set updated_by = v_uid, updated_at = now() where id = c.id;
  perform memory.audit(case when v_deleted then 'memory.item_deleted' else 'memory.item_retired' end, 'memory_collection', c.id,
                       jsonb_build_object('item', i.id));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

-- The source's text for this reference changed (a reviewed re-import):
-- point the item at a new passage version, with a reason members can read.
-- Earlier practice stays attached to the earlier version; each member
-- decides whether to start the new one.
create function public.memory_admin_item_update_text(p_item uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  c memory.collections;
  p memory.passages;
  v_new uuid;
begin
  select * into i from memory.items where id = p_item and retired_at is null;
  c := memory.load_collection(i.collection_id);
  if not memory.can_publish(c) then
    raise exception 'Only a memory verse publisher can do that.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Explain the change for members (3 to 500 characters).' using errcode = '22023';
  end if;
  select * into p from memory.passages where id = i.passage_id;
  if memory.passage_current(p) then
    raise exception 'This verse already uses the source''s current text.' using errcode = '22023';
  end if;
  v_new := memory.capture_passage(p.translation_id, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse);
  update memory.items set passage_id = v_new, updated_at = now() where id = i.id returning * into i;
  insert into memory.item_versions (item_id, from_passage_id, to_passage_id, reason, changed_by)
  values (i.id, p.id, v_new, btrim(p_reason), v_uid);
  perform memory.audit('memory.item_text_updated', 'memory_collection', c.id, jsonb_build_object('item', i.id));
  return memory.item_json(i);
end;
$$;

-- Fills a sequence: verse 1 gets the week starting p_start, verse 2 the
-- next, and so on (p_days per verse).
create function public.memory_admin_sequence_fill(p_collection uuid, p_start date, p_days integer default 7)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections := memory.load_collection(p_collection);
begin
  perform memory.require_change(c);
  if p_start is null or p_days is null or p_days not between 1 and 31 then
    raise exception 'Choose a start date and 1 to 31 days per verse.' using errcode = '22023';
  end if;
  update memory.items x
     set starts_on = p_start + (x.position - 1) * p_days, ends_on = p_start + x.position * p_days - 1, updated_at = now()
   where x.collection_id = c.id and x.retired_at is null;
  update memory.collections set updated_by = v_uid, updated_at = now() where id = c.id;
  perform memory.audit('memory.sequence_filled', 'memory_collection', c.id, jsonb_build_object('start', p_start, 'days', p_days));
end;
$$;

-- Checks references for the passage picker: {book, sc, sv, ec, ev} →
-- {ok, problem, label, words, text} using the collection's translation.
create function public.memory_admin_passage_check(p_translation uuid, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  v_problem text;
begin
  if not (public.has_capability('memory.manage') or public.has_capability('memory.publish')
          or exists (select 1 from memory.group_authorizations a where community.group_leader(a.group_id, v_uid))) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  v_problem := memory.passage_problem(p_translation, p ->> 'book', (p ->> 'sc')::integer, (p ->> 'sv')::integer, (p ->> 'ec')::integer, (p ->> 'ev')::integer);
  return jsonb_build_object('ok', v_problem is null, 'problem', v_problem,
    'label', case when v_problem is null then bible.passage_label(p ->> 'book', (p ->> 'sc')::integer, (p ->> 'sv')::integer, (p ->> 'ec')::integer, (p ->> 'ev')::integer) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Group leaders
-- ---------------------------------------------------------------------------
create function public.memory_admin_group_authorize(p_group uuid, p_on boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  if not public.has_capability('memory.publish') then
    raise exception 'Only a memory verse publisher can do that.' using errcode = '42501';
  end if;
  if not exists (select 1 from community.groups where id = p_group) then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;
  if p_on then
    insert into memory.group_authorizations (group_id, granted_by, note) values (p_group, v_uid, left(nullif(btrim(p_note), ''), 300))
    on conflict (group_id) do nothing;
  else
    delete from memory.group_authorizations where group_id = p_group;
  end if;
  perform memory.audit(case when p_on then 'memory.group_authorized' else 'memory.group_unauthorized' end, 'community_group', p_group);
end;
$$;

revoke execute on all functions in schema memory from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'memory\_admin\_%' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;
