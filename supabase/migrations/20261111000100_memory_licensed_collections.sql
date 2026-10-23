-- Licensed API.Bible versions in church and group memory collections
-- (additive). Extends 20261106000100_memory_provider_practice, which built
-- memory practice for licensed versions (NIV, NASB, AMP) for members' own
-- verses, to shared collections and their assignments. No new integration:
-- the same passages without text, fingerprints, permission table, gated
-- practice modes, and server-side fetches are used.
--
--   * One eligibility rule (memory.translation_eligibility) for every memory
--     selector: a published ('active') version with its text stored here, or
--     a published licensed version whose memory permission is recorded
--     (memory.provider_permissions.unchanged_text) and whose provider access
--     is set up. Being published alone never makes a licensed version
--     eligible. Drafts and retired versions are never listed. The database
--     can't see the server's environment, so the app adds one more check
--     (the API key's server setting is present) before offering a version;
--     public.memory_translation_options gives it what it needs.
--   * A licensed version can be a collection's version. Its verses are
--     captured exactly like a member's own licensed verse: reference,
--     API.Bible passage ID, verse numbers, word count, and fingerprint from
--     the app's fetch (memory.capture_for). No text is stored.
--   * Practice of an assigned licensed verse goes through the existing
--     licensed path (memory.provider_session_start): flashcards and
--     self-check only, refused in the database otherwise. Membership of a
--     collection unlocks nothing.
--   * "Members may practice in their own Bible version" is unchanged: off,
--     the collection's version is required; on, each member may choose
--     another eligible version for themselves. The shared collection never
--     changes.
--   * Permission withdrawn: no new collections, verses, publishing, or new
--     cards in that version; collections stay listed with their verses,
--     members keep their cards, progress, and history; nothing is switched
--     to another version.
--   * Wording changes: the app compares fingerprints. Staff can point a
--     verse at the new wording (memory_admin_item_update_text with the
--     app's fetch); members are then asked, as for stored text. A member who
--     already started the new wording on their own isn't asked again.
--   * Youth: licensed collections aren't shown to youth accounts and can't
--     be assigned to youth groups or guardian-led practice (stored-text
--     collections are unchanged). Opening them to youth is a separate
--     decision.
--
-- Replaced (same signatures and grants): memory.collection_visible,
-- memory.translation_brief, memory.collection_json, memory.member_item_json,
-- memory.card_json, memory.suitability, public.memory_admin_home,
-- public.memory_admin_collection, public.memory_admin_collection_save,
-- public.memory_admin_collection_status, public.memory_admin_collection_duplicate,
-- public.memory_admin_item_add, public.memory_admin_item_update_text (now
-- also takes the app's fetch), public.memory_admin_preview,
-- public.memory_card_add, youth.child_items, public.youth_learning_options,
-- public.youth_learning_assign.
-- New: memory.translation_eligibility, memory.licensed,
-- public.memory_translation_options,
-- public.memory_admin_item_update_text(uuid, text, jsonb).
-- No row is rewritten; translation authorization settings are untouched.

-- ---------------------------------------------------------------------------
-- Eligibility (shared)
-- ---------------------------------------------------------------------------
-- Whether a version can be used for memory verses now, and why not:
--   eligible  true / false
--   reason    null | 'not_published' | 'not_confirmed' (licensed, memory
--             permission not recorded) | 'not_configured' (licensed,
--             provider access incomplete)
-- Exactly memory.translation_usable, with the reason spelled out.
create function memory.translation_eligibility(p_translation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.id is null or t.status <> 'active' then jsonb_build_object('eligible', false, 'reason', 'not_published')
    when memory.translation_usable(t.id) then jsonb_build_object('eligible', true, 'reason', null)
    when t.source_kind = 'api' and not coalesce((select pp.unchanged_text from memory.provider_permissions pp where pp.translation_id = t.id), false)
      then jsonb_build_object('eligible', false, 'reason', 'not_confirmed')
    else jsonb_build_object('eligible', false, 'reason', 'not_configured')
  end
  from (select 1) one left join bible.translations t on t.id = p_translation;
$$;

create function memory.licensed(p_translation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from bible.translations t where t.id = p_translation and t.source_kind = 'api');
$$;

-- Every published version with its memory eligibility, for selectors. A
-- licensed version also names the server setting that holds its key (the
-- name only; bible_passage already returns it), so the app can confirm
-- access is set up before offering it. Drafts and retired versions aren't
-- listed.
create function public.memory_translation_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform memory.require_member();
  return coalesce((select jsonb_agg(bible.translation_json(t) || jsonb_build_object(
                                      'memory_modes', to_jsonb(coalesce(memory.translation_modes(t.id), '{}'::text[])),
                                      'memory_eligible', (memory.translation_eligibility(t.id) ->> 'eligible')::boolean,
                                      'memory_reason', memory.translation_eligibility(t.id) ->> 'reason',
                                      'credential_env', case when t.source_kind = 'api' then t.credential_env end)
                                    order by t.id = (select s.default_translation_id from bible.settings s) desc, t.source_kind, t.name)
                     from bible.translations t where t.status = 'active'), '[]'::jsonb);
end;
$$;

-- Problem text for a version that can't be used for memory verses now.
create function memory.translation_problem(p_translation uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := (select t.code from bible.translations t where t.id = p_translation);
begin
  return case memory.translation_eligibility(p_translation) ->> 'reason'
    when 'not_published' then 'Choose a published Bible version.'
    when 'not_confirmed' then v_code || ' isn''t confirmed for memory verses. A Bible source manager records that its terms allow it first.'
    when 'not_configured' then v_code || ' isn''t connected to its outside service yet, so it can''t be used for memory verses.'
    else null end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Visibility: licensed collections aren't opened to youth accounts here
-- ---------------------------------------------------------------------------
create or replace function memory.collection_visible(c memory.collections, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.id is not null and memory.is_member(p_profile)
     and case c.audience
           when 'personal' then c.owner_id = p_profile and c.status <> 'archived'
           else c.status = 'published' and c.publish_at <= now()
                and bible.translation_active(c.translation_id)
                and (c.audience = 'members' or community.group_member(c.group_id, p_profile))
                -- Youth accounts aren't adult members: licensed collections stay closed to them.
                and (community.is_member(p_profile) or not memory.licensed(c.translation_id))
         end;
$$;

-- ---------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------
create or replace function memory.translation_brief(p_translation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'attribution', t.attribution, 'copyright', t.copyright,
                            'source_url', t.source_url, 'available', memory.translation_usable(t.id), 'source_kind', t.source_kind)
    from bible.translations t where t.id = p_translation;
$$;

-- As in 20261105000100; the translation also says whether it's licensed and
-- whether memory practice in it is available now.
create or replace function memory.collection_json(c memory.collections)
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
    'translation', (select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'source_kind', t.source_kind,
                                              'memory_available', memory.translation_usable(t.id),
                                              'memory_modes', to_jsonb(coalesce(memory.translation_modes(t.id), '{}'::text[])))
                      from bible.translations t where t.id = c.translation_id),
    'translation_choice', c.translation_choice,
    'kind', c.kind, 'status', c.status, 'publish_at', c.publish_at,
    'scheduled', c.status = 'published' and c.publish_at > now(),
    'sort_order', c.sort_order, 'goal_note', c.goal_note, 'goal_sessions_per_week', c.goal_sessions_per_week,
    'timezone', c.timezone, 'previous_collection_id', c.previous_collection_id,
    'published_at', c.published_at, 'archived_at', c.archived_at, 'updated_at', c.updated_at,
    'item_count', (select count(*) from memory.items i where i.collection_id = c.id and i.retired_at is null));
$$;

-- As in 20261105000100. For a licensed verse, "current" means the church
-- hasn't moved the verse on from the member's wording (a member who started
-- a newer wording themselves is current).
create or replace function memory.member_item_json(i memory.items, p_profile uuid, p_with_text boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select memory.item_json(i, p_with_text) || jsonb_build_object(
    'translation_choice', coalesce((select c.translation_choice from memory.collections c where c.id = i.collection_id), false),
    'card', (select case when k.id is null then null else jsonb_build_object('id', k.id, 'stage', memory.stage(k.step), 'sessions', k.sessions,
                                                                            'review_ready', k.best_step >= 3,
                                                                            'current_version', case when y.translation_id <> ip.translation_id then y.superseded_by is null
                                                                                                    when y.source_kind = 'api' then k.passage_id = i.passage_id
                                                                                                         or not exists (select 1 from memory.item_versions v where v.item_id = i.id and v.from_passage_id = k.passage_id)
                                                                                                    else k.passage_id = i.passage_id end,
                                                                            'modes', to_jsonb(coalesce(memory.translation_modes(y.translation_id), '{}'::text[])),
                                                                            'translation', jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name)) end
               from memory.my_card_for_item(i, p_profile) k
               left join memory.passages y on y.id = k.passage_id
               left join bible.translations t on t.id = y.translation_id
               left join memory.passages ip on ip.id = i.passage_id));
$$;

-- As in 20261106000100, except that a licensed verse is offered the
-- church's update only when the church moved the verse on from the
-- member's own wording (memory.item_versions), not merely because the
-- member started a newer wording themselves.
create or replace function memory.card_json(k memory.cards, p_with_text boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p memory.passages;
  i memory.items;
  c memory.collections;
  ip memory.passages;
  v_today date := memory.local_today(memory.member_tz(k.profile_id));
  v_update jsonb;
  v_item jsonb;
  v_assignment jsonb;
  v_own boolean := false;
begin
  select * into p from memory.passages where id = k.passage_id;
  if k.item_id is not null then
    select * into i from memory.items where id = k.item_id;
    select * into c from memory.collections where id = i.collection_id;
    select * into ip from memory.passages where id = i.passage_id;
    -- Practicing an assigned verse in the member's own version.
    v_own := ip.translation_id <> p.translation_id;
    if memory.collection_visible(c, k.profile_id) or c.audience = 'personal' and c.owner_id = k.profile_id then
      v_item := jsonb_build_object('id', i.id, 'title', i.title, 'note', i.note, 'hint', i.hint,
                                   'collection', jsonb_build_object('id', c.id, 'title', c.title, 'audience', c.audience));
    end if;
    if c.id is not null and c.audience <> 'personal' then
      v_assignment := jsonb_build_object('translation', memory.translation_brief(c.translation_id),
                                         'choice', c.translation_choice, 'own_translation', v_own);
    end if;
  end if;
  -- A newer text: the church updated the collection's verse, or the source
  -- itself changed. Either way the member decides; nothing switches by itself.
  -- A verse practiced in the member's own version follows that version's source.
  if k.status = 'active' then
    if v_item is not null and not v_own and i.passage_id <> k.passage_id
       and (p.source_kind <> 'api' or exists (select 1 from memory.item_versions v where v.item_id = i.id and v.from_passage_id = k.passage_id)) then
      v_update := jsonb_build_object('source', 'collection',
        'reason', (select v.reason from memory.item_versions v where v.item_id = i.id and v.from_passage_id = k.passage_id order by v.changed_at desc limit 1));
    elsif p.superseded_by is not null or not memory.passage_current(p) then
      v_update := jsonb_build_object('source', 'bible', 'reason', null);
    end if;
  end if;
  return jsonb_build_object(
    'id', k.id, 'status', k.status, 'step', k.step, 'stage', memory.stage(k.step), 'review_ready', k.best_step >= 3,
    'best_step', k.best_step, 'due_on', k.due_on, 'due', k.status = 'active' and (k.due_on is null or k.due_on <= v_today),
    'sessions', k.sessions, 'last_practiced_at', k.last_practiced_at, 'added_at', k.added_at,
    'previous_card_id', k.previous_card_id, 'passage', memory.passage_json(p, p_with_text),
    'item', v_item, 'update_available', v_update,
    'translation_available', bible.translation_active(p.translation_id),
    'assignment', v_assignment,
    'can_change_translation', k.status = 'active' and (v_assignment is null or (v_assignment ->> 'choice')::boolean),
    -- Practice modes this verse's version allows now (licensed versions:
    -- unchanged text only, and only while permitted).
    'modes', to_jsonb(coalesce(memory.translation_modes(p.translation_id), '{}'::text[])),
    'provider', p.source_kind = 'api');
end;
$$;

-- Editors' notes. A licensed passage has no stored text or practice parts;
-- what members can do with it is listed instead.
create or replace function memory.suitability(p memory.passages)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.source_kind = 'api' then (select coalesce(jsonb_agg(w) filter (where w is not null), '[]'::jsonb) from (values
      ('Licensed version: members see it exactly as published, with flashcards and self-check. Activities that hide or rearrange words aren''t offered.'),
      ('Its text isn''t stored here; it''s fetched from the provider whenever it''s shown.'),
      (case when not memory.translation_usable(p.translation_id) then 'Memory practice in this version isn''t available right now. Members keep their progress.' end)
    ) x(w))
  else (select coalesce(jsonb_agg(w) filter (where w is not null), '[]'::jsonb) from (values
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
  ) y(w)) end;
$$;

-- ---------------------------------------------------------------------------
-- Administration, My Verses, and youth
-- ---------------------------------------------------------------------------
-- As in 20261105000100; a permitted licensed version can be chosen too.
create or replace function public.memory_admin_collection_save(p_id uuid, p jsonb, p_client_key uuid default null)
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
  v_choice boolean := nullif(p ->> 'translation_choice', '')::boolean;
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
    -- Stored text, or a licensed version permitted for memory verses.
    if v_translation is null or not memory.translation_usable(v_translation) then
      raise exception '%', coalesce(memory.translation_problem(v_translation), 'Choose an available Bible version.') using errcode = '22023';
    end if;
    insert into memory.collections (title, description, audience, group_id, translation_id, translation_choice, kind, sort_order, goal_note,
                                    goal_sessions_per_week, timezone, client_key, created_by, updated_by)
    values (v_title, coalesce(p ->> 'description', ''), v_audience::memory.audience, v_group, v_translation, coalesce(v_choice, false), v_kind,
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
  -- Members may already be practicing in their own version, so a published
  -- collection can start allowing a choice but never stop.
  if c.status <> 'draft' and c.translation_choice and v_choice is false then
    raise exception 'Members may already be practicing in another version, so this can''t be turned off after publishing. Duplicate the collection to require one version.' using errcode = '22023';
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
      if v_translation is null or not memory.translation_usable(v_translation) then
        raise exception '%', coalesce(memory.translation_problem(v_translation), 'Choose an available Bible version.') using errcode = '22023';
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
    case when p ? 'sort_order' and nullif(p ->> 'sort_order', '')::integer is distinct from c.sort_order then 'order' end,
    case when v_choice is not null and v_choice <> c.translation_choice then 'translation_choice' end], null);
  update memory.collections set
    title = v_title,
    description = coalesce(p ->> 'description', description),
    audience = case when status = 'draft' and p ? 'audience' then v_audience::memory.audience else audience end,
    group_id = case when status = 'draft' and p ? 'audience' then case when v_audience = 'group' then v_group end else group_id end,
    translation_id = case when status = 'draft' and v_translation is not null then v_translation else translation_id end,
    kind = case when status = 'draft' and p ? 'kind' and v_kind in ('collection', 'sequence') then v_kind else kind end,
    translation_choice = coalesce(v_choice, translation_choice),
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

-- As in 20261027000200; publishing a licensed collection needs its version's
-- memory permission.
create or replace function public.memory_admin_collection_status(p_id uuid, p_action text, p_at timestamptz default null)
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
      -- A licensed version only while its memory permission stands.
      if not memory.translation_usable(c.translation_id) then
        raise exception '% Members keep anything they''ve already practiced.', memory.translation_problem(c.translation_id) using errcode = '22023';
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

-- As in 20261027000200; licensed verses are copied by reference.
create or replace function public.memory_admin_collection_duplicate(p_id uuid, p_title text default null)
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
  if not memory.translation_usable(c.translation_id) then
    raise exception '%', memory.translation_problem(c.translation_id) using errcode = '22023';
  end if;
  for i in select x.*, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse, p.source_kind
             from memory.items x join memory.passages p on p.id = x.passage_id
            where x.collection_id = c.id and x.retired_at is null order by x.position loop
    v_pos := v_pos + 1;
    insert into memory.items (collection_id, passage_id, position, title, note, hint)
    -- A licensed verse keeps the wording it was added with (no text here to
    -- recapture); staff update it from the app's fetch if it has changed.
    values (n.id, case when i.source_kind = 'api' then i.passage_id
                       else memory.capture_passage(n.translation_id, i.book_code, i.start_chapter, i.start_verse, i.end_chapter, i.end_verse) end,
            v_pos, i.title, i.note, i.hint);
  end loop;
  perform memory.audit('memory.collection_duplicated', 'memory_collection', n.id, jsonb_build_object('from', c.id));
  return memory.collection_json(n);
end;
$$;

-- p: book, sc, sv, ec, ev, title, note, hint, starts_on, ends_on, and for a
-- licensed version provider (as memory_card_add).
create or replace function public.memory_admin_item_add(p_collection uuid, p jsonb)
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
  -- A licensed version: p.provider {fingerprint, verses, words, passage_id}
  -- from the app's server fetch; never the text.
  v_passage := memory.capture_for(c.translation_id, p ->> 'book', (p ->> 'sc')::integer, (p ->> 'sv')::integer,
                                  (p ->> 'ec')::integer, (p ->> 'ev')::integer, p -> 'provider');
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

-- As in 20261027000200. For a licensed verse, p_provider is the app's fetch
-- of the current wording (no text); members are asked whether to switch.
create function public.memory_admin_item_update_text(p_item uuid, p_reason text, p_provider jsonb)
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
  if p.source_kind = 'api' then
    -- The app found the published wording changed (fingerprint).
    v_new := memory.capture_provider_passage(p.translation_id, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse, p_provider);
    if v_new = p.id then
      raise exception 'This verse already uses the current wording.' using errcode = '22023';
    end if;
  else
    if memory.passage_current(p) then
      raise exception 'This verse already uses the source''s current text.' using errcode = '22023';
    end if;
    v_new := memory.capture_passage(p.translation_id, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse);
  end if;
  update memory.items set passage_id = v_new, updated_at = now() where id = i.id returning * into i;
  insert into memory.item_versions (item_id, from_passage_id, to_passage_id, reason, changed_by)
  values (i.id, p.id, v_new, btrim(p_reason), v_uid);
  perform memory.audit('memory.item_text_updated', 'memory_collection', c.id, jsonb_build_object('item', i.id));
  return memory.item_json(i);
end;
$$;

create or replace function public.memory_admin_item_update_text(p_item uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.memory_admin_item_update_text(p_item, p_reason, null::jsonb);
$$;

-- As in 20261027000300; not for licensed versions.
create or replace function public.memory_admin_preview(p_item uuid, p_activity text, p_difficulty text, p_segment integer, p_short boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  c memory.collections;
  p memory.passages;
  v_id uuid := gen_random_uuid();
  x memory.sessions;
  v_segments jsonb;
begin
  select * into i from memory.items where id = p_item;
  select * into c from memory.collections where id = i.collection_id;
  if c.id is null or not memory.can_edit(c) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = i.passage_id;
  -- No stored text to build an activity from; the collection page shows the
  -- fetched text and what members can do with it.
  if p.source_kind = 'api' then
    raise exception 'Licensed versions are practiced with flashcards and self-check, showing the verse unchanged.' using errcode = '22023';
  end if;
  v_segments := case when p_short then p.short_segments else p.segments end;
  x.id := v_id;
  x.passage_id := p.id;
  x.card_id := null;
  x.activity := p_activity::memory.activity;
  x.difficulty := p_difficulty::memory.difficulty;
  x.segment := coalesce(p_segment, 0);
  x.short_segments := coalesce(p_short, false);
  x.hints := 0;
  x.revealed := false;
  x.status := 'open';
  if x.segment = 0 then
    x.token_from := 0;
    x.token_to := jsonb_array_length(p.tokens) - 1;
  else
    select (e ->> 'from')::integer, (e ->> 'to')::integer into x.token_from, x.token_to
      from jsonb_array_elements(v_segments) e where (e ->> 'n')::integer = x.segment;
    if x.token_from is null then
      raise exception 'That part of the passage doesn''t exist.' using errcode = '22023';
    end if;
  end if;
  x.setup := memory.build_setup(v_id, p, x.activity, x.difficulty, x.token_from, x.token_to, 0, memory.settings_of(v_uid), '{}'::jsonb);
  return memory.session_json(x) || jsonb_build_object('preview', true,
    'answer_text', memory.range_text(p.tokens, x.token_from, x.token_to), 'hidden', x.setup);
end;
$$;

-- As in 20261027000200, with the shared eligibility list.
create or replace function public.memory_admin_home()
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
    -- Every published version with its memory eligibility (ineligible ones
    -- are shown disabled with the reason; drafts aren't listed).
    'translations', public.memory_translation_options(),
    'default_translation_id', (select s.default_translation_id from bible.settings s where memory.translation_usable(s.default_translation_id)),
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

-- As in 20261106000100; an assigned licensed verse needs its version's
-- memory permission.
create or replace function public.memory_card_add(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  c memory.collections;
  ip memory.passages;
  v_translation uuid := nullif(p ->> 'translation_id', '')::uuid;
  v_passage uuid;
  k memory.cards;
  v_ref text;
  v_code text;
begin
  perform community.rate_limit(v_uid, 'memory_card', 120, interval '10 minutes');
  if p ? 'item_id' then
    select * into i from memory.items where id = nullif(p ->> 'item_id', '')::uuid and retired_at is null;
    select * into c from memory.collections where id = i.collection_id;
    if i.id is null or not memory.collection_visible(c, v_uid) then
      raise exception 'That verse isn''t available.' using errcode = 'P0002';
    end if;
    select * into ip from memory.passages where id = i.passage_id;
    if v_translation is null or v_translation = ip.translation_id then
      v_passage := i.passage_id;
    elsif c.audience = 'personal' or not c.translation_choice then
      select t.code into v_code from bible.translations t where t.id = ip.translation_id;
      raise exception 'This verse is assigned in %, so it''s practiced in that version.', v_code using errcode = '22023';
    else
      v_passage := memory.capture_for(v_translation, ip.book_code, ip.start_chapter, ip.start_verse, ip.end_chapter, ip.end_verse, p -> 'provider');
    end if;
    select * into k from memory.my_card_for_item(i, v_uid);
    if k.id is not null and k.passage_id <> v_passage
       and (select translation_id from memory.passages where id = k.passage_id) <> (select translation_id from memory.passages where id = v_passage) then
      select t.code into v_code from memory.passages y join bible.translations t on t.id = y.translation_id where y.id = k.passage_id;
      raise exception 'You''re already practicing this verse in %. Open it in My Verses to change its translation.', v_code using errcode = '22023';
    end if;
    k := null;
  else
    v_translation := coalesce(v_translation, (memory.effective_translation(v_uid) ->> 'id')::uuid);
    v_passage := memory.capture_for(v_translation, p ->> 'book', (p ->> 'sc')::integer, (p ->> 'sv')::integer,
                                    coalesce((p ->> 'ec')::integer, (p ->> 'sc')::integer), (p ->> 'ev')::integer, p -> 'provider');
  end if;
  if not bible.translation_active((select translation_id from memory.passages where id = v_passage)) then
    raise exception 'That Bible version isn''t available.' using errcode = '22023';
  end if;
  -- An assigned licensed verse: only while that version's memory permission
  -- stands. Nothing is switched to another version.
  if not memory.translation_usable((select translation_id from memory.passages where id = v_passage)) then
    raise exception '% isn''t available for memory practice right now. No other version is used instead.',
      (select t.code from memory.passages y join bible.translations t on t.id = y.translation_id where y.id = v_passage) using errcode = '22023';
  end if;
  select * into k from memory.cards where profile_id = v_uid and passage_id = v_passage;
  if k.id is not null then
    if k.status = 'removed' then
      update memory.cards set status = 'active', removed_at = null, updated_at = now(),
             item_id = coalesce(item_id, i.id)
       where id = k.id returning * into k;
    end if;
    return memory.card_json(k);
  end if;
  -- An active card for another text version of this reference: the member
  -- chooses explicitly (memory_card_switch_version) instead.
  select ref_key into v_ref from memory.passages where id = v_passage;
  if exists (select 1 from memory.cards x join memory.passages y on y.id = x.passage_id
              where x.profile_id = v_uid and x.status = 'active' and y.ref_key = v_ref and y.id <> v_passage) then
    raise exception 'You''re already practicing this verse in an earlier text. Open it in My Verses to choose the updated text.' using errcode = '22023';
  end if;
  if (select count(*) from memory.cards x where x.profile_id = v_uid and x.status = 'active') >= 500 then
    raise exception 'My Verses can hold up to 500 verses. Remove some first.' using errcode = '22023';
  end if;
  insert into memory.cards (profile_id, passage_id, item_id, due_on)
  values (v_uid, v_passage, i.id, memory.local_today(memory.member_tz(v_uid)))
  returning * into k;
  return memory.card_json(k);
end;
$$;

-- Youth: as in 20261028000700, stored-text collections only.
create or replace function youth.child_items(p_child uuid)
returns setof memory.items
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.*
    from youth.learning l
    join memory.collections c on c.id = l.memory_collection_id and c.status = 'published' and c.publish_at <= now()
    join memory.items i on i.collection_id = c.id and i.retired_at is null
   where l.kind = 'memory_collection' and youth.learning_current(l) and youth.enrolled(l.group_id, p_child)
     and bible.translation_active(c.translation_id)
     -- Stored-text collections only (licensed ones aren't opened to youth here).
     and not memory.licensed(c.translation_id);
$$;

create or replace function public.youth_learning_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  if not (public.has_capability('youth.publish') or exists (select 1 from youth.group_leaders l where l.profile_id = v_uid and l.status = 'active'
                                                              and l.can_publish and youth.is_leader(l.group_id, v_uid))) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'memory_collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) order by c.title)
                                     from memory.collections c where c.audience = 'members' and c.status = 'published'
                                      and not memory.licensed(c.translation_id)), '[]'::jsonb),
    'reading_plans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title) order by p.title)
                                from bible.plans p where p.audience = 'members' and p.status = 'published'), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'kind', i.kind) order by i.title)
                            from media.items i where i.kind::text in ('devotional', 'lesson', 'assignment')
                             and i.audience::text in ('public', 'members') and media.is_live(i.status, i.publish_at, i.expires_at)), '[]'::jsonb));
