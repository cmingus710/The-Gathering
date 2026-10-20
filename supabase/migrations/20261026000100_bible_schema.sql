-- Phase 8 · Bible reading plans, scripture reader, and private journals:
-- schema, capabilities, and the access rules every later function uses.
--
-- Two private schemas, neither exposed by the Data API nor readable by
-- anon/authenticated. Everything goes through SECURITY DEFINER functions in
-- public (bible_*, bible_admin_*, journal_*) that recheck the caller on
-- every call.
--
--   bible     translations and their attribution/rights, structured verse
--             text, staged imports awaiting review, reference PDFs, reading
--             plans (days, passages, revisions, change log), enrollments,
--             completions, bookmarks, highlights, and reader settings
--   journal   members' private journal entries (owner only, always)
--
-- Scripture is stored only as supplied by a verified source. Nothing is ever
-- generated, guessed, or combined across translations: a verse row belongs
-- to exactly one translation, and a translation is shown to members only
-- after its rights are confirmed and (for stored text) a reviewed import
-- was published.
--
-- Capabilities (super administrators hold them implicitly, like content.*;
-- none of them opens journals, progress, bookmarks, or highlights, which no
-- staff function can read):
--   reading.edit     create and edit draft reading plans, import assignments
--   reading.publish  publish, archive, feature, and revise published plans
--   bible.manage     translations and sources, scripture imports and their
--                    review and publication, reference PDFs

-- ---------------------------------------------------------------------------
-- Capabilities and roles
-- ---------------------------------------------------------------------------
insert into public.capabilities (key, description, available) values
  ('reading.edit', 'Create and edit draft Bible reading plans and import plan assignments', true),
  ('reading.publish', 'Publish, archive, feature, and revise published Bible reading plans', true),
  ('bible.manage', 'Configure Bible translations and sources, review and publish imported scripture text, and manage reference PDFs', true);

insert into public.roles (key, name, description, assignable, sort_order) values
  ('reading_plan_editor', 'Reading plan editor',
   'Creates and edits draft Bible reading plans and imports assignments. Cannot publish, change scripture sources, or see anyone''s journal or progress.', true, 90),
  ('reading_plan_publisher', 'Reading plan publisher',
   'Edits, publishes, archives, and revises Bible reading plans. Cannot change scripture sources or see anyone''s journal or progress.', true, 91),
  ('bible_source_manager', 'Bible source manager',
   'Configures Bible translations and sources, reviews and publishes imported scripture text, and manages reference PDFs.', true, 92);

insert into public.role_capabilities (role_key, capability_key) values
  ('reading_plan_editor', 'reading.edit'),
  ('reading_plan_publisher', 'reading.edit'),
  ('reading_plan_publisher', 'reading.publish'),
  ('bible_source_manager', 'bible.manage');

-- ---------------------------------------------------------------------------
-- Schemas and types
-- ---------------------------------------------------------------------------
create schema bible;
revoke all on schema bible from public, anon, authenticated;
create schema journal;
revoke all on schema journal from public, anon, authenticated;

-- Where members' passage text comes from: verses stored in this database
-- (from a reviewed import) or a licensed scripture API read at view time.
create type bible.source_kind as enum ('database', 'api');
create type bible.rights as enum ('unverified', 'public_domain', 'licensed', 'permission');
create type bible.translation_status as enum ('draft', 'active', 'retired');
create type bible.import_status as enum ('uploading', 'processing', 'staged', 'failed', 'published', 'discarded');
create type bible.file_status as enum ('uploading', 'processing', 'ready', 'failed', 'removed');
create type bible.plan_mode as enum ('calendar', 'personal');
create type bible.plan_status as enum ('draft', 'published', 'archived');
create type bible.day_kind as enum ('reading', 'rest', 'catch_up');
create type bible.highlight_color as enum ('yellow', 'green', 'blue', 'pink');

-- ---------------------------------------------------------------------------
-- Canonical books and reference versification
-- ---------------------------------------------------------------------------
-- Stable identifiers are USFM/Paratext book codes (GEN … REV). Names match
-- the Phase 7 scripture references (src/lib/media/scripture.ts) so teaching
-- content, plans, journals, and future memory verses share one vocabulary.
-- chapter_verses is the reference versification (the English Protestant
-- tradition followed by the KJV and the World English Bible); a translation
-- with stored text is validated against its own verses instead.
create table bible.books (
  code text primary key check (code ~ '^[1-3A-Z][A-Z0-9]{2}$'),
  ordinal smallint not null unique check (ordinal between 1 and 66),
  name text not null unique,
  testament text not null check (testament in ('OT', 'NT')),
  chapter_verses smallint[] not null check (cardinality(chapter_verses) between 1 and 150)
);

