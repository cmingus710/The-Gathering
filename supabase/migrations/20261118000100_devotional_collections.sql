-- Devotionals · imported collections (Morning & Evening by Charles Spurgeon).
--
-- Schema only. This migration creates no collection and no readings: the
-- text is brought in afterwards by a content publisher with the import on
-- Admin → Teaching content → Collections (dry run, staging, then one
-- all-or-nothing apply), never by a migration. See docs/morning-evening.md.
--
-- A collection is a set of readings for each calendar day (month/day,
-- morning/evening, no year) that repeats every year. It lives beside the
-- church's own devotionals (media.items kind 'devotional'), not among them,
-- so the archive, search, home sections, and notices for church devotionals
-- are unchanged and are never flooded with 732 imported readings.
--
--   media.collections            title, card line, author, description, cover
--                                (a media library image), audience, status
--                                (draft / published), the enabled switch,
--                                and provenance (source repository, commit,
--                                file hash, licence notice, text source).
--   media.collection_imports     one row per import: the dry-run report, the
--                                result (inserted / updated / unchanged /
--                                kept edits / conflicts), who and when.
--   media.collection_import_rows the staged readings of an import.
--   media.collection_readings    one row per calendar reading, with a stable
--                                id and a stable source key ("01-01-morning");
--                                unique per collection and per (month, day,
--                                slot), so a rerun can't create duplicates.
--                                The text as last imported is kept beside
--                                the current text: they differ only after an
--                                editor's correction, which a rerun never
--                                overwrites (it reports a conflict instead).
--   media.collection_reading_revisions  the earlier text of every change.
--
-- Read rule (media.collection_visible): enabled AND published AND publish
-- time reached AND the audience allows the caller (approved adult members,
-- or one group's active members; never public, so visitors and youth
-- accounts get nothing, exactly like members-only church devotionals).
-- Every member function, search, direct link, cover image, and journal
-- preview applies it at the moment of the call.
--
-- My Journal: link kind 'collection_reading' with the reading and the
-- calendar date the member reflected on. One reflection per member, reading,
-- and date (unique index); a second "Reflect" opens the first. Reflections
-- in different years are different dates, so they stay distinct. Removing a
-- collection keeps every journal entry's text (the link is set to null).
--
-- Nothing here sends email, push, or in-app notices, or writes community
-- feed entries: the tables aren't read by media.tick or any notifier.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table media.collections (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  -- The card's second line ("Daily readings by Charles Spurgeon").
  subtitle text not null default '' check (char_length(subtitle) <= 160),
  author text not null default '' check (char_length(author) <= 160),
  description text not null default '' check (char_length(description) <= 4000),
  cover_asset_id uuid references media.assets (id) on delete set null,
  cover_alt text check (char_length(cover_alt) <= 500),
  status media.pub_status not null default 'draft' check (status in ('draft', 'published')),
  -- Hide/show without unpublishing. Members see a collection only while it
  -- is enabled AND published.
  enabled boolean not null default false,
  publish_at timestamptz,
  first_published_at timestamptz,
  audience media.audience not null default 'members' check (audience in ('members', 'group')),
  group_id uuid references community.groups (id) on delete restrict,
  sort_order integer not null default 100 check (sort_order between 0 and 100000),
  -- Provenance (written by the import; shown to members and editors).
  attribution text not null default '' check (char_length(attribution) <= 600),
  rights media.rights not null default 'unknown',
  rights_statement text not null default '' check (char_length(rights_statement) <= 1000),
  text_source_url text check (text_source_url ~ '^https://' and char_length(text_source_url) <= 500),
  upstream_url text check (upstream_url ~ '^https://' and char_length(upstream_url) <= 500),
  source_repository text check (source_repository ~ '^https://' and char_length(source_repository) <= 500),
  source_commit text check (source_commit ~ '^[0-9a-f]{40}$'),
  source_path text check (char_length(source_path) <= 300),
  source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_license text check (char_length(source_license) <= 80),
  source_license_notice text check (char_length(source_license_notice) <= 1000),
  imported_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_group check ((audience = 'group') = (group_id is not null)),
  constraint collections_published_time check (status <> 'published' or publish_at is not null)
);
create index collections_cover_idx on media.collections (cover_asset_id);
create index collections_group_idx on media.collections (group_id);
create index collections_created_by_idx on media.collections (created_by);
create index collections_updated_by_idx on media.collections (updated_by);

