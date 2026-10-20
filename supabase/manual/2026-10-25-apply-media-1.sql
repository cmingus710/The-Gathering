-- Phase 7 · Step 1 of 6: apply migration 20261025000100_media_schema to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Media schema, capabilities and roles, enums, tables, access helpers (one read rule for every surface), and access-loss triggers.
--
-- It copies supabase/migrations/20261025000100_media_schema.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-7).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('prayer.requests') is null or to_regclass('community.notifications') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the Phase 6 stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000400') then
    raise exception 'Nothing was changed: the previous step (20261024000400) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000100') then
    raise exception 'Nothing was changed: 20261025000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261025000100_media_schema.sql
-- =========================================================================
-- Phase 7 · Teaching, media, and shared resources: schema, capabilities, and
-- the access rules every later function uses.
--
-- Everything lives in a private `media` schema that the Data API does not
-- expose and that anon/authenticated cannot read. Visitors and members reach
-- it only through SECURITY DEFINER functions in public (media_*), which
-- recheck on every call: approved adult membership, current group
-- membership, live status (draft / scheduled / published / archived,
-- publish and expiry times, evaluated with the database clock), the
-- content's audience, and the caller's capabilities.
--
-- Audiences (media.audience)
--   public   anyone, including signed-out visitors. Only devotionals,
--            Sunday lessons, church podcast episodes, and podcast shows may
--            be public, and only when a publisher confirms it. A hosted file
--            is delivered publicly only when its asset is also approved for
--            public use (assets.public_ok); otherwise members only.
--   members  approved adult members (the default)
--   group    current active members of one group
-- Photo albums are never public (constraint).
--
-- Capabilities (super administrators hold them implicitly, like
-- announcements.manage; none of them opens finance, prayer, care, private
-- messages, or journals):
--   content.edit     create and edit drafts, preview, series/people/topics
--   content.publish  publish, schedule, unpublish, archive, feature, public
--   media.manage     media library: uploads, rights, replacement, cleanup
--   podcasts.manage  podcast shows, external feeds, the public RSS feed
--   gallery.moderate photo albums and moderation
-- Event coordinators (events.manage) may also create albums for gallery
-- moderators to curate; they cannot approve photos.

-- ---------------------------------------------------------------------------
-- Capabilities and roles
-- ---------------------------------------------------------------------------
insert into public.capabilities (key, description, available) values
  ('content.edit', 'Create and edit teaching content drafts (devotionals, lessons, episodes, reading, playlists)', true),
  ('content.publish', 'Publish, schedule, unpublish, and archive teaching content, including public content', true),
  ('media.manage', 'Upload and manage files in the media library, including rights and cleanup', true),
  ('podcasts.manage', 'Configure podcast shows, external feeds, and the public podcast feed', true),
  ('gallery.moderate', 'Manage photo albums and review member photo uploads', true);

insert into public.roles (key, name, description, assignable, sort_order) values
  ('content_publisher', 'Content publisher',
   'Edits and publishes teaching content. No member records, messages, prayer, care, or finance.', true, 80),
  ('media_manager', 'Media manager',
   'Uploads and manages files in the media library, rights details, replacement, and cleanup.', true, 81),
  ('podcast_manager', 'Podcast manager',
   'Configures church and external podcast shows and the public podcast feed.', true, 82),
  ('gallery_moderator', 'Gallery moderator',
   'Creates photo albums and reviews member photo uploads before they are shown.', true, 83);

insert into public.role_capabilities (role_key, capability_key) values
  -- Content editors (Phase 1 role) now also draft teaching content.
  ('content_editor', 'content.edit'),
  ('content_publisher', 'content.edit'),
  ('content_publisher', 'content.publish'),
  ('media_manager', 'media.manage'),
  ('podcast_manager', 'podcasts.manage'),
  ('gallery_moderator', 'gallery.moderate');

update public.roles
   set description = 'Creates and publishes announcements and drafts teaching content. Publishing teaching content needs the content publisher role. No membership or financial access.'
 where key = 'content_editor';

