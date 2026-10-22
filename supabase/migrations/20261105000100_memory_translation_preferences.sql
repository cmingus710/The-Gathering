-- Memory verse translation preferences: a member's default memory
-- translation, a translation chosen per verse, changing a verse's
-- translation explicitly, and church/group collections that let members
-- practice in their own version.
--
-- Additive. No applied migration is edited, no row is rewritten, and no
-- member's progress is reset:
--   * memory.member_settings.default_translation_id (nullable): the member's
--     "Default memory verse translation". Unset, it follows their Bible
--     reading version, then the church's version (memory.effective_translation).
--     It is only a starting choice for new verses: changing it never touches
--     an existing card, passage, session, or attempt.
--   * memory.collections.translation_choice (default false = the church's
--     version is required, which is how every existing collection behaves).
--     When true, members may practice an assigned verse in another stored
--     version; the shared collection and its items never change.
--   * A card already pins one exact text (its passage: translation,
--     reference, text version, content hash), and every session and attempt
--     records that passage, so practice and scoring always use the card's own
--     wording. Changing a verse's translation (memory_card_change_translation)
--     works like the existing text-version switch: the earlier card and its
--     history are kept as "superseded", awards stay, and the new wording gets
--     its own card and schedule (or the member's earlier card for exactly
--     that wording comes back with its own progress). Mastery of one wording
--     is never carried to another.
--   * Only active stored-text ('database') translations are offered or
--     accepted, as before. Text that a version doesn't have is reported, never
--     substituted.
-- Replaced (same signatures and grants): memory.settings_json,
-- public.memory_settings_save, memory.collection_json, memory.card_json,
-- memory.member_item_json, public.memory_card_add, public.memory_card,
-- public.memory_card_switch_version, memory.challenge_aggregate,
-- public.memory_session_submit (treasured_five counts distinct references),
-- public.memory_admin_collection_save (translation_choice).
-- New: memory.translation_usable, memory.passage_ref, memory.translation_brief,
-- memory.effective_translation, memory.source_hash,
-- memory.translation_change_problem, public.memory_translations,
-- public.memory_card_translation_preview, public.memory_card_change_translation.

alter table memory.member_settings
  add column default_translation_id uuid references bible.translations (id) on delete set null;
create index member_settings_translation_idx on memory.member_settings (default_translation_id);

alter table memory.collections
  add column translation_choice boolean not null default false;
alter table memory.collections
  add constraint collections_translation_choice check (audience <> 'personal' or not translation_choice);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- A version members can memorize: active, with its text stored here.
create function memory.translation_usable(p_translation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_translation is not null
     and exists (select 1 from bible.translations t where t.id = p_translation and t.status = 'active' and t.source_kind = 'database');
$$;

-- The reference of a passage without its translation ("JHN.3.16-3.17").
create function memory.passage_ref(p memory.passages)
returns text
language sql
immutable
set search_path = ''
as $$
  select p.book_code || '.' || p.start_chapter || '.' || p.start_verse || '-' || p.end_chapter || '.' || p.end_verse;
$$;

create function memory.translation_brief(p_translation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'attribution', t.attribution, 'copyright', t.copyright,
                            'source_url', t.source_url, 'available', t.status = 'active' and t.source_kind = 'database')
    from bible.translations t where t.id = p_translation;
$$;

-- The version new memory verses start with: the member's memory default,
-- else their Bible reading version, else the church's version (each only
-- when it can be memorized). {id, source}; id is null when none qualifies.
create function memory.effective_translation(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('id', s.default_translation_id, 'source', 'memory')
       from memory.member_settings s where s.profile_id = p_profile and memory.translation_usable(s.default_translation_id)),
    (select jsonb_build_object('id', r.translation_id, 'source', 'reading')
       from bible.reader_prefs r where r.profile_id = p_profile and memory.translation_usable(r.translation_id)),
    (select jsonb_build_object('id', b.default_translation_id, 'source', 'church')
       from bible.settings b where memory.translation_usable(b.default_translation_id)),
    jsonb_build_object('id', null, 'source', 'none'));
$$;

-- The content hash memory.capture_passage would give the source's current
-- text of a reference (null when there is none).
create function memory.source_hash(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(string_agg(v.chapter || ':' || v.verse || E'\t' || v.text || E'\n', '' order by v.chapter, v.verse), 'UTF8')), 'hex')
    from bible.verses v
   where v.translation_id = p_translation and v.book_code = p_book and not v.omitted
     and (v.chapter, v.verse) >= (p_sc, p_sv) and (v.chapter, v.verse) <= (p_ec, p_ev);