create table media.collection_imports (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references media.collections (id) on delete cascade,
  status text not null default 'staging' check (status in ('staging', 'applied', 'failed', 'discarded')),
  source_repository text not null check (char_length(source_repository) <= 500),
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
  source_path text not null check (char_length(source_path) <= 300),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  expected_count integer not null check (expected_count between 1 and 2000),
  -- The normalizer's dry-run report (counts, coverage, corrections, warnings).
  report jsonb not null default '{}'::jsonb,
  -- What the apply did: counts and the source keys of conflicts.
  result jsonb,
  error text check (char_length(error) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint collection_imports_finished check ((status = 'staging') = (finished_at is null))
);
create index collection_imports_collection_idx on media.collection_imports (collection_id, created_at desc);
create index collection_imports_created_by_idx on media.collection_imports (created_by);
-- At most one import in progress per collection.
create unique index collection_imports_one_staging_idx on media.collection_imports (collection_id) where status = 'staging';

create table media.collection_import_rows (
  import_id uuid not null references media.collection_imports (id) on delete cascade,
  source_key text not null check (source_key ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-(morning|evening)$'),
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  slot text not null check (slot in ('morning', 'evening')),
  key_verse text not null check (char_length(key_verse) <= 1000),
  scripture_ref text not null check (char_length(scripture_ref) <= 120),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  primary key (import_id, source_key),
  constraint import_rows_key check (source_key = lpad(month::text, 2, '0') || '-' || lpad(day::text, 2, '0') || '-' || slot),
  constraint import_rows_calendar check (day <= case month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)
);

create table media.collection_readings (
  -- Stable: links, search results, and journal reflections point here, and an
  -- import or an edit never replaces the row.
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references media.collections (id) on delete cascade,
  source_key text not null check (source_key ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-(morning|evening)$'),
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  slot text not null check (slot in ('morning', 'evening')),
  key_verse text not null check (char_length(key_verse) <= 1000),
  scripture_ref text not null check (char_length(scripture_ref) <= 120),
  -- Plain text: paragraphs separated by a blank line; lines of a hymn or
  -- poem by one line break. Rendered as text (never as HTML).
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  -- The text as last imported. Current text <> imported text = edited.
  imported_key_verse text not null,
  imported_scripture_ref text not null,
  imported_body text not null,
  import_id uuid references media.collection_imports (id) on delete set null,
  revision integer not null default 1 check (revision >= 1),
  edited_at timestamptz,
  edited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, source_key),
  unique (collection_id, month, day, slot),
  constraint readings_key check (source_key = lpad(month::text, 2, '0') || '-' || lpad(day::text, 2, '0') || '-' || slot),
  constraint readings_calendar check (day <= case month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)
);
create index collection_readings_import_idx on media.collection_readings (import_id);
create index collection_readings_edited_by_idx on media.collection_readings (edited_by);

create table media.collection_reading_revisions (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null references media.collection_readings (id) on delete cascade,
  revision integer not null,
  key_verse text not null,
  scripture_ref text not null,
  body text not null,
  -- What replaced this text: an editor's correction, a restore of the
  -- imported text, or a newer import.
  replaced_by text not null check (replaced_by in ('edit', 'restore', 'import')),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (reading_id, revision)
);
create index collection_reading_revisions_changed_by_idx on media.collection_reading_revisions (changed_by);

alter table media.collections enable row level security;
alter table media.collection_imports enable row level security;
alter table media.collection_import_rows enable row level security;
alter table media.collection_readings enable row level security;
alter table media.collection_reading_revisions enable row level security;

-- ---------------------------------------------------------------------------
-- My Journal link
-- ---------------------------------------------------------------------------
alter table journal.entries add column collection_reading_id uuid references media.collection_readings (id) on delete set null;
alter table journal.entries add column reading_date date;
alter table journal.entries drop constraint entries_link_kind_check;
alter table journal.entries add constraint entries_link_kind_check
  check (link_kind in ('none', 'passage', 'assignment', 'devotional', 'lesson', 'book', 'book_assignment', 'collection_reading'));
alter table journal.entries add constraint entries_reading_date check ((link_kind = 'collection_reading') = (reading_date is not null));
create index entries_collection_reading_idx on journal.entries (collection_reading_id);
-- One reflection per member, reading, and calendar date.
create unique index entries_one_reflection_idx on journal.entries (profile_id, collection_reading_id, reading_date)
  where collection_reading_id is not null;

-- ---------------------------------------------------------------------------
-- Access helpers (internal)
-- ---------------------------------------------------------------------------
create function media.collection_visible(c media.collections, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.id is not null and c.enabled and c.status = 'published'
     and c.publish_at is not null and c.publish_at <= now()
     and media.audience_allows(c.audience, c.group_id, p_profile);
$$;

create function media.collection_state(c media.collections)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when c.status = 'draft' then 'draft'
    when not c.enabled then 'hidden'
    when c.publish_at > now() then 'scheduled'
    else 'live' end;
$$;

-- The member's local date and hour: their notification time zone setting,
-- else the church's (community.member_tz).
create function media.member_now(p_profile uuid)
returns timestamp
language sql
stable
security definer
set search_path = ''
as $$
  select now() at time zone community.member_tz(p_profile);
$$;

create function media.reading_label(r media.collection_readings)
returns text
language sql
stable
set search_path = ''
as $$
  select trim(to_char(make_date(2000, r.month, r.day), 'FMMonth')) || ' ' || r.day || ' · ' || initcap(r.slot);
$$;

create function media.collection_cover_json(c media.collections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('asset_id', a.id, 'path', a.path, 'variant_path', a.variant_path,
                            'alt', coalesce(nullif(c.cover_alt, ''), a.alt_text, ''), 'width', a.width, 'height', a.height)
    from media.assets a
   where a.id = c.cover_asset_id and a.status = 'ready' and a.kind = 'image';
$$;

create function media.collection_json(c media.collections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'key', c.key, 'title', c.title, 'subtitle', c.subtitle, 'author', c.author, 'description', c.description,
    'cover', media.collection_cover_json(c),
    'attribution', c.attribution, 'rights', c.rights, 'rights_statement', c.rights_statement,
    'text_source_url', c.text_source_url, 'upstream_url', c.upstream_url,
    'source', jsonb_build_object('repository', c.source_repository, 'commit', c.source_commit, 'path', c.source_path,
                                 'sha256', c.source_sha256, 'license', c.source_license, 'license_notice', c.source_license_notice,
                                 'imported_at', c.imported_at));
$$;

create function media.reading_json(r media.collection_readings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'source_key', r.source_key, 'month', r.month, 'day', r.day, 'slot', r.slot,
                            'label', media.reading_label(r), 'key_verse', r.key_verse, 'scripture_ref', r.scripture_ref,
                            'body', r.body, 'updated_at', r.updated_at);
$$;

-- The cover of a visible collection is a visible use of its image.
-- Unchanged from 20261109000200 except the collections clause.
create or replace function media.asset_used_visibly(p_asset uuid, p_profile uuid)
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
                          and exists (select 1 from media.items i where i.series_id = sr.id and media.item_visible(i, p_profile)))
            or exists (select 1 from media.lesson_blocks lb join media.items i on i.id = lb.item_id
                        where lb.asset_id = a.id and lb.removed_at is null and not lb.teacher_only
                          and media.is_member(p_profile) and media.item_visible(i, p_profile))
            or exists (select 1 from media.photos ph
                        where ph.asset_id = a.id and ph.kind = 'video' and media.photo_visible(ph, p_profile))
            or exists (select 1 from media.collections c
                        where c.cover_asset_id = a.id and media.collection_visible(c, p_profile))));
$$;

-- Unchanged from 20261109000200 except the collections clause (a cover in
-- use can't be cleaned up).
create or replace function media.asset_usage(p_asset uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(u order by u ->> 'title'), '[]'::jsonb) from (
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', im.role) u
      from media.item_media im join media.items i on i.id = im.item_id where im.asset_id = p_asset
    union all
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', 'cover')
      from media.items i where i.cover_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'show', 'id', s.id, 'kind', s.kind, 'title', s.title, 'status', s.status, 'role', 'artwork')
      from media.shows s where s.artwork_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'series', 'id', sr.id, 'kind', sr.scope, 'title', sr.title, 'status', case when sr.archived then 'archived' else 'active' end, 'role', 'cover')
      from media.series sr where sr.cover_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', 'lesson block')
      from (select distinct lb.item_id from media.lesson_blocks lb where lb.asset_id = p_asset and lb.removed_at is null) x
      join media.items i on i.id = x.item_id
    union all
    select jsonb_build_object('type', 'album', 'id', al.id, 'kind', 'album', 'title', al.title, 'status', ph.status, 'role', 'album video')
      from media.photos ph join media.albums al on al.id = ph.album_id
     where ph.asset_id = p_asset and ph.status in ('pending', 'approved', 'hidden')
    union all
    select jsonb_build_object('type', 'collection', 'id', c.id, 'kind', 'collection', 'title', c.title, 'status', media.collection_state(c), 'role', 'cover')
      from media.collections c where c.cover_asset_id = p_asset
  ) x(u);
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
-- The collections the caller can open, each with today's morning and evening
-- reading (the caller's local date). Only what the devotionals page shows.
create function public.media_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  v_now timestamp := media.member_now(v_uid);
  v_today date := v_now::date;
  -- February 29 readings fall on February 28 in a common year (beside it).
  v_month integer := extract(month from v_today);
  v_day integer := extract(day from v_today);
begin
  return jsonb_build_object(
    'today', v_today,
    'local_hour', extract(hour from v_now)::integer,
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'key', c.key, 'title', c.title, 'subtitle', c.subtitle, 'author', c.author,
               'cover', media.collection_cover_json(c),
               'today', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'slot', r.slot, 'label', media.reading_label(r),
                                                                      'key_verse', r.key_verse, 'scripture_ref', r.scripture_ref) order by r.slot desc)
                                    from media.collection_readings r
                                   where r.collection_id = c.id and r.month = v_month and r.day = v_day), '[]'::jsonb))
             order by c.sort_order, c.title)
        from media.collections c where media.collection_visible(c, v_uid)), '[]'::jsonb));
