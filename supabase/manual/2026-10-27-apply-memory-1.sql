-- Phase 9 · Step 1 of 5: apply migration 20261027000100_memory_schema to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Scripture memory schema, capabilities and roles, passages captured from the Phase 8 source, collections and items, member cards, sessions, attempts, badges and awards, challenges, text helpers (tokens, comparison keys, practice segments), access helpers, the private memory bucket, and access-loss triggers.
--
-- It copies supabase/migrations/20261027000100_memory_schema.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-9).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('bible.translations') is null or to_regclass('community.notifications') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the Phase 8 stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000600') then
    raise exception 'Nothing was changed: the previous step (20261026000600) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027000100') then
    raise exception 'Nothing was changed: 20261027000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261027000100_memory_schema.sql
-- =========================================================================
-- Phase 9 · Scripture memory and practice: schema, capabilities, text
-- helpers (tokens, comparison keys, practice segments), and the access rules
-- every later function uses.
--
-- One private schema, `memory`, not exposed by the Data API and not readable
-- by anon/authenticated (RLS on, no policies). Everything goes through
-- SECURITY DEFINER functions in public (memory_*, memory_admin_*) that
-- recheck the caller on every call.
--
-- Scripture comes only from the Phase 8 source (bible.translations and
-- bible.verses). A memory passage is a captured *version* of one reference
-- in one translation: the exact verse text, the translation's text_version,
-- and a content hash. Nothing is generated, paraphrased, or combined across
-- translations. Only stored-text (source_kind = 'database') translations can
-- be memorized: scoring needs the exact approved text on the server, and
-- API translations may not be stored (Phase 8 never stores API text).
--
-- Capabilities (super administrators hold them implicitly; none of them
-- opens anyone's practice results, progress, settings, or badges, which no
-- staff function reads):
--   memory.manage   create and edit draft church/group verse collections,
--                   choose passages, preview activities
--   memory.publish  publish, schedule, archive, duplicate, revise published
--                   collections, authorize group leaders, run challenges
-- Group leaders hold no capability. A memory.publish holder can authorize a
-- group; that group's active leaders may then manage collections and
-- challenges for that group only.

-- ---------------------------------------------------------------------------
-- Capabilities and roles
-- ---------------------------------------------------------------------------
insert into public.capabilities (key, description, available) values
  ('memory.manage', 'Create and edit draft memory verse collections and preview practice activities', true),
  ('memory.publish', 'Publish, schedule, archive, duplicate, and revise memory verse collections, authorize group leaders, and run group challenges', true);

insert into public.roles (key, name, description, assignable, sort_order) values
  ('memory_verse_editor', 'Memory verse editor',
   'Creates and edits draft memory verse collections and previews practice activities. Cannot publish or see anyone''s practice results.', true, 95),
  ('memory_verse_publisher', 'Memory verse publisher',
   'Edits, publishes, schedules, archives, and duplicates memory verse collections, authorizes group leaders, and runs group challenges. Cannot see anyone''s practice results.', true, 96);

insert into public.role_capabilities (role_key, capability_key) values
  ('memory_verse_editor', 'memory.manage'),
  ('memory_verse_publisher', 'memory.manage'),
  ('memory_verse_publisher', 'memory.publish');

-- ---------------------------------------------------------------------------
-- Schema and types
-- ---------------------------------------------------------------------------
create schema memory;
revoke all on schema memory from public, anon, authenticated;

create type memory.audience as enum ('members', 'group', 'personal');
create type memory.collection_status as enum ('draft', 'published', 'archived');
create type memory.activity as enum ('read_repeat', 'flashcards', 'missing_words', 'word_order', 'type_verse', 'self_check');
create type memory.difficulty as enum ('guided', 'growing', 'challenge');
create type memory.quality as enum ('strong', 'partial', 'practice', 'none');

