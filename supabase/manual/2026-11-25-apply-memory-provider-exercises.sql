-- All six memory exercises for licensed versions · Apply migration
-- 20261125000100_memory_provider_exercises to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/memory-provider-practice.md, "Activation steps"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: new columns on memory.provider_permissions (all default off),
-- one check and two indexes, NIV's existing row marked as needing Biblica's
-- feature approval (a restriction only), private helpers, four member
-- entry points (authenticated only), and create-or-replace of the practice
-- and permission functions with the same signatures and grants. Nothing is
-- enabled: every version keeps exactly the practice it has now until a
-- Bible source manager records the second permission.
--
-- It copies supabase/migrations/20261125000100_memory_provider_exercises.sql
-- verbatim and records it under its repository version (created_by =
-- memory-provider-exercises). All or nothing: one transaction; a second run
-- stops at the preflight with "Nothing was changed". It needs
-- 20261106000100 and 20261111000100.
begin;

do $preflight$
begin
  if to_regclass('memory.provider_permissions') is null or to_regprocedure('public.memory_translation_options()') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where version in ('20261106000100', '20261111000100')) <> 2 then
    raise exception 'Nothing was changed: 20261106000100 and 20261111000100 must be recorded first. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125000100')
     or exists (select 1 from information_schema.columns where table_schema = 'memory' and table_name = 'provider_permissions' and column_name = 'exercise_modes') then
    raise exception 'Nothing was changed: 20261125000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261125000100_memory_provider_exercises.sql
-- =========================================================================
-- All six memory exercises for licensed API.Bible versions, without storing
-- their text (additive).
--
-- Authorization: API.Bible support's written clarification (DJ Chuang,
-- support@api.bible, 2026-10-26; recorded in
-- docs/memory-provider-practice.md). All six exercise mechanics are permitted
-- for NIV, NASB, and AMP under the church's existing licenses: masking,
-- revealing, tokenizing, and reordering the verbatim text are learning
-- interactions, not changes to it. Conditions:
--   * the underlying text stays verbatim, and nothing altered is stored or
--     shared;
--   * the abbreviation and a link to the full copyright notice stay on screen
--     during every exercise (the app);
--   * every display is reported to FUMS, including partly hidden text (the
--     app);
--   * NIV also has a direct Biblica agreement whose feature-approval clause
--     must be checked before this enhanced feature is turned on for NIV.
--
-- So, per licensed version, a Bible source manager can now record a second
-- permission (memory.provider_permissions.exercise_modes) on top of the
-- existing unchanged-text one. It is off for every version after this
-- migration: nothing is enabled. A version marked as needing its publisher's
-- feature approval (publisher_approval_required; set for NIV's existing row
-- here, and for any new NIV row) can't have it turned on until that approval
-- is recorded too.
--
-- How the exercises work without stored text:
--   * The app's server fetches the passage through the existing API.Bible
--     integration (in-memory cache, at most cache_days, 1 day today) and
--     passes the verses to the database for that one call only (key
--     'source'). The database checks them against the passage's fingerprint
--     (memory.provider_text): a mismatch means the published wording
--     changed (SQLSTATE P0010), and nothing is recorded.
--   * The verified verses are tokenized in memory exactly like stored text,
--     so every existing game (memory.build_setup, memory.public_setup, the
--     hint logic, and the three scorers) runs unchanged on them.
--   * Only text-free structure is stored with a session: word positions of
--     blanks, piece ranges and ids, directions, settings. The word bank,
--     tokens, piece text, hints, typed answers, and answer feedback are
--     returned to the member's browser and never written. Results stored for
--     licensed versions keep scores and counts only.
--   * Cards, attempts, history, and progress are unchanged (they never held
--     text).
--
-- Replaced (same signatures and grants): memory.translation_modes,
-- public.memory_session_start (licensed text path), public.memory_session_hint,
-- public.memory_session_submit, public.memory_admin_preview (5 arguments, now
-- delegating), memory.suitability, public.memory_admin_provider_permissions,
-- public.memory_admin_provider_permission_save.
-- New: memory.provider_exercises, memory.provider_text, memory.session_json_with,
-- memory.provider_session_start_text, memory.provider_result,
-- public.memory_session_source, public.memory_card_parts,
-- public.memory_admin_preview(uuid, text, text, integer, boolean, jsonb),
-- public.memory_admin_provider_exercises_save.