end;
$$;

-- One screen of a collection: the reading for a calendar date and slot.
-- p_date null = the caller's today; p_slot null = morning, or evening from
-- 5 p.m. local time when the date is today. Not found (P0002) when the
-- collection isn't visible to the caller.
create function public.media_collection_day(p_key text, p_date date default null, p_slot text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  c media.collections;
  v_now timestamp := media.member_now(v_uid);
  v_today date := v_now::date;
  v_date date := coalesce(p_date, v_today);
  v_slot text;
  r media.collection_readings;
  v_leap boolean;
begin
  select * into c from media.collections where key = p_key;
  if not media.collection_visible(c, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if v_date < date '1900-01-01' or v_date > date '2200-12-31' then
    v_date := v_today;
  end if;
  v_slot := case when p_slot in ('morning', 'evening') then p_slot
                 when v_date = v_today and extract(hour from v_now) >= 17 then 'evening'
                 else 'morning' end;
  select * into r from media.collection_readings x
   where x.collection_id = c.id and x.month = extract(month from v_date) and x.day = extract(day from v_date) and x.slot = v_slot;
  -- February 28 of a common year also offers the February 29 readings.
  v_leap := extract(month from v_date) = 2 and extract(day from v_date) = 28
            and extract(day from (date_trunc('year', v_date) + interval '1 month 28 days'))::integer <> 29;
  return jsonb_build_object(
    'collection', media.collection_json(c),
    'today', v_today,
    'local_hour', extract(hour from v_now)::integer,
    'timezone', community.member_tz(v_uid),
    'date', v_date,
    'slot', v_slot,
    'reading', case when r.id is not null then media.reading_json(r) end,
    'leap_day', case when v_leap then coalesce((
       select jsonb_agg(jsonb_build_object('id', x.id, 'slot', x.slot, 'label', media.reading_label(x), 'scripture_ref', x.scripture_ref) order by x.slot desc)
         from media.collection_readings x where x.collection_id = c.id and x.month = 2 and x.day = 29), '[]'::jsonb) end);
end;
$$;

-- A reading by its stable id (direct links, search results, the journal).
create function public.media_collection_reading(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  r media.collection_readings;
  c media.collections;
  v_now timestamp := media.member_now(v_uid);
begin
  select * into r from media.collection_readings where id = p_id;
  select * into c from media.collections where id = r.collection_id;
  if r.id is null or not media.collection_visible(c, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('collection', media.collection_json(c), 'today', v_now::date, 'local_hour', extract(hour from v_now)::integer,
                            'timezone', community.member_tz(v_uid), 'reading', media.reading_json(r));
end;
$$;

-- Search one collection's key verses, references, and text (LIKE wildcards
-- are literal). Results carry the calendar day and morning/evening.
-- Volatile, not stable: it records a rate-limit hit, and PostgREST runs
-- stable functions in a read-only transaction.
create function public.media_collection_search(p_key text, p_q text, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  c media.collections;
  v_q text := left(btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g')), 100);
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  select * into c from media.collections where key = p_key;
  if not media.collection_visible(c, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if char_length(v_q) < 2 then
    return jsonb_build_object('q', v_q, 'total', 0, 'items', '[]'::jsonb);
  end if;
  perform community.rate_limit(v_uid, 'collection_search', 120, interval '10 minutes');
  v_pattern := media.like_pattern(v_q);
  return jsonb_build_object(
    'q', v_q,
    'total', (select count(*) from media.collection_readings r
               where r.collection_id = c.id and (r.key_verse ilike v_pattern or r.scripture_ref ilike v_pattern or r.body ilike v_pattern)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'month', r.month, 'day', r.day, 'slot', r.slot, 'label', media.reading_label(r),
               'key_verse', r.key_verse, 'scripture_ref', r.scripture_ref,
               'snippet', case when strpos(lower(r.body), lower(v_q)) > 0
                               then (case when strpos(lower(r.body), lower(v_q)) > 70 then '…' else '' end)
                                    || substr(regexp_replace(r.body, '\s+', ' ', 'g'), greatest(strpos(lower(regexp_replace(r.body, '\s+', ' ', 'g')), lower(v_q)) - 70, 1), 200) || '…'
                               else left(regexp_replace(r.body, '\s+', ' ', 'g'), 160) || '…' end)
             order by r.month, r.day, r.slot desc)
        from (select * from media.collection_readings r
               where r.collection_id = c.id and (r.key_verse ilike v_pattern or r.scripture_ref ilike v_pattern or r.body ilike v_pattern)
               order by r.month, r.day, r.slot desc
               limit v_limit offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- My Journal
-- ---------------------------------------------------------------------------
-- Unchanged from 20261026000500 except the 'collection_reading' branch: the
-- reading is named only while the owner can still open its collection; the
-- reflection's own date is always shown (it's the member's own data).
create or replace function journal.link_json(e journal.entries)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case e.link_kind
    when 'none' then null
    when 'passage' then jsonb_build_object(
      'kind', 'passage', 'label', e.passage_label,
      'translation_code', (select t.code from bible.translations t where t.id = e.translation_id),
      'translation_id', e.translation_id, 'book', e.book_code, 'chapter', e.chapter,
      'start_verse', e.start_verse, 'end_verse', e.end_verse,
      'available', e.translation_id is not null and bible.translation_active(e.translation_id))
    when 'assignment' then (
      select jsonb_build_object(
        'kind', 'assignment', 'question', e.question, 'revision', e.day_revision,
        'available', d.id is not null and p.id is not null and bible.member_can_read_plan(p, e.profile_id),
        'day_id', case when bible.member_can_read_plan(p, e.profile_id) then d.id end,
        'label', case when bible.member_can_read_plan(p, e.profile_id) then bible.day_label(d) end,
        'plan_title', case when bible.member_can_read_plan(p, e.profile_id) then p.title end,
        'passages', case when bible.member_can_read_plan(p, e.profile_id) then
                      coalesce((select r.snapshot -> 'passages' from bible.day_revisions r where r.day_id = d.id and r.revision = e.day_revision),
                               (select coalesce(jsonb_agg(jsonb_build_object('label', pp.label) order by pp.position), '[]'::jsonb)
                                  from bible.plan_passages pp where pp.day_id = d.id)) end,
        'changed_since', d.id is not null and e.day_revision is not null and d.revision <> e.day_revision)
        from (select 1) one
        left join bible.plan_days d on d.id = e.day_id
        left join bible.plans p on p.id = d.plan_id)
    when 'collection_reading' then (
      select jsonb_build_object('kind', 'collection_reading', 'reading_date', e.reading_date,
                                'available', r.id is not null and media.collection_visible(c, e.profile_id),
                                'reading_id', case when media.collection_visible(c, e.profile_id) then r.id end,
                                'collection_key', case when media.collection_visible(c, e.profile_id) then c.key end,
                                'title', case when media.collection_visible(c, e.profile_id) then c.title end,
                                'label', case when media.collection_visible(c, e.profile_id) then media.reading_label(r) end,
                                'scripture_ref', case when media.collection_visible(c, e.profile_id) then r.scripture_ref end)
        from (select 1) one
        left join media.collection_readings r on r.id = e.collection_reading_id
        left join media.collections c on c.id = r.collection_id)
    else (
      select jsonb_build_object('kind', e.link_kind,
                                'available', i.id is not null and media.item_visible(i, e.profile_id),
                                'item_id', case when media.item_visible(i, e.profile_id) then i.id end,
                                'title', case when media.item_visible(i, e.profile_id) then i.title end)
        from (select 1) one left join media.items i on i.id = e.media_item_id)
  end;
$$;

-- Unchanged from 20261026000500 except the collection_reading_id filter
-- (optionally with reading_date): "Your reflection" beside a reading.
create or replace function public.journal_linked(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'excerpt', left(regexp_replace(e.body, '\s+', ' ', 'g'), 140),
                                        'updated_at', e.updated_at, 'question', e.question, 'reading_date', e.reading_date,
                                        'status', e.status) order by e.updated_at desc)
      from (select * from journal.entries e
             where e.profile_id = v_uid and e.status = 'active'
               and ((p ? 'day_id' and e.day_id = (p ->> 'day_id')::uuid)
                    or (p ? 'media_item_id' and e.media_item_id = (p ->> 'media_item_id')::uuid)
                    or (p ? 'book' and e.link_kind = 'passage' and e.translation_id = (p ->> 'translation_id')::uuid
                        and e.book_code = p ->> 'book' and e.chapter = (p ->> 'chapter')::integer)
                    or (p ? 'collection_reading_id' and e.collection_reading_id = (p ->> 'collection_reading_id')::uuid
                        and (not p ? 'reading_date' or e.reading_date = (p ->> 'reading_date')::date)))
             order by e.updated_at desc limit 20) e), '[]'::jsonb);
end;
$$;

-- The caller's reflection on one reading for one date, active or archived,
-- so "Reflect in My Journal" opens it instead of starting a second one.
create function public.journal_reading_reflection(p_reading uuid, p_date date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from journal.entries e
   where e.profile_id = bible.require_member() and e.collection_reading_id = p_reading and e.reading_date = p_date;
$$;

-- Whether a reflection date fits a reading: the same month and day, or
-- February 28 of a common year for a February 29 reading.
create function journal.reading_date_fits(r media.collection_readings, p_date date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_date between date '1900-01-01' and date '2200-12-31'
     and ((extract(month from p_date) = r.month and extract(day from p_date) = r.day)
          or (r.month = 2 and r.day = 29 and extract(month from p_date) = 2 and extract(day from p_date) = 28
              and extract(day from (date_trunc('year', p_date) + interval '1 month 28 days'))::integer <> 29));
$$;

-- Unchanged from 20261104000100 except the 'collection_reading' branch and
-- its two columns.
create or replace function public.journal_entry_create(p_client_key uuid, p_title text, p_body text, p_link jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  e journal.entries;
  v_kind text := coalesce(nullif(p_link ->> 'kind', ''), 'none');
  v_day bible.plan_days;
  v_plan bible.plans;
  v_tr uuid;
  v_book text;
  v_ch integer;
  v_sv integer;
  v_ev integer;
  v_item uuid;
  v_question text;
  v_reading media.collection_readings;
  v_collection media.collections;
  v_reading_date date;
begin
  if p_client_key is null then
    raise exception 'Missing request key.' using errcode = '22023';
  end if;
  select * into e from journal.entries where profile_id = v_uid and client_key = p_client_key;
  if found then
    return journal.entry_json(e);
  end if;
  if char_length(coalesce(p_title, '')) > 200 or char_length(coalesce(p_body, '')) > 100000 then
    raise exception 'This entry is too long to save.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'journal_create', 60, interval '10 minutes');
  if (select count(*) from journal.entries where profile_id = v_uid) >= 10000 then
    raise exception 'You have reached the journal limit. Export and delete older entries first.' using errcode = '22023';
  end if;
  case v_kind
    when 'none' then null;
    when 'passage' then
      v_tr := (p_link ->> 'translation_id')::uuid;
      v_book := p_link ->> 'book';
      v_ch := (p_link ->> 'chapter')::integer;
      v_sv := nullif(p_link ->> 'start_verse', '')::integer;
      v_ev := nullif(p_link ->> 'end_verse', '')::integer;
      if not bible.translation_active(v_tr) or bible.passage_problem(v_tr, v_book, v_ch, v_sv, v_ch, coalesce(v_ev, v_sv)) is not null then
        raise exception 'That passage can''t be linked.' using errcode = '22023';
      end if;
    when 'assignment' then
      select * into v_day from bible.plan_days where id = (p_link ->> 'day_id')::uuid;
      select * into v_plan from bible.plans where id = v_day.plan_id;
      if v_day.id is null or not bible.member_can_read_plan(v_plan, v_uid) then
        raise exception 'That reading can''t be linked.' using errcode = '22023';
      end if;
      -- Only one of the day's own reflection questions can be attached.
      if nullif(p_link ->> 'question', '') is not null then
        if (p_link ->> 'question') <> all (v_day.questions) then
          raise exception 'That question isn''t part of this reading.' using errcode = '22023';
        end if;
        v_question := p_link ->> 'question';
      end if;
    when 'devotional', 'lesson', 'book', 'book_assignment' then
      v_item := (p_link ->> 'media_item_id')::uuid;
      if not exists (select 1 from media.items i where i.id = v_item and i.kind::text = case v_kind when 'book_assignment' then 'assignment' else v_kind end and media.item_visible(i, v_uid)) then
        raise exception 'That teaching or book can''t be linked.' using errcode = '22023';
      end if;
    when 'collection_reading' then
      select * into v_reading from media.collection_readings where id = (p_link ->> 'reading_id')::uuid;
      select * into v_collection from media.collections where id = v_reading.collection_id;
      if v_reading.id is null or not media.collection_visible(v_collection, v_uid) then
        raise exception 'That reading can''t be linked.' using errcode = '22023';
      end if;
      v_reading_date := (p_link ->> 'reading_date')::date;
      if v_reading_date is null or not journal.reading_date_fits(v_reading, v_reading_date) then
        raise exception 'That date doesn''t match this reading.' using errcode = '22023';
      end if;
      if exists (select 1 from journal.entries x where x.profile_id = v_uid and x.collection_reading_id = v_reading.id and x.reading_date = v_reading_date) then
        raise exception 'You already have a reflection on this reading for this date. Open it from My Journal; this text wasn''t saved.' using errcode = '22023';
      end if;
    else
      raise exception 'Unknown link.' using errcode = '22023';
  end case;
  insert into journal.entries (profile_id, client_key, title, body, link_kind, translation_id, book_code, chapter, start_verse, end_verse,
                               passage_label, plan_id, day_id, day_revision, question, media_item_id, collection_reading_id, reading_date)
  values (v_uid, p_client_key, coalesce(p_title, ''), coalesce(p_body, ''), v_kind, v_tr, v_book, v_ch, v_sv, v_ev,
          case when v_kind = 'passage' then bible.passage_label(v_book, v_ch, v_sv, v_ch, coalesce(v_ev, v_sv)) end,
          v_plan.id, v_day.id, v_day.revision, v_question, v_item, v_reading.id, v_reading_date)
  returning * into e;
  return journal.entry_json(e);
exception
  when unique_violation then
    -- Two first saves of a reflection at once: the other one won.
    if v_kind = 'collection_reading' then
      raise exception 'You already have a reflection on this reading for this date. Open it from My Journal; this text wasn''t saved.' using errcode = '22023';
    end if;
    raise;
end;
$$;

-- Unchanged from 20261026000500 except clearing the reading link too.
create or replace function public.journal_entry_unlink(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e journal.entries := journal.require_owner(p_id);
begin
  update journal.entries set link_kind = 'none', translation_id = null, book_code = null, chapter = null, start_verse = null,
                             end_verse = null, passage_label = null, plan_id = null, day_id = null, day_revision = null,
                             question = null, media_item_id = null, collection_reading_id = null, reading_date = null, updated_at = now()
   where id = e.id;
  select * into e from journal.entries where id = e.id;
  return journal.entry_json(e);
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration (content.edit reviews and corrects; content.publish
-- imports, publishes, hides, and removes)
-- ---------------------------------------------------------------------------
create function media.collection_admin_json(c media.collections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select media.collection_json(c) || jsonb_build_object(
    'state', media.collection_state(c), 'status', c.status, 'enabled', c.enabled, 'publish_at', c.publish_at,
    'first_published_at', c.first_published_at, 'audience', c.audience, 'group_id', c.group_id,
    'group_name', (select g.name from community.groups g where g.id = c.group_id),
    'cover_asset_id', c.cover_asset_id, 'cover_alt', c.cover_alt, 'updated_at', c.updated_at,
    'readings', (select count(*) from media.collection_readings r where r.collection_id = c.id),
    'mornings', (select count(*) from media.collection_readings r where r.collection_id = c.id and r.slot = 'morning'),
    'evenings', (select count(*) from media.collection_readings r where r.collection_id = c.id and r.slot = 'evening'),
    'edited', (select count(*) from media.collection_readings r where r.collection_id = c.id
                 and (r.key_verse, r.scripture_ref, r.body) is distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body)));
$$;

create function public.media_admin_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform media.require_cap('content.edit');
  return coalesce((select jsonb_agg(media.collection_admin_json(c) order by c.sort_order, c.title) from media.collections c), '[]'::jsonb);
end;
$$;

create function public.media_admin_collection(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c media.collections;
begin
  perform media.require_cap('content.edit');
  select * into c from media.collections where id = p_id;
  if c.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return media.collection_admin_json(c) || jsonb_build_object(
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'readings', n) order by m), '[]'::jsonb)
                 from (select r.month m, count(*) n from media.collection_readings r where r.collection_id = c.id group by r.month) x),
    'imports', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'source_commit', i.source_commit,
                                                             'source_sha256', i.source_sha256, 'expected_count', i.expected_count,
                                                             'staged', (select count(*) from media.collection_import_rows x where x.import_id = i.id),
                                                             'report', i.report, 'result', i.result, 'error', i.error,
                                                             'created_at', i.created_at, 'finished_at', i.finished_at,
                                                             'created_by', community.display_name(i.created_by))
                                          order by i.created_at desc)
                           from (select * from media.collection_imports i where i.collection_id = c.id order by i.created_at desc limit 10) i), '[]'::jsonb));
end;
$$;

-- Readings for review: by month, search, or only those changed by an editor.
create function public.media_admin_collection_readings(p_id uuid, p_month integer default null, p_q text default null,
                                                       p_edited boolean default false, p_limit integer default 62, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(left(btrim(coalesce(p_q, '')), 100), '');
  v_limit integer := least(greatest(coalesce(p_limit, 62), 1), 100);
begin
  perform media.require_cap('content.edit');
  return jsonb_build_object(
    'total', (select count(*) from media.collection_readings r
               where r.collection_id = p_id and (p_month is null or r.month = p_month)
                 and (v_q is null or r.key_verse ilike media.like_pattern(v_q) or r.scripture_ref ilike media.like_pattern(v_q) or r.body ilike media.like_pattern(v_q))
                 and (not coalesce(p_edited, false)
                      or (r.key_verse, r.scripture_ref, r.body) is distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body))),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'source_key', r.source_key, 'month', r.month, 'day', r.day, 'slot', r.slot,
                                          'label', media.reading_label(r), 'key_verse', r.key_verse, 'scripture_ref', r.scripture_ref,
                                          'revision', r.revision, 'edited_at', r.edited_at,
                                          'edited', (r.key_verse, r.scripture_ref, r.body) is distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body))
                       order by r.month, r.day, r.slot desc)
        from (select * from media.collection_readings r
               where r.collection_id = p_id and (p_month is null or r.month = p_month)
                 and (v_q is null or r.key_verse ilike media.like_pattern(v_q) or r.scripture_ref ilike media.like_pattern(v_q) or r.body ilike media.like_pattern(v_q))
                 and (not coalesce(p_edited, false)
                      or (r.key_verse, r.scripture_ref, r.body) is distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body))
               order by r.month, r.day, r.slot desc
               limit v_limit offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb));