end;
$$;

create or replace function public.youth_learning_assign(p_group uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_ref uuid := nullif(p ->> 'ref_id', '')::uuid;
  v_kind text := p ->> 'kind';
  l youth.learning;
begin
  if not youth.can_publish(p_group, v_uid) or not exists (select 1 from youth.groups where id = p_group and status = 'active') then
    raise exception 'You can''t publish to that group.' using errcode = '42501';
  end if;
  if v_kind = 'memory_collection' and not exists (select 1 from memory.collections c where c.id = v_ref and c.audience = 'members' and c.status = 'published'
                                                    and not memory.licensed(c.translation_id))
     or v_kind = 'reading_plan' and not exists (select 1 from bible.plans pl where pl.id = v_ref and pl.audience = 'members' and pl.status = 'published')
     or v_kind = 'resource' and not exists (select 1 from media.items i where i.id = v_ref and i.audience::text in ('public', 'members')
                                              and media.is_live(i.status, i.publish_at, i.expires_at))
     or v_kind not in ('memory_collection', 'reading_plan', 'resource') then
    raise exception 'Choose something published for the whole church.' using errcode = '22023';
  end if;
  insert into youth.learning (group_id, kind, memory_collection_id, bible_plan_id, media_item_id, note, starts_on, ends_on, assigned_by)
  values (p_group, v_kind, case when v_kind = 'memory_collection' then v_ref end, case when v_kind = 'reading_plan' then v_ref end,
          case when v_kind = 'resource' then v_ref end, left(coalesce(p ->> 'note', ''), 300),
          nullif(p ->> 'starts_on', '')::date, nullif(p ->> 'ends_on', '')::date, v_uid)
  returning * into l;
  perform youth.notify(x.guardian_id, 'youth_learning', jsonb_build_object('youth_learning_id', l.id), 'youth_learning:' || l.id)
     from (select distinct g.guardian_id from youth.enrollments e join youth.guardianships g on g.child_id = e.child_id
            where e.group_id = p_group and e.status = 'active' and g.status = 'verified' and (g.can_practice or g.can_receive_updates)
              and youth.guardian_can(e.child_id, g.guardian_id)) x;
  perform youth.audit('youth.learning_assigned', 'youth_group', p_group, jsonb_build_object('kind', v_kind));
  return jsonb_build_object('id', l.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: helpers stay private; the new entry points are for signed-in
-- members (each rechecks membership and rights).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema memory from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('memory_translation_options', 'memory_admin_item_update_text') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;