-- ---------------------------------------------------------------------------
-- Passages: captured versions of approved scripture
-- ---------------------------------------------------------------------------
-- One row per (translation, reference, exact text). A re-imported
-- translation whose text for this reference changed gets a new row; the
-- old row (and the practice recorded against it) is never rewritten.
-- Removing a personal verse never deletes a passage.
create table memory.passages (
  id uuid primary key default gen_random_uuid(),
  translation_id uuid not null references bible.translations (id) on delete restrict,
  book_code text not null references bible.books (code),
  start_chapter smallint not null check (start_chapter between 1 and 150),
  start_verse smallint not null check (start_verse between 1 and 200),
  end_chapter smallint not null check (end_chapter between 1 and 150),
  end_verse smallint not null check (end_verse between 1 and 200),
  label text not null check (char_length(label) between 1 and 80),
  -- Stable across text versions of the same reference: "WEB:JHN.3.16-3.16".
  ref_key text not null check (ref_key ~ '^[A-Z0-9-]+:[1-3A-Z][A-Z0-9]{2}\.\d+\.\d+-\d+\.\d+$'),
  -- The translation's text_version when captured, and the digest of the
  -- exact verse text (sha256 over "c:v\ttext\n" lines).
  text_version integer not null check (text_version >= 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  version smallint not null default 1 check (version >= 1),
  -- [{c, v, t, q}] exactly as stored in bible.verses (omitted verses
  -- excluded; q = poetry lines).
  verses jsonb not null check (jsonb_typeof(verses) = 'array' and jsonb_array_length(verses) between 1 and 30),
  -- [{t, c, v, g, b}] whitespace tokens of the text in order; g = no space
  -- follows (a dash joining two words), b = a line break follows (poetry).
  tokens jsonb not null check (jsonb_typeof(tokens) = 'array'),
  word_count smallint not null check (word_count between 1 and 900),
  -- Practice segments as token ranges: [{n, from, to, label}].
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),
  short_segments jsonb not null check (jsonb_typeof(short_segments) = 'array'),
  -- The newer version of this reference, once one is captured.
  superseded_by uuid references memory.passages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (translation_id, ref_key, content_hash),
  constraint passages_order check (end_chapter > start_chapter or (end_chapter = start_chapter and end_verse >= start_verse))
);
create index passages_ref_idx on memory.passages (translation_id, ref_key, version desc);
create index passages_book_idx on memory.passages (book_code);
create index passages_superseded_idx on memory.passages (superseded_by);

-- ---------------------------------------------------------------------------
-- Collections and assignments
-- ---------------------------------------------------------------------------
-- members:  approved church members
-- group:    active members of one group
-- personal: one member's own collection (no staff function reads these)
create table memory.collections (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  cover_path text unique check (cover_path ~ '^covers/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.webp$'),
  cover_alt text check (char_length(cover_alt) <= 300),
  audience memory.audience not null default 'members',
  group_id uuid references community.groups (id) on delete restrict,
  owner_id uuid references public.profiles (id) on delete cascade,
  -- One translation per collection: passages are never mixed or switched.
  translation_id uuid not null references bible.translations (id) on delete restrict,
  kind text not null default 'collection' check (kind in ('collection', 'sequence')),
  status memory.collection_status not null default 'draft',
  -- Published collections appear at publish_at (scheduled until then).
  publish_at timestamptz,
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  -- Optional practice goal, in the church's words, plus an optional
  -- suggested number of practice sessions per week (never enforced).
  goal_note text check (char_length(goal_note) <= 300),
  goal_sessions_per_week smallint check (goal_sessions_per_week between 1 and 50),
  timezone text not null default 'America/Chicago' check (char_length(timezone) <= 64),
  previous_collection_id uuid references memory.collections (id) on delete set null,
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  client_key uuid,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_group check ((audience = 'group') = (group_id is not null)),
  constraint collections_owner check ((audience = 'personal') = (owner_id is not null)),
  constraint collections_personal check (audience <> 'personal' or (kind = 'collection' and status <> 'draft')),
  constraint collections_published check (status = 'draft' or publish_at is not null),
  constraint collections_archived check ((status = 'archived') = (archived_at is not null))
);
create index collections_status_idx on memory.collections (status, publish_at);
create index collections_group_idx on memory.collections (group_id);
create index collections_owner_idx on memory.collections (owner_id);
create index collections_translation_idx on memory.collections (translation_id);
create index collections_previous_idx on memory.collections (previous_collection_id);
create index collections_created_by_idx on memory.collections (created_by);
create index collections_updated_by_idx on memory.collections (updated_by);
create index collections_published_by_idx on memory.collections (published_by);
create unique index collections_client_key_idx on memory.collections (created_by, client_key) where client_key is not null;