-- ---------------------------------------------------------------------------
-- The second permission: all six exercises
-- ---------------------------------------------------------------------------
alter table memory.provider_permissions
  -- All six exercises (read & repeat, flashcards both ways, missing words,
  -- word order, typed recall, self-check with hints), shown on screen only.
  add column exercise_modes boolean not null default false,
  add column exercise_note text check (exercise_note is null or char_length(btrim(exercise_note)) between 10 and 2000),
  add column exercise_confirmed_by uuid references public.profiles (id) on delete set null,
  add column exercise_confirmed_at timestamptz,
  -- A direct agreement with the publisher (NIV: Biblica, feature-approval
  -- clause) that must approve the enhanced feature first.
  add column publisher_approval_required boolean not null default false,
  add column publisher_approval_note text check (publisher_approval_note is null or char_length(btrim(publisher_approval_note)) between 10 and 2000),
  add column publisher_approval_confirmed_by uuid references public.profiles (id) on delete set null,
  add column publisher_approval_confirmed_at timestamptz;
alter table memory.provider_permissions add constraint provider_permissions_exercises check (
  not exercise_modes
  or (unchanged_text and exercise_note is not null and exercise_confirmed_at is not null
      and (not publisher_approval_required or publisher_approval_confirmed_at is not null)));
create index provider_permissions_exercise_by_idx on memory.provider_permissions (exercise_confirmed_by);
create index provider_permissions_publisher_by_idx on memory.provider_permissions (publisher_approval_confirmed_by);

-- NIV carries a direct Biblica agreement with a feature-approval clause
-- (API.Bible support, 2026-10-26). A restriction only: nothing is enabled.
update memory.provider_permissions pp set publisher_approval_required = true
  from bible.translations t where t.id = pp.translation_id and t.code = 'NIV';

-- ---------------------------------------------------------------------------
-- Modes
-- ---------------------------------------------------------------------------
create function memory.provider_exercises(p_translation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from memory.provider_permissions pp join bible.translations t on t.id = pp.translation_id
                  where pp.translation_id = p_translation and pp.unchanged_text and pp.exercise_modes and t.status = 'active');
$$;

-- As in 20261106000100, plus all six for a licensed version with both permissions.
create or replace function memory.translation_modes(p_translation uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.source_kind = 'database' or memory.provider_exercises(t.id)
      then array['read_repeat', 'flashcards', 'missing_words', 'word_order', 'type_verse', 'self_check']
    when exists (select 1 from memory.provider_permissions pp where pp.translation_id = t.id and pp.unchanged_text) then array['flashcards', 'self_check']
    else array[]::text[]
  end
  from bible.translations t where t.id = p_translation and t.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- A licensed passage with its text for one call only
-- ---------------------------------------------------------------------------
-- p_source: [{c, v, t, q}] as the app's server just fetched it (the verses
-- with text, verbatim). Checked against the passage's fingerprint, which the
-- app computes the same way (src/lib/memory/provider.ts: NFC, then
-- "c:v<TAB>text<NEWLINE>" per verse, SHA-256). The returned row carries
-- verses, tokens, and parts in memory; it is never written.
create function memory.provider_text(p memory.passages, p_source jsonb)
returns memory.passages
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pt memory.passages := p;
  v_code text := (select t.code from bible.translations t where t.id = p.translation_id);
  v_hash text;
  v_tokens jsonb;