insert into bible.books (ordinal, code, name, testament, chapter_verses) values
  ( 1, 'GEN', 'Genesis', 'OT', '{31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26}'),
  ( 2, 'EXO', 'Exodus', 'OT', '{22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38}'),
  ( 3, 'LEV', 'Leviticus', 'OT', '{17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34}'),
  ( 4, 'NUM', 'Numbers', 'OT', '{54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13}'),
  ( 5, 'DEU', 'Deuteronomy', 'OT', '{46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12}'),
  ( 6, 'JOS', 'Joshua', 'OT', '{18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33}'),
  ( 7, 'JDG', 'Judges', 'OT', '{36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25}'),
  ( 8, 'RUT', 'Ruth', 'OT', '{22,23,18,22}'),
  ( 9, '1SA', '1 Samuel', 'OT', '{28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13}'),
  (10, '2SA', '2 Samuel', 'OT', '{27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25}'),
  (11, '1KI', '1 Kings', 'OT', '{53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53}'),
  (12, '2KI', '2 Kings', 'OT', '{18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30}'),
  (13, '1CH', '1 Chronicles', 'OT', '{54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30}'),
  (14, '2CH', '2 Chronicles', 'OT', '{17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23}'),
  (15, 'EZR', 'Ezra', 'OT', '{11,70,13,24,17,22,28,36,15,44}'),
  (16, 'NEH', 'Nehemiah', 'OT', '{11,20,32,23,19,19,73,18,38,39,36,47,31}'),
  (17, 'EST', 'Esther', 'OT', '{22,23,15,17,14,14,10,17,32,3}'),
  (18, 'JOB', 'Job', 'OT', '{22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17}'),
  (19, 'PSA', 'Psalms', 'OT', '{6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6}'),
  (20, 'PRO', 'Proverbs', 'OT', '{33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31}'),
  (21, 'ECC', 'Ecclesiastes', 'OT', '{18,26,22,16,20,12,29,17,18,20,10,14}'),
  (22, 'SNG', 'Song of Songs', 'OT', '{17,17,11,16,16,13,13,14}'),
  (23, 'ISA', 'Isaiah', 'OT', '{31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24}'),
  (24, 'JER', 'Jeremiah', 'OT', '{19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34}'),
  (25, 'LAM', 'Lamentations', 'OT', '{22,22,66,22,22}'),
  (26, 'EZK', 'Ezekiel', 'OT', '{28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35}'),
  (27, 'DAN', 'Daniel', 'OT', '{21,49,30,37,31,28,28,27,27,21,45,13}'),
  (28, 'HOS', 'Hosea', 'OT', '{11,23,5,19,15,11,16,14,17,15,12,14,16,9}'),
  (29, 'JOL', 'Joel', 'OT', '{20,32,21}'),
  (30, 'AMO', 'Amos', 'OT', '{15,16,15,13,27,14,17,14,15}'),
  (31, 'OBA', 'Obadiah', 'OT', '{21}'),
  (32, 'JON', 'Jonah', 'OT', '{17,10,10,11}'),
  (33, 'MIC', 'Micah', 'OT', '{16,13,12,13,15,16,20}'),
  (34, 'NAM', 'Nahum', 'OT', '{15,13,19}'),
  (35, 'HAB', 'Habakkuk', 'OT', '{17,20,19}'),
  (36, 'ZEP', 'Zephaniah', 'OT', '{18,15,20}'),
  (37, 'HAG', 'Haggai', 'OT', '{15,23}'),
  (38, 'ZEC', 'Zechariah', 'OT', '{21,13,10,14,11,15,14,23,17,12,17,14,9,21}'),
  (39, 'MAL', 'Malachi', 'OT', '{14,17,18,6}'),
  (40, 'MAT', 'Matthew', 'NT', '{25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20}'),
  (41, 'MRK', 'Mark', 'NT', '{45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20}'),
  (42, 'LUK', 'Luke', 'NT', '{80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53}'),
  (43, 'JHN', 'John', 'NT', '{51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25}'),
  (44, 'ACT', 'Acts', 'NT', '{26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31}'),
  (45, 'ROM', 'Romans', 'NT', '{32,29,31,25,21,23,25,39,33,21,36,21,14,26,33,25}'),
  (46, '1CO', '1 Corinthians', 'NT', '{31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24}'),
  (47, '2CO', '2 Corinthians', 'NT', '{24,17,18,18,21,18,16,24,15,18,33,21,14}'),
  (48, 'GAL', 'Galatians', 'NT', '{24,21,29,31,26,18}'),
  (49, 'EPH', 'Ephesians', 'NT', '{23,22,21,32,33,24}'),
  (50, 'PHP', 'Philippians', 'NT', '{30,30,21,23}'),
  (51, 'COL', 'Colossians', 'NT', '{29,23,25,18}'),
  (52, '1TH', '1 Thessalonians', 'NT', '{10,20,13,18,28}'),
  (53, '2TH', '2 Thessalonians', 'NT', '{12,17,18}'),
  (54, '1TI', '1 Timothy', 'NT', '{20,15,16,16,25,21}'),
  (55, '2TI', '2 Timothy', 'NT', '{18,26,17,22}'),
  (56, 'TIT', 'Titus', 'NT', '{16,15,15}'),
  (57, 'PHM', 'Philemon', 'NT', '{25}'),
  (58, 'HEB', 'Hebrews', 'NT', '{14,18,19,16,14,20,28,13,28,39,40,29,25}'),
  (59, 'JAS', 'James', 'NT', '{27,26,18,17,20}'),
  (60, '1PE', '1 Peter', 'NT', '{25,25,22,19,14}'),
  (61, '2PE', '2 Peter', 'NT', '{21,22,18}'),
  (62, '1JN', '1 John', 'NT', '{10,29,24,21,21}'),
  (63, '2JN', '2 John', 'NT', '{13}'),
  (64, '3JN', '3 John', 'NT', '{14}'),
  (65, 'JUD', 'Jude', 'NT', '{25}'),
  (66, 'REV', 'Revelation', 'NT', '{20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21}');