-- ---------------------------------------------------------------------------
-- Schema and types
-- ---------------------------------------------------------------------------
create schema media;
revoke all on schema media from public, anon, authenticated;

create type media.audience as enum ('public', 'members', 'group');
create type media.pub_status as enum ('draft', 'scheduled', 'published', 'archived');
create type media.item_kind as enum ('devotional', 'lesson', 'episode', 'book', 'assignment', 'playlist');
create type media.asset_kind as enum ('audio', 'video', 'image', 'document', 'captions', 'external_video');
create type media.asset_status as enum ('uploading', 'processing', 'ready', 'failed', 'removed');
create type media.rights as enum ('unknown', 'church_owned', 'licensed', 'permission', 'public_domain');
create type media.photo_status as enum ('uploading', 'processing', 'pending', 'approved', 'rejected', 'hidden', 'removed', 'failed');

-- ---------------------------------------------------------------------------
-- Settings (singleton)
-- ---------------------------------------------------------------------------
-- Upload limits stay at or below the Supabase Free plan's 50 MB per-file cap
-- until the church moves to a paid plan and raises the bucket limits.
create table media.settings (
  id boolean primary key default true check (id),
  audio_max_mb integer not null default 50 check (audio_max_mb between 1 and 5000),
  video_max_mb integer not null default 50 check (video_max_mb between 1 and 5000),
  document_max_mb integer not null default 20 check (document_max_mb between 1 and 200),
  image_max_mb integer not null default 20 check (image_max_mb between 1 and 50),
  -- A soft quota for the usage report (Free plan: 1 GB of storage).
  storage_quota_mb integer not null default 900 check (storage_quota_mb between 100 and 10000000),
  gallery_file_mb integer not null default 20 check (gallery_file_mb between 1 and 50),
  gallery_batch_max integer not null default 20 check (gallery_batch_max between 1 and 100),
  gallery_daily_max integer not null default 60 check (gallery_daily_max between 1 and 1000),
  gallery_pending_max integer not null default 100 check (gallery_pending_max between 1 and 1000),
  feed_refresh_minutes integer not null default 360 check (feed_refresh_minutes between 60 and 10080),
  -- Uploads left unfinished this long are offered for cleanup.
  abandoned_upload_hours integer not null default 24 check (abandoned_upload_hours between 1 and 720),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into media.settings default values;

-- ---------------------------------------------------------------------------
-- Media library
-- ---------------------------------------------------------------------------
-- Files live in the private `media` bucket. External videos (YouTube/Vimeo)
-- are references only: no file, and their privacy is the provider's.
create table media.assets (
  id uuid primary key default gen_random_uuid(),
  kind media.asset_kind not null,
  status media.asset_status not null default 'uploading',
  title text not null check (char_length(btrim(title)) between 1 and 160),
  -- Storage object (bucket `media`). path is the served file; upload_path is
  -- where the browser uploads (images are re-encoded to path afterwards).
  path text unique,
  upload_path text unique,
  variant_path text unique,
  original_name text check (char_length(original_name) <= 200),
  mime text check (char_length(mime) <= 120),
  size_bytes bigint check (size_bytes >= 0),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  duration_seconds numeric(10, 2) check (duration_seconds > 0 and duration_seconds <= 86400),
  duration_source text check (duration_source in ('browser', 'server', 'feed')),
  alt_text text check (char_length(alt_text) <= 500),
  -- Captions belong to an audio or video asset.
  parent_id uuid references media.assets (id) on delete cascade,
  language text check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  label text check (char_length(label) <= 60),
  -- Plain-text transcript for audio and video (rendered as text).
  transcript text check (char_length(transcript) <= 200000),
  -- External video
  provider text check (provider in ('youtube', 'vimeo')),
  provider_ref text check (provider_ref ~ '^[A-Za-z0-9_-]{6,20}$'),
  provider_hash text check (provider_hash ~ '^[A-Za-z0-9]{6,20}$'),
  external_url text check (char_length(external_url) <= 500),
  -- Public delivery needs this as well as a public item (never automatic).
  public_ok boolean not null default false,
  -- Rights (administrative)
  rights media.rights not null default 'unknown',
  source text check (char_length(source) <= 300),
  attribution text check (char_length(attribution) <= 300),
  rights_notes text check (char_length(rights_notes) <= 1000),
  rights_confirmed_at timestamptz,
  rights_confirmed_by uuid references public.profiles (id) on delete set null,
  error text check (char_length(error) <= 300),
  client_key uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  removed_at timestamptz,
  -- When the stored objects were deleted (removal and cleanup).
  objects_deleted_at timestamptz,
  replaced_by uuid references media.assets (id) on delete set null,
  constraint assets_external check ((kind = 'external_video') = (provider is not null and provider_ref is not null)),
  constraint assets_external_no_file check (kind <> 'external_video' or (path is null and upload_path is null)),
  constraint assets_captions check ((kind = 'captions') = (parent_id is not null)),
  constraint assets_ready_file check (status <> 'ready' or kind = 'external_video' or path is not null),
  constraint assets_removed check ((status = 'removed') = (removed_at is not null))
);
create index assets_kind_idx on media.assets (kind, status, created_at desc);
create index assets_parent_idx on media.assets (parent_id);
create index assets_created_by_idx on media.assets (created_by);
create index assets_rights_by_idx on media.assets (rights_confirmed_by);
create index assets_replaced_by_idx on media.assets (replaced_by);
create unique index assets_client_key_idx on media.assets (created_by, client_key) where client_key is not null;

create table media.series (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'any' check (scope in ('any', 'lesson', 'devotional', 'episode')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  cover_asset_id uuid references media.assets (id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index series_cover_idx on media.series (cover_asset_id);

-- Speakers, authors, hosts, and contributors (names only; not member links).
create table media.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index people_name_idx on media.people (lower(btrim(name)));

create table media.topics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index topics_name_idx on media.topics (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Podcast shows (church-hosted and external)
-- ---------------------------------------------------------------------------
create table media.shows (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('church', 'external')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  author text check (char_length(author) <= 160),
  artwork_asset_id uuid references media.assets (id) on delete set null,
  -- External artwork from the publisher's feed (https only).
  artwork_url text check (artwork_url ~ '^https://' and char_length(artwork_url) <= 1000),
  website_url text check (website_url ~ '^https?://' and char_length(website_url) <= 1000),
  -- External sources: a public RSS feed and/or an official provider page.
  feed_url text check (feed_url ~ '^https?://' and char_length(feed_url) <= 1000),
  provider text check (provider in ('spotify', 'apple')),
  provider_url text check (provider_url ~ '^https://' and char_length(provider_url) <= 1000),
  provider_ref text check (char_length(provider_ref) <= 200),
  -- The administrator confirmed the publisher allows in-app playback of the
  -- audio URLs in its public feed (never downloaded or re-hosted).
  allow_stream boolean not null default false,
  status media.pub_status not null default 'draft',
  audience media.audience not null default 'members',
  group_id uuid references community.groups (id) on delete restrict,
  featured boolean not null default false,
  sort_order integer not null default 100 check (sort_order between 0 and 100000),
  -- Church show: the optional public RSS feed (iTunes fields).
  public_feed boolean not null default false,
  feed_language text not null default 'en-us' check (feed_language ~ '^[a-z]{2}(-[a-z]{2})?$'),
  feed_category text not null default 'Religion & Spirituality' check (char_length(feed_category) <= 80),
  feed_explicit boolean not null default false,
  feed_owner_email text check (feed_owner_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- External refresh state
  refresh_due_at timestamptz,
  lease_until timestamptz,
  last_fetched_at timestamptz,
  last_success_at timestamptz,
  fetch_error text check (char_length(fetch_error) <= 300),
  consecutive_failures integer not null default 0,
  etag text check (char_length(etag) <= 300),
  last_modified text check (char_length(last_modified) <= 100),
  episode_count integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint shows_group check ((audience = 'group') = (group_id is not null)),
  constraint shows_status check (status <> 'scheduled'),
  constraint shows_external_source check (kind = 'church' or feed_url is not null or provider_url is not null),
  constraint shows_church_fields check (kind = 'external' or (feed_url is null and provider_url is null and not allow_stream)),
  constraint shows_public_feed check (not public_feed or (kind = 'church' and audience = 'public'))
);
create index shows_status_idx on media.shows (status, featured desc, sort_order);
create index shows_refresh_idx on media.shows (refresh_due_at) where kind = 'external' and feed_url is not null and status <> 'archived';
create index shows_group_idx on media.shows (group_id);
create index shows_artwork_idx on media.shows (artwork_asset_id);
create index shows_created_by_idx on media.shows (created_by);
-- At most one church show publishes the public feed.
create unique index shows_one_public_feed_idx on media.shows (public_feed) where public_feed;

-- Episodes imported from an external public feed: metadata and the
-- publisher's own audio URL only. Nothing is downloaded or re-hosted.
create table media.external_episodes (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references media.shows (id) on delete cascade,
  -- Stable identity: the feed's <guid>, else the enclosure URL, else
  -- title + date (see the app's feed parser). md5 keeps the index small.
  guid text not null check (char_length(guid) between 1 and 1000),
  guid_hash text not null check (guid_hash ~ '^[0-9a-f]{32}$'),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text not null default '' check (char_length(description) <= 8000),
  link text check (link ~ '^https?://' and char_length(link) <= 1000),
  artwork_url text check (artwork_url ~ '^https://' and char_length(artwork_url) <= 1000),
  published_at timestamptz,
  duration_seconds integer check (duration_seconds between 1 and 86400),
  audio_url text check (audio_url ~ '^https://' and char_length(audio_url) <= 2000),
  audio_type text check (char_length(audio_type) <= 80),
  audio_length bigint check (audio_length >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- No longer in the publisher's feed: hidden from members.
  missing_since timestamptz,
  unique (show_id, guid_hash)
);
create index external_episodes_show_idx on media.external_episodes (show_id, published_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Content items
-- ---------------------------------------------------------------------------
-- One table for every kind, so publishing, audiences, search, bookmarks,
-- related links, and notifications share one rule. Files are attached by
-- reference (item_media), so a recording used by a lesson and a podcast
-- episode is one asset, not two copies.
create table media.items (
  id uuid primary key default gen_random_uuid(),
  kind media.item_kind not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Plain text for cards and search.
  summary text not null default '' check (char_length(summary) <= 600),
  -- Markdown (the announcement subset): devotional text, lesson summary,
  -- episode notes, book or playlist description, assignment details.
  body text not null default '' check (char_length(body) <= 40000),
  -- Lesson notes (Markdown).
  notes text not null default '' check (char_length(notes) <= 40000),
  questions text[] not null default '{}' check (cardinality(questions) <= 20),
  cover_asset_id uuid references media.assets (id) on delete set null,
  cover_alt text check (char_length(cover_alt) <= 500),
  status media.pub_status not null default 'draft',
  publish_at timestamptz,
  expires_at timestamptz,
  audience media.audience not null default 'members',
  group_id uuid references community.groups (id) on delete restrict,
  featured boolean not null default false,
  sort_order integer not null default 100 check (sort_order between 0 and 100000),
  series_id uuid references media.series (id) on delete set null,
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  -- Canonical references written by the app ("John 3:16-18").
  scripture_refs text[] not null default '{}' check (cardinality(scripture_refs) <= 20),
  -- Shown to members when the item uses licensed or borrowed material.
  attribution text check (char_length(attribution) <= 300),
  -- Kind-specific
  devotional_on date,
  delivered_on date,
  show_id uuid references media.shows (id) on delete restrict,
  episode_number integer check (episode_number between 0 and 100000),
  season_number integer check (season_number between 0 and 1000),
  book_author text check (char_length(book_author) <= 160),
  audible_url text check (audible_url ~ '^https://(www\.)?audible\.(com|co\.uk|ca|com\.au|de|fr|it|es|in|co\.jp)/' and char_length(audible_url) <= 500),
  book_current boolean not null default false,
  book_id uuid references media.items (id) on delete restrict,
  starts_on date,
  ends_on date,
  instructions text check (char_length(instructions) <= 1000),
  spotify_id text check (spotify_id ~ '^[A-Za-z0-9]{22}$'),
  -- A linked community discussion; its audience may never be broader.
  discussion_thread_id uuid references community.threads (id) on delete set null,
  -- Optional notification when the item goes live (sent once by the tick).
  notify boolean not null default false,
  notified_at timestamptz,
  first_published_at timestamptz,
  client_key uuid,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint items_group check ((audience = 'group') = (group_id is not null)),
  constraint items_public_kinds check (audience <> 'public' or kind in ('devotional', 'lesson', 'episode')),
  constraint items_live_needs_time check (status not in ('scheduled', 'published') or publish_at is not null),
  constraint items_expiry check (expires_at is null or publish_at is null or expires_at > publish_at),
  constraint items_archived check ((status = 'archived') = (archived_at is not null)),
  constraint items_devotional check (kind <> 'devotional' or devotional_on is not null),
  constraint items_lesson check (kind <> 'lesson' or delivered_on is not null),
  constraint items_episode check ((kind = 'episode') = (show_id is not null)),
  constraint items_assignment check ((kind = 'assignment') = (book_id is not null) and (kind <> 'assignment' or starts_on is not null)),
  constraint items_assignment_dates check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint items_playlist check ((kind = 'playlist') = (spotify_id is not null)),
  constraint items_book_fields check (kind = 'book' or (audible_url is null and not book_current))
);
create index items_kind_live_idx on media.items (kind, status, publish_at desc);
create index items_devotional_idx on media.items (devotional_on desc) where kind = 'devotional';
create index items_lesson_idx on media.items (delivered_on desc) where kind = 'lesson';
create index items_show_idx on media.items (show_id);
create index items_book_idx on media.items (book_id);
create index items_series_idx on media.items (series_id);
create index items_group_idx on media.items (group_id);
create index items_cover_idx on media.items (cover_asset_id);
create index items_thread_idx on media.items (discussion_thread_id);
create index items_created_by_idx on media.items (created_by);
create index items_updated_by_idx on media.items (updated_by);
create index items_notify_idx on media.items (publish_at) where notify and notified_at is null;
create unique index items_client_key_idx on media.items (created_by, client_key) where client_key is not null;

create table media.item_media (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references media.items (id) on delete cascade,
  -- Restrict: an asset in use can't be deleted; replace or detach it first.
  asset_id uuid not null references media.assets (id) on delete restrict,
  role text not null check (role in ('audio', 'video', 'handout', 'slides', 'resource')),
  label text check (char_length(label) <= 120),
  -- Shown only to approved members even when the item is public.
  members_only boolean not null default false,
  sort_order integer not null default 0,
  unique (item_id, asset_id, role)
);
create unique index item_media_one_audio_idx on media.item_media (item_id) where role = 'audio';
create unique index item_media_one_video_idx on media.item_media (item_id) where role = 'video';
create index item_media_asset_idx on media.item_media (asset_id);

create table media.item_people (
  item_id uuid not null references media.items (id) on delete cascade,
  person_id uuid not null references media.people (id) on delete restrict,
  role text not null check (role in ('author', 'speaker', 'host', 'contributor')),
  sort_order integer not null default 0,
  primary key (item_id, person_id, role)
);
create index item_people_person_idx on media.item_people (person_id);

create table media.item_topics (
  item_id uuid not null references media.items (id) on delete cascade,
  topic_id uuid not null references media.topics (id) on delete cascade,
  primary key (item_id, topic_id)
);
create index item_topics_topic_idx on media.item_topics (topic_id);

-- Related content (shown from both sides, each only when visible).
create table media.item_links (
  from_item uuid not null references media.items (id) on delete cascade,
  to_item uuid not null references media.items (id) on delete cascade,
  primary key (from_item, to_item),
  constraint item_links_not_self check (from_item <> to_item)
);
create index item_links_to_idx on media.item_links (to_item);

-- ---------------------------------------------------------------------------
-- Member data: private to its owner (no administrator view)
-- ---------------------------------------------------------------------------
create table media.bookmarks (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('item', 'show')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, target_type, target_id)
);

-- Listening/viewing position. media_key is 'a:<asset id>' (church media) or
-- 'e:<external episode id>'.
create table media.progress (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  media_key text not null check (media_key ~ '^[ae]:[0-9a-f-]{36}$'),
  item_id uuid references media.items (id) on delete cascade,
  position_seconds numeric(10, 2) not null check (position_seconds >= 0 and position_seconds <= 86400),
  duration_seconds numeric(10, 2) check (duration_seconds > 0 and duration_seconds <= 86400),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (profile_id, media_key)
);
create index progress_item_idx on media.progress (item_id);
create index progress_recent_idx on media.progress (profile_id, updated_at desc);

create table media.completions (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references media.items (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);
create index completions_item_idx on media.completions (item_id);

-- Per-member choice of which new-content notices to receive.
create table media.member_prefs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  muted_kinds text[] not null default '{}'
    check (muted_kinds <@ array['devotional', 'lesson', 'episode', 'assignment', 'playlist', 'gallery']::text[]),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Photo galleries (never public)
-- ---------------------------------------------------------------------------
create table media.albums (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  album_on date,
  cover_photo_id uuid,
  -- Context only: linking an event never widens the album's audience.
  event_series_id uuid references events.series (id) on delete set null,
  audience media.audience not null default 'members',
  group_id uuid references community.groups (id) on delete restrict,
  uploads_open boolean not null default false,
  status media.pub_status not null default 'draft',
  sort_order integer not null default 100 check (sort_order between 0 and 100000),
  last_notified_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint albums_not_public check (audience <> 'public'),
  constraint albums_group check ((audience = 'group') = (group_id is not null)),
  constraint albums_status check (status <> 'scheduled')
);
create index albums_status_idx on media.albums (status, album_on desc nulls last);
create index albums_group_idx on media.albums (group_id);
create index albums_event_idx on media.albums (event_series_id);
create index albums_created_by_idx on media.albums (created_by);

-- Originals go to the restricted `media-uploads` bucket (quarantine). The
-- uploader's server action re-encodes review copies there (orientation
-- applied, sRGB, metadata stripped) and deletes the original. On approval a
-- moderator's server action re-encodes again into the `media` bucket, so
-- every served copy has passed through trusted processing.
create table media.photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references media.albums (id) on delete cascade,
  uploader_id uuid references public.profiles (id) on delete set null,
  status media.photo_status not null default 'uploading',
  caption text not null default '' check (char_length(caption) <= 500),
  alt_text text not null default '' check (char_length(alt_text) <= 500),
  permission_confirmed boolean not null default false,
  -- Moderator review of people under 18 (no automated detection).
  minors text not null default 'unreviewed' check (minors in ('unreviewed', 'none', 'permission_confirmed')),
  original_path text unique,
  review_display_path text unique,
  review_thumb_path text unique,
  display_path text unique,
  thumb_path text unique,
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  size_bytes bigint check (size_bytes >= 0),
  -- SHA-256 of the original: the same file twice in one album is refused.
  content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  client_key uuid not null,
  batch_key uuid,
  sort_order integer not null default 0,
  error text check (char_length(error) <= 300),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_reason text check (char_length(review_reason) <= 500),
  caption_edited_at timestamptz,
  -- Set when stored objects are deleted (removal, rejection, cleanup).
  objects_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint photos_approved_files check (status not in ('approved', 'hidden') or (display_path is not null and thumb_path is not null)),
  constraint photos_approved_review check (status <> 'approved' or minors <> 'unreviewed'),
  constraint photos_permission check (status in ('uploading', 'processing', 'failed') or permission_confirmed)
);
create unique index photos_client_key_idx on media.photos (uploader_id, client_key);
create unique index photos_hash_idx on media.photos (album_id, content_hash)
  where content_hash is not null and status in ('processing', 'pending', 'approved', 'hidden');
create index photos_album_idx on media.photos (album_id, status, sort_order, created_at);
create index photos_uploader_idx on media.photos (uploader_id, created_at desc);
create index photos_reviewed_by_idx on media.photos (reviewed_by);
alter table media.albums add constraint albums_cover_fk foreign key (cover_photo_id) references media.photos (id) on delete set null;
create index albums_cover_idx on media.albums (cover_photo_id);

create table media.photo_reports (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references media.photos (id) on delete cascade,
  reporter_id uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in ('removal_request', 'privacy', 'minor', 'inappropriate', 'other')),
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution text check (char_length(resolution) <= 1000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index photo_reports_status_idx on media.photo_reports (status, created_at);
create index photo_reports_photo_idx on media.photo_reports (photo_id);
create index photo_reports_reporter_idx on media.photo_reports (reporter_id);
create index photo_reports_resolved_by_idx on media.photo_reports (resolved_by);

-- Moderation actions: references and reasons only (never captions).
create table media.moderation_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  photo_id uuid,
  album_id uuid,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index media_mod_log_actor_idx on media.moderation_log (actor_id);
create index media_mod_log_created_idx on media.moderation_log (created_at desc);

-- Best-effort limits for signed-out endpoints (public audio redirects).
create table media.public_hits (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action ~ '^[a-z_]+$'),
  created_at timestamptz not null default now()
);
create index public_hits_idx on media.public_hits (key_hash, action, created_at);

do $rls$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'media' loop
    execute format('alter table media.%I enable row level security', t);
  end loop;
end
$rls$;

-- ---------------------------------------------------------------------------
-- Access helpers (internal; not executable by clients)
-- ---------------------------------------------------------------------------
create function media.is_member(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and community.is_member(p_profile);
$$;

create function media.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not media.is_member(v_uid) then
    raise exception 'Only approved members can do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- The caller holds a capability (approved; super administrators implicitly).
create function media.require_cap(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if not public.has_capability(p_capability) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Library and preview access: anyone who manages teaching or media content.
create function media.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_capability('media.manage') or public.has_capability('content.edit')
      or public.has_capability('content.publish') or public.has_capability('podcasts.manage');
$$;

create function media.audience_allows(p_audience media.audience, p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_audience
    when 'public' then true
    when 'members' then media.is_member(p_profile)
    when 'group' then p_profile is not null and community.group_member(p_group, p_profile)
    else false
  end;
$$;

-- Live: published or scheduled, publish time reached (database clock), not
-- expired. No job is needed for scheduling.
create function media.is_live(p_status media.pub_status, p_publish timestamptz, p_expires timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('scheduled', 'published') and p_publish is not null and p_publish <= now()
     and (p_expires is null or p_expires > now());
$$;

create function media.show_visible(s media.shows, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select s.id is not null and s.status = 'published' and media.audience_allows(s.audience, s.group_id, p_profile);
$$;

-- The single read rule for content.
create function media.item_visible(i media.items, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select i.id is not null
     and media.is_live(i.status, i.publish_at, i.expires_at)
     and media.audience_allows(i.audience, i.group_id, p_profile)
     and (i.kind <> 'episode' or exists (select 1 from media.shows s where s.id = i.show_id and media.show_visible(s, p_profile)));
$$;

create function media.item_visible_id(p_item uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select media.item_visible(i, p_profile) from media.items i where i.id = p_item), false);
$$;

-- A file attached to an item: visible with the item, except that on a
-- public item a file not approved for public use (or marked members-only)
-- reaches approved members only. Widening an item never publishes its files.
create function media.attachment_visible(i media.items, p_members_only boolean, p_public_ok boolean, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select media.item_visible(i, p_profile)
     and ((i.audience <> 'public' and not p_members_only)
          or (i.audience = 'public' and not p_members_only and p_public_ok)
          or media.is_member(p_profile));
$$;

create function media.album_visible(a media.albums, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a.id is not null and a.status = 'published' and a.audience <> 'public'
     and media.audience_allows(a.audience, a.group_id, p_profile);
$$;

create function media.photo_visible(ph media.photos, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select ph.status = 'approved'
     and exists (select 1 from media.albums a where a.id = ph.album_id and media.album_visible(a, p_profile));
$$;

-- Whether a file asset is used somewhere the person may see it.
create function media.asset_used_visibly(p_asset uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from media.assets a
     where a.id = p_asset and a.status = 'ready'
       and (exists (select 1 from media.item_media im join media.items i on i.id = im.item_id
                     where im.asset_id = a.id and media.attachment_visible(i, im.members_only, a.public_ok, p_profile))
            or exists (select 1 from media.items i
                        where i.cover_asset_id = a.id and media.attachment_visible(i, false, a.public_ok, p_profile))
            or exists (select 1 from media.shows s
                        where s.artwork_asset_id = a.id and media.show_visible(s, p_profile)
                          and (s.audience <> 'public' or a.public_ok or media.is_member(p_profile)))
            or exists (select 1 from media.series sr
                        where sr.cover_asset_id = a.id
                          and (a.public_ok or media.is_member(p_profile))
                          and exists (select 1 from media.items i where i.series_id = sr.id and media.item_visible(i, p_profile)))));
$$;

-- Captions follow their audio/video.
create function media.asset_visible(p_asset uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when a.kind = 'captions'
                then a.status = 'ready' and media.asset_used_visibly(a.parent_id, p_profile)
                else media.asset_used_visibly(a.id, p_profile) end
      from media.assets a where a.id = p_asset), false);
$$;

-- Whether a community discussion's audience fits inside a content
-- audience (never broader). Church-wide threads reach approved members.
create function media.thread_fits(p_thread uuid, p_audience media.audience, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_thread is null or exists (
    select 1 from community.threads t
     where t.id = p_thread and t.status <> 'deleted'
       and (case p_audience
              when 'group' then t.group_id = p_group
              else true end));
$$;

create function media.audit(p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id::text, coalesce(p_details, '{}'::jsonb));
$$;

create function media.like_pattern(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(btrim(coalesce(p, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

create function media.church_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select timezone from public.church_settings), 'America/Chicago'))::date;
$$;

-- ---------------------------------------------------------------------------
-- Losing access: reads always recheck, so access ends at once. This also
-- removes unread teaching/gallery notices the person can no longer see.
-- (Defined here; the notification columns arrive in a later migration, so
-- it is created as plpgsql and only runs after that migration.)
-- ---------------------------------------------------------------------------
create function media.reconcile_access(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile is null then
    return;
  end if;
  delete from community.notifications n
   where n.profile_id = p_profile and n.read_at is null
     and n.category in ('teaching', 'gallery')
     and not community.notification_visible(n);
end;
$$;

create function media.on_group_membership_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'active' and new.state <> 'active' then
    perform media.reconcile_access(new.profile_id);
  end if;
  return new;
end;
$$;

create trigger group_members_media_access
  after update of state on community.group_members
  for each row execute function media.on_group_membership_end();

create function media.on_profile_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.membership_status = 'approved' and new.membership_status <> 'approved' then
    perform media.reconcile_access(new.id);
  end if;
  return new;
end;
$$;

create trigger profiles_media_access
  after update of membership_status on public.profiles
  for each row execute function media.on_profile_status();

revoke execute on all functions in schema media from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261025000100', 'media_schema', 'phase-7');

commit;