begin
  if p.source_kind <> 'api' then
    return p;
  end if;
  if p_source is null or jsonb_typeof(p_source) <> 'array' or jsonb_array_length(p_source) not between 1 and 30
     or exists (select 1 from jsonb_array_elements(p_source) e
                 where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 't') <> 'string' or btrim(e ->> 't') = ''
                    or coalesce(e ->> 'c', '') !~ '^\d{1,3}$' or coalesce(e ->> 'v', '') !~ '^\d{1,3}$'
                    or ((e ->> 'c')::integer, (e ->> 'v')::integer) < (p.start_chapter, p.start_verse)
                    or ((e ->> 'c')::integer, (e ->> 'v')::integer) > (p.end_chapter, p.end_verse))
     or (select sum(char_length(e ->> 't')) from jsonb_array_elements(p_source) e) > 20000 then
    raise exception '% is temporarily unavailable for practice. Try again later; no other version is used instead.', v_code using errcode = '22023';
  end if;
  select encode(sha256(convert_to(string_agg((e ->> 'c')::integer || ':' || (e ->> 'v')::integer || E'\t' || normalize(e ->> 't', NFC) || E'\n', ''
                                             order by (e ->> 'c')::integer, (e ->> 'v')::integer), 'UTF8')), 'hex')
    into v_hash from jsonb_array_elements(p_source) e;
  if v_hash is distinct from p.content_hash then
    raise exception 'The wording of this passage in % has changed since you added it. Open the verse to start the new wording; nothing was recorded.', v_code
      using errcode = 'P0010';
  end if;
  pt.verses := (select jsonb_agg(jsonb_build_object('c', (e ->> 'c')::integer, 'v', (e ->> 'v')::integer, 't', e ->> 't',
                                                    'q', coalesce((e ->> 'q')::boolean, false))
                                 order by (e ->> 'c')::integer, (e ->> 'v')::integer)
                  from jsonb_array_elements(p_source) e);
  -- Same tokenizer as memory.capture_passage (poetry verses end their last line with a break).
  select coalesce(jsonb_agg(jsonb_build_object('t', s.t, 'c', (e ->> 'c')::integer, 'v', (e ->> 'v')::integer, 'g', s.g,
                                               'b', s.b or (coalesce((e ->> 'q')::boolean, false)
                                                            and s.ord = (select count(*) from memory.split_tokens(e ->> 't'))))
                            order by n, s.ord), '[]'::jsonb)
    into v_tokens
    from jsonb_array_elements(pt.verses) with ordinality x(e, n)
    cross join lateral memory.split_tokens(e ->> 't') with ordinality s(t, g, b, ord);
  pt.tokens := v_tokens;
  pt.word_count := jsonb_array_length(v_tokens);
  pt.segments := memory.segments(v_tokens, 32, p.label);
  pt.short_segments := memory.segments(v_tokens, 16, p.label);
  return pt;
end;
$$;

-- memory.session_json for a passage held in memory (licensed text).
create function memory.session_json_with(x memory.sessions, p memory.passages)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_segments jsonb := case when x.short_segments then p.short_segments else p.segments end;
begin
  return jsonb_build_object(
    'id', x.id, 'card_id', x.card_id, 'activity', x.activity, 'difficulty', x.difficulty, 'segment', x.segment,
    'segment_count', coalesce(jsonb_array_length(v_segments), 0), 'short_segments', x.short_segments,
    'label', case when x.segment = 0 then p.label
                  else coalesce((select s ->> 'label' from jsonb_array_elements(v_segments) s where (s ->> 'n')::integer = x.segment), p.label) end,
    'reference', p.label, 'hints', x.hints, 'revealed', x.revealed, 'status', x.status, 'expires_at', x.expires_at,
    'translation', (select jsonb_build_object('code', t.code, 'name', t.name, 'attribution', t.attribution, 'copyright', t.copyright,
                                              'source_url', t.source_url, 'allow_copy', t.allow_copy, 'allow_print', t.allow_print)
                      from bible.translations t where t.id = p.translation_id),
    'setup', memory.public_setup(x, p),
    'result', x.result,
    'provider', p.source_kind = 'api');
end;
$$;