$$;

-- Why a card can't move to another translation (null when it can). An
-- assignment that requires the church's version keeps it.
create function memory.translation_change_problem(k memory.cards, p_translation uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p memory.passages;
  c memory.collections;
  v_code text;
begin
  if k.id is null or k.status <> 'active' then
    return 'Only a verse you''re practicing can change translation.';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  if p_translation is null or not memory.translation_usable(p_translation) then
    return memory.passage_problem(p_translation, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse);
  end if;
  if p_translation = p.translation_id then
    return 'This verse already uses that version.';
  end if;
  if k.item_id is not null then
    select c0.* into c from memory.items i join memory.collections c0 on c0.id = i.collection_id where i.id = k.item_id;
    if c.id is not null and c.audience <> 'personal' and not c.translation_choice then
      select t.code into v_code from bible.translations t where t.id = c.translation_id;
      return 'This verse is assigned in ' || v_code || ', so it''s practiced in that version. To learn it in another version as well, add it as your own verse.';
    end if;
  end if;
  select t.code into v_code from memory.cards x join memory.passages y on y.id = x.passage_id join bible.translations t on t.id = y.translation_id
   where x.profile_id = k.profile_id and x.status = 'active' and x.id <> k.id
     and y.translation_id = p_translation and memory.passage_ref(y) = memory.passage_ref(p)
   limit 1;
  if v_code is not null then
    return 'You''re already practicing this verse in ' || v_code || '. Open it in My Verses instead.';
  end if;
  return memory.passage_problem(p_translation, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create or replace function memory.settings_json(s memory.member_settings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'difficulty', s.difficulty, 'presentation', s.presentation, 'ignore_case', s.ignore_case,
    'ignore_punctuation', s.ignore_punctuation, 'celebrations', s.celebrations, 'daily_goal', s.daily_goal,
    'timezone', s.timezone, 'effective_timezone', memory.member_tz(s.profile_id), 'paused', s.paused,
    'remind_weekly', s.remind_weekly, 'remind_review', s.remind_review, 'remind_practice', s.remind_practice,
    'remind_challenge', s.remind_challenge, 'reminder_time', to_char(s.reminder_time, 'HH24:MI'),
    -- The stored choice (null = not chosen), and what new verses use now.
    'default_translation_id', s.default_translation_id,
    'default_translation_available', s.default_translation_id is null or memory.translation_usable(s.default_translation_id),
    'effective_translation', (select memory.translation_brief((e ->> 'id')::uuid) || jsonb_build_object('source', e ->> 'source')
                                from (select memory.effective_translation(s.profile_id) as e) x where e ->> 'id' is not null));
$$;

-- default_translation_id: '' clears it (follow the Bible reading version);
-- a version must be one that can be memorized. Existing verses never change.
create or replace function public.memory_settings_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  s memory.member_settings := memory.settings_of(v_uid);
  v_translation uuid := s.default_translation_id;
begin
  if p ? 'difficulty' and p ->> 'difficulty' not in ('guided', 'growing', 'challenge') then
    raise exception 'Choose a difficulty.' using errcode = '22023';
  end if;
  if p ? 'presentation' and p ->> 'presentation' not in ('standard', 'kids') then
    raise exception 'Choose a presentation.' using errcode = '22023';
  end if;
  if p ? 'daily_goal' and nullif(p ->> 'daily_goal', '') is not null and (p ->> 'daily_goal')::integer not between 1 and 20 then
    raise exception 'Choose a daily goal from 1 to 20, or none.' using errcode = '22023';
  end if;
  if p ? 'timezone' and nullif(p ->> 'timezone', '') is not null and not memory.valid_tz(p ->> 'timezone') then
    raise exception 'Choose a valid time zone.' using errcode = '22023';
  end if;
  if p ? 'reminder_time' and (p ->> 'reminder_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Choose a reminder time.' using errcode = '22023';
  end if;
  if p ? 'default_translation_id' then
    v_translation := nullif(p ->> 'default_translation_id', '')::uuid;
    if v_translation is not null and v_translation is distinct from s.default_translation_id and not memory.translation_usable(v_translation) then
      raise exception 'Choose a Bible version that''s available for memory practice.' using errcode = '22023';
    end if;
  end if;
  insert into memory.member_settings as m (profile_id, difficulty, presentation, ignore_case, ignore_punctuation, celebrations, daily_goal,
                                           timezone, paused, remind_weekly, remind_review, remind_practice, remind_challenge, reminder_time,
                                           default_translation_id)
  values (v_uid,
          coalesce(p ->> 'difficulty', s.difficulty::text)::memory.difficulty,
          coalesce(p ->> 'presentation', s.presentation),
          coalesce((p ->> 'ignore_case')::boolean, s.ignore_case),
          coalesce((p ->> 'ignore_punctuation')::boolean, s.ignore_punctuation),
          coalesce((p ->> 'celebrations')::boolean, s.celebrations),
          case when p ? 'daily_goal' then nullif(p ->> 'daily_goal', '')::smallint else s.daily_goal end,
          case when p ? 'timezone' then nullif(p ->> 'timezone', '') else s.timezone end,
          coalesce((p ->> 'paused')::boolean, s.paused),
          coalesce((p ->> 'remind_weekly')::boolean, s.remind_weekly),
          coalesce((p ->> 'remind_review')::boolean, s.remind_review),
          coalesce((p ->> 'remind_practice')::boolean, s.remind_practice),
          coalesce((p ->> 'remind_challenge')::boolean, s.remind_challenge),
          coalesce((p ->> 'reminder_time')::time, s.reminder_time),
          v_translation)
  on conflict (profile_id) do update set
    difficulty = excluded.difficulty, presentation = excluded.presentation, ignore_case = excluded.ignore_case,
    ignore_punctuation = excluded.ignore_punctuation, celebrations = excluded.celebrations, daily_goal = excluded.daily_goal,
    timezone = excluded.timezone, paused = excluded.paused, remind_weekly = excluded.remind_weekly,
    remind_review = excluded.remind_review, remind_practice = excluded.remind_practice,
    remind_challenge = excluded.remind_challenge, reminder_time = excluded.reminder_time,
    default_translation_id = excluded.default_translation_id, updated_at = now();
  return memory.settings_json(memory.settings_of(v_uid));
end;
$$;

-- The versions a member can memorize, and the one new verses start with.
create function public.memory_translations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  v_effective jsonb := memory.effective_translation(v_uid);
begin
  return jsonb_build_object(
    'effective_id', v_effective ->> 'id', 'source', v_effective ->> 'source',
    'church_id', (select s.default_translation_id from bible.settings s),
    'reading_id', (select r.translation_id from bible.reader_prefs r where r.profile_id = v_uid and bible.translation_active(r.translation_id)),
    'items', coalesce((select jsonb_agg(bible.translation_json(t) order by t.id = (select s.default_translation_id from bible.settings s) desc, t.name)
                         from bible.translations t where t.status = 'active' and t.source_kind = 'database'), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------
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
    'translation', (select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) from bible.translations t where t.id = c.translation_id),
    'translation_choice', c.translation_choice,
    'kind', c.kind, 'status', c.status, 'publish_at', c.publish_at,
    'scheduled', c.status = 'published' and c.publish_at > now(),
    'sort_order', c.sort_order, 'goal_note', c.goal_note, 'goal_sessions_per_week', c.goal_sessions_per_week,
    'timezone', c.timezone, 'previous_collection_id', c.previous_collection_id,
    'published_at', c.published_at, 'archived_at', c.archived_at, 'updated_at', c.updated_at,
    'item_count', (select count(*) from memory.items i where i.collection_id = c.id and i.retired_at is null));
$$;

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
    if v_item is not null and not v_own and i.passage_id <> k.passage_id then
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
    'can_change_translation', k.status = 'active' and (v_assignment is null or (v_assignment ->> 'choice')::boolean));
end;
$$;

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
                                                                            'current_version', case when y.translation_id = ip.translation_id then k.passage_id = i.passage_id
                                                                                                    else y.superseded_by is null end,
                                                                            'translation', jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name)) end
               from memory.my_card_for_item(i, p_profile) k
               left join memory.passages y on y.id = k.passage_id
               left join bible.translations t on t.id = y.translation_id
               left join memory.passages ip on ip.id = i.passage_id));