-- ---------------------------------------------------------------------------
-- Settings (singleton)
-- ---------------------------------------------------------------------------
create table bible.settings (
  id boolean primary key default true check (id),
  -- The church's approved translation for the reader and new plans.
  default_translation_id uuid,
  -- Member guidance shown in My Journal (plain text, optional).
  journal_note text not null default '' check (char_length(journal_note) <= 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into bible.settings default values;

-- ---------------------------------------------------------------------------
-- Translations and sources
-- ---------------------------------------------------------------------------
create table bible.translations (
  id uuid primary key default gen_random_uuid(),
  -- Short label shown beside every passage (e.g. WEB, ESV).
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  language text not null default 'en' check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  source_kind bible.source_kind not null default 'database',
  -- API sources: the provider, its identifier for this translation, and the
  -- NAME of the server environment variable holding the key (never the key).
  provider text check (provider in ('api_bible')),
  provider_ref text check (provider_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  credential_env text check (credential_env ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  -- Shown with passages where required.
  attribution text not null default '' check (char_length(attribution) <= 1000),
  copyright text not null default '' check (char_length(copyright) <= 2000),
  source_url text check (char_length(source_url) <= 500 and source_url ~ '^https://'),
  source_notes text not null default '' check (char_length(source_notes) <= 2000),
  -- Rights review (administrative).
  rights bible.rights not null default 'unverified',
  rights_notes text not null default '' check (char_length(rights_notes) <= 4000),
  rights_confirmed_at timestamptz,
  rights_confirmed_by uuid references public.profiles (id) on delete set null,
  -- What the license allows. Defaults are the most restrictive.
  allow_cache boolean not null default false,
  cache_days integer check (cache_days between 1 and 30),
  allow_copy boolean not null default false,
  allow_print boolean not null default false,
  allow_export boolean not null default false,
  max_verses_per_view integer not null default 500 check (max_verses_per_view between 1 and 5000),
  -- API.Bible requires its usage-tracking (FUMS) script wherever its text is shown.
  tracking_required boolean not null default false,
  status bible.translation_status not null default 'draft',
  -- Stored text: verse rows and the number of published imports.
  verse_count integer not null default 0 check (verse_count >= 0),
  text_version integer not null default 0 check (text_version >= 0),
  published_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint translations_api check ((source_kind = 'api') = (provider is not null)),
  constraint translations_api_ready check (source_kind <> 'api' or status <> 'active' or (provider_ref is not null and credential_env is not null)),
  constraint translations_rights_ready check (status <> 'active' or (rights <> 'unverified' and rights_confirmed_at is not null)),
  constraint translations_text_ready check (source_kind <> 'database' or status <> 'active' or verse_count > 0),
  constraint translations_cache_days check (allow_cache = (cache_days is not null))
);
create index translations_created_by_idx on bible.translations (created_by);
create index translations_rights_by_idx on bible.translations (rights_confirmed_by);
alter table bible.settings add constraint settings_default_translation_fk
  foreign key (default_translation_id) references bible.translations (id) on delete set null;
create index settings_default_translation_idx on bible.settings (default_translation_id);
create index settings_updated_by_idx on bible.settings (updated_by);

-- Published verse text. One row per verse of one translation; never shared
-- between translations and never edited in place (a reviewed import
-- replaces a translation's text as a whole). omitted marks a verse number
-- the translation deliberately leaves without text (e.g. a verse found only
-- in later manuscripts), confirmed during review.
create table bible.verses (
  translation_id uuid not null references bible.translations (id) on delete cascade,
  book_code text not null references bible.books (code),
  chapter smallint not null check (chapter between 1 and 150),
  verse smallint not null check (verse between 1 and 200),
  text text not null check (char_length(text) <= 4000),
  omitted boolean not null default false,
  -- A section heading printed before this verse (from the source).
  heading text check (char_length(heading) <= 300),
  para_start boolean not null default false,
  poetry boolean not null default false,
  primary key (translation_id, book_code, chapter, verse),
  constraint verses_omitted check (omitted = (btrim(text) = ''))
);
create index verses_book_idx on bible.verses (book_code);

-- Structured text imports (CSV/TSV/VPL), staged for review. Nothing here is
-- visible to members until an administrator publishes the reviewed import.
create table bible.imports (
  id uuid primary key default gen_random_uuid(),
  translation_id uuid not null references bible.translations (id) on delete cascade,
  status bible.import_status not null default 'uploading',
  format text not null check (format in ('csv', 'tsv', 'vpl')),
  path text not null unique check (path ~ '^imports/[0-9a-f-]{36}/source\.(csv|tsv|txt)$'),
  original_name text check (char_length(original_name) <= 200),
  size_bytes bigint check (size_bytes between 1 and 52428800),
  rows_staged integer not null default 0 check (rows_staged >= 0),
  -- Counts by issue (set when staging finishes): duplicate, malformed,
  -- unknown_book, out_of_range, empty, missing.
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error text check (char_length(error) <= 300),
  client_key uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  discarded_at timestamptz,
  objects_deleted_at timestamptz,
  constraint imports_published check ((status = 'published') = (published_at is not null))
);
create index imports_translation_idx on bible.imports (translation_id, created_at desc);
create index imports_created_by_idx on bible.imports (created_by);
create index imports_published_by_idx on bible.imports (published_by);
create unique index imports_client_key_idx on bible.imports (created_by, client_key) where client_key is not null;

-- One row per source line. Lines that couldn't be read keep their raw text
-- (truncated) for review; nothing is ever guessed or completed.
create table bible.staged_verses (
  import_id uuid not null references bible.imports (id) on delete cascade,
  line_no integer not null check (line_no between 1 and 1000000),
  book_code text references bible.books (code),
  chapter smallint check (chapter between 1 and 150),
  verse smallint check (verse between 1 and 200),
  text text not null default '' check (char_length(text) <= 4000),
  heading text check (char_length(heading) <= 300),
  para_start boolean not null default false,
  poetry boolean not null default false,
  -- Where the line came from in the source (e.g. "line 1234", "page 87").
  source_ref text not null check (char_length(source_ref) <= 60),
  issue text check (issue in ('malformed', 'unknown_book', 'duplicate', 'out_of_range', 'empty')),
  -- Non-blocking issues (out_of_range, empty) need explicit acceptance.
  accepted boolean not null default false,
  primary key (import_id, line_no)
);
create index staged_verses_ref_idx on bible.staged_verses (import_id, book_code, chapter, verse);
create index staged_verses_issue_idx on bible.staged_verses (import_id, issue) where issue is not null;
create index staged_verses_book_idx on bible.staged_verses (book_code);

-- Reference PDFs: kept for administrators only (never public, never shown
-- to members, never used as member-facing text).
create table bible.reference_files (
  id uuid primary key default gen_random_uuid(),
  translation_label text not null check (char_length(btrim(translation_label)) between 1 and 120),
  source text not null check (char_length(btrim(source)) between 1 and 300),
  attribution text not null default '' check (char_length(attribution) <= 1000),
  -- The administrator's statement of permission, confirmed on upload.
  rights_statement text not null check (char_length(btrim(rights_statement)) between 10 and 2000),
  rights_confirmed_by uuid references public.profiles (id) on delete set null,
  rights_confirmed_at timestamptz not null default now(),
  status bible.file_status not null default 'uploading',
  path text not null unique check (path ~ '^references/[0-9a-f-]{36}/source\.pdf$'),
  original_name text check (char_length(original_name) <= 200),
  size_bytes bigint check (size_bytes between 1 and 52428800),
  page_count integer check (page_count between 1 and 20000),
  -- Selectable text on its pages, or scanned images only (best effort).
  text_layer text check (text_layer in ('present', 'absent', 'mixed', 'unknown')),
  error text check (char_length(error) <= 300),
  client_key uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  objects_deleted_at timestamptz,
  constraint reference_files_removed check ((status = 'removed') = (removed_at is not null))
);
create index reference_files_created_by_idx on bible.reference_files (created_by);
create index reference_files_rights_by_idx on bible.reference_files (rights_confirmed_by);
create unique index reference_files_client_key_idx on bible.reference_files (created_by, client_key) where client_key is not null;

-- ---------------------------------------------------------------------------
-- Reading plans
-- ---------------------------------------------------------------------------
-- calendar: dated church-wide plan; "today" is the date in the plan's time
--           zone (the church's by default).
-- personal: numbered days from each member's own start date, in the
--           member's chosen time zone.
-- Plans with enrollments are never deleted; they are archived.
create table bible.plans (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  cover_path text unique check (cover_path ~ '^covers/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.webp$'),
  cover_alt text check (char_length(cover_alt) <= 300),
  translation_id uuid not null references bible.translations (id),
  audience text not null default 'members' check (audience in ('members', 'group')),
  group_id uuid references community.groups (id) on delete restrict,
  -- Who the plan is for, in the church's words ("Everyone", "New believers").
  audience_note text check (char_length(audience_note) <= 120),
  mode bible.plan_mode not null,
  timezone text not null default 'America/Chicago' check (char_length(timezone) <= 64),
  status bible.plan_status not null default 'draft',
  featured boolean not null default false,
  -- Bumped on every published change to assignments.
  version integer not null default 1 check (version >= 1),
  -- A plan created as the next version of an earlier one.
  previous_plan_id uuid references bible.plans (id) on delete set null,
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  client_key uuid,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_group check ((audience = 'group') = (group_id is not null)),
  constraint plans_featured check (not featured or status = 'published'),
  constraint plans_published check (status = 'draft' or published_at is not null)
);
create unique index plans_one_featured_idx on bible.plans (featured) where featured;
create index plans_status_idx on bible.plans (status, updated_at desc);
create index plans_translation_idx on bible.plans (translation_id);
create index plans_group_idx on bible.plans (group_id);
create index plans_previous_idx on bible.plans (previous_plan_id);
create index plans_created_by_idx on bible.plans (created_by);
create index plans_updated_by_idx on bible.plans (updated_by);
create index plans_published_by_idx on bible.plans (published_by);
create unique index plans_client_key_idx on bible.plans (created_by, client_key) where client_key is not null;

-- Assignments. Identifiers are stable: once a plan is published, days are
-- revised (revision + snapshot) or retired, never deleted, so completions
-- and journal entries always point at the assignment they were made for.
create table bible.plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references bible.plans (id) on delete cascade,
  day_number integer check (day_number between 1 and 2000),
  day_date date,
  kind bible.day_kind not null default 'reading',
  heading text check (char_length(heading) <= 160),
  notes text not null default '' check (char_length(notes) <= 4000),
  questions text[] not null default '{}' check (cardinality(questions) <= 5),
  -- An explicitly linked community discussion (access is rechecked on read).
  discussion_thread_id uuid references community.threads (id) on delete set null,
  revision integer not null default 1 check (revision >= 1),
  retired_at timestamptz,
  retired_reason text check (char_length(retired_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_days_one_key check ((day_number is null) <> (day_date is null)),
  constraint plan_days_retired check ((retired_at is null) = (retired_reason is null))
);
create unique index plan_days_number_idx on bible.plan_days (plan_id, day_number) where retired_at is null and day_number is not null;
create unique index plan_days_date_idx on bible.plan_days (plan_id, day_date) where retired_at is null and day_date is not null;
create index plan_days_plan_idx on bible.plan_days (plan_id, day_date, day_number);
create index plan_days_thread_idx on bible.plan_days (discussion_thread_id);

-- Passages of a day, in order. Several passages from the same book are
-- separate rows. A null verse means the whole chapter (start) or to the end
-- of the chapter (end).
create table bible.plan_passages (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references bible.plan_days (id) on delete cascade,
  position smallint not null check (position between 1 and 20),
  book_code text not null references bible.books (code),
  start_chapter smallint not null check (start_chapter between 1 and 150),
  start_verse smallint check (start_verse between 1 and 200),
  end_chapter smallint not null check (end_chapter between 1 and 150),
  end_verse smallint check (end_verse between 1 and 200),
  label text not null check (char_length(label) between 1 and 80),
  unique (day_id, position),
  constraint plan_passages_order check (
    end_chapter > start_chapter
    or (end_chapter = start_chapter and (start_verse is null or end_verse is null or end_verse >= start_verse))),
  constraint plan_passages_whole check ((start_verse is null) = (end_verse is null) or end_chapter > start_chapter)
);
create index plan_passages_book_idx on bible.plan_passages (book_code);

-- Related published devotionals or Sunday lessons (shown only when visible).
create table bible.plan_day_links (
  day_id uuid not null references bible.plan_days (id) on delete cascade,
  media_item_id uuid not null references media.items (id) on delete cascade,
  position smallint not null default 1 check (position between 1 and 10),
  primary key (day_id, media_item_id)
);
create index plan_day_links_item_idx on bible.plan_day_links (media_item_id);

-- What each earlier revision of a day contained (passages, kind, heading),
-- so a completion or journal entry made for revision N can always show it.
create table bible.day_revisions (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references bible.plan_days (id) on delete cascade,
  revision integer not null check (revision >= 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  reason text check (char_length(reason) <= 500),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (day_id, revision)
);
create index day_revisions_changed_by_idx on bible.day_revisions (changed_by);

-- Change log for plan managers (assignments are not private; journal and
-- progress data never appear here).
create table bible.plan_changes (
  id bigint generated always as identity primary key,
  plan_id uuid not null references bible.plans (id) on delete cascade,
  day_id uuid references bible.plan_days (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+$'),
  reason text check (char_length(reason) <= 500),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index plan_changes_plan_idx on bible.plan_changes (plan_id, created_at desc);
create index plan_changes_day_idx on bible.plan_changes (day_id);
create index plan_changes_actor_idx on bible.plan_changes (actor_id);

-- CSV imports for a draft plan: validated rows held for preview until the
-- editor confirms (or discards; previews expire after a day).
create table bible.plan_imports (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references bible.plans (id) on delete cascade,
  status text not null default 'previewed' check (status in ('previewed', 'applied', 'discarded')),
  file_name text check (char_length(file_name) <= 200),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  mode text check (mode in ('add', 'replace')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index plan_imports_plan_idx on bible.plan_imports (plan_id, created_at desc);
create index plan_imports_created_by_idx on bible.plan_imports (created_by);

-- ---------------------------------------------------------------------------
-- Member data: private to its owner (no staff function reads it)
-- ---------------------------------------------------------------------------
create table bible.enrollments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references bible.plans (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'left')),
  is_primary boolean not null default false,
  -- personal plans: day 1 is start_date in the member's time zone.
  start_date date,
  -- calendar plans joined midyear: readings before this date aren't counted
  -- as missed (null = count from the beginning, chosen by the member).
  expect_from date,
  timezone text not null check (char_length(timezone) <= 64),
  reminders boolean not null default false,
  reminder_time time not null default '07:00',
  reminders_paused boolean not null default false,
  last_reminded_on date,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (plan_id, profile_id),
  constraint enrollments_left check ((status = 'left') = (left_at is not null)),
  constraint enrollments_primary check (not is_primary or status = 'active')
);
create unique index enrollments_one_primary_idx on bible.enrollments (profile_id) where is_primary;
create index enrollments_profile_idx on bible.enrollments (profile_id, status);
create index enrollments_reminder_idx on bible.enrollments (plan_id) where status = 'active' and reminders and not reminders_paused;

-- Completion of one assignment, tied to the revision that was read. Days
-- can't be deleted while completions point at them (no orphaned history).
create table bible.completions (
  enrollment_id uuid not null references bible.enrollments (id) on delete cascade,
  day_id uuid not null references bible.plan_days (id) on delete restrict,
  revision integer not null check (revision >= 1),
  completed_at timestamptz not null default now(),
  primary key (enrollment_id, day_id)
);
create index completions_day_idx on bible.completions (day_id);

-- Private bookmarks of a passage (translation + verse identifiers) or of an
-- assignment. Never stored on shared scripture rows.
create table bible.bookmarks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('passage', 'assignment')),
  translation_id uuid references bible.translations (id) on delete cascade,
  book_code text references bible.books (code),
  chapter smallint check (chapter between 1 and 150),
  start_verse smallint check (start_verse between 1 and 200),
  end_verse smallint check (end_verse between 1 and 200),
  day_id uuid references bible.plan_days (id) on delete cascade,
  label text check (char_length(label) <= 120),
  created_at timestamptz not null default now(),
  constraint bookmarks_passage check (kind <> 'passage' or (translation_id is not null and book_code is not null and chapter is not null)),
  constraint bookmarks_assignment check ((kind = 'assignment') = (day_id is not null)),
  constraint bookmarks_verses check (end_verse is null or (start_verse is not null and end_verse >= start_verse))
);
create unique index bookmarks_unique_idx on bible.bookmarks (profile_id, kind, translation_id, book_code, chapter, start_verse, end_verse, day_id) nulls not distinct;
create index bookmarks_profile_idx on bible.bookmarks (profile_id, created_at desc);
create index bookmarks_translation_idx on bible.bookmarks (translation_id);
create index bookmarks_day_idx on bible.bookmarks (day_id);
create index bookmarks_book_idx on bible.bookmarks (book_code);

create table bible.highlights (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  translation_id uuid not null references bible.translations (id) on delete cascade,
  book_code text not null references bible.books (code),
  chapter smallint not null check (chapter between 1 and 150),
  verse smallint not null check (verse between 1 and 200),
  color bible.highlight_color not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, translation_id, book_code, chapter, verse)
);
create index highlights_translation_idx on bible.highlights (translation_id);
create index highlights_book_idx on bible.highlights (book_code);

-- Reader settings: presentation only, kept apart from scripture content.
create table bible.reader_prefs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  text_size smallint not null default 100 check (text_size between 85 and 200),
  line_spacing numeric(3, 2) not null default 1.70 check (line_spacing between 1.30 and 2.20),
  verse_numbers boolean not null default true,
  translation_id uuid references bible.translations (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index reader_prefs_translation_idx on bible.reader_prefs (translation_id);

-- ---------------------------------------------------------------------------
-- Journals (owner only)
-- ---------------------------------------------------------------------------
-- Text is stored as written (a small Markdown subset rendered safely). No
-- staff function, report, search index, notification, or log ever reads
-- title or body. This is access control, not end-to-end encryption: the
-- database operator can technically read the rows.
create table journal.entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 100000),
  status text not null default 'active' check (status in ('active', 'archived')),
  -- Optimistic concurrency: every save names the version it edited.
  version integer not null default 1 check (version >= 1),
  client_key uuid,
  -- Optional link (references only; access to linked teaching content is
  -- rechecked whenever the entry is shown).
  link_kind text not null default 'none' check (link_kind in ('none', 'passage', 'assignment', 'devotional', 'lesson')),
  translation_id uuid references bible.translations (id) on delete set null,
  book_code text references bible.books (code),
  chapter smallint check (chapter between 1 and 150),
  start_verse smallint check (start_verse between 1 and 200),
  end_verse smallint check (end_verse between 1 and 200),
  passage_label text check (char_length(passage_label) <= 80),
  plan_id uuid references bible.plans (id) on delete set null,
  day_id uuid references bible.plan_days (id) on delete set null,
  day_revision integer check (day_revision >= 1),
  -- The reflection question being answered, as it read when chosen.
  question text check (char_length(question) <= 500),
  media_item_id uuid references media.items (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint entries_archived check ((status = 'archived') = (archived_at is not null))
);
create index entries_profile_idx on journal.entries (profile_id, status, updated_at desc);
create unique index entries_client_key_idx on journal.entries (profile_id, client_key) where client_key is not null;
create index entries_translation_idx on journal.entries (translation_id);
create index entries_book_idx on journal.entries (book_code);
create index entries_plan_idx on journal.entries (plan_id);
create index entries_day_idx on journal.entries (day_id);
create index entries_item_idx on journal.entries (media_item_id);

do $rls$
declare
  t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname in ('bible', 'journal') loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end
$rls$;

-- ---------------------------------------------------------------------------
-- Access helpers (internal; not executable by clients)
-- ---------------------------------------------------------------------------
create function bible.is_member(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and community.is_member(p_profile);
$$;

create function bible.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not bible.is_member(v_uid) then
    raise exception 'Only approved members can do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- The caller holds a capability (approved; super administrators implicitly).
create function bible.require_cap(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  if not public.has_capability(p_capability) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function bible.is_plan_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_capability('reading.edit') or public.has_capability('reading.publish');
$$;

create function bible.valid_tz(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tz is not null and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz);
$$;

create function bible.church_tz()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select timezone from public.church_settings), 'America/Chicago');
$$;

create function bible.local_today(p_tz text)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone p_tz)::date;
$$;

-- A published plan whose audience includes the person.
create function bible.plan_visible(p bible.plans, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p.id is not null and p.status = 'published' and bible.is_member(p_profile)
     and (p.audience = 'members' or community.group_member(p.group_id, p_profile));
$$;

create function bible.plan_visible_id(p_plan uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select bible.plan_visible(p, p_profile) from bible.plans p where p.id = p_plan), false);
$$;

-- An active translation (members can read only these).
create function bible.translation_active(p_translation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from bible.translations t where t.id = p_translation and t.status = 'active');
$$;

-- Last verse number of a chapter in a translation: its stored text when it
-- has any, otherwise the reference versification. Null = no such chapter.
create function bible.chapter_last_verse(p_translation uuid, p_book text, p_chapter integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from bible.translations t where t.id = p_translation and t.source_kind = 'database' and t.verse_count > 0)
      then (select max(v.verse)::integer from bible.verses v
             where v.translation_id = p_translation and v.book_code = p_book and v.chapter = p_chapter)
    else (select b.chapter_verses[p_chapter]::integer from bible.books b
           where b.code = p_book and p_chapter between 1 and cardinality(b.chapter_verses))
  end;
$$;

create function bible.chapter_count(p_translation uuid, p_book text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from bible.translations t where t.id = p_translation and t.source_kind = 'database' and t.verse_count > 0)
      then (select max(v.chapter)::integer from bible.verses v where v.translation_id = p_translation and v.book_code = p_book)
    else (select cardinality(b.chapter_verses) from bible.books b where b.code = p_book)
  end;
$$;

-- Validates one passage against a translation. Returns null when valid,
-- otherwise a member-safe reason. Nothing is reinterpreted: an unknown book,
-- chapter, or verse is an error, never a guess.
create function bible.passage_problem(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last integer;
begin
  if p_book is null or not exists (select 1 from bible.books where code = p_book) then
    return 'Unknown book.';
  end if;
  if p_sc is null or p_ec is null or p_ec < p_sc or (p_ec = p_sc and p_sv is not null and p_ev is not null and p_ev < p_sv) then
    return 'The passage ends before it starts.';
  end if;
  if (p_sv is null) <> (p_ev is null) and p_ec = p_sc then
    return 'Give both a first and a last verse, or neither.';
  end if;
  if p_ec - p_sc > 40 then
    return 'One passage can span at most 40 chapters.';
  end if;
  v_last := bible.chapter_last_verse(p_translation, p_book, p_sc);
  if v_last is null then
    return 'That chapter doesn''t exist in this translation.';
  end if;
  if p_sv is not null and p_sv > v_last then
    return 'That verse doesn''t exist in this translation.';
  end if;
  v_last := bible.chapter_last_verse(p_translation, p_book, p_ec);
  if v_last is null then
    return 'That chapter doesn''t exist in this translation.';
  end if;
  if p_ev is not null and p_ev > v_last then
    return 'That verse doesn''t exist in this translation.';
  end if;
  return null;
end;
$$;

-- "Today" for an enrollment: the plan's time zone for calendar plans, the
-- member's chosen time zone for personal plans.
create function bible.enrollment_today(e bible.enrollments, p bible.plans)
returns date
language sql
stable
set search_path = ''
as $$
  select bible.local_today(case when p.mode = 'calendar' then p.timezone else e.timezone end);
$$;

-- The day (not retired) an enrollment is scheduled to read on a date.
create function bible.day_on(e bible.enrollments, p bible.plans, p_date date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from bible.plan_days d
   where d.plan_id = p.id and d.retired_at is null
     and case when p.mode = 'calendar' then d.day_date = p_date
              else e.start_date is not null and d.day_number = (p_date - e.start_date) + 1 end
   limit 1;
$$;

-- The date an enrollment is scheduled to read a day.
create function bible.day_date_for(e bible.enrollments, d bible.plan_days)
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(d.day_date, e.start_date + (d.day_number - 1));
$$;

create function bible.audit(p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id::text, coalesce(p_details, '{}'::jsonb));
$$;

-- Display reference of a passage ("John 3:16–21", "Genesis 1–2", "Psalms 23").
create function bible.passage_label(p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_book = 'PSA' and p_ec = p_sc then 'Psalm' else b.name end || ' ' ||
         case
           when p_sv is null and p_ec = p_sc then p_sc::text
           when p_sv is null and p_ev is null then p_sc || '–' || p_ec
           when p_sv is null then p_sc || '–' || p_ec || ':' || p_ev
           when p_ec = p_sc and p_ev = p_sv then p_sc || ':' || p_sv
           when p_ec = p_sc then p_sc || ':' || p_sv || '–' || p_ev
           when p_ev is null then p_sc || ':' || p_sv || '–' || p_ec
           else p_sc || ':' || p_sv || '–' || p_ec || ':' || p_ev
         end
    from bible.books b where b.code = p_book;
$$;

-- ---------------------------------------------------------------------------
-- Storage: one private bucket for plan covers, staged text imports, and
-- reference PDFs. Nothing in it is public.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bible', 'bible', false, 52428800, array[
  'image/webp', 'application/pdf', 'text/csv', 'text/plain', 'text/tab-separated-values'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.bible_can_read_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not bible.is_member(v_uid) then
    return false;
  end if;
  if p_name like 'covers/%' then
    return bible.is_plan_manager()
        or exists (select 1 from bible.plans p where p.cover_path = p_name and bible.plan_visible(p, v_uid));
  end if;
  -- Imports and reference PDFs: source managers only.
  return public.has_capability('bible.manage');
end;
$$;

create function public.bible_can_write_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not bible.is_member(v_uid) then
    return false;
  end if;
  if p_name like 'covers/%' then
    return bible.is_plan_manager()
       and exists (select 1 from bible.plans p where p_name like 'covers/' || p.id::text || '/%');
  elsif p_name like 'imports/%' then
    return public.has_capability('bible.manage')
       and exists (select 1 from bible.imports i where i.path = p_name and i.status = 'uploading' and i.created_by = v_uid);
  elsif p_name like 'references/%' then
    return public.has_capability('bible.manage')
       and exists (select 1 from bible.reference_files f where f.path = p_name and f.status = 'uploading' and f.created_by = v_uid);
  end if;
  return false;
end;
$$;

create function public.bible_can_delete_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not bible.is_member(v_uid) then
    return false;
  end if;
  if p_name like 'covers/%' then
    return bible.is_plan_manager();
  end if;
  return public.has_capability('bible.manage');
end;
$$;

create policy "Bible files follow plan visibility and source management"
  on storage.objects for select to authenticated
  using (bucket_id = 'bible' and (select public.bible_can_read_object(storage.objects.name)));

create policy "Bible uploads only to registered paths"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'bible' and (select public.bible_can_write_object(storage.objects.name)));

create policy "Bible files removed by their managers"
  on storage.objects for delete to authenticated
  using (bucket_id = 'bible' and (select public.bible_can_delete_object(storage.objects.name)));

-- ---------------------------------------------------------------------------
-- Losing access: reads always recheck. This also removes unread reading
-- notices the person can no longer act on, and switches off reminders for
-- plans they can no longer see (a group plan after leaving the group).
-- (Defined here; the notification columns arrive in a later migration.)
-- ---------------------------------------------------------------------------
create function bible.reconcile_access(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile is null then
    return;
  end if;
  update bible.enrollments e set reminders = false, updated_at = now()
   where e.profile_id = p_profile and e.reminders
     and not bible.plan_visible_id(e.plan_id, p_profile);
  delete from community.notifications n
   where n.profile_id = p_profile and n.read_at is null
     and n.category = 'reading'
     and not community.notification_visible(n);
end;
$$;

create function bible.on_group_membership_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'active' and new.state <> 'active' then
    perform bible.reconcile_access(new.profile_id);
  end if;
  return new;
end;
$$;

create trigger group_members_bible_access
  after update of state on community.group_members
  for each row execute function bible.on_group_membership_end();

create function bible.on_profile_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.membership_status = 'approved' and new.membership_status <> 'approved' then
    perform bible.reconcile_access(new.id);
  end if;
  return new;
end;
$$;

create trigger profiles_bible_access
  after update of membership_status on public.profiles
  for each row execute function bible.on_profile_status();

revoke execute on all functions in schema bible from public, anon, authenticated;
revoke execute on function public.bible_can_read_object(text), public.bible_can_write_object(text), public.bible_can_delete_object(text) from public, anon;
grant execute on function public.bible_can_read_object(text), public.bible_can_write_object(text), public.bible_can_delete_object(text) to authenticated;