-- Items keep a stable id: reordering, retitling, or archiving never touches
-- practice history. A text update points the item at a newer passage
-- version and is logged in item_versions; members decide when to switch.
create table memory.items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references memory.collections (id) on delete cascade,
  passage_id uuid not null references memory.passages (id) on delete restrict,
  position smallint not null check (position between 1 and 500),
  -- Editorial content, always shown apart from the scripture text.
  title text check (char_length(title) <= 120),
  note text not null default '' check (char_length(note) <= 2000),
  hint text check (char_length(hint) <= 300),
  -- Assignment window (weekly or date-based memory verse; sequences fill
  -- these week by week). Both null = part of the collection, not assigned.
  starts_on date,
  ends_on date,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_window check ((starts_on is null) = (ends_on is null) and (ends_on is null or ends_on >= starts_on)),
  constraint items_window_length check (ends_on is null or ends_on - starts_on <= 92)
);
create unique index items_position_idx on memory.items (collection_id, position) where retired_at is null;
create index items_passage_idx on memory.items (passage_id);
create index items_window_idx on memory.items (starts_on, ends_on) where retired_at is null and starts_on is not null;

create table memory.item_versions (
  id bigint generated always as identity primary key,
  item_id uuid not null references memory.items (id) on delete cascade,
  from_passage_id uuid not null references memory.passages (id) on delete restrict,
  to_passage_id uuid not null references memory.passages (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index item_versions_item_idx on memory.item_versions (item_id, changed_at desc);
create index item_versions_from_idx on memory.item_versions (from_passage_id);
create index item_versions_to_idx on memory.item_versions (to_passage_id);
create index item_versions_changed_by_idx on memory.item_versions (changed_by);

-- A group whose active leaders may manage that group's collections and
-- challenges (granted by a memory.publish holder, audited, revocable).
create table memory.group_authorizations (
  group_id uuid primary key references community.groups (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  note text check (char_length(note) <= 300)
);
create index group_authorizations_granted_by_idx on memory.group_authorizations (granted_by);

-- ---------------------------------------------------------------------------
-- Member data: private to its owner (no staff function reads it)
-- ---------------------------------------------------------------------------
create table memory.member_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  difficulty memory.difficulty not null default 'guided',
  -- Presentation only: never an age check, never a permission.
  presentation text not null default 'standard' check (presentation in ('standard', 'kids')),
  ignore_case boolean not null default true,
  ignore_punctuation boolean not null default true,
  celebrations boolean not null default true,
  daily_goal smallint check (daily_goal between 1 and 20),
  timezone text check (char_length(timezone) <= 64),
  -- Pausing stops reminders and the review queue's "due" emphasis. Nothing
  -- is lost while paused.
  paused boolean not null default false,
  remind_weekly boolean not null default false,
  remind_review boolean not null default false,
  remind_practice boolean not null default false,
  remind_challenge boolean not null default false,
  reminder_time time not null default '18:00',
  last_weekly_on date,
  last_review_on date,
  last_practice_on date,
  updated_at timestamptz not null default now()
);

-- One card per member per passage version: the member's practice of it.
create table memory.cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  passage_id uuid not null references memory.passages (id) on delete restrict,
  -- Where it came from (a collection item, or added personally).
  item_id uuid references memory.items (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'removed', 'superseded')),
  -- Spaced review (see memory.schedule): step 0–7, next review date in the
  -- member's own calendar.
  step smallint not null default 0 check (step between 0 and 7),
  due_on date,
  last_scheduled_on date,
  best_step smallint not null default 0 check (best_step between 0 and 7),
  sessions integer not null default 0 check (sessions >= 0),
  last_practiced_at timestamptz,
  -- When this card replaced an earlier version of the same reference.
  previous_card_id uuid references memory.cards (id) on delete set null,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (profile_id, passage_id),
  constraint cards_removed check ((status = 'active') = (removed_at is null))
);
create index cards_profile_idx on memory.cards (profile_id, status, due_on);
create index cards_passage_idx on memory.cards (passage_id);
create index cards_item_idx on memory.cards (item_id);
create index cards_previous_idx on memory.cards (previous_card_id);