$$;

-- ---------------------------------------------------------------------------
-- My Verses
-- ---------------------------------------------------------------------------
-- p: {item_id, translation_id?} (from a visible collection) or
-- {translation_id?, book, sc, sv, ec, ev} (personal; without a version it
-- uses memory.effective_translation). An assigned verse uses the
-- collection's version unless the collection lets members choose. One card
-- per assigned verse: a second version of it is a translation change, not a
-- second card. Idempotent: an existing card is returned (and restored if it
-- had been removed, with its history).
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
      v_passage := memory.capture_passage(v_translation, ip.book_code, ip.start_chapter, ip.start_verse, ip.end_chapter, ip.end_verse);
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
    v_passage := memory.capture_passage(v_translation, p ->> 'book', (p ->> 'sc')::integer, (p ->> 'sv')::integer,
                                        coalesce((p ->> 'ec')::integer, (p ->> 'sc')::integer), (p ->> 'ev')::integer);
  end if;
  if not bible.translation_active((select translation_id from memory.passages where id = v_passage)) then
    raise exception 'That Bible version isn''t available.' using errcode = '22023';
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

-- History entries name the version and text they were practiced in;
-- "earlier" lists this reference's other cards in any version.
create or replace function public.memory_card(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
  p memory.passages;
begin
  select * into k from memory.cards where id = p_id and profile_id = v_uid;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  return memory.card_json(k, true) || jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('activity', a.activity, 'difficulty', a.difficulty, 'segment', a.segment,
                                                             'accuracy', a.accuracy, 'hints', a.hints, 'confidence', a.confidence,
                                                             'quality', a.quality, 'step_before', a.step_before, 'step_after', a.step_after,
                                                             'date', a.local_date, 'at', a.created_at,
                                                             'translation', t.code, 'text_version', y.version) order by a.created_at desc)
                           from (select * from memory.attempts a where a.card_id = k.id order by a.created_at desc limit 50) a
                           join memory.passages y on y.id = a.passage_id
                           join bible.translations t on t.id = y.translation_id), '[]'::jsonb),
    'earlier', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'version', y.version, 'sessions', x.sessions, 'status', x.status,
                                                             'translation', t.code, 'same_translation', y.translation_id = p.translation_id)
                                          order by y.translation_id = p.translation_id desc, t.code, y.version)
                           from memory.cards x join memory.passages y on y.id = x.passage_id join bible.translations t on t.id = y.translation_id
                          where x.profile_id = v_uid and x.id <> k.id
                            and memory.passage_ref(y) = memory.passage_ref(p)), '[]'::jsonb),
    'settings', memory.settings_json(memory.settings_of(v_uid)));