end;
$$;

create function public.media_admin_collection_reading(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r media.collection_readings;
  c media.collections;
  v_latest media.collection_imports;
  v_incoming media.collection_import_rows;
begin
  perform media.require_cap('content.edit');
  select * into r from media.collection_readings where id = p_id;
  if r.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into c from media.collections where id = r.collection_id;
  -- A newer import whose text for this reading was not applied because of an edit.
  select * into v_latest from media.collection_imports i
   where i.collection_id = c.id and i.status = 'applied' order by i.finished_at desc limit 1;
  if v_latest.id is not null and coalesce(v_latest.result -> 'conflicts', '[]'::jsonb) ? r.source_key then
    select * into v_incoming from media.collection_import_rows x where x.import_id = v_latest.id and x.source_key = r.source_key;
  end if;
  return media.reading_json(r) || jsonb_build_object(
    'collection', jsonb_build_object('id', c.id, 'key', c.key, 'title', c.title, 'state', media.collection_state(c), 'author', c.author),
    'revision', r.revision, 'edited_at', r.edited_at,
    'edited_by', community.display_name(r.edited_by),
    'edited', (r.key_verse, r.scripture_ref, r.body) is distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body),
    'imported', jsonb_build_object('key_verse', r.imported_key_verse, 'scripture_ref', r.imported_scripture_ref, 'body', r.imported_body),
    'incoming', case when v_incoming.import_id is not null then jsonb_build_object(
                  'import_id', v_incoming.import_id, 'key_verse', v_incoming.key_verse, 'scripture_ref', v_incoming.scripture_ref, 'body', v_incoming.body) end,
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('revision', v.revision, 'replaced_by', v.replaced_by, 'changed_at', v.changed_at,
                                                               'changed_by', community.display_name(v.changed_by),
                                                               'key_verse', v.key_verse, 'scripture_ref', v.scripture_ref, 'body', v.body)
                                            order by v.revision desc)
                             from media.collection_reading_revisions v where v.reading_id = r.id), '[]'::jsonb));