-- A served activity. The server chooses what is hidden or shuffled and
-- keeps it here, so a submission is scored against exactly what was shown,
-- once (retries return the same result), and only for the passage version
-- the member practiced.
create table memory.sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  card_id uuid not null references memory.cards (id) on delete cascade,
  passage_id uuid not null references memory.passages (id) on delete restrict,
  activity memory.activity not null,
  difficulty memory.difficulty not null,
  -- 0 = the whole passage; otherwise a segment number.
  segment smallint not null default 0 check (segment between 0 and 200),
  short_segments boolean not null default false,
  token_from integer not null check (token_from >= 0),
  token_to integer not null check (token_to >= token_from),
  -- Activity setup chosen by the server (blanks, chips, direction, rules).
  setup jsonb not null default '{}'::jsonb check (jsonb_typeof(setup) = 'object'),
  hints integer not null default 0 check (hints between 0 and 1000),
  revealed boolean not null default false,
  status text not null default 'open' check (status in ('open', 'submitted', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  submitted_at timestamptz,
  constraint sessions_submitted check ((status = 'submitted') = (result is not null and submitted_at is not null))
);
create index sessions_profile_idx on memory.sessions (profile_id, created_at desc);
create index sessions_card_idx on memory.sessions (card_id);
create index sessions_passage_idx on memory.sessions (passage_id);
create index sessions_open_idx on memory.sessions (expires_at) where status = 'open';

-- Practice history. Each field is separate on purpose: completing an
-- activity, accuracy, hints, the member's own confidence, and the review
-- step are different things and are never folded into one "mastery" score.
create table memory.attempts (
  id uuid primary key default gen_random_uuid(),
  -- Kept when old sessions are cleared (attempts are the history).
  session_id uuid unique references memory.sessions (id) on delete set null,
  card_id uuid not null references memory.cards (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  passage_id uuid not null references memory.passages (id) on delete restrict,
  activity memory.activity not null,
  difficulty memory.difficulty not null,
  segment smallint not null default 0,
  completed boolean not null default true,
  -- 0–1 for scored activities; null for read & repeat, flashcards, and
  -- self-check (those are self-assessed, never machine-scored).
  accuracy numeric(4, 3) check (accuracy between 0 and 1),
  hints integer not null default 0 check (hints >= 0),
  confidence text check (confidence in ('not_yet', 'partly', 'mostly', 'fully')),
  quality memory.quality not null,
  step_before smallint not null,
  step_after smallint not null,
  local_date date not null,
  created_at timestamptz not null default now()
);
create index attempts_profile_idx on memory.attempts (profile_id, created_at desc);
create index attempts_card_idx on memory.attempts (card_id, created_at desc);
create index attempts_passage_idx on memory.attempts (passage_id);
create index attempts_profile_date_idx on memory.attempts (profile_id, local_date);

-- Badge catalog (effort and milestones only) and awards. Awards are written
-- only by the submission function, once per (member, badge, scope).
create table memory.badges (
  key text primary key check (key ~ '^[a-z_]+$'),
  name text not null,
  description text not null,
  sort_order smallint not null
);
insert into memory.badges (key, name, description, sort_order) values
  ('first_steps', 'First steps', 'You completed your first practice activity.', 10),
  ('steady_ten', 'Steady practice', 'You completed 10 practice activities.', 20),
  ('faithful_fifty', 'Faithful practice', 'You completed 50 practice activities.', 30),
  ('coming_back', 'Coming back', 'You practiced on 3 different days.', 40),
  ('ten_days', 'Ten days of practice', 'You practiced on 10 different days (they don''t need to be in a row).', 50),
  ('recited', 'Recited', 'You recited a verse from memory and checked it yourself.', 60),
  ('taking_root', 'Taking root', 'A verse reached review-ready: you recalled it on three separate review days.', 70),
  ('treasured_five', 'Hidden in my heart', 'Five verses reached review-ready.', 80),
  ('explorer', 'Explorer', 'You tried all six practice activities.', 90),
  ('collection_explored', 'Collection explored', 'You practiced every verse in a collection.', 100);

create table memory.awards (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  badge_key text not null references memory.badges (key),
  -- '' for one-time badges; a collection id for collection_explored.
  scope text not null default '' check (char_length(scope) <= 64),
  awarded_at timestamptz not null default now(),
  primary key (profile_id, badge_key, scope)
);
create index awards_badge_idx on memory.awards (badge_key);

-- ---------------------------------------------------------------------------
-- Group challenges (adults, explicit opt-in, aggregate only)
-- ---------------------------------------------------------------------------
create table memory.challenges (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references community.groups (id) on delete cascade,
  collection_id uuid not null references memory.collections (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  starts_on date not null,
  ends_on date not null,
  -- Shared goal: practice activities completed together.
  goal_sessions integer not null check (goal_sessions between 1 and 100000),
  -- Aggregates are hidden until at least this many people share.
  min_participants smallint not null default 5 check (min_participants between 3 and 50),
  status text not null default 'active' check (status in ('active', 'ended', 'canceled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint challenges_dates check (ends_on >= starts_on and ends_on - starts_on <= 120)
);
create index challenges_group_idx on memory.challenges (group_id, status);
create index challenges_collection_idx on memory.challenges (collection_id);
create index challenges_created_by_idx on memory.challenges (created_by);

create table memory.challenge_participants (
  challenge_id uuid not null references memory.challenges (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- Sharing can be revoked at any time; contributions are counted live, so
  -- revoking or leaving removes them from every aggregate.
  sharing boolean not null default true,
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, profile_id)
);
create index challenge_participants_profile_idx on memory.challenge_participants (profile_id);

-- Milestones already announced (never twice, even if the total later dips).
create table memory.challenge_milestones (
  challenge_id uuid not null references memory.challenges (id) on delete cascade,
  percent smallint not null check (percent in (25, 50, 75, 100)),
  reached_at timestamptz not null default now(),
  primary key (challenge_id, percent)
);

do $rls$
declare
  t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname = 'memory' loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end
$rls$;

-- ---------------------------------------------------------------------------
-- Text helpers
-- ---------------------------------------------------------------------------
-- Whitespace tokens of a verse. A dash or hyphen joining two words
-- (world—that, one-and-only) ends a token without a space ("g" = glued), so
-- each word can be compared on its own while joining tokens with a space
-- (a line break where the source has one, "b") unless glued reproduces the
-- text's words, punctuation, and poetry lines exactly.
create function memory.split_tokens(p_text text)
returns table (t text, g boolean, b boolean)
language plpgsql
immutable
set search_path = ''
as $$
declare
  m record;
  parts text[];
  i integer;
begin
  for m in select r[1] as w, r[2] as sp from regexp_matches(normalize(coalesce(p_text, ''), NFC), '(\S+)(\s*)', 'g') r loop
    parts := string_to_array(regexp_replace(m.w, '((?<=[[:alnum:]])[-‐‑]|[—–])(?=\S)', E'\\1\u0001', 'g'), E'\u0001');
    for i in 1 .. cardinality(parts) loop
      continue when parts[i] = '';
      t := parts[i];
      g := i < cardinality(parts);
      -- A line break (poetry) follows this token in the source.
      b := not g and position(E'\n' in m.sp) > 0;
      return next;
    end loop;
  end loop;
end;
$$;

-- Comparison key of a token. Always: Unicode NFC, curly quotes and
-- apostrophes made straight, dashes made plain. Optional: case-insensitive;
-- punctuation-tolerant (everything that isn't a letter, digit, or combining
-- mark is ignored, including apostrophes, so "dont" matches "don't" but
-- "do not" never matches "don't"). A token that is only punctuation has
-- the key '' and is not a word.
create function memory.word_key(p_token text, p_ignore_case boolean, p_ignore_punct boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := normalize(coalesce(p_token, ''), NFC);
begin
  v := translate(v, '’‘ʼ`´“”„«»—–‐‑', '''''''''''""""""----');
  if p_ignore_case then
    v := lower(v);
  end if;
  if p_ignore_punct or v !~ '[[:alnum:]]' then
    v := regexp_replace(v, '[^[:alnum:]\u0300-\u036f\u0591-\u05c7]', '', 'g');
  end if;
  return v;
end;
$$;

-- The leading and trailing punctuation of a token, shown around a blank.
create function memory.token_core(p_token text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pre text;
  v_post text;
begin
  if p_token !~ '[[:alnum:]]' then
    return jsonb_build_object('pre', p_token, 'core', '', 'post', '');
  end if;
  v_pre := substring(p_token from '^[^[:alnum:]]*');
  v_post := substring(p_token from '[^[:alnum:]\u0300-\u036f]*$');
  return jsonb_build_object('pre', v_pre, 'post', v_post,
    'core', substr(p_token, char_length(v_pre) + 1, char_length(p_token) - char_length(v_pre) - char_length(v_post)));
end;
$$;

-- Practice segments of a token list: break at verse boundaries when the
-- next verse would exceed p_max words; split a single long verse at clause
-- punctuation (, ; : . ! ? and dashes) near the limit, or at the limit when
-- a verse has no punctuation. Segments are token ranges: the text itself is
-- never changed.
create function memory.segments(p_tokens jsonb, p_max integer, p_label text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := jsonb_array_length(p_tokens);
  v_out jsonb := '[]'::jsonb;
  v_start integer := 0;
  i integer := 0;
  v_vstart integer;
  v_vend integer;
  v_cut integer;
  j integer;
  k integer;
  v_seg integer := 0;
  v_first jsonb;
  v_last jsonb;
begin
  if n = 0 then
    return v_out;
  end if;
  -- Walk verse by verse.
  while i < n loop
    v_vstart := i;
    v_vend := i;
    while v_vend + 1 < n
      and (p_tokens -> (v_vend + 1) ->> 'c') = (p_tokens -> i ->> 'c')
      and (p_tokens -> (v_vend + 1) ->> 'v') = (p_tokens -> i ->> 'v') loop
      v_vend := v_vend + 1;
    end loop;
    -- Close the current segment if this verse doesn't fit.
    if v_vstart > v_start and (v_vend - v_start + 1) > p_max then
      v_seg := v_seg + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('n', v_seg, 'from', v_start, 'to', v_vstart - 1));
      v_start := v_vstart;
    end if;
    -- A verse longer than the limit is split at punctuation.
    while v_vend - v_start + 1 > p_max loop
      v_cut := null;
      j := least(v_start + p_max - 1, v_vend - 1);
      k := v_start + greatest(p_max / 2, 3) - 1;
      while j >= k loop
        if (p_tokens -> j ->> 't') ~ '[,;:.!?—–)”’]$' then
          v_cut := j;
          exit;
        end if;
        j := j - 1;
      end loop;
      v_cut := coalesce(v_cut, least(v_start + p_max - 1, v_vend - 1));
      v_seg := v_seg + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('n', v_seg, 'from', v_start, 'to', v_cut));
      v_start := v_cut + 1;
    end loop;
    i := v_vend + 1;
  end loop;
  if v_start < n then
    v_seg := v_seg + 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object('n', v_seg, 'from', v_start, 'to', n - 1));
  end if;
  -- Labels: "Part 2 of 3 · verses 17–18" (or "verse 16, part 1").
  return (
    select jsonb_agg(s || jsonb_build_object('label',
             case when v_seg = 1 then p_label
                  else 'Part ' || (s ->> 'n') || ' of ' || v_seg || ' · ' ||
                       case when f ->> 'c' = l ->> 'c' and f ->> 'v' = l ->> 'v' then 'verse ' || (f ->> 'v')
                            when f ->> 'c' = l ->> 'c' then 'verses ' || (f ->> 'v') || '–' || (l ->> 'v')
                            else (f ->> 'c') || ':' || (f ->> 'v') || '–' || (l ->> 'c') || ':' || (l ->> 'v') end
             end) order by (s ->> 'n')::integer)
      from jsonb_array_elements(v_out) s
      cross join lateral (select p_tokens -> (s ->> 'from')::integer as f, p_tokens -> (s ->> 'to')::integer as l) x);
end;
$$;

-- Display text of a token range (exactly the source wording and spacing).
create function memory.range_text(p_tokens jsonb, p_from integer, p_to integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(e ->> 't' || case when (e ->> 'g')::boolean or n - 1 = p_to then '' when (e ->> 'b')::boolean then E'\n' else ' ' end, '' order by n), '')
    from jsonb_array_elements(p_tokens) with ordinality x(e, n)
   where n - 1 between p_from and p_to;
$$;

-- ---------------------------------------------------------------------------
-- Access helpers (internal; not executable by clients)
-- ---------------------------------------------------------------------------
create function memory.is_member(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and community.is_member(p_profile);
$$;

create function memory.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not memory.is_member(v_uid) then
    raise exception 'Only approved members can do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- The caller's active leadership of a group that a publisher authorized.
create function memory.leader_authorized(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_group is not null
     and exists (select 1 from memory.group_authorizations a where a.group_id = p_group)
     and community.group_leader(p_group, p_profile);
$$;

-- Edit a church or group collection (never a personal one).
create function memory.can_edit(c memory.collections)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.id is not null and c.audience <> 'personal' and memory.is_member((select auth.uid()))
     and (public.has_capability('memory.manage') or public.has_capability('memory.publish')
          or (c.audience = 'group' and memory.leader_authorized(c.group_id, (select auth.uid()))));
$$;

create function memory.can_publish(c memory.collections)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.id is not null and c.audience <> 'personal' and memory.is_member((select auth.uid()))
     and (public.has_capability('memory.publish')
          or (c.audience = 'group' and memory.leader_authorized(c.group_id, (select auth.uid()))));
$$;

create function memory.valid_tz(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tz is not null and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz);
$$;

create function memory.church_tz()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select timezone from public.church_settings), 'America/Chicago');
$$;

-- The member's practice time zone: their memory setting, else their
-- notification time zone, else the church's.
create function memory.member_tz(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.timezone from memory.member_settings s where s.profile_id = p_profile and memory.valid_tz(s.timezone)),
    community.member_tz(p_profile));
$$;

create function memory.local_today(p_tz text)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone p_tz)::date;
$$;

-- A collection the person may see now. Scheduled collections appear at
-- publish_at; archived ones are hidden from browsing (cards made from them
-- keep their history).
create function memory.collection_visible(c memory.collections, p_profile uuid)
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
         end;
$$;

create function memory.collection_visible_id(p_collection uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select memory.collection_visible(c, p_profile) from memory.collections c where c.id = p_collection), false);
$$;

create function memory.audit(p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id::text, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Capturing a passage version from the approved source
-- ---------------------------------------------------------------------------
-- Memory passages: one book, explicit verses, at most 30 verses and 900
-- words, stored-text translations only. Returns null when valid, otherwise
-- a member-safe reason.
create function memory.passage_problem(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer)
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
    return 'Memory practice needs a version whose text is stored here. This version is read from an outside service and can''t be stored.';
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

-- The passage version matching the source's current text (captured now if
-- this exact text hasn't been captured before). Earlier versions of the same
-- reference are marked superseded, never changed.
create function memory.capture_passage(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t bible.translations;
  v_problem text := memory.passage_problem(p_translation, p_book, p_sc, p_sv, p_ec, p_ev);
  v_verses jsonb;
  v_hash text;
  v_ref text;
  v_id uuid;
  v_tokens jsonb;
  v_label text := bible.passage_label(p_book, p_sc, p_sv, p_ec, p_ev);
  v_version integer;
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  select * into t from bible.translations where id = p_translation;
  select jsonb_agg(jsonb_build_object('c', v.chapter, 'v', v.verse, 't', v.text, 'q', v.poetry) order by v.chapter, v.verse),
         encode(sha256(convert_to(string_agg(v.chapter || ':' || v.verse || E'\t' || v.text || E'\n', '' order by v.chapter, v.verse), 'UTF8')), 'hex')
    into v_verses, v_hash
    from bible.verses v
   where v.translation_id = p_translation and v.book_code = p_book and not v.omitted
     and (v.chapter, v.verse) >= (p_sc, p_sv) and (v.chapter, v.verse) <= (p_ec, p_ev);
  v_ref := t.code || ':' || p_book || '.' || p_sc || '.' || p_sv || '-' || p_ec || '.' || p_ev;
  select id into v_id from memory.passages where translation_id = p_translation and ref_key = v_ref and content_hash = v_hash;
  if v_id is not null then
    return v_id;
  end if;
  -- Poetry verses end their last line with a break.
  select coalesce(jsonb_agg(jsonb_build_object('t', s.t, 'c', (e ->> 'c')::integer, 'v', (e ->> 'v')::integer, 'g', s.g,
                                               'b', s.b or (coalesce((e ->> 'q')::boolean, false)
                                                            and s.ord = (select count(*) from memory.split_tokens(e ->> 't'))))
                            order by n, s.ord), '[]'::jsonb)
    into v_tokens
    from jsonb_array_elements(v_verses) with ordinality x(e, n)
    cross join lateral memory.split_tokens(e ->> 't') with ordinality s(t, g, b, ord);
  select coalesce(max(version), 0) + 1 into v_version from memory.passages where translation_id = p_translation and ref_key = v_ref;
  insert into memory.passages (translation_id, book_code, start_chapter, start_verse, end_chapter, end_verse, label, ref_key,
                               text_version, content_hash, version, verses, tokens, word_count, segments, short_segments)
  values (p_translation, p_book, p_sc, p_sv, p_ec, p_ev, v_label, v_ref, t.text_version, v_hash, v_version, v_verses, v_tokens,
          jsonb_array_length(v_tokens), memory.segments(v_tokens, 32, v_label), memory.segments(v_tokens, 16, v_label))
  returning id into v_id;
  update memory.passages set superseded_by = v_id
   where translation_id = p_translation and ref_key = v_ref and id <> v_id and superseded_by is null;
  return v_id;
end;
$$;

-- Whether the source's current text still matches a captured version.
create function memory.passage_current(p memory.passages)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select encode(sha256(convert_to(string_agg(v.chapter || ':' || v.verse || E'\t' || v.text || E'\n', '' order by v.chapter, v.verse), 'UTF8')), 'hex') = p.content_hash
      from bible.verses v
     where v.translation_id = p.translation_id and v.book_code = p.book_code and not v.omitted
       and (v.chapter, v.verse) >= (p.start_chapter, p.start_verse) and (v.chapter, v.verse) <= (p.end_chapter, p.end_verse)), false);
$$;

-- Public description of a passage version (scripture plus its source
-- requirements). Scripture text and editorial text are never mixed.
create function memory.passage_json(p memory.passages, p_with_text boolean default true)
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
    'translation', jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'attribution', t.attribution,
                                      'copyright', t.copyright, 'source_url', t.source_url, 'allow_copy', t.allow_copy,
                                      'allow_print', t.allow_print, 'allow_export', t.allow_export, 'status', t.status),
    'verses', case when p_with_text then (select jsonb_agg(jsonb_build_object('c', (e ->> 'c')::integer, 'v', (e ->> 'v')::integer, 't', e ->> 't',
                                                                              'o', false, 'h', null, 'p', false, 'q', coalesce((e ->> 'q')::boolean, false)))
                                            from jsonb_array_elements(p.verses) e) end)
    from bible.translations t where t.id = p.translation_id;
$$;

-- ---------------------------------------------------------------------------
-- Storage: a private bucket for collection covers.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory', 'memory', false, 10485760, array['image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.memory_can_read_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not memory.is_member(v_uid) then
    return false;
  end if;
  return exists (select 1 from memory.collections c
                  where c.cover_path = p_name and (memory.collection_visible(c, v_uid) or memory.can_edit(c)));
end;
$$;

create function public.memory_can_write_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not memory.is_member(v_uid) or p_name !~ '^covers/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.webp$' then
    return false;
  end if;
  return exists (select 1 from memory.collections c
                  where p_name like 'covers/' || c.id::text || '/%' and memory.can_edit(c));
end;
$$;

create policy "Memory covers follow collection visibility"
  on storage.objects for select to authenticated
  using (bucket_id = 'memory' and (select public.memory_can_read_object(storage.objects.name)));
create policy "Memory covers uploaded by collection editors"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'memory' and (select public.memory_can_write_object(storage.objects.name)));
create policy "Memory covers removed by collection editors"
  on storage.objects for delete to authenticated
  using (bucket_id = 'memory' and (select public.memory_can_write_object(storage.objects.name)));

-- ---------------------------------------------------------------------------
-- Losing access: every read rechecks. Leaving a group (or suspension) also
-- ends challenge participation for that group and drops unread memory
-- notices that no longer apply. Personal practice is never deleted.
-- (The notification category arrives in a later migration.)
-- ---------------------------------------------------------------------------
create function memory.reconcile_access(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile is null then
    return;
  end if;
  update memory.challenge_participants cp
     set left_at = coalesce(cp.left_at, now()), sharing = false, updated_at = now()
    from memory.challenges ch
   where ch.id = cp.challenge_id and cp.profile_id = p_profile and cp.left_at is null
     and not community.group_member(ch.group_id, p_profile);
  delete from community.notifications n
   where n.profile_id = p_profile and n.read_at is null and n.category = 'memory'
     and not community.notification_visible(n);
end;
$$;

create function memory.on_group_membership_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'active' and new.state <> 'active' then
    perform memory.reconcile_access(new.profile_id);
  end if;
  return new;
end;
$$;

create trigger group_members_memory_access
  after update of state on community.group_members
  for each row execute function memory.on_group_membership_end();

create function memory.on_profile_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.membership_status = 'approved' and new.membership_status <> 'approved' then
    perform memory.reconcile_access(new.id);
  end if;
  return new;
end;
$$;

create trigger profiles_memory_access
  after update of membership_status on public.profiles
  for each row execute function memory.on_profile_status();

revoke execute on all functions in schema memory from public, anon, authenticated;
revoke execute on function public.memory_can_read_object(text), public.memory_can_write_object(text) from public, anon;
grant execute on function public.memory_can_read_object(text), public.memory_can_write_object(text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261027000100', 'memory_schema', 'phase-9');

commit;
