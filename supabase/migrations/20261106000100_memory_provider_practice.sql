-- Memory verses in licensed API versions (API.Bible), without storing their
-- text.
--
-- API.Bible's public guidance (care.api.bible "Caching Content", updated
-- 2026-08-19; "Common Integration Patterns", updated 2026-10-01; read by the
-- owner, see docs/memory-provider-practice.md) describes memory verses as an
-- integration pattern: fetch by passage ID, cache only under the applicable
-- license, keep the text unmodified, and report usage (FUMS) wherever it is
-- shown, cached content included. It doesn't settle each translation's own
-- terms, or exercises that alter the text. So:
--
--   * A licensed version can be memorized only after a Bible source manager
--     records that its own terms (dashboard/license) permit showing it,
--     unchanged, for memory practice (memory.provider_permissions). Nothing
--     is enabled by this migration.
--   * Only unchanged-text practice exists for these versions: the verse page,
--     flashcards (reference on the front, the full passage on the back), and
--     self-check (reference only, then the full passage). Read & repeat
--     (hides words), missing words, word order, typed recall, self-check
--     hints (partial excerpts), and reference-practice flashcards (the text
--     would sit in the session) are refused in the database for them. The
--     permission table can't express those modes; enabling any of them needs
--     a reviewed code and migration change after written permission.
--   * Kept permanently: the reference, the API.Bible passage ID, verse
--     numbers, word count, and a one-way SHA-256 fingerprint of the exact
--     wording (memory.passages.content_hash). Never the verse text: the
--     passage's verses, tokens, and segments are null, enforced by
--     passages_source. Sessions, results, attempts, and history hold no text
--     for these versions (no typed answers are possible).
--   * The text is fetched on the server through the existing API.Bible
--     integration when it is shown (verse page, preview, reveal), from the
--     translation's in-memory cache only while unexpired (its cache_days,
--     1 day today), and never stored by the database. A practice session for
--     these versions ends with that window (at most 1 day).
--   * Wording consistency: the app sends the fingerprint of the text it just
--     fetched when a session starts and when the text is revealed; a
--     mismatch with the card's passage means the source wording changed, and
--     nothing is recorded. The member then explicitly starts the new wording
--     (memory_card_provider_refresh): the earlier card keeps its history, the
--     new wording starts fresh. Passages for these versions are never marked
--     superseded for everyone, because the fingerprint comes from a member's
--     request: a wrong fingerprint can only affect that member's own card.
--
-- Additive. Database (stored-text) passages, cards, and practice are
-- unchanged; no row is rewritten. Replaced functions keep their signatures
-- and grants; two gain an overload with one more argument.