-- Starts any permitted activity on a licensed passage from the app's fetch
-- (p_options.source). The stored setup keeps positions only; the word bank
-- and every piece of text go back to the member and are never written.
create function memory.provider_session_start_text(p_uid uuid, k memory.cards, p memory.passages, p_activity memory.activity,
                                                   p_difficulty memory.difficulty, p_segment integer, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t bible.translations;
  s memory.member_settings := memory.settings_of(p_uid);
  v_modes text[];
  v_short boolean := coalesce((p_options ->> 'short')::boolean, s.presentation = 'kids');
  v_segments jsonb;
  v_from integer;
  v_to integer;
  v_id uuid := gen_random_uuid();
  v_setup jsonb;
  pt memory.passages;
  x memory.sessions;
begin
  select * into t from bible.translations where id = p.translation_id;
  v_modes := coalesce(memory.translation_modes(p.translation_id), '{}');
  if cardinality(v_modes) = 0 then
    raise exception '% isn''t available for memory practice right now. Your progress is kept; no other version is used instead.', t.code using errcode = '22023';
  end if;
  if not (p_activity::text = any(v_modes)) then
    raise exception 'For %, memory practice shows the text unchanged: use flashcards or self-check.', t.code using errcode = '22023';
  end if;
  if p_options ->> 'direction' = 'text_to_ref' and not memory.provider_exercises(p.translation_id) then
    raise exception 'Reference practice isn''t available for %.', t.code using errcode = '22023';
  end if;
  pt := memory.provider_text(p, p_options -> 'source');
  v_segments := case when v_short then pt.short_segments else pt.segments end;
  if coalesce(p_segment, 0) = 0 then
    if p_activity in ('missing_words', 'word_order', 'type_verse') and pt.word_count > 80 then
      raise exception 'This passage is long. Practice it one part at a time.' using errcode = '22023';
    end if;
    v_from := 0;
    v_to := jsonb_array_length(pt.tokens) - 1;
  else
    select (e ->> 'from')::integer, (e ->> 'to')::integer into v_from, v_to
      from jsonb_array_elements(v_segments) e where (e ->> 'n')::integer = p_segment;
    if v_from is null then
      raise exception 'That part of the passage doesn''t exist.' using errcode = '22023';
    end if;
  end if;
  if p_activity = 'word_order' and (select count(*) from memory.words(pt.tokens, v_from, v_to, true, true)) < 2 then
    raise exception 'This passage is too short for word order.' using errcode = '22023';
  end if;
  v_setup := memory.build_setup(v_id, pt, p_activity, p_difficulty, v_from, v_to, k.step, s, p_options - 'source');
  insert into memory.sessions (id, profile_id, card_id, passage_id, activity, difficulty, segment, short_segments, token_from, token_to, setup, expires_at)
  values (v_id, p_uid, k.id, p.id, p_activity, p_difficulty, coalesce(p_segment, 0), v_short, v_from, v_to,
          -- Positions only: the word bank is text.
          (v_setup - 'bank') || jsonb_build_object('provider', true),
          now() + case when t.allow_cache then least(interval '1 day', make_interval(days => t.cache_days)) else interval '1 hour' end)
  returning * into x;
  x.setup := v_setup;
  return memory.session_json_with(x, pt);
end;
$$;

-- What's kept of a licensed version's result: scores and counts, never the
-- typed answer, the expected text, or word-by-word feedback.
create function memory.provider_result(p_activity memory.activity, p_result jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_result || jsonb_build_object('details',
    case p_activity
      when 'type_verse' then (p_result -> 'details') - 'ops' - 'your_text' - 'text'
      when 'missing_words' then ((p_result -> 'details') - 'results')
        || jsonb_build_object('results', coalesce((select jsonb_agg(jsonb_build_object('blank', r -> 'blank', 'correct', r -> 'correct'))
                                                   from jsonb_array_elements(p_result -> 'details' -> 'results') r), '[]'::jsonb))
      else coalesce(p_result -> 'details', '{}'::jsonb)
    end);
$$;

-- The reference of a session's licensed passage, so the app's server can
-- fetch its text for a hint or a check (null for stored text).
create function public.memory_session_source(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  pa memory.passages;
  v_activity memory.activity;
begin
  select x.activity into v_activity from memory.sessions x where x.id = p_session and x.profile_id = v_uid;
  select p.* into pa from memory.sessions x join memory.passages p on p.id = x.passage_id where x.id = p_session and x.profile_id = v_uid;
  if pa.id is null then
    raise exception 'That practice activity wasn''t found.' using errcode = 'P0002';
  end if;
  if pa.source_kind <> 'api' then
    return null;
  end if;
  return jsonb_build_object('activity', v_activity, 'translation_id', pa.translation_id, 'book', pa.book_code, 'sc', pa.start_chapter, 'sv', pa.start_verse,
                            'ec', pa.end_chapter, 'ev', pa.end_verse);
end;
$$;

-- The practice parts of the member's licensed verse, from the app's fetch
-- (labels and word counts; no text).
create function public.memory_card_parts(p_card uuid, p_source jsonb)
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
  select * into k from memory.cards where id = p_card and profile_id = v_uid;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  p := memory.provider_text(p, p_source);
  return jsonb_build_object(
    'word_count', p.word_count,
    'segments', (select jsonb_agg(s - 'from' - 'to' || jsonb_build_object('words', (s ->> 'to')::integer - (s ->> 'from')::integer + 1)) from jsonb_array_elements(p.segments) s),
    'short_segments', (select jsonb_agg(s - 'from' - 'to' || jsonb_build_object('words', (s ->> 'to')::integer - (s ->> 'from')::integer + 1)) from jsonb_array_elements(p.short_segments) s));
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------
create or replace function public.memory_admin_provider_permissions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform memory.require_member();
  if not public.has_capability('bible.manage') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'translation', jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'status', t.status),
      'unchanged_text', coalesce(pp.unchanged_text, false), 'terms_note', pp.terms_note, 'confirmed_at', pp.confirmed_at,
      'confirmed_by', (select coalesce(pr.preferred_name, pr.full_name) from public.profiles pr where pr.id = pp.confirmed_by),
      'exercise_modes', coalesce(pp.exercise_modes, false), 'exercise_note', pp.exercise_note, 'exercise_confirmed_at', pp.exercise_confirmed_at,
      'exercise_confirmed_by', (select coalesce(pr.preferred_name, pr.full_name) from public.profiles pr where pr.id = pp.exercise_confirmed_by),
      'publisher_approval_required', coalesce(pp.publisher_approval_required, t.code = 'NIV'),
      'publisher_approval_note', pp.publisher_approval_note, 'publisher_approval_confirmed_at', pp.publisher_approval_confirmed_at,
      'publisher_approval_confirmed_by', (select coalesce(pr.preferred_name, pr.full_name) from public.profiles pr where pr.id = pp.publisher_approval_confirmed_by),
      'cards', (select count(*) from memory.cards k join memory.passages p on p.id = k.passage_id where p.translation_id = t.id and k.status = 'active'))
      order by t.name)
    from bible.translations t left join memory.provider_permissions pp on pp.translation_id = t.id
   where t.source_kind = 'api'), '[]'::jsonb);