end;
$$;

-- The member's explicit decision to practice the updated text. The earlier
-- card (and its history) is kept as "earlier text"; the new card starts
-- fresh, because practice of one wording isn't practice of another. A verse
-- practiced in the member's own version updates from that version's source,
-- never to the collection's version.
create or replace function public.memory_card_switch_version(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
  p memory.passages;
  i memory.items;
  v_new uuid;
  n memory.cards;
begin
  select * into k from memory.cards where id = p_id and profile_id = v_uid and status = 'active' for update;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  if k.item_id is not null then
    select * into i from memory.items where id = k.item_id and retired_at is null;
  end if;
  if i.id is not null and i.passage_id <> k.passage_id and memory.collection_visible_id(i.collection_id, v_uid)
     and (select translation_id from memory.passages where id = i.passage_id) = p.translation_id then
    v_new := i.passage_id;
  elsif p.superseded_by is not null or not memory.passage_current(p) then
    v_new := memory.capture_passage(p.translation_id, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse);
  end if;
  if v_new is null or v_new = k.passage_id then
    raise exception 'This verse already uses the current text.' using errcode = '22023';
  end if;
  update memory.cards set status = 'superseded', removed_at = now(), updated_at = now() where id = k.id;
  insert into memory.cards (profile_id, passage_id, item_id, due_on, previous_card_id)
  values (v_uid, v_new, k.item_id, memory.local_today(memory.member_tz(v_uid)), k.id)
  on conflict (profile_id, passage_id) do update
    set status = 'active', removed_at = null, previous_card_id = excluded.previous_card_id, updated_at = now()
  returning * into n;
  return memory.card_json(n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Changing a verse's translation
-- ---------------------------------------------------------------------------
-- What would change, before anything does: the replacement text exactly as
-- stored, verses the two versions number or include differently, and the
-- effect on practice. Nothing is saved; text the version doesn't have is
-- reported (ok = false), never replaced by another version's.
create or replace function public.memory_card_translation_preview(p_card uuid, p_translation uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
  p memory.passages;
  t bible.translations;
  v_problem text;
  v_hash text;
  v_back memory.cards;
  v_collection jsonb;
begin
  perform community.rate_limit(v_uid, 'memory_read', 300, interval '10 minutes');
  select * into k from memory.cards where id = p_card and profile_id = v_uid;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  v_problem := memory.translation_change_problem(k, p_translation);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'problem', v_problem);
  end if;
  select * into p from memory.passages where id = k.passage_id;
  select * into t from bible.translations where id = p_translation;
  -- The member's earlier card for exactly this wording comes back with its own progress.
  v_hash := memory.source_hash(p_translation, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse);
  select x.* into v_back from memory.cards x join memory.passages y on y.id = x.passage_id
   where x.profile_id = v_uid and y.translation_id = p_translation and y.content_hash = v_hash
     and memory.passage_ref(y) = memory.passage_ref(p);
  -- A personal collection keeps one version; the verse stays there in its current one.
  if k.item_id is not null then
    select jsonb_build_object('id', c.id, 'title', c.title) into v_collection
      from memory.items i join memory.collections c on c.id = i.collection_id
     where i.id = k.item_id and c.audience = 'personal' and c.translation_id <> p_translation;
  end if;
  return jsonb_build_object(
    'ok', true, 'label', p.label,
    'translation', bible.translation_json(t),
    'verses', bible.verses_json(p_translation, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse),
    'current', jsonb_build_object('translation', memory.translation_brief(p.translation_id), 'version', p.version,
                                  'verses', (memory.passage_json(p, true) -> 'verses')),
    -- Verses one version includes and the other leaves out or numbers differently.
    'only_current', coalesce((select jsonb_agg(e ->> 'c' || ':' || (e ->> 'v') order by (e ->> 'c')::integer, (e ->> 'v')::integer)
                                from jsonb_array_elements(p.verses) e
                               where not exists (select 1 from bible.verses v where v.translation_id = p_translation and v.book_code = p.book_code
                                                    and v.chapter = (e ->> 'c')::integer and v.verse = (e ->> 'v')::integer and not v.omitted)), '[]'::jsonb),
    'only_new', coalesce((select jsonb_agg(v.chapter || ':' || v.verse order by v.chapter, v.verse)
                            from bible.verses v
                           where v.translation_id = p_translation and v.book_code = p.book_code and not v.omitted
                             and (v.chapter, v.verse) >= (p.start_chapter, p.start_verse) and (v.chapter, v.verse) <= (p.end_chapter, p.end_verse)
                             and not exists (select 1 from jsonb_array_elements(p.verses) e
                                              where (e ->> 'c')::integer = v.chapter and (e ->> 'v')::integer = v.verse)), '[]'::jsonb),
    'effects', jsonb_build_object(
      'sessions', k.sessions, 'stage', memory.stage(k.step), 'review_ready', k.best_step >= 3,
      'restores', case when v_back.id is not null then jsonb_build_object('id', v_back.id, 'stage', memory.stage(v_back.step),
                                                                            'sessions', v_back.sessions, 'review_ready', v_back.best_step >= 3) end,
      'leaves_collection', v_collection));
end;
$$;

-- The member's explicit, confirmed change. The current card and its history
-- are kept as "earlier text" (status superseded), badges already earned stay,
-- and the new wording is practiced on its own card: new (due today), or the
-- member's earlier card for exactly that wording with its own progress. The
-- once-a-day schedule limit carries over, so switching can't move a verse
-- twice in one day. Assignments that require a version keep it.
create or replace function public.memory_card_change_translation(p_card uuid, p_translation uuid, p_confirm boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
  p memory.passages;
  v_problem text;
  v_new uuid;
  v_item uuid;
  n memory.cards;
begin
  perform community.rate_limit(v_uid, 'memory_card', 120, interval '10 minutes');
  if p_confirm is not true then
    raise exception 'Confirm the change after reviewing what it affects.' using errcode = '22023';
  end if;
  select * into k from memory.cards where id = p_card and profile_id = v_uid for update;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  v_problem := memory.translation_change_problem(k, p_translation);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  v_new := memory.capture_passage(p_translation, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse);
  -- Stays linked to a church or group assignment (which allows the choice,
  -- checked above); a personal collection keeps one version.
  if k.item_id is not null then
    select i.id into v_item from memory.items i join memory.collections c on c.id = i.collection_id
     where i.id = k.item_id and (c.audience <> 'personal' or c.translation_id = p_translation);
  end if;
  update memory.cards set status = 'superseded', removed_at = coalesce(removed_at, now()), updated_at = now() where id = k.id;
  insert into memory.cards (profile_id, passage_id, item_id, due_on, previous_card_id, last_scheduled_on)
  values (v_uid, v_new, v_item, memory.local_today(memory.member_tz(v_uid)), k.id, k.last_scheduled_on)
  on conflict (profile_id, passage_id) do update
    set status = 'active', removed_at = null, previous_card_id = excluded.previous_card_id,
        item_id = coalesce(excluded.item_id, memory.cards.item_id),
        last_scheduled_on = greatest(memory.cards.last_scheduled_on, excluded.last_scheduled_on), updated_at = now()
  returning * into n;
  return memory.card_json(n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Challenges
-- ---------------------------------------------------------------------------
-- As before, plus: when the collection lets members choose their version,
-- practice of the challenge's references counts in any version. Each attempt
-- is counted once, so changing a verse's translation adds nothing by itself.
create or replace function memory.challenge_aggregate(ch memory.challenges)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := memory.challenge_today(ch);
  v_through date := least(ch.ends_on, case when v_today > ch.ends_on then ch.ends_on else v_today - 1 end);
  v_sharing integer;
  v_sessions integer;
  v_refs text[];
  v_plain text[];
  v_translation uuid;
  v_choice boolean;
begin
  select count(*) into v_sharing from memory.challenge_participants cp
   where cp.challenge_id = ch.id and cp.left_at is null and cp.sharing
     and community.group_member(ch.group_id, cp.profile_id);
  if v_sharing < ch.min_participants then
    return jsonb_build_object('visible', false, 'min_participants', ch.min_participants, 'goal', ch.goal_sessions);
  end if;
  select c.translation_id, c.translation_choice into v_translation, v_choice from memory.collections c where c.id = ch.collection_id;
  select array_agg(distinct p.ref_key), array_agg(distinct memory.passage_ref(p)) into v_refs, v_plain
    from memory.items i join memory.passages p on p.id = i.passage_id
   where i.collection_id = ch.collection_id and i.retired_at is null;
  select count(*) into v_sessions
    from memory.attempts a
    join memory.passages p on p.id = a.passage_id
    join memory.challenge_participants cp on cp.challenge_id = ch.id and cp.profile_id = a.profile_id
   where cp.left_at is null and cp.sharing and community.group_member(ch.group_id, cp.profile_id)
     and a.completed and a.created_at >= cp.joined_at
     and a.local_date between ch.starts_on and v_through
     and case when v_choice then memory.passage_ref(p) = any(coalesce(v_plain, '{}'))
              else p.translation_id = v_translation and p.ref_key = any(coalesce(v_refs, '{}')) end;
  v_sessions := (v_sessions / 5) * 5;
  return jsonb_build_object('visible', true, 'participants', v_sharing, 'sessions', v_sessions, 'goal', ch.goal_sessions,
                            'percent', least(100, floor(100.0 * v_sessions / ch.goal_sessions))::integer,
                            'through', case when v_through >= ch.starts_on then v_through end,
                            'min_participants', ch.min_participants);
end;
$$;

-- ---------------------------------------------------------------------------
-- Practice: unchanged except that treasured_five counts distinct references
-- ---------------------------------------------------------------------------
create or replace function public.memory_session_submit(p_session uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  x memory.sessions;
  k memory.cards;
  pa memory.passages;
  s memory.member_settings := memory.settings_of(v_uid);
  v_today date := memory.local_today(memory.member_tz(v_uid));
  v_details jsonb := '{}'::jsonb;
  v_accuracy numeric;
  v_hints integer;
  v_conf text := nullif(p ->> 'confidence', '');
  v_quality memory.quality;
  v_recall boolean;
  v_step integer;
  v_due date;
  v_change text := 'practice';
  v_was_due boolean;
  v_badges jsonb := '[]'::jsonb;
  v_badge jsonb;
  v_result jsonb;
  v_attempts integer;
  v_days integer;
  v_item memory.items;
  v_verses integer[];
  v_step_before integer;
begin
  perform community.rate_limit(v_uid, 'memory_submit', 120, interval '10 minutes');
  x := memory.load_session(p_session, v_uid);
  if x.status = 'submitted' then
    return x.result || jsonb_build_object('replayed', true);
  end if;
  if x.status = 'expired' then
    return jsonb_build_object('status', 'expired', 'saved', false);
  end if;
  select * into k from memory.cards where id = x.card_id and profile_id = v_uid for update;
  if k.id is null or k.status <> 'active' or k.passage_id <> x.passage_id then
    return jsonb_build_object('status', 'conflict', 'saved', false);
  end if;
  select * into pa from memory.passages where id = x.passage_id;
  if v_conf is not null and v_conf not in ('not_yet', 'partly', 'mostly', 'fully') then
    raise exception 'Choose how well you knew it.' using errcode = '22023';
  end if;
  v_hints := x.hints;
  case x.activity
    when 'read_repeat' then
      v_hints := v_hints + least(greatest(coalesce((p ->> 'reveals')::integer, 0), 0), 500);
      v_details := jsonb_build_object('level', least(greatest(coalesce((p ->> 'level')::integer, 0), 0), 3));
    when 'flashcards', 'self_check' then
      if not x.revealed then
        raise exception 'Reveal the verse before checking yourself.' using errcode = '22023';
      end if;
      if v_conf is null then
        raise exception 'Choose how well you knew it.' using errcode = '22023';
      end if;
    when 'missing_words' then
      v_details := memory.score_blanks(pa.tokens, (select array_agg(b::integer) from jsonb_array_elements_text(x.setup -> 'blanks') b),
                                       coalesce(p -> 'answers', '{}'::jsonb), coalesce((x.setup ->> 'ignore_case')::boolean, true));
      v_accuracy := (v_details ->> 'accuracy')::numeric;
    when 'word_order' then
      v_details := memory.score_order(pa.tokens, x.setup -> 'chips', p -> 'order');
      v_accuracy := (v_details ->> 'accuracy')::numeric;
    when 'type_verse' then
      select array_agg(distinct (e ->> 'v')::integer) into v_verses
        from jsonb_array_elements(pa.tokens) with ordinality q(e, n) where n - 1 between x.token_from and x.token_to;
      v_details := memory.score_typed(pa.tokens, x.token_from, x.token_to, p ->> 'text',
                                      (x.setup ->> 'ignore_case')::boolean, (x.setup ->> 'ignore_punct')::boolean,
                                      (select b.name from bible.books b where b.code = pa.book_code), v_verses)
                   || jsonb_build_object('your_text', left(coalesce(p ->> 'text', ''), 20000),
                                         'text', memory.range_text(pa.tokens, x.token_from, x.token_to),
                                         'ignore_case', (x.setup ->> 'ignore_case')::boolean, 'ignore_punctuation', (x.setup ->> 'ignore_punct')::boolean);
      v_accuracy := (v_details ->> 'accuracy')::numeric;
  end case;

  v_quality := memory.quality_of(x.activity, v_accuracy, v_hints, v_conf);
  v_recall := memory.is_recall(x.activity, x.difficulty);
  v_step_before := k.step;
  v_step := k.step;
  v_due := k.due_on;
  v_was_due := k.due_on is null or k.due_on <= v_today;
  -- The schedule changes at most once per verse per day.
  if k.last_scheduled_on is not distinct from v_today then
    v_change := 'already_today';
  elsif v_quality = 'none' then
    v_change := 'practice';
  elsif not v_recall then
    if v_quality = 'strong' and k.step = 0 then
      v_step := 1; v_due := v_today + 1; v_change := 'advanced';
    end if;
  elsif v_quality = 'strong' then
    if v_was_due then
      v_step := least(k.step + 1, 7); v_due := v_today + memory.interval_for(v_step); v_change := 'advanced';
    else
      v_change := 'early';
    end if;
  elsif v_quality = 'partial' then
    if v_was_due then
      v_due := v_today + greatest(1, memory.interval_for(k.step) / 2); v_change := 'kept';
    else
      v_change := 'early';
    end if;
  else
    v_step := greatest(k.step - 1, 0); v_due := v_today + 1; v_change := 'eased';
  end if;

  update memory.cards set
    step = v_step, due_on = v_due, best_step = greatest(best_step, v_step),
    last_scheduled_on = case when v_change in ('advanced', 'kept', 'eased') then v_today else last_scheduled_on end,
    sessions = sessions + 1, last_practiced_at = now(), updated_at = now()
  where id = k.id
  returning * into k;

  insert into memory.attempts (session_id, card_id, profile_id, passage_id, activity, difficulty, segment, completed, accuracy, hints,
                               confidence, quality, step_before, step_after, local_date)
  values (x.id, k.id, v_uid, pa.id, x.activity, x.difficulty, x.segment, true, v_accuracy, v_hints, v_conf, v_quality,
          v_step_before, v_step, v_today);

  -- Badges (effort and milestones only; computed here, never accepted from
  -- the client).
  select count(*), count(distinct local_date) into v_attempts, v_days from memory.attempts where profile_id = v_uid and completed;
  for v_badge in
    select memory.award(v_uid, b) from unnest(array_remove(array[
      case when v_attempts >= 1 then 'first_steps' end,
      case when v_attempts >= 10 then 'steady_ten' end,
      case when v_attempts >= 50 then 'faithful_fifty' end,
      case when v_days >= 3 then 'coming_back' end,
      case when v_days >= 10 then 'ten_days' end,
      case when (x.activity = 'self_check' and v_conf = 'fully') or (x.activity = 'type_verse' and v_accuracy >= 1 and v_hints = 0) then 'recited' end,
      case when k.best_step >= 3 then 'taking_root' end,
      -- Distinct references: a verse switched to another translation or text
      -- (a separate card) is still one verse.
      case when (select count(distinct memory.passage_ref(y)) from memory.cards c join memory.passages y on y.id = c.passage_id
                  where c.profile_id = v_uid and c.best_step >= 3) >= 5 then 'treasured_five' end,
      case when (select count(distinct activity) from memory.attempts a where a.profile_id = v_uid) = 6 then 'explorer' end], null)) b
  loop
    if v_badge is not null then
      v_badges := v_badges || jsonb_build_array(v_badge);
    end if;
  end loop;
  if k.item_id is not null then
    select * into v_item from memory.items where id = k.item_id;
    if not exists (select 1 from memory.items i where i.collection_id = v_item.collection_id and i.retired_at is null
                      and not exists (select 1 from memory.cards c where c.profile_id = v_uid and c.sessions > 0
                                         and (c.item_id = i.id or c.passage_id = i.passage_id))) then
      v_badge := memory.award(v_uid, 'collection_explored', v_item.collection_id::text);
      if v_badge is not null then
        v_badges := v_badges || jsonb_build_array(v_badge || jsonb_build_object('collection',
                      (select c.title from memory.collections c where c.id = v_item.collection_id)));
      end if;
    end if;
  end if;

  v_result := jsonb_build_object(
    'status', 'saved', 'saved', true, 'session_id', x.id, 'card_id', k.id, 'activity', x.activity, 'difficulty', x.difficulty,
    'completed', true, 'accuracy', v_accuracy, 'hints', v_hints, 'confidence', v_conf, 'quality', v_quality,
    'recall', v_recall, 'details', v_details,
    'review', jsonb_build_object('change', v_change, 'step', k.step, 'stage', memory.stage(k.step), 'due_on', k.due_on,
                                 'review_ready', k.best_step >= 3),
    'badges', v_badges, 'done_today', (select count(*) from memory.attempts a where a.profile_id = v_uid and a.local_date = v_today),
    'daily_goal', s.daily_goal, 'celebrations', s.celebrations);
  update memory.sessions set status = 'submitted', submitted_at = now(), result = v_result where id = x.id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration: unchanged except for translation_choice ("Members may
-- practice in their own version"), which a published collection can turn
-- on but not off.
-- ---------------------------------------------------------------------------
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
    if v_translation is null or not exists (select 1 from bible.translations t where t.id = v_translation and t.status = 'active' and t.source_kind = 'database') then
      raise exception 'Choose an available Bible version with stored text.' using errcode = '22023';
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

revoke execute on all functions in schema memory from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('memory_translations', 'memory_card_translation_preview', 'memory_card_change_translation') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;