end;
$$;

-- Changing a reading of a live collection is a change to published content
-- (content.publish), like changing a live church devotional.
create function media.collection_reading_write(p_id uuid, p_base_revision integer)
returns media.collection_readings
language plpgsql
security definer
set search_path = ''
as $$
declare
  r media.collection_readings;
  c media.collections;
begin
  perform media.require_cap('content.edit');
  select * into r from media.collection_readings where id = p_id for update;
  if r.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into c from media.collections where id = r.collection_id;
  if c.status = 'published' and not public.has_capability('content.publish') then
    raise exception 'This collection is published. A content publisher corrects its readings.' using errcode = '42501';
  end if;
  if p_base_revision is distinct from r.revision then
    raise exception 'Someone changed this reading while you were editing. Reload it to see their change.' using errcode = '40001';
  end if;
  return r;
end;
$$;

-- A correction applies to this calendar reading in every year (readings
-- have no year). The reading keeps its id, so links and reflections stay.
create function public.media_admin_collection_reading_save(p_id uuid, p_key_verse text, p_scripture_ref text, p_body text, p_base_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r media.collection_readings := media.collection_reading_write(p_id, p_base_revision);
  v_kv text := btrim(coalesce(p_key_verse, ''));
  v_ref text := btrim(regexp_replace(coalesce(p_scripture_ref, ''), '\s+', ' ', 'g'));
  v_body text := btrim(regexp_replace(regexp_replace(coalesce(p_body, ''), E'\r\n?', E'\n', 'g'), E'\n{3,}', E'\n\n', 'g'));
begin
  if char_length(v_body) not between 1 and 20000 or char_length(v_kv) > 1000 or char_length(v_ref) > 120 then
    raise exception 'Keep the text between 1 and 20,000 characters, the key verse under 1,000, and the reference under 120.' using errcode = '22023';
  end if;
  if (v_kv, v_ref, v_body) is not distinct from (r.key_verse, r.scripture_ref, r.body) then
    return media.reading_json(r) || jsonb_build_object('revision', r.revision, 'changed', false);
  end if;
  insert into media.collection_reading_revisions (reading_id, revision, key_verse, scripture_ref, body, replaced_by, changed_by)
  values (r.id, r.revision, r.key_verse, r.scripture_ref, r.body, 'edit', (select auth.uid()));
  update media.collection_readings
     set key_verse = v_kv, scripture_ref = v_ref, body = v_body, revision = revision + 1,
         edited_at = now(), edited_by = (select auth.uid()), updated_at = now()
   where id = r.id
  returning * into r;
  perform media.audit('media.collection_reading_edited', 'collection_reading', r.id,
                      jsonb_build_object('collection_id', r.collection_id, 'source_key', r.source_key, 'revision', r.revision));
  return media.reading_json(r) || jsonb_build_object('revision', r.revision, 'changed', true);
end;
$$;

-- Back to the text as last imported (p_import null), or to the newer text of
-- an import that reported a conflict on this reading (p_import = that import).
create function public.media_admin_collection_reading_restore(p_id uuid, p_base_revision integer, p_import uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r media.collection_readings := media.collection_reading_write(p_id, p_base_revision);
  x media.collection_import_rows;
begin
  if p_import is not null then
    select ir.* into x from media.collection_import_rows ir join media.collection_imports i on i.id = ir.import_id
     where ir.import_id = p_import and ir.source_key = r.source_key and i.collection_id = r.collection_id and i.status = 'applied';
    if x.import_id is null then
      raise exception 'That imported text isn''t available.' using errcode = 'P0002';
    end if;
  else
    x.key_verse := r.imported_key_verse;
    x.scripture_ref := r.imported_scripture_ref;
    x.body := r.imported_body;
  end if;
  if (x.key_verse, x.scripture_ref, x.body) is not distinct from (r.key_verse, r.scripture_ref, r.body)
     and (x.key_verse, x.scripture_ref, x.body) is not distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body) then
    return media.reading_json(r) || jsonb_build_object('revision', r.revision, 'changed', false);
  end if;
  insert into media.collection_reading_revisions (reading_id, revision, key_verse, scripture_ref, body, replaced_by, changed_by)
  values (r.id, r.revision, r.key_verse, r.scripture_ref, r.body, 'restore', (select auth.uid()));
  update media.collection_readings
     set key_verse = x.key_verse, scripture_ref = x.scripture_ref, body = x.body,
         imported_key_verse = x.key_verse, imported_scripture_ref = x.scripture_ref, imported_body = x.body,
         import_id = coalesce(p_import, import_id), revision = revision + 1, edited_at = null, edited_by = null, updated_at = now()
   where id = r.id
  returning * into r;
  perform media.audit('media.collection_reading_restored', 'collection_reading', r.id,
                      jsonb_build_object('collection_id', r.collection_id, 'source_key', r.source_key, 'revision', r.revision, 'import_id', p_import));
  return media.reading_json(r) || jsonb_build_object('revision', r.revision, 'changed', true);
end;
$$;

-- Title, card line, description, cover, and audience. Changing the
-- audience of a published collection needs content.publish.
create function public.media_admin_collection_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c media.collections;
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_subtitle text := btrim(coalesce(p ->> 'subtitle', ''));
  v_description text := btrim(coalesce(p ->> 'description', ''));
  v_cover uuid := nullif(p ->> 'cover_asset_id', '')::uuid;
  v_alt text := nullif(btrim(coalesce(p ->> 'cover_alt', '')), '');
  v_audience media.audience := coalesce(nullif(p ->> 'audience', ''), 'members')::media.audience;
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
begin
  perform media.require_cap('content.edit');
  select * into c from media.collections where id = p_id for update;
  if c.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if char_length(v_title) not between 1 and 120 or char_length(v_subtitle) > 160 or char_length(v_description) > 4000 or char_length(v_alt) > 500 then
    raise exception 'Keep the title under 120 characters, the card line under 160, and the description under 4,000.' using errcode = '22023';
  end if;
  if v_audience not in ('members', 'group') then
    raise exception 'A collection is for members or for one group.' using errcode = '22023';
  end if;
  if v_audience <> 'group' then
    v_group := null;
  elsif v_group is null or not exists (select 1 from community.groups g where g.id = v_group) then
    raise exception 'Choose the group.' using errcode = '22023';
  end if;
  if c.status = 'published' and (v_audience, v_group) is distinct from (c.audience, c.group_id) and not public.has_capability('content.publish') then
    raise exception 'Changing who sees a published collection needs the content publisher role.' using errcode = '42501';
  end if;
  if v_cover is not null and not exists (select 1 from media.assets a where a.id = v_cover and a.kind = 'image' and a.status = 'ready') then
    raise exception 'Choose a ready image from the media library.' using errcode = '22023';
  end if;
  update media.collections
     set title = v_title, subtitle = v_subtitle, description = v_description, cover_asset_id = v_cover, cover_alt = v_alt,
         audience = v_audience, group_id = v_group, updated_at = now(), updated_by = (select auth.uid())
   where id = c.id
  returning * into c;
  perform media.audit('media.collection_updated', 'collection', c.id, jsonb_build_object('fields', array['title', 'subtitle', 'description', 'cover', 'audience']));
  return media.collection_admin_json(c);
end;
$$;

-- publish (also enables it) · unpublish (back to draft for review) ·
-- hide (members lose discovery and access; nothing is deleted) · show.
create function public.media_admin_collection_status(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c media.collections;
  v_count integer;
begin
  perform media.require_cap('content.publish');
  select * into c from media.collections where id = p_id for update;
  if c.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  case p_action
    when 'publish' then
      select count(*) into v_count from media.collection_readings where collection_id = c.id;
      if v_count = 0 then
        raise exception 'Import the readings before publishing.' using errcode = '22023';
      end if;
      if exists (select 1 from media.collection_imports i where i.collection_id = c.id and i.status = 'staging') then
        raise exception 'Finish or discard the import in progress before publishing.' using errcode = '22023';
      end if;
      update media.collections set status = 'published', enabled = true, publish_at = least(coalesce(publish_at, now()), now()),
             first_published_at = coalesce(first_published_at, now()), updated_at = now(), updated_by = (select auth.uid())
       where id = c.id returning * into c;
    when 'unpublish' then
      update media.collections set status = 'draft', updated_at = now(), updated_by = (select auth.uid()) where id = c.id returning * into c;
    when 'hide' then
      update media.collections set enabled = false, updated_at = now(), updated_by = (select auth.uid()) where id = c.id returning * into c;
    when 'show' then
      if c.status <> 'published' then
        raise exception 'Publish the collection first.' using errcode = '22023';
      end if;
      update media.collections set enabled = true, updated_at = now(), updated_by = (select auth.uid()) where id = c.id returning * into c;
    else
      raise exception 'Unknown action.' using errcode = '22023';
  end case;
  perform media.audit('media.collection_' || p_action, 'collection', c.id, jsonb_build_object('state', media.collection_state(c)));
  return media.collection_admin_json(c);
end;
$$;

-- Import, step 1: create the collection on first import (an unpublished,
-- hidden draft), or reuse it by key, and open a staging import. Any older
-- staging import of this collection is discarded first.
create function public.media_admin_collection_import_begin(p_meta jsonb, p_report jsonb, p_expected integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.publish');
  c media.collections;
  i media.collection_imports;
  v_key text := p_meta ->> 'key';
begin
  if coalesce((p_report ->> 'ok')::boolean, false) is not true then
    raise exception 'The dry run reported problems. Nothing was imported.' using errcode = '22023';
  end if;
  if p_expected is null or p_expected not between 1 and 2000 then
    raise exception 'The expected number of readings is missing.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'collection_import', 20, interval '1 hour');
  select * into c from media.collections where key = v_key for update;
  if c.id is null then
    insert into media.collections (key, title, subtitle, author, description, attribution, rights, rights_statement, text_source_url, upstream_url,
                                   source_repository, source_commit, source_path, source_sha256, source_license, source_license_notice,
                                   created_by, updated_by)
    values (v_key, p_meta ->> 'title', coalesce(p_meta ->> 'subtitle', ''), coalesce(p_meta ->> 'author', ''), coalesce(p_meta ->> 'description', ''),
            coalesce(p_meta ->> 'attribution', ''), coalesce(nullif(p_meta ->> 'rights', ''), 'unknown')::media.rights,
            coalesce(p_meta ->> 'rights_statement', ''), p_meta ->> 'text_source_url', p_meta ->> 'upstream_url',
            p_meta ->> 'source_repository', p_meta ->> 'source_commit', p_meta ->> 'source_path', p_meta ->> 'source_sha256',
            p_meta ->> 'source_license', p_meta ->> 'source_license_notice', v_uid, v_uid)
    returning * into c;
    perform media.audit('media.collection_created', 'collection', c.id, jsonb_build_object('key', c.key));
  end if;
  update media.collection_imports set status = 'discarded', finished_at = now(), error = 'Replaced by a newer import.'
   where collection_id = c.id and status = 'staging';
  insert into media.collection_imports (collection_id, source_repository, source_commit, source_path, source_sha256, expected_count, report, created_by)
  values (c.id, p_meta ->> 'source_repository', p_meta ->> 'source_commit', p_meta ->> 'source_path', p_meta ->> 'source_sha256',
          p_expected, coalesce(p_report, '{}'::jsonb), v_uid)
  returning * into i;
  return jsonb_build_object('import_id', i.id, 'collection_id', c.id);
end;
$$;

-- Import, step 2: stage readings (at most 200 per call). Staged rows touch
-- nothing members can see.
create function public.media_admin_collection_import_rows(p_import uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.publish');
  i media.collection_imports;
  v_n integer;
begin
  select * into i from media.collection_imports where id = p_import for update;
  if i.id is null or i.status <> 'staging' or i.created_by is distinct from v_uid then
    raise exception 'That import isn''t open.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'Send between 1 and 200 readings at a time.' using errcode = '22023';
  end if;
  insert into media.collection_import_rows (import_id, source_key, month, day, slot, key_verse, scripture_ref, body)
  select i.id, x ->> 'source_key', (x ->> 'month')::smallint, (x ->> 'day')::smallint, x ->> 'slot',
         coalesce(x ->> 'key_verse', ''), coalesce(x ->> 'scripture_ref', ''), x ->> 'body'
    from jsonb_array_elements(p_rows) x;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Import, step 3: apply every staged reading in this one transaction (all or
-- nothing). New readings are added; a reading nobody edited takes the new
-- source text; a reading an editor corrected keeps the correction and is
-- reported as a conflict when the source changed. Nothing is deleted, and
-- nothing sends notices.
create function public.media_admin_collection_import_apply(p_import uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.publish');
  i media.collection_imports;
  v_staged integer;
  v_result jsonb;
  v_inserted integer;
  v_updated integer;
begin
  select * into i from media.collection_imports where id = p_import for update;
  if i.id is null or i.status <> 'staging' or i.created_by is distinct from v_uid then
    raise exception 'That import isn''t open.' using errcode = 'P0002';
  end if;
  perform 1 from media.collections where id = i.collection_id for update;
  select count(*) into v_staged from media.collection_import_rows where import_id = i.id;
  if v_staged <> i.expected_count then
    raise exception 'Only % of % readings were staged. Nothing was imported; start the import again.', v_staged, i.expected_count using errcode = '22023';
  end if;

  create temporary table pg_temp.import_plan on commit drop as
  select x.*, r.id as reading_id,
         case when r.id is null then 'insert'
              when (x.key_verse, x.scripture_ref, x.body) is not distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body)
                then case when (r.key_verse, r.scripture_ref, r.body) is not distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body)
                          then 'unchanged' else 'kept_edit' end
              when (r.key_verse, r.scripture_ref, r.body) is not distinct from (r.imported_key_verse, r.imported_scripture_ref, r.imported_body)
                then 'update'
              else 'conflict' end as action
    from media.collection_import_rows x
    left join media.collection_readings r on r.collection_id = i.collection_id and r.source_key = x.source_key
   where x.import_id = i.id;

  insert into media.collection_reading_revisions (reading_id, revision, key_verse, scripture_ref, body, replaced_by, changed_by)
  select r.id, r.revision, r.key_verse, r.scripture_ref, r.body, 'import', v_uid
    from pg_temp.import_plan p join media.collection_readings r on r.id = p.reading_id
   where p.action = 'update';

  update media.collection_readings r
     set key_verse = p.key_verse, scripture_ref = p.scripture_ref, body = p.body,
         imported_key_verse = p.key_verse, imported_scripture_ref = p.scripture_ref, imported_body = p.body,
         import_id = i.id, revision = r.revision + 1, updated_at = now()
    from pg_temp.import_plan p
   where p.reading_id = r.id and p.action = 'update';
  get diagnostics v_updated = row_count;

  insert into media.collection_readings (collection_id, source_key, month, day, slot, key_verse, scripture_ref, body,
                                         imported_key_verse, imported_scripture_ref, imported_body, import_id)
  select i.collection_id, p.source_key, p.month, p.day, p.slot, p.key_verse, p.scripture_ref, p.body,
         p.key_verse, p.scripture_ref, p.body, i.id
    from pg_temp.import_plan p where p.action = 'insert';
  get diagnostics v_inserted = row_count;

  v_result := jsonb_build_object(
    'staged', v_staged,
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', (select count(*) from pg_temp.import_plan where action = 'unchanged'),
    'kept_edits', (select count(*) from pg_temp.import_plan where action = 'kept_edit'),
    'conflicts', coalesce((select jsonb_agg(source_key order by source_key) from pg_temp.import_plan where action = 'conflict'), '[]'::jsonb),
    'not_in_source', coalesce((select jsonb_agg(r.source_key order by r.source_key) from media.collection_readings r
                                where r.collection_id = i.collection_id
                                  and not exists (select 1 from media.collection_import_rows x where x.import_id = i.id and x.source_key = r.source_key)), '[]'::jsonb),
    'total', (select count(*) from media.collection_readings r where r.collection_id = i.collection_id));

  update media.collection_imports set status = 'applied', result = v_result, finished_at = now() where id = i.id;
  update media.collections
     set source_repository = i.source_repository, source_commit = i.source_commit, source_path = i.source_path,
         source_sha256 = i.source_sha256, imported_at = now(), updated_at = now(), updated_by = v_uid
   where id = i.collection_id;
  -- One audit entry per import (counts only), never one per reading.
  perform media.audit('media.collection_imported', 'collection', i.collection_id,
                      (v_result - 'conflicts' - 'not_in_source') || jsonb_build_object('import_id', i.id, 'source_commit', i.source_commit,
                        'conflicts', jsonb_array_length(v_result -> 'conflicts')));
  drop table pg_temp.import_plan;
  return v_result;
end;
$$;

-- Marks an import that couldn't be applied (the apply itself rolled back),
-- with the reason, or discards one on request. Staged rows are removed.
create function public.media_admin_collection_import_close(p_import uuid, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.publish');
begin
  if p_status not in ('failed', 'discarded') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  update media.collection_imports set status = p_status, error = left(p_error, 1000), finished_at = now()
   where id = p_import and status = 'staging' and created_by = v_uid;
  delete from media.collection_import_rows where import_id = p_import
     and exists (select 1 from media.collection_imports i where i.id = p_import and i.status in ('failed', 'discarded'));
end;
$$;

-- Removes one collection: its readings, imports, and revisions. Only while
-- members can't see it (draft or hidden), with its key typed to confirm.
-- Unrelated content is untouched, and members' journal entries keep their
-- text (their link to a removed reading reads as no longer available).
create function public.media_admin_collection_remove(p_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c media.collections;
  v_readings integer;
begin
  perform media.require_cap('content.publish');
  select * into c from media.collections where id = p_id for update;
  if c.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_confirm is distinct from c.key then
    raise exception 'Type % to confirm.', c.key using errcode = '22023';
  end if;
  if c.status = 'published' and c.enabled then
    raise exception 'Hide the collection first.' using errcode = '22023';
  end if;
  select count(*) into v_readings from media.collection_readings where collection_id = c.id;
  -- Journal entries are never counted or read here (no staff path into
  -- journals); their link is set to null by the foreign key.
  delete from media.collections where id = c.id;
  perform media.audit('media.collection_removed', 'collection', c.id, jsonb_build_object('key', c.key, 'readings', v_readings));
  return jsonb_build_object('readings', v_readings);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: approved members and staff (rechecked inside); never anon.
-- ---------------------------------------------------------------------------
revoke all on function
  media.collection_visible(media.collections, uuid), media.collection_state(media.collections), media.member_now(uuid),
  media.reading_label(media.collection_readings), media.collection_cover_json(media.collections), media.collection_json(media.collections),
  media.reading_json(media.collection_readings), media.collection_admin_json(media.collections),
  media.collection_reading_write(uuid, integer), journal.reading_date_fits(media.collection_readings, date)
from public, anon, authenticated, service_role;

revoke all on function
  public.media_collections(), public.media_collection_day(text, date, text), public.media_collection_reading(uuid),
  public.media_collection_search(text, text, integer, integer), public.journal_reading_reflection(uuid, date),
  public.media_admin_collections(), public.media_admin_collection(uuid),
  public.media_admin_collection_readings(uuid, integer, text, boolean, integer, integer), public.media_admin_collection_reading(uuid),
  public.media_admin_collection_reading_save(uuid, text, text, text, integer), public.media_admin_collection_reading_restore(uuid, integer, uuid),
  public.media_admin_collection_save(uuid, jsonb), public.media_admin_collection_status(uuid, text),
  public.media_admin_collection_import_begin(jsonb, jsonb, integer), public.media_admin_collection_import_rows(uuid, jsonb),
  public.media_admin_collection_import_apply(uuid), public.media_admin_collection_import_close(uuid, text, text),
  public.media_admin_collection_remove(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.media_collections(), public.media_collection_day(text, date, text), public.media_collection_reading(uuid),
  public.media_collection_search(text, text, integer, integer), public.journal_reading_reflection(uuid, date),
  public.media_admin_collections(), public.media_admin_collection(uuid),
  public.media_admin_collection_readings(uuid, integer, text, boolean, integer, integer), public.media_admin_collection_reading(uuid),
  public.media_admin_collection_reading_save(uuid, text, text, text, integer), public.media_admin_collection_reading_restore(uuid, integer, uuid),
  public.media_admin_collection_save(uuid, jsonb), public.media_admin_collection_status(uuid, text),
  public.media_admin_collection_import_begin(jsonb, jsonb, integer), public.media_admin_collection_import_rows(uuid, jsonb),
  public.media_admin_collection_import_apply(uuid), public.media_admin_collection_import_close(uuid, text, text),
  public.media_admin_collection_remove(uuid, text)
to authenticated;