end;
$$;

-- As in 20261106000100. A new NIV row starts needing Biblica's feature
-- approval; turning unchanged-text practice off also turns the exercises off.
create or replace function public.memory_admin_provider_permission_save(p_translation uuid, p_unchanged_text boolean, p_terms_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  if not public.has_capability('bible.manage') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if not exists (select 1 from bible.translations t where t.id = p_translation and t.source_kind = 'api') then
    raise exception 'Choose a version read from an outside service.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_terms_note, ''))) not between 10 and 2000 then
    raise exception 'Record what you checked in this version''s terms (10 to 2000 characters).' using errcode = '22023';
  end if;
  insert into memory.provider_permissions (translation_id, unchanged_text, terms_note, confirmed_by, confirmed_at, updated_at, publisher_approval_required)
  values (p_translation, coalesce(p_unchanged_text, false), btrim(p_terms_note), v_uid, now(), now(),
          (select t.code = 'NIV' from bible.translations t where t.id = p_translation))
  on conflict (translation_id) do update set unchanged_text = excluded.unchanged_text, terms_note = excluded.terms_note,
    confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, updated_at = now(),
    exercise_modes = memory.provider_permissions.exercise_modes and excluded.unchanged_text;
  perform memory.audit('memory.provider_permission', 'bible_translation', p_translation,
                       jsonb_build_object('unchanged_text', coalesce(p_unchanged_text, false)));
  return public.memory_admin_provider_permissions();
end;
$$;

-- p: {exercise_modes, exercise_note, publisher_approval_required,
--     publisher_approval_confirmed, publisher_approval_note}; omitted keys
-- keep their value. Needs the unchanged-text permission first.
create function public.memory_admin_provider_exercises_save(p_translation uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  pp memory.provider_permissions;
  v_code text;
  v_on boolean;
  v_required boolean;
  v_confirmed boolean;
  v_note text := nullif(btrim(coalesce(p ->> 'exercise_note', '')), '');
  v_pub_note text := nullif(btrim(coalesce(p ->> 'publisher_approval_note', '')), '');
begin
  if not public.has_capability('bible.manage') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  select t.code into v_code from bible.translations t where t.id = p_translation and t.source_kind = 'api';
  if v_code is null then
    raise exception 'Choose a version read from an outside service.' using errcode = '22023';
  end if;
  select * into pp from memory.provider_permissions where translation_id = p_translation for update;
  if pp.translation_id is null or not pp.unchanged_text then
    raise exception 'Record that % may be shown unchanged for memory verses first.', v_code using errcode = '22023';
  end if;
  v_on := coalesce((p ->> 'exercise_modes')::boolean, pp.exercise_modes);
  v_required := coalesce((p ->> 'publisher_approval_required')::boolean, pp.publisher_approval_required);
  v_confirmed := coalesce((p ->> 'publisher_approval_confirmed')::boolean, pp.publisher_approval_confirmed_at is not null);
  if (v_required <> pp.publisher_approval_required or (v_confirmed and pp.publisher_approval_confirmed_at is null))
     and char_length(coalesce(v_pub_note, '')) not between 10 and 2000 then
    raise exception 'Record the publisher agreement you checked (10 to 2000 characters).' using errcode = '22023';
  end if;
  if v_on and not pp.exercise_modes and char_length(coalesce(v_note, '')) not between 10 and 2000 then
    raise exception 'Record the written permission you relied on (10 to 2000 characters).' using errcode = '22023';
  end if;
  if v_on and v_required and not v_confirmed then
    raise exception '% has a direct publisher agreement: record its feature approval before turning on all exercises.', v_code using errcode = '22023';
  end if;
  update memory.provider_permissions set
    exercise_modes = v_on,
    exercise_note = case when v_on and not pp.exercise_modes then v_note else coalesce(v_note, exercise_note) end,
    exercise_confirmed_by = case when v_on and not pp.exercise_modes then v_uid else exercise_confirmed_by end,
    exercise_confirmed_at = case when v_on and not pp.exercise_modes then now() else exercise_confirmed_at end,
    publisher_approval_required = v_required,
    publisher_approval_note = coalesce(v_pub_note, publisher_approval_note),
    publisher_approval_confirmed_by = case when not v_confirmed then null when publisher_approval_confirmed_at is null then v_uid else publisher_approval_confirmed_by end,
    publisher_approval_confirmed_at = case when not v_confirmed then null when publisher_approval_confirmed_at is null then now() else publisher_approval_confirmed_at end,
    updated_at = now()
  where translation_id = p_translation;
  perform memory.audit('memory.provider_exercises', 'bible_translation', p_translation,
                       jsonb_build_object('exercise_modes', v_on, 'publisher_approval_required', v_required, 'publisher_approval_confirmed', v_confirmed));
  return public.memory_admin_provider_permissions();
end;
$$;

-- ---------------------------------------------------------------------------
-- Practice, preview, and editors' notes
-- ---------------------------------------------------------------------------
-- As in 20261106000100; p_options.source (the app's fetch) opens the licensed text path.
create or replace function public.memory_session_start(p_card uuid, p_activity text, p_difficulty text, p_segment integer, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
  p memory.passages;
  s memory.member_settings := memory.settings_of(v_uid);
  v_activity memory.activity;
  v_difficulty memory.difficulty;
  v_short boolean := coalesce((p_options ->> 'short')::boolean, s.presentation = 'kids');
  v_segments jsonb;
  v_from integer;
  v_to integer;
  v_id uuid := gen_random_uuid();
  x memory.sessions;
begin
  perform community.rate_limit(v_uid, 'memory_start', 200, interval '10 minutes');
  if p_activity not in ('read_repeat', 'flashcards', 'missing_words', 'word_order', 'type_verse', 'self_check')
     or coalesce(p_difficulty, s.difficulty::text) not in ('guided', 'growing', 'challenge') then
    raise exception 'Choose an activity and difficulty.' using errcode = '22023';
  end if;
  v_activity := p_activity::memory.activity;
  v_difficulty := coalesce(p_difficulty, s.difficulty::text)::memory.difficulty;
  select * into k from memory.cards where id = p_card and profile_id = v_uid and status = 'active';
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  if not bible.translation_active(p.translation_id) then
    raise exception 'This verse''s Bible version is no longer available for practice.' using errcode = '22023';
  end if;
  if p.source_kind = 'api' then
    -- With the app's fetch (p_options.source): every permitted activity.
    if coalesce(p_options, '{}'::jsonb) ? 'source' then
      return memory.provider_session_start_text(v_uid, k, p, v_activity, v_difficulty, coalesce(p_segment, 0), p_options);
    end if;
    return memory.provider_session_start(v_uid, k, p, v_activity, v_difficulty, coalesce(p_options, '{}'::jsonb));
  end if;
  v_segments := case when v_short then p.short_segments else p.segments end;
  if coalesce(p_segment, 0) = 0 then
    if v_activity in ('missing_words', 'word_order', 'type_verse') and p.word_count > 80 then
      raise exception 'This passage is long. Practice it one part at a time.' using errcode = '22023';
    end if;
    v_from := 0;
    v_to := jsonb_array_length(p.tokens) - 1;
  else
    select (e ->> 'from')::integer, (e ->> 'to')::integer into v_from, v_to
      from jsonb_array_elements(v_segments) e where (e ->> 'n')::integer = p_segment;
    if v_from is null then
      raise exception 'That part of the passage doesn''t exist.' using errcode = '22023';
    end if;
  end if;
  if v_activity = 'word_order' and (select count(*) from memory.words(p.tokens, v_from, v_to, true, true)) < 2 then
    raise exception 'This passage is too short for word order.' using errcode = '22023';
  end if;
  insert into memory.sessions (id, profile_id, card_id, passage_id, activity, difficulty, segment, short_segments, token_from, token_to, setup)
  values (v_id, v_uid, k.id, p.id, v_activity, v_difficulty, coalesce(p_segment, 0), v_short, v_from, v_to,
          memory.build_setup(v_id, p, v_activity, v_difficulty, v_from, v_to, k.step, s, coalesce(p_options, '{}'::jsonb)))
  returning * into x;
  return memory.session_json(x);
end;
$$;

-- As in 20261106000100; hints for licensed versions with all six exercises.
create or replace function public.memory_session_hint(p_session uuid, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  x memory.sessions;
  pa memory.passages;
  v_words text[];
  v_pos integer;
  v_idx integer;
  v_hint jsonb;
  v_expected text[];
  v_given text[];
  v_chip text;
  i integer;
begin
  perform community.rate_limit(v_uid, 'memory_hint', 300, interval '10 minutes');
  x := memory.load_session(p_session, v_uid);
  if x.status <> 'open' then
    return jsonb_build_object('status', x.status);
  end if;
  select * into pa from memory.passages where id = x.passage_id;
  -- A licensed version: only with all six exercises permitted, from the
  -- app's fetch (p.source), checked against the session's wording. The hint
  -- goes back to the member; nothing of it is stored.
  if pa.source_kind = 'api' then
    if not memory.provider_exercises(pa.translation_id) then
      raise exception 'Hints aren''t available for this version.' using errcode = '22023';
    end if;
    pa := memory.provider_text(pa, p -> 'source');
  end if;
  select array_agg(w.t order by w.idx) into v_words from memory.words(pa.tokens, x.token_from, x.token_to, true, true) w;
  case x.activity
    when 'type_verse' then
      v_pos := least(greatest(coalesce((p ->> 'position')::integer, 0), 0), cardinality(v_words) - 1);
      v_hint := jsonb_build_object('position', v_pos, 'word', v_words[v_pos + 1]);
    when 'missing_words' then
      v_pos := (p ->> 'blank')::integer;
      v_idx := (x.setup -> 'blanks' ->> (v_pos - 1))::integer;
      if v_idx is null then
        raise exception 'Choose a blank.' using errcode = '22023';
      end if;
      v_hint := jsonb_build_object('blank', v_pos, 'word', memory.token_core(pa.tokens -> v_idx ->> 't') ->> 'core');
      update memory.sessions set setup = jsonb_set(setup, '{hinted}', (setup -> 'hinted') || to_jsonb(v_pos)) where id = x.id;
    when 'word_order' then
      select array_agg(memory.chip_key(pa.tokens, c) order by (c ->> 'from')::integer) into v_expected from jsonb_array_elements(x.setup -> 'chips') c;
      select array_agg(coalesce(memory.chip_key(pa.tokens, (select c from jsonb_array_elements(x.setup -> 'chips') c where c ->> 'id' = o.v)), '') order by o.n)
        into v_given from jsonb_array_elements_text(coalesce(p -> 'order', '[]'::jsonb)) with ordinality o(v, n);
      v_pos := cardinality(v_expected);
      for i in 1 .. cardinality(v_expected) loop
        if v_given is null or i > cardinality(v_given) or v_given[i] is distinct from v_expected[i] then
          v_pos := i;
          exit;
        end if;
      end loop;
      -- The piece that belongs there and isn't already correctly placed.
      select c ->> 'id' into v_chip from jsonb_array_elements(x.setup -> 'chips') c
       where memory.chip_key(pa.tokens, c) = v_expected[v_pos]
       order by (c ->> 'id') = any(coalesce((select array_agg(o.v) from jsonb_array_elements_text(coalesce(p -> 'order', '[]'::jsonb)) with ordinality o(v, n) where o.n < v_pos), '{}')),
                (c ->> 'from')::integer
       limit 1;
      v_hint := jsonb_build_object('position', v_pos, 'id', v_chip);
    when 'self_check' then
      v_hint := jsonb_build_object('words', array_to_string(v_words[1:least(3 * (x.hints + 1), cardinality(v_words))], ' '),
                                   'more', 3 * (x.hints + 1) < cardinality(v_words));
    else
      raise exception 'This activity has no hints.' using errcode = '22023';
  end case;
  update memory.sessions set hints = hints + 1 where id = x.id;
  return v_hint || jsonb_build_object('hints', x.hints + 1);
end;
$$;

-- As in 20261105000100; licensed versions are scored from the app's fetch
-- and keep scores only.
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
  -- A licensed version: only while the activity is still permitted, and
  -- scored against the app's fetch (p.source) of the same wording.
  if pa.source_kind = 'api' then
    if not (x.activity::text = any(coalesce(memory.translation_modes(pa.translation_id), '{}'))) then
      return jsonb_build_object('status', 'unavailable', 'saved', false);
    end if;
    if x.activity in ('missing_words', 'word_order', 'type_verse') then
      begin
        pa := memory.provider_text(pa, p -> 'source');
      exception when sqlstate 'P0010' then
        update memory.sessions set status = 'expired' where id = x.id;
        return jsonb_build_object('status', 'changed', 'saved', false);
      end;
    end if;
  end if;
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
  -- A licensed version keeps scores only; the full feedback goes back once.
  update memory.sessions set status = 'submitted', submitted_at = now(),
         result = case when pa.source_kind = 'api' then memory.provider_result(x.activity, v_result) else v_result end
   where id = x.id;
  return v_result;
end;
$$;

-- As in 20261111000100; a licensed version previews from the app's fetch
-- (p_source). Nothing is recorded.
create function public.memory_admin_preview(p_item uuid, p_activity text, p_difficulty text, p_segment integer, p_short boolean, p_source jsonb)
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
  -- A licensed version: the activities it permits, from the app's fetch.
  if p.source_kind = 'api' then
    if not (p_activity = any(coalesce(memory.translation_modes(p.translation_id), '{}'))) then
      raise exception 'This activity isn''t permitted for this version.' using errcode = '22023';
    end if;
    p := memory.provider_text(p, p_source);
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
  -- The passage as held (a licensed version's text is in memory only), with its parts.
  return memory.session_json_with(x, p) || jsonb_build_object('preview', true,
    'answer_text', memory.range_text(p.tokens, x.token_from, x.token_to), 'hidden', x.setup,
    'parts', jsonb_build_object(
      'segments', (select jsonb_agg(s - 'from' - 'to' || jsonb_build_object('words', (s ->> 'to')::integer - (s ->> 'from')::integer + 1)) from jsonb_array_elements(p.segments) s),
      'short_segments', (select jsonb_agg(s - 'from' - 'to' || jsonb_build_object('words', (s ->> 'to')::integer - (s ->> 'from')::integer + 1)) from jsonb_array_elements(p.short_segments) s)));
end;
$$;

create or replace function public.memory_admin_preview(p_item uuid, p_activity text, p_difficulty text, p_segment integer, p_short boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.memory_admin_preview(p_item, p_activity, p_difficulty, p_segment, p_short, null::jsonb);
$$;

-- As in 20261111000100, naming the activities the version permits now.
create or replace function memory.suitability(p memory.passages)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.source_kind = 'api' then (select coalesce(jsonb_agg(w) filter (where w is not null), '[]'::jsonb) from (values
      (case when memory.provider_exercises(p.translation_id)
            then 'Licensed version: all six activities, on screen only. Nothing altered is stored.'
            else 'Licensed version: members see it exactly as published, with flashcards and self-check. Activities that hide or rearrange words aren''t offered.' end),
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
-- Grants: helpers stay private; new entry points for signed-in members only.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema memory from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('memory_session_source', 'memory_card_parts', 'memory_admin_preview',
                                                         'memory_admin_provider_exercises_save') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;

-- Expected afterwards: nothing new callable without signing in, members keep
-- access, helpers stay private, and no version has the exercises on.
do $check$
declare
  f text;
begin
  foreach f in array array['public.memory_session_source(uuid)', 'public.memory_card_parts(uuid, jsonb)',
                           'public.memory_admin_preview(uuid, text, text, integer, boolean, jsonb)',
                           'public.memory_admin_preview(uuid, text, text, integer, boolean)',
                           'public.memory_admin_provider_exercises_save(uuid, jsonb)', 'public.memory_session_start(uuid, text, text, integer, jsonb)',
                           'public.memory_session_hint(uuid, jsonb)', 'public.memory_session_submit(uuid, jsonb)'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'Nothing was changed: % would be callable without signing in. Send this message to the developer.', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'Nothing was changed: signed-in members would lose access to %. Send this message to the developer.', f;
    end if;
  end loop;
  foreach f in array array['memory.provider_text(memory.passages, jsonb)', 'memory.provider_exercises(uuid)', 'memory.provider_result(memory.activity, jsonb)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'Nothing was changed: % would be callable by clients. Send this message to the developer.', f;
    end if;
  end loop;
  if exists (select 1 from memory.provider_permissions where exercise_modes) then
    raise exception 'Nothing was changed: an exercise permission is on. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261125000100', 'memory_provider_exercises', 'memory-provider-exercises');

commit;