-- ---------------------------------------------------------------------------
-- Permission per licensed version
-- ---------------------------------------------------------------------------
create table memory.provider_permissions (
  translation_id uuid primary key references bible.translations (id) on delete cascade,
  -- Verse page, flashcards (reference → passage), and self-check: the text is
  -- shown exactly as the provider returns it. The only mode that can be
  -- recorded; altered-text modes need a code change.
  unchanged_text boolean not null default false,
  -- What was checked (dashboard, license, publisher terms) and when.
  terms_note text not null check (char_length(btrim(terms_note)) between 10 and 2000),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index provider_permissions_confirmed_by_idx on memory.provider_permissions (confirmed_by);
alter table memory.provider_permissions enable row level security;

-- ---------------------------------------------------------------------------
-- Passages without text
-- ---------------------------------------------------------------------------
alter table memory.passages
  add column source_kind text not null default 'database' check (source_kind in ('database', 'api')),
  -- API.Bible passage ID ("JHN.3.16-JHN.3.17") and the verse numbers it
  -- returned ([[c, v], …]); no text.
  add column provider_passage_id text check (provider_passage_id ~ '^[1-3A-Z][A-Z0-9]{2}\.\d+(\.\d+)?(-[1-3A-Z][A-Z0-9]{2}\.\d+(\.\d+)?)?$'),
  add column verse_numbers jsonb check (jsonb_typeof(verse_numbers) = 'array' and jsonb_array_length(verse_numbers) between 1 and 30);
alter table memory.passages alter column verses drop not null;
alter table memory.passages alter column tokens drop not null;
alter table memory.passages alter column segments drop not null;
alter table memory.passages alter column short_segments drop not null;
alter table memory.passages add constraint passages_source check (
  (source_kind = 'database' and verses is not null and tokens is not null and segments is not null and short_segments is not null
   and provider_passage_id is null and verse_numbers is null)
  or (source_kind = 'api' and verses is null and tokens is null and segments is null and short_segments is null
      and provider_passage_id is not null and verse_numbers is not null));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Practice modes a version allows for memory practice.
create function memory.translation_modes(p_translation uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.source_kind = 'database' then array['read_repeat', 'flashcards', 'missing_words', 'word_order', 'type_verse', 'self_check']
    when exists (select 1 from memory.provider_permissions pp where pp.translation_id = t.id and pp.unchanged_text) then array['flashcards', 'self_check']
    else array[]::text[]
  end
  from bible.translations t where t.id = p_translation and t.status = 'active';
$$;

create or replace function memory.translation_usable(p_translation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_translation is not null and coalesce(cardinality(memory.translation_modes(p_translation)) > 0, false);
$$;

-- Stored-text versions as before; a permitted licensed version needs only a
-- valid reference here (its text is checked on the server when fetched).
create or replace function memory.passage_problem(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t bible.translations;
  v_problem text;
  v_count integer;
  v_words integer;
begin
  select * into t from bible.translations where id = p_translation and status = 'active';
  if not found then
    return 'Choose an available Bible version.';
  end if;
  if t.source_kind <> 'database' then
    if not memory.translation_usable(p_translation) then
      return 'Memory practice needs a version whose text is stored here. This version is read from an outside service and can''t be stored.';
    end if;
    if p_sv is null or p_ev is null then
      return 'Choose the first and last verse.';
    end if;
    return bible.passage_problem(p_translation, p_book, p_sc, p_sv, p_ec, p_ev);
  end if;
  if p_sv is null or p_ev is null then
    return 'Choose the first and last verse.';
  end if;
  v_problem := bible.passage_problem(p_translation, p_book, p_sc, p_sv, p_ec, p_ev);
  if v_problem is not null then
    return v_problem;
  end if;
  select count(*) filter (where not v.omitted), coalesce(sum(cardinality(regexp_split_to_array(btrim(v.text), '\s+'))) filter (where not v.omitted), 0)
    into v_count, v_words
    from bible.verses v
   where v.translation_id = p_translation and v.book_code = p_book
     and (v.chapter, v.verse) >= (p_sc, p_sv) and (v.chapter, v.verse) <= (p_ec, p_ev);
  if v_count = 0 then
    return 'This version has no text for that passage.';
  end if;
  if v_count > 30 then
    return 'Choose at most 30 verses for memory practice.';
  end if;
  if v_words > 900 then
    return 'That passage is too long for memory practice. Choose fewer verses.';
  end if;
  return null;
end;
$$;

-- The passage for a licensed version's exact wording, from what the app's
-- server just fetched: p {fingerprint, verses: [[c, v], …], words, passage_id}.
-- Found or created by (translation, reference, fingerprint); never marks
-- other versions superseded (see the header).
create function memory.capture_provider_passage(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t bible.translations;
  v_problem text := memory.passage_problem(p_translation, p_book, p_sc, p_sv, p_ec, p_ev);
  v_hash text := p ->> 'fingerprint';
  v_words integer := (p ->> 'words')::integer;
  v_verses jsonb := p -> 'verses';
  v_ref text;
  v_label text := bible.passage_label(p_book, p_sc, p_sv, p_ec, p_ev);
  v_id uuid;
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  select * into t from bible.translations where id = p_translation;
  if t.source_kind <> 'api' then
    raise exception 'This version''s text is stored here.' using errcode = '22023';
  end if;
  if p is null or v_hash is null then
    raise exception 'This version''s text couldn''t be checked right now. Try again.' using errcode = '22023';
  end if;
  if v_words is not null and v_words > 900 then
    raise exception 'That passage is too long for memory practice. Choose fewer verses.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_verses) = 'array' and jsonb_array_length(case when jsonb_typeof(v_verses) = 'array' then v_verses else '[]' end) > 30 then
    raise exception 'Choose at most 30 verses for memory practice.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(v_verses), '') <> 'array' then
    raise exception 'This version''s text couldn''t be checked right now. Try again.' using errcode = '22023';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' or v_words is null or v_words < 1 or jsonb_array_length(v_verses) < 1
     or coalesce(p ->> 'passage_id', '') !~ '^[1-3A-Z][A-Z0-9]{2}\.\d+(\.\d+)?(-[1-3A-Z][A-Z0-9]{2}\.\d+(\.\d+)?)?$' then
    raise exception 'This version''s text couldn''t be checked right now. Try again.' using errcode = '22023';
  end if;
  -- Verse numbers [c, v] inside the reference.
  if exists (select 1 from jsonb_array_elements(v_verses) e
              where jsonb_typeof(e) <> 'array' or jsonb_array_length(e) <> 2
                 or coalesce(e ->> 0, '') !~ '^\d{1,3}$' or coalesce(e ->> 1, '') !~ '^\d{1,3}$') then
    raise exception 'This version''s text couldn''t be checked right now. Try again.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_verses) e
              where ((e ->> 0)::integer, (e ->> 1)::integer) < (p_sc, p_sv) or ((e ->> 0)::integer, (e ->> 1)::integer) > (p_ec, p_ev)) then
    raise exception 'This version''s text couldn''t be checked right now. Try again.' using errcode = '22023';
  end if;
  v_ref := t.code || ':' || p_book || '.' || p_sc || '.' || p_sv || '-' || p_ec || '.' || p_ev;
  select id into v_id from memory.passages where translation_id = p_translation and ref_key = v_ref and content_hash = v_hash;
  if v_id is not null then
    return v_id;
  end if;
  insert into memory.passages (translation_id, book_code, start_chapter, start_verse, end_chapter, end_verse, label, ref_key,
                               text_version, content_hash, version, word_count, source_kind, provider_passage_id, verse_numbers)
  values (p_translation, p_book, p_sc, p_sv, p_ec, p_ev, v_label, v_ref, t.text_version, v_hash,
          coalesce((select max(version) from memory.passages where translation_id = p_translation and ref_key = v_ref), 0) + 1,
          v_words, 'api', p ->> 'passage_id', v_verses)
  returning id into v_id;
  return v_id;
end;
$$;

-- One entry point for both kinds of version.
create function memory.capture_for(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer, p_provider jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from bible.translations t where t.id = p_translation and t.source_kind = 'api') then
    return memory.capture_provider_passage(p_translation, p_book, p_sc, p_sv, p_ec, p_ev, p_provider);
  end if;
  return memory.capture_passage(p_translation, p_book, p_sc, p_sv, p_ec, p_ev);
end;
$$;

-- Licensed wording is compared with the source in the app (fingerprint);
-- the database has no text to compare.
create or replace function memory.passage_current(p memory.passages)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.source_kind = 'api' then true else coalesce((
    select encode(sha256(convert_to(string_agg(v.chapter || ':' || v.verse || E'\t' || v.text || E'\n', '' order by v.chapter, v.verse), 'UTF8')), 'hex') = p.content_hash
      from bible.verses v
     where v.translation_id = p.translation_id and v.book_code = p.book_code and not v.omitted
       and (v.chapter, v.verse) >= (p.start_chapter, p.start_verse) and (v.chapter, v.verse) <= (p.end_chapter, p.end_verse)), false) end;
$$;


-- ---------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------
create or replace function memory.passage_json(p memory.passages, p_with_text boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'label', p.label, 'ref_key', p.ref_key, 'version', p.version, 'text_version', p.text_version,
    'book', p.book_code, 'start_chapter', p.start_chapter, 'start_verse', p.start_verse,
    'end_chapter', p.end_chapter, 'end_verse', p.end_verse, 'word_count', p.word_count,
    'segments', (select jsonb_agg(s - 'from' - 'to' || jsonb_build_object('words', (s ->> 'to')::integer - (s ->> 'from')::integer + 1)) from jsonb_array_elements(p.segments) s),
    'short_segments', (select jsonb_agg(s - 'from' - 'to' || jsonb_build_object('words', (s ->> 'to')::integer - (s ->> 'from')::integer + 1)) from jsonb_array_elements(p.short_segments) s),
    'superseded', p.superseded_by is not null,
    -- Licensed versions: no text, only what's needed to fetch and check it.
    'source_kind', p.source_kind,
    'fingerprint', case when p.source_kind = 'api' then p.content_hash end,
    'provider_passage_id', p.provider_passage_id,
    'verse_numbers', coalesce(p.verse_numbers, (select jsonb_agg(jsonb_build_array((e ->> 'c')::integer, (e ->> 'v')::integer)) from jsonb_array_elements(p.verses) e)),
    'translation', jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'attribution', t.attribution,
                                      'copyright', t.copyright, 'source_url', t.source_url, 'allow_copy', t.allow_copy,
                                      'allow_print', t.allow_print, 'allow_export', t.allow_export, 'status', t.status,
                                      'source_kind', t.source_kind),
    'verses', case when p_with_text then (select jsonb_agg(jsonb_build_object('c', (e ->> 'c')::integer, 'v', (e ->> 'v')::integer, 't', e ->> 't',
                                                                              'o', false, 'h', null, 'p', false, 'q', coalesce((e ->> 'q')::boolean, false)))
                                            from jsonb_array_elements(p.verses) e) end)
    from bible.translations t where t.id = p.translation_id;
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
    'can_change_translation', k.status = 'active' and (v_assignment is null or (v_assignment ->> 'choice')::boolean),
    -- Practice modes this verse's version allows now (licensed versions:
    -- unchanged text only, and only while permitted).
    'modes', to_jsonb(coalesce(memory.translation_modes(p.translation_id), '{}'::text[])),
    'provider', p.source_kind = 'api');
end;
$$;

-- ---------------------------------------------------------------------------
-- Practice for licensed versions
-- ---------------------------------------------------------------------------
-- Called from memory_session_start for a licensed version's card. p_options
-- carries the fingerprint of the text the app's server just fetched. The
-- session holds no text and ends with the cache window (at most 1 day).
create function memory.provider_session_start(p_uid uuid, k memory.cards, p memory.passages, p_activity memory.activity,
                                              p_difficulty memory.difficulty, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t bible.translations;
  v_id uuid := gen_random_uuid();
  x memory.sessions;
begin
  select * into t from bible.translations where id = p.translation_id;
  if not (p_activity::text = any(coalesce(memory.translation_modes(p.translation_id), '{}'))) then
    raise exception 'For %, memory practice shows the text unchanged: use flashcards or self-check.', t.code using errcode = '22023';
  end if;
  if p_options ->> 'direction' = 'text_to_ref' then
    raise exception 'Reference practice isn''t available for %.', t.code using errcode = '22023';
  end if;
  if coalesce(p_options ->> 'fingerprint', '') = '' then
    raise exception '% is temporarily unavailable for practice. Try again later.', t.code using errcode = '22023';
  end if;
  if p_options ->> 'fingerprint' <> p.content_hash then
    raise exception 'The wording of this passage in % has changed since you added it. Open the verse to start the new wording.', t.code using errcode = '22023';
  end if;
  insert into memory.sessions (id, profile_id, card_id, passage_id, activity, difficulty, segment, short_segments, token_from, token_to, setup, expires_at)
  values (v_id, p_uid, k.id, p.id, p_activity, p_difficulty, 0, false, 0, p.word_count - 1,
          jsonb_build_object('direction', 'ref_to_text', 'provider', true),
          now() + case when t.allow_cache then least(interval '1 day', make_interval(days => t.cache_days)) else interval '1 hour' end)
  returning * into x;
  return memory.session_json(x);
end;
$$;

-- As before for stored text. For a licensed version: no text; the app's
-- server fetches it, checks it against the fingerprint, and shows it
-- unchanged with its usage reporting.
create or replace function public.memory_session_reveal(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  x memory.sessions;
  pa memory.passages;
begin
  x := memory.load_session(p_session, v_uid);
  if x.activity not in ('self_check', 'flashcards') then
    raise exception 'This activity has nothing to reveal.' using errcode = '22023';
  end if;
  if x.status = 'expired' then
    return jsonb_build_object('status', x.status);
  end if;
  select * into pa from memory.passages where id = x.passage_id;
  update memory.sessions set revealed = true where id = x.id;
  if pa.source_kind = 'api' then
    return jsonb_build_object('status', x.status, 'reference', pa.label, 'text', null, 'provider', jsonb_build_object(
      'translation_id', pa.translation_id, 'book', pa.book_code, 'sc', pa.start_chapter, 'sv', pa.start_verse,
      'ec', pa.end_chapter, 'ev', pa.end_verse, 'fingerprint', pa.content_hash));
  end if;
  return jsonb_build_object('status', x.status, 'reference', pa.label,
    'text', case when x.activity = 'flashcards' and x.setup ->> 'direction' = 'text_to_ref' then null
                 else memory.range_text(pa.tokens, x.token_from, x.token_to) end,
    'verses', (select jsonb_agg(distinct (e ->> 'v')::integer) from jsonb_array_elements(pa.tokens) with ordinality q(e, n)
                where n - 1 between x.token_from and x.token_to));
end;
$$;

-- The member's explicit choice to practice a licensed version's new wording
-- (the app found the source text changed). Like a text update: the earlier
-- card keeps its history; the new wording starts fresh.
create function public.memory_card_provider_refresh(p_card uuid, p_provider jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
  p memory.passages;
  v_new uuid;
  n memory.cards;
begin
  perform community.rate_limit(v_uid, 'memory_card', 120, interval '10 minutes');
  select * into k from memory.cards where id = p_card and profile_id = v_uid and status = 'active' for update;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  if p.source_kind <> 'api' then
    raise exception 'This verse''s text is stored here; use the updated-text option instead.' using errcode = '22023';
  end if;
  v_new := memory.capture_provider_passage(p.translation_id, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse, p_provider);
  if v_new = k.passage_id then
    raise exception 'This verse already uses the current wording.' using errcode = '22023';
  end if;
  update memory.cards set status = 'superseded', removed_at = now(), updated_at = now() where id = k.id;
  insert into memory.cards (profile_id, passage_id, item_id, due_on, previous_card_id, last_scheduled_on)
  values (v_uid, v_new, k.item_id, memory.local_today(memory.member_tz(v_uid)), k.id, k.last_scheduled_on)
  on conflict (profile_id, passage_id) do update
    set status = 'active', removed_at = null, previous_card_id = excluded.previous_card_id,
        last_scheduled_on = greatest(memory.cards.last_scheduled_on, excluded.last_scheduled_on), updated_at = now()
  returning * into n;
  return memory.card_json(n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Versions offered for memory practice
-- ---------------------------------------------------------------------------
create or replace function public.memory_translations()
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
    'items', coalesce((select jsonb_agg(bible.translation_json(t) || jsonb_build_object('memory_modes', to_jsonb(memory.translation_modes(t.id)))
                                        order by t.id = (select s.default_translation_id from bible.settings s) desc, t.source_kind, t.name)
                         from bible.translations t where t.status = 'active' and memory.translation_usable(t.id)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration: Bible source managers record each licensed version's terms
-- ---------------------------------------------------------------------------
create function public.memory_admin_provider_permissions()
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
      'cards', (select count(*) from memory.cards k join memory.passages p on p.id = k.passage_id where p.translation_id = t.id and k.status = 'active'))
      order by t.name)
    from bible.translations t left join memory.provider_permissions pp on pp.translation_id = t.id
   where t.source_kind = 'api'), '[]'::jsonb);
end;
$$;

-- Turning it off stops practice and new verses in that version; members'
-- verses, progress, and history are kept.
create function public.memory_admin_provider_permission_save(p_translation uuid, p_unchanged_text boolean, p_terms_note text)
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
  insert into memory.provider_permissions (translation_id, unchanged_text, terms_note, confirmed_by, confirmed_at, updated_at)
  values (p_translation, coalesce(p_unchanged_text, false), btrim(p_terms_note), v_uid, now(), now())
  on conflict (translation_id) do update set unchanged_text = excluded.unchanged_text, terms_note = excluded.terms_note,
    confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, updated_at = now();
  perform memory.audit('memory.provider_permission', 'bible_translation', p_translation,
                       jsonb_build_object('unchanged_text', coalesce(p_unchanged_text, false)));
  return public.memory_admin_provider_permissions();
end;
$$;

-- ---------------------------------------------------------------------------
-- My Verses: adding and changing translation
-- ---------------------------------------------------------------------------
-- As in 20261105000100; a licensed version also needs p.provider
-- {fingerprint, verses, words, passage_id} from the app's server fetch.
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

create function public.memory_card_change_translation(p_card uuid, p_translation uuid, p_confirm boolean, p_provider jsonb)
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
  v_new := memory.capture_for(p_translation, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse, p_provider);
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

-- Stored-text targets (unchanged callers); a licensed target needs p_provider.
create or replace function public.memory_card_change_translation(p_card uuid, p_translation uuid, p_confirm boolean)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.memory_card_change_translation(p_card, p_translation, p_confirm, null::jsonb);
$$;

create function public.memory_card_translation_preview(p_card uuid, p_translation uuid, p_fingerprint text)
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
  -- A licensed version's wording is known only from the app's fetch.
  v_hash := case when t.source_kind = 'api' then p_fingerprint
                 else memory.source_hash(p_translation, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse) end;
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
      'leaves_collection', v_collection))
    -- No text for a licensed version: the app fetches and compares it.
    || case when t.source_kind = 'api' then jsonb_build_object('verses', null, 'only_current', null, 'only_new', null, 'provider', true) else '{}'::jsonb end;
end;
$$;

create or replace function public.memory_card_translation_preview(p_card uuid, p_translation uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select public.memory_card_translation_preview(p_card, p_translation, null::text);
$$;

-- ---------------------------------------------------------------------------
-- Practice sessions
-- ---------------------------------------------------------------------------
-- p_options also carries {fingerprint} for licensed versions (set by the
-- app's server, never by the browser).
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
  -- Hints show part of the text, which isn't permitted for licensed versions.
  if pa.source_kind = 'api' then
    raise exception 'Hints aren''t available for this version.' using errcode = '22023';
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

revoke execute on all functions in schema memory from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('memory_card_provider_refresh', 'memory_admin_provider_permissions',
                                                         'memory_admin_provider_permission_save', 'memory_card_change_translation',
                                                         'memory_card_translation_preview') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;
