-- Prayer Library link catalogues · Apply migration
-- 20261130000100_prayer_link_catalog to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "Prayer Library link
-- catalogues"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: seven new tables in the private `prayer` schema (RLS on, no
-- grant to any API role), six internal helpers, and sixteen new
-- public.prayer_link_* functions granted to `authenticated` only. No
-- existing table, column, policy, grant, or function is changed. No prayer,
-- collection, category, request, or membership is touched, and nothing is
-- notified.
--
-- It creates no content: every table starts empty. A settings manager
-- imports the pinned catalogue afterwards from
-- Admin → Prayer link catalogues, which stages it and applies it in one
-- transaction. Imported links arrive unpublished and the catalogue arrives
-- as a draft, so members see nothing until someone publishes.
--
-- No prayer text is stored by anything here: a catalogue keeps a title, the
-- source's topic labels, and the address of the page each prayer is on.
--
-- It copies supabase/migrations/20261130000100_prayer_link_catalog.sql
-- verbatim and records it under its repository version
-- (created_by = prayer-link-catalog). All or nothing: one transaction; out of
-- order or a second run stops at the preflight with "Nothing was changed".
-- It needs the Prayer Library (20261115000100) for prayer.library_tsquery and
-- prayer.require_settings_manager, and the prayer schema (20261024000100) for
-- prayer.audit, prayer.like_pattern, and prayer.require_member.
begin;

do $preflight$
begin
  if to_regclass('prayer.library_prayers') is null
     or to_regprocedure('prayer.require_settings_manager()') is null
     or to_regprocedure('prayer.library_tsquery(text)') is null
     or to_regprocedure('prayer.like_pattern(text)') is null
     or to_regprocedure('prayer.audit(text, text, uuid, jsonb)') is null
     or to_regprocedure('community.clean_text(text, integer, integer, text)') is null
     or to_regprocedure('community.rate_limit(uuid, text, integer, interval)') is null then
    raise exception 'Nothing was changed: the Prayer Library step (20261115000100) is not in this database.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261115000100') then
    raise exception 'Nothing was changed: the Prayer Library step (20261115000100) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261130000100') then
    raise exception 'Nothing was changed: 20261130000100 is already applied.';
  end if;
  if to_regclass('prayer.link_catalogs') is not null then
    raise exception 'Nothing was changed: the link catalogue tables are already in this database but 20261130000100 isn''t recorded. Run 2026-11-30-record-prayer-link-catalog.sql instead.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261130000100_prayer_link_catalog.sql
-- =========================================================================
-- Prayer Library · link catalogues (additive).
--
-- A link catalogue is a prayer category whose prayers live on someone else's
-- site: the church keeps the title, the topic labels the source lists it
-- under, and the address of the page, and members open the prayer there. The
-- first one is "Catholic Online Prayers" (2,304 prayers in 111 of the
-- source's topics), imported from the pinned files under
-- data/prayers/catholic-online/.
--
-- No prayer text is stored, shown, or copied here. That is the point: the
-- church has no right to reproduce these prayers, so every catalogue carries
-- a rights statement saying titles, labels, and links only, and members see
-- an "Open prayer" link out rather than words on our page.
--
-- Separate from everything else in the Prayer Library
--   * It is not prayer.library_prayers: those are members' own contributions,
--     each with its text, its contributor, its collection, bookmarks, reports
--     and moderation. Nothing in this migration touches them, their
--     collections, their categories, prayer requests, or practical care, and
--     no library prayer is created, moved, or relabelled.
--   * Catalogue links have no contributor, cannot be edited by members,
--     cannot be bookmarked or reported, and never appear in the library's own
--     lists or search. They are browsed on their own pages.
--
-- Who can do what
--   * Approved adult members (prayer.is_member: youth accounts are refused,
--     as everywhere in prayer) browse published catalogues: the topics that
--     hold a published link, and the published links themselves, by title,
--     with search and one topic filter. Nothing else is readable.
--   * Settings managers (settings.manage, the same people who manage the
--     library's collections, topics, purposes, and uses) import a catalogue,
--     name and describe it, order it, publish or archive it, publish or
--     unpublish links one at a time or in bulk (all of a catalogue, or one
--     topic), and archive a topic. Every one of those is audited.
--   * Nobody is notified, ever: no emails, push messages, or in-app notices.
--
-- Review before anyone sees it. An imported link arrives unpublished
-- (is_published = false), as the source catalogue's own README asks, and a
-- catalogue arrives as a draft. Members see a catalogue only while it is
-- published and holds a published link, and a topic only while it holds one.
-- So importing shows members nothing until a settings manager publishes.
--
-- Importing is staged and all-or-nothing, like the devotional collection
-- import (20261118000100): begin, stage the topics, stage the links in
-- batches, then one apply inside a single transaction. A re-import of the
-- same source keeps every publishing decision already made, updates titles
-- and addresses that changed, archives topics the source dropped, and marks
-- links the source no longer lists as retired (members stop seeing them;
-- nothing is deleted).
--
-- Search: a weighted tsvector (title; topic labels and the source's name)
-- with a GIN index, rebuilt by the apply and by the topic functions. Lists
-- are ordered by title and paged with limit/offset over a stable alphabetical
-- list, and each list returns its total so a page can say how many there are.

-- ---------------------------------------------------------------------------
-- Tables (private schema, RLS on, no client grants)
-- ---------------------------------------------------------------------------
create table prayer.link_catalogs (
  id uuid primary key default gen_random_uuid(),
  -- Stable key: a catalogue is created once and re-imported under this key.
  key text not null unique check (key ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  source_name text not null check (char_length(btrim(source_name)) between 1 and 200),
  source_url text not null check (char_length(source_url) <= 500 and source_url ~ '^https?://[^\s<>"]+$'),
  -- Why no prayer text is here, shown to members on the catalogue's page.
  rights_statement text not null default '' check (char_length(rights_statement) <= 1000),
  sort_order integer not null default 1000 check (sort_order between 0 and 1000000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  archived_at timestamptz,
  -- Provenance of the last applied import.
  source_path text check (char_length(source_path) <= 300),
  source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_catalogs_published check (status <> 'published' or published_at is not null),
  constraint link_catalogs_archived check ((status = 'archived') = (archived_at is not null))
);
create unique index link_catalogs_name_idx on prayer.link_catalogs (lower(btrim(name)));
create index link_catalogs_order_idx on prayer.link_catalogs (sort_order, lower(name), id) where status = 'published';
create index link_catalogs_created_by_idx on prayer.link_catalogs (created_by);
create index link_catalogs_updated_by_idx on prayer.link_catalogs (updated_by);

-- The source's own topic labels, kept verbatim (they are its taxonomy, not
-- ours, and they overlap). Archived, never deleted, so a link keeps its label.
create table prayer.link_topics (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references prayer.link_catalogs (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  -- The source's category page, when it gave one.
  source_url text check (char_length(source_url) <= 500 and source_url ~ '^https?://[^\s<>"]+$'),
  sort_order integer not null default 1000 check (sort_order between 0 and 1000000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index link_topics_name_idx on prayer.link_topics (catalog_id, lower(btrim(name)));
create index link_topics_order_idx on prayer.link_topics (catalog_id, sort_order, lower(name), id) where archived_at is null;

create table prayer.link_prayers (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references prayer.link_catalogs (id) on delete cascade,
  -- The source's stable id, for de-duplication and later re-imports.
  source_id text not null check (char_length(btrim(source_id)) between 1 and 120),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  source_url text not null check (char_length(source_url) <= 500 and source_url ~ '^https?://[^\s<>"]+$'),
  -- False until a settings manager has reviewed it; members see published only.
  is_published boolean not null default false,
  -- Set when an import no longer lists it: members stop seeing it, and
  -- nothing is deleted.
  retired_at timestamptz,
  search tsvector not null default ''::tsvector,
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index link_prayers_source_idx on prayer.link_prayers (catalog_id, source_id);
create index link_prayers_list_idx on prayer.link_prayers (catalog_id, lower(title), id) where is_published and retired_at is null;
create index link_prayers_admin_idx on prayer.link_prayers (catalog_id, lower(title), id);
create index link_prayers_search_idx on prayer.link_prayers using gin (search);
create index link_prayers_import_idx on prayer.link_prayers (import_id);

create table prayer.link_prayer_topics (
  prayer_id uuid not null references prayer.link_prayers (id) on delete cascade,
  topic_id uuid not null references prayer.link_topics (id) on delete restrict,
  primary key (prayer_id, topic_id)
);
create index link_prayer_topics_topic_idx on prayer.link_prayer_topics (topic_id, prayer_id);

create table prayer.link_imports (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references prayer.link_catalogs (id) on delete cascade,
  status text not null default 'staging' check (status in ('staging', 'applied', 'failed', 'discarded')),
  source_path text not null check (char_length(source_path) <= 300),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  expected_count integer not null check (expected_count between 1 and 20000),
  -- The normalizer's dry-run report (counts, corrections, warnings).
  report jsonb not null default '{}'::jsonb,
  -- What the apply did: counts, and the labels and ids it changed.
  result jsonb,
  error text check (char_length(error) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint link_imports_finished check ((status = 'staging') = (finished_at is null))
);
create index link_imports_catalog_idx on prayer.link_imports (catalog_id, created_at desc);
create index link_imports_created_by_idx on prayer.link_imports (created_by);
-- At most one import in progress per catalogue.
create unique index link_imports_one_staging_idx on prayer.link_imports (catalog_id) where status = 'staging';

alter table prayer.link_prayers
  add constraint link_prayers_import_fk foreign key (import_id) references prayer.link_imports (id) on delete set null;

create table prayer.link_import_topics (
  import_id uuid not null references prayer.link_imports (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  source_url text check (char_length(source_url) <= 500),
  sort_order integer not null default 1000 check (sort_order between 0 and 1000000),
  primary key (import_id, name)
);

create table prayer.link_import_rows (
  import_id uuid not null references prayer.link_imports (id) on delete cascade,
  source_id text not null check (char_length(btrim(source_id)) between 1 and 120),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  source_url text not null check (char_length(source_url) <= 500 and source_url ~ '^https?://[^\s<>"]+$'),
  topics text[] not null check (cardinality(topics) between 1 and 10),
  primary key (import_id, source_id)
);

alter table prayer.link_catalogs enable row level security;
alter table prayer.link_topics enable row level security;
alter table prayer.link_prayers enable row level security;
alter table prayer.link_prayer_topics enable row level security;
alter table prayer.link_imports enable row level security;
alter table prayer.link_import_topics enable row level security;
alter table prayer.link_import_rows enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (internal; no API role may call them)
-- ---------------------------------------------------------------------------
-- How many links in a catalogue members can see.
create function prayer.link_count(p_catalog uuid, p_topic uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from prayer.link_prayers l
   where l.catalog_id = p_catalog and l.is_published and l.retired_at is null
     and (p_topic is null or exists (select 1 from prayer.link_prayer_topics pt
                                      where pt.prayer_id = l.id and pt.topic_id = p_topic));
$$;

create function prayer.link_catalog_json(c prayer.link_catalogs, p_count integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'key', c.key, 'name', c.name, 'description', c.description,
    'source_name', c.source_name, 'source_url', c.source_url,
    'rights_statement', c.rights_statement, 'count', coalesce(p_count, 0),
    'imported_at', c.imported_at);
$$;

create function prayer.link_row_json(l prayer.link_prayers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'title', l.title, 'source_url', l.source_url,
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort_order, lower(t.name))
                          from prayer.link_prayer_topics pt
                          join prayer.link_topics t on t.id = pt.topic_id
                         where pt.prayer_id = l.id and t.archived_at is null), '[]'::jsonb));
$$;

-- The catalogue a member may open: published, not archived, and holding at
-- least one published link. Anything else reads as not found.
create function prayer.link_visible_catalog(p_id uuid)
returns prayer.link_catalogs
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from prayer.link_catalogs c
   where c.id = p_id and c.status = 'published' and c.archived_at is null
     and prayer.link_count(c.id) > 0;
$$;

-- Every link in a catalogue's search vector: its title, then its topic labels
-- and the source's name, rebuilt in one statement after an import. No prayer
-- text exists here to index.
create function prayer.link_reindex_catalog(p_catalog uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update prayer.link_prayers l
     set search = setweight(to_tsvector('english', l.title), 'A')
               || setweight(to_tsvector('english', concat_ws(' ',
                    (select string_agg(t.name, ' ') from prayer.link_prayer_topics pt
                       join prayer.link_topics t on t.id = pt.topic_id where pt.prayer_id = l.id),
                    c.source_name)), 'B')
    from prayer.link_catalogs c
   where c.id = l.catalog_id and l.catalog_id = p_catalog;
$$;

-- ---------------------------------------------------------------------------
-- Reading (approved adult members)
-- ---------------------------------------------------------------------------
-- Every catalogue a member may browse, in the order settings managers chose.
create function public.prayer_link_catalogs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_member();
  return coalesce((
    select jsonb_agg(prayer.link_catalog_json(x.c, x.n) order by (x.c).sort_order, lower((x.c).name), (x.c).id)
      from (select c as c, prayer.link_count(c.id) as n
              from prayer.link_catalogs c
             where c.status = 'published' and c.archived_at is null) x
     where x.n > 0), '[]'::jsonb);
end;
$$;

-- One catalogue with its topics (only those holding a published link).
create function public.prayer_link_catalog(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c prayer.link_catalogs;
begin
  perform prayer.require_member();
  select * into c from prayer.link_visible_catalog(p_id);
  if c.id is null then
    raise exception 'That prayer category wasn''t found.' using errcode = 'P0002';
  end if;
  return prayer.link_catalog_json(c, prayer.link_count(c.id)) || jsonb_build_object(
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'source_url', t.source_url, 'count', n.n)
                                         order by t.sort_order, lower(t.name), t.id)
                          from prayer.link_topics t
                          cross join lateral (select prayer.link_count(c.id, t.id) as n) n
                         where t.catalog_id = c.id and t.archived_at is null and n.n > 0), '[]'::jsonb));
end;
$$;

-- Published links in one catalogue, by title. p_topic narrows to one of its
-- topics; p_query matches words as prefixes against the title, the topic
-- labels, and the source's name. Paged with p_limit / p_offset over a stable
-- alphabetical list; `total` counts everything the filters match.
create function public.prayer_link_list(
  p_catalog uuid, p_query text default null, p_topic uuid default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c prayer.link_catalogs;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_has_query boolean := nullif(btrim(coalesce(p_query, '')), '') is not null;
  v_tsq tsquery := prayer.library_tsquery(p_query);
  v_pattern text := prayer.like_pattern(left(coalesce(p_query, ''), 100));
  v_items jsonb;
  v_total integer;
begin
  perform prayer.require_member();
  select * into c from prayer.link_visible_catalog(p_catalog);
  if c.id is null then
    raise exception 'That prayer category wasn''t found.' using errcode = 'P0002';
  end if;
  -- Only stop words ("the", "and"): match the title instead.
  if v_has_query and (v_tsq is null or numnode(v_tsq) = 0) then
    v_tsq := null;
  end if;
  if p_topic is not null and not exists (select 1 from prayer.link_topics t
                                          where t.id = p_topic and t.catalog_id = c.id and t.archived_at is null) then
    raise exception 'That topic wasn''t found.' using errcode = 'P0002';
  end if;

  with matched as (
    select l from prayer.link_prayers l
     where l.catalog_id = c.id and l.is_published and l.retired_at is null
       and (not v_has_query or (v_tsq is not null and l.search @@ v_tsq) or (v_tsq is null and l.title ilike v_pattern))
       and (p_topic is null or exists (select 1 from prayer.link_prayer_topics pt
                                        where pt.prayer_id = l.id and pt.topic_id = p_topic))
  )
  select coalesce((select jsonb_agg(prayer.link_row_json(m.l) order by lower((m.l).title), (m.l).id)
                     from (select l from matched order by lower((l).title), (l).id
                            limit v_limit offset v_offset) m), '[]'::jsonb),
         (select count(*)::integer from matched)
    into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total, 'has_more', v_total > v_offset + v_limit);
end;
$$;

-- ---------------------------------------------------------------------------
-- Managing (settings.manage)
-- ---------------------------------------------------------------------------
create function prayer.link_catalog_admin_json(c prayer.link_catalogs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'key', c.key, 'name', c.name, 'description', c.description,
    'source_name', c.source_name, 'source_url', c.source_url, 'rights_statement', c.rights_statement,
    'sort_order', c.sort_order, 'status', c.status, 'published_at', c.published_at, 'archived_at', c.archived_at,
    'source_path', c.source_path, 'source_sha256', c.source_sha256, 'imported_at', c.imported_at,
    'updated_at', c.updated_at,
    'counts', (select jsonb_build_object(
                 'total', count(*)::integer,
                 'published', count(*) filter (where l.is_published and l.retired_at is null)::integer,
                 'unpublished', count(*) filter (where not l.is_published and l.retired_at is null)::integer,
                 'retired', count(*) filter (where l.retired_at is not null)::integer)
                 from prayer.link_prayers l where l.catalog_id = c.id),
    'topic_counts', (select jsonb_build_object(
                       'active', count(*) filter (where t.archived_at is null)::integer,
                       'archived', count(*) filter (where t.archived_at is not null)::integer)
                       from prayer.link_topics t where t.catalog_id = c.id));
$$;

create function public.prayer_link_admin_catalogs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_settings_manager();
  return coalesce((select jsonb_agg(prayer.link_catalog_admin_json(c) order by c.sort_order, lower(c.name), c.id)
                     from prayer.link_catalogs c), '[]'::jsonb);
end;
$$;

-- One catalogue for its admin page: its details, every topic (archived
-- included) with counts, and its recent imports.
create function public.prayer_link_admin_catalog(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c prayer.link_catalogs;
begin
  perform prayer.require_settings_manager();
  select * into c from prayer.link_catalogs where id = p_id;
  if c.id is null then
    raise exception 'That prayer category wasn''t found.' using errcode = 'P0002';
  end if;
  return prayer.link_catalog_admin_json(c) || jsonb_build_object(
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', t.id, 'name', t.name, 'source_url', t.source_url,
                                 'sort_order', t.sort_order, 'archived', t.archived_at is not null,
                                 'total', n.total, 'published', n.published)
                               order by t.sort_order, lower(t.name), t.id)
                          from prayer.link_topics t
                          cross join lateral (
                            select count(*)::integer as total,
                                   count(*) filter (where l.is_published and l.retired_at is null)::integer as published
                              from prayer.link_prayer_topics pt
                              join prayer.link_prayers l on l.id = pt.prayer_id
                             where pt.topic_id = t.id) n
                         where t.catalog_id = c.id), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', i.id, 'status', i.status, 'expected', i.expected_count,
                                  'source_sha256', i.source_sha256, 'result', i.result, 'error', i.error,
                                  'by', community.display_name(i.created_by),
                                  'created_at', i.created_at, 'finished_at', i.finished_at)
                                order by i.created_at desc)
                           from (select * from prayer.link_imports where catalog_id = c.id
                                  order by created_at desc limit 10) i), '[]'::jsonb));
end;
$$;

-- Links in one catalogue for review. p_state: all | published | unpublished |
-- retired. Same search as the member list, and the same alphabetical order.
create function public.prayer_link_admin_list(
  p_catalog uuid, p_query text default null, p_topic uuid default null, p_state text default 'all',
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_state text := coalesce(nullif(btrim(p_state), ''), 'all');
  v_has_query boolean := nullif(btrim(coalesce(p_query, '')), '') is not null;
  v_tsq tsquery := prayer.library_tsquery(p_query);
  v_pattern text := prayer.like_pattern(left(coalesce(p_query, ''), 100));
  v_items jsonb;
  v_total integer;
begin
  perform prayer.require_settings_manager();
  if v_state not in ('all', 'published', 'unpublished', 'retired') then
    raise exception 'Choose a valid list.' using errcode = '22023';
  end if;
  if not exists (select 1 from prayer.link_catalogs where id = p_catalog) then
    raise exception 'That prayer category wasn''t found.' using errcode = 'P0002';
  end if;
  if v_has_query and (v_tsq is null or numnode(v_tsq) = 0) then
    v_tsq := null;
  end if;

  with matched as (
    select l from prayer.link_prayers l
     where l.catalog_id = p_catalog
       and case v_state
             when 'published' then l.is_published and l.retired_at is null
             when 'unpublished' then not l.is_published and l.retired_at is null
             when 'retired' then l.retired_at is not null
             else true end
       and (not v_has_query or (v_tsq is not null and l.search @@ v_tsq) or (v_tsq is null and l.title ilike v_pattern))
       and (p_topic is null or exists (select 1 from prayer.link_prayer_topics pt
                                        where pt.prayer_id = l.id and pt.topic_id = p_topic))
  )
  select coalesce((select jsonb_agg(prayer.link_row_json(m.l)
                                    || jsonb_build_object('is_published', (m.l).is_published,
                                                          'retired', (m.l).retired_at is not null,
                                                          'source_id', (m.l).source_id)
                                    order by lower((m.l).title), (m.l).id)
                     from (select l from matched order by lower((l).title), (l).id
                            limit v_limit offset v_offset) m), '[]'::jsonb),
         (select count(*)::integer from matched)
    into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total, 'has_more', v_total > v_offset + v_limit);
end;
$$;

-- Rename, describe, and reorder a catalogue. Its key, source, rights
-- statement, and links are untouched.
create function public.prayer_link_catalog_save(p_id uuid, p_name text, p_description text default '', p_sort_order integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  c prayer.link_catalogs;
  -- Cleaned and whitespace-collapsed, exactly as a collection's name is.
  v_name text := regexp_replace(community.clean_text(p_name, 2, 80, 'The name'), '\s+', ' ', 'g');
  v_description text := regexp_replace(community.clean_text(coalesce(p_description, ''), 0, 500, 'The description'), '\s+', ' ', 'g');
  v_was text;
begin
  select * into c from prayer.link_catalogs where id = p_id for update;
  if c.id is null then
    raise exception 'That prayer category wasn''t found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from prayer.link_catalogs o where o.id <> c.id and lower(btrim(o.name)) = lower(v_name)) then
    raise exception 'Another prayer category is already called that.' using errcode = '23505';
  end if;
  v_was := c.name;
  update prayer.link_catalogs
     set name = v_name, description = v_description,
         sort_order = coalesce(p_sort_order, sort_order), updated_by = v_uid, updated_at = now()
   where id = c.id
  returning * into c;
  perform prayer.audit('prayer.link_catalog_saved', 'prayer_link_catalog', c.id,
                       jsonb_build_object('key', c.key, 'renamed', lower(btrim(v_was)) <> lower(btrim(v_name))));
  return prayer.link_catalog_admin_json(c);
end;
$$;

-- Publish a catalogue to members, return it to a draft, or archive it.
-- Archiving hides it from members; nothing is deleted and no link changes.
create function public.prayer_link_catalog_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  c prayer.link_catalogs;
begin
  if coalesce(p_status, '') not in ('draft', 'published', 'archived') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  select * into c from prayer.link_catalogs where id = p_id for update;
  if c.id is null then
    raise exception 'That prayer category wasn''t found.' using errcode = 'P0002';
  end if;
  if p_status = 'published' and prayer.link_count(c.id) = 0 then
    raise exception 'Publish at least one prayer link first; members would see an empty category.' using errcode = '22023';
  end if;
  update prayer.link_catalogs
     set status = p_status,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
         archived_at = case when p_status = 'archived' then coalesce(archived_at, now()) else null end,
         updated_by = v_uid, updated_at = now()
   where id = c.id
  returning * into c;
  perform prayer.audit('prayer.link_catalog_status', 'prayer_link_catalog', c.id,
                       jsonb_build_object('key', c.key, 'status', p_status));
  return prayer.link_catalog_admin_json(c);
end;
$$;

-- Publish or unpublish named links (one at a time, or a page of them).
-- Retired links can't be published; nothing else about a link changes.
create function public.prayer_link_set_published(p_ids uuid[], p_published boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  v_ids uuid[] := coalesce(p_ids, '{}'::uuid[]);
  v_n integer;
  v_catalog uuid;
begin
  if cardinality(v_ids) not between 1 and 500 then
    raise exception 'Choose between 1 and 500 prayer links.' using errcode = '22023';
  end if;
  if p_published is null then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  select l.catalog_id into v_catalog from prayer.link_prayers l where l.id = any (v_ids) limit 1;
  if v_catalog is null then
    raise exception 'Those prayer links weren''t found.' using errcode = 'P0002';
  end if;
  update prayer.link_prayers l
     set is_published = p_published, updated_at = now()
   where l.id = any (v_ids) and l.is_published is distinct from p_published
     and (l.retired_at is null or not p_published);
  get diagnostics v_n = row_count;
  perform prayer.audit(case when p_published then 'prayer.link_published' else 'prayer.link_unpublished' end,
                       'prayer_link_catalog', v_catalog, jsonb_build_object('links', v_n, 'asked', cardinality(v_ids)));
  return jsonb_build_object('changed', v_n);
end;
$$;

-- Publish or unpublish every link in a catalogue, or every link in one of its
-- topics: the bulk review step after an import. Retired links stay hidden.
create function public.prayer_link_publish_all(p_catalog uuid, p_topic uuid default null, p_published boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  c prayer.link_catalogs;
  v_n integer;
begin
  if p_published is null then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  select * into c from prayer.link_catalogs where id = p_catalog for update;
  if c.id is null then
    raise exception 'That prayer category wasn''t found.' using errcode = 'P0002';
  end if;
  if p_topic is not null and not exists (select 1 from prayer.link_topics t where t.id = p_topic and t.catalog_id = c.id) then
    raise exception 'That topic wasn''t found.' using errcode = 'P0002';
  end if;
  update prayer.link_prayers l
     set is_published = p_published, updated_at = now()
   where l.catalog_id = c.id
     and l.is_published is distinct from p_published
     and (l.retired_at is null or not p_published)
     and (p_topic is null or exists (select 1 from prayer.link_prayer_topics pt
                                      where pt.prayer_id = l.id and pt.topic_id = p_topic));
  get diagnostics v_n = row_count;
  perform prayer.audit(case when p_published then 'prayer.link_published' else 'prayer.link_unpublished' end,
                       'prayer_link_catalog', c.id,
                       jsonb_build_object('links', v_n, 'bulk', true, 'topic', p_topic));
  return jsonb_build_object('changed', v_n);
end;
$$;

-- Archive a topic (it leaves the member filters and the links' labels) or
-- restore it. Links keep their rows either way; nothing is deleted.
create function public.prayer_link_topic_archive(p_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  t prayer.link_topics;
begin
  if p_archived is null then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  select * into t from prayer.link_topics where id = p_id for update;
  if t.id is null then
    raise exception 'That topic wasn''t found.' using errcode = 'P0002';
  end if;
  update prayer.link_topics
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end, updated_at = now()
   where id = t.id
  returning * into t;
  perform prayer.audit(case when p_archived then 'prayer.link_topic_archived' else 'prayer.link_topic_restored' end,
                       'prayer_link_topic', t.id, jsonb_build_object('catalog', t.catalog_id, 'name', t.name));
  return jsonb_build_object('id', t.id, 'archived', t.archived_at is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Importing (settings.manage): begin → topics → rows → apply
-- ---------------------------------------------------------------------------
-- Step 1: open an import, creating the catalogue the first time. The
-- catalogue is created as a draft, so nothing reaches members here.
create function public.prayer_link_import_begin(p_meta jsonb, p_report jsonb, p_expected integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  c prayer.link_catalogs;
  i prayer.link_imports;
  v_key text := p_meta ->> 'key';
begin
  if coalesce((p_report ->> 'ok')::boolean, false) is not true then
    raise exception 'The dry run reported problems. Nothing was imported.' using errcode = '22023';
  end if;
  if p_expected is null or p_expected not between 1 and 20000 then
    raise exception 'The expected number of prayer links is missing.' using errcode = '22023';
  end if;
  if coalesce(v_key, '') !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' then
    raise exception 'The catalogue key is missing.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'prayer_link_import', 10, interval '1 hour');
  select * into c from prayer.link_catalogs where key = v_key for update;
  if c.id is null then
    insert into prayer.link_catalogs (key, name, description, source_name, source_url, rights_statement,
                                      source_path, source_sha256, created_by, updated_by)
    values (v_key,
            regexp_replace(community.clean_text(p_meta ->> 'name', 2, 80, 'The name'), '\s+', ' ', 'g'),
            regexp_replace(left(coalesce(p_meta ->> 'description', ''), 500), '\s+', ' ', 'g'),
            community.clean_text(p_meta ->> 'source_name', 1, 200, 'The source'),
            p_meta ->> 'source_url',
            left(coalesce(p_meta ->> 'rights_statement', ''), 1000),
            p_meta ->> 'source_path', p_meta ->> 'source_sha256', v_uid, v_uid)
    returning * into c;
    perform prayer.audit('prayer.link_catalog_created', 'prayer_link_catalog', c.id, jsonb_build_object('key', c.key));
  end if;
  update prayer.link_imports set status = 'discarded', finished_at = now(), error = 'Replaced by a newer import.'
   where catalog_id = c.id and status = 'staging';
  insert into prayer.link_imports (catalog_id, source_path, source_sha256, expected_count, report, created_by)
  values (c.id, p_meta ->> 'source_path', p_meta ->> 'source_sha256', p_expected, coalesce(p_report, '{}'::jsonb), v_uid)
  returning * into i;
  return jsonb_build_object('import_id', i.id, 'catalog_id', c.id);
end;
$$;

-- Step 2: stage the source's topic labels (at most 500 per call).
create function public.prayer_link_import_topics(p_import uuid, p_topics jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  i prayer.link_imports;
  v_n integer;
begin
  select * into i from prayer.link_imports where id = p_import for update;
  if i.id is null or i.status <> 'staging' or i.created_by is distinct from v_uid then
    raise exception 'That import isn''t open.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_topics) <> 'array' or jsonb_array_length(p_topics) not between 1 and 500 then
    raise exception 'Send between 1 and 500 topics at a time.' using errcode = '22023';
  end if;
  insert into prayer.link_import_topics (import_id, name, source_url, sort_order)
  select i.id, btrim(x ->> 'name'), nullif(btrim(coalesce(x ->> 'source_url', '')), ''),
         coalesce((x ->> 'sort_order')::integer, 1000)
    from jsonb_array_elements(p_topics) x
  on conflict (import_id, name) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Step 3: stage the links (at most 200 per call). Staged rows touch nothing
-- members can see.
create function public.prayer_link_import_rows(p_import uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  i prayer.link_imports;
  v_n integer;
begin
  select * into i from prayer.link_imports where id = p_import for update;
  if i.id is null or i.status <> 'staging' or i.created_by is distinct from v_uid then
    raise exception 'That import isn''t open.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'Send between 1 and 200 prayer links at a time.' using errcode = '22023';
  end if;
  insert into prayer.link_import_rows (import_id, source_id, title, source_url, topics)
  select i.id, btrim(x ->> 'source_id'), btrim(x ->> 'title'), btrim(x ->> 'source_url'),
         (select array_agg(btrim(t)) from jsonb_array_elements_text(x -> 'topics') t)
    from jsonb_array_elements(p_rows) x;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Step 4: apply everything staged, in this one transaction (all or nothing).
--
--   * Topics: new ones added, existing ones re-ordered and given the source's
--     address again (a topic that was archived by hand stays archived); a
--     topic the source no longer lists is archived, never deleted.
--   * Links: new ones added unpublished (members see nothing until a settings
--     manager publishes); an existing link's title, address, and topics take
--     the source's again, while its publishing decision is kept exactly as
--     it was; a link the source no longer lists is marked retired, so members
--     stop seeing it and nothing is deleted.
--   * Every staged row must have arrived, and every label it names must exist,
--     or nothing is applied.
create function public.prayer_link_import_apply(p_import uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  i prayer.link_imports;
  c prayer.link_catalogs;
  v_staged integer;
  v_topics_new integer;
  v_topics_archived integer;
  v_inserted integer;
  v_updated integer;
  v_retired integer;
  v_restored integer;
  v_unknown text[];
  v_result jsonb;
begin
  select * into i from prayer.link_imports where id = p_import for update;
  if i.id is null or i.status <> 'staging' or i.created_by is distinct from v_uid then
    raise exception 'That import isn''t open.' using errcode = 'P0002';
  end if;
  select * into c from prayer.link_catalogs where id = i.catalog_id for update;
  select count(*) into v_staged from prayer.link_import_rows where import_id = i.id;
  if v_staged <> i.expected_count then
    raise exception 'Only % of % prayer links were staged. Nothing was imported; start the import again.', v_staged, i.expected_count using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct t), '{}'::text[]) into v_unknown
    from prayer.link_import_rows r, unnest(r.topics) t
   where r.import_id = i.id
     and not exists (select 1 from prayer.link_import_topics it where it.import_id = i.id and it.name = t);
  if cardinality(v_unknown) > 0 then
    raise exception 'The staged prayer links name % topics that were not staged (for example "%"). Nothing was imported.',
      cardinality(v_unknown), v_unknown[1] using errcode = '22023';
  end if;

  -- Topics the source lists now.
  insert into prayer.link_topics (catalog_id, name, source_url, sort_order)
  select c.id, it.name, it.source_url, it.sort_order
    from prayer.link_import_topics it
   where it.import_id = i.id
     and not exists (select 1 from prayer.link_topics t where t.catalog_id = c.id and lower(btrim(t.name)) = lower(it.name));
  get diagnostics v_topics_new = row_count;

  update prayer.link_topics t
     set source_url = it.source_url, sort_order = it.sort_order, updated_at = now()
    from prayer.link_import_topics it
   where it.import_id = i.id and t.catalog_id = c.id and lower(btrim(t.name)) = lower(it.name)
     and (t.source_url, t.sort_order) is distinct from (it.source_url, it.sort_order);

  -- Topics the source dropped: archived, never deleted.
  update prayer.link_topics t
     set archived_at = now(), updated_at = now()
   where t.catalog_id = c.id and t.archived_at is null
     and not exists (select 1 from prayer.link_import_topics it where it.import_id = i.id and lower(it.name) = lower(btrim(t.name)));
  get diagnostics v_topics_archived = row_count;

  -- New links arrive unpublished, for review.
  insert into prayer.link_prayers (catalog_id, source_id, title, source_url, import_id)
  select c.id, r.source_id, r.title, r.source_url, i.id
    from prayer.link_import_rows r
   where r.import_id = i.id
     and not exists (select 1 from prayer.link_prayers l where l.catalog_id = c.id and l.source_id = r.source_id);
  get diagnostics v_inserted = row_count;

  -- Existing links: the source's title and address again; is_published is
  -- never touched here.
  update prayer.link_prayers l
     set title = r.title, source_url = r.source_url, import_id = i.id, updated_at = now()
    from prayer.link_import_rows r
   where r.import_id = i.id and l.catalog_id = c.id and l.source_id = r.source_id
     and (l.title, l.source_url) is distinct from (r.title, r.source_url);
  get diagnostics v_updated = row_count;

  -- A link the source lists again stops being retired (its publishing
  -- decision is still whatever it was).
  update prayer.link_prayers l
     set retired_at = null, import_id = i.id, updated_at = now()
   where l.catalog_id = c.id and l.retired_at is not null
     and exists (select 1 from prayer.link_import_rows r where r.import_id = i.id and r.source_id = l.source_id);
  get diagnostics v_restored = row_count;

  -- Links the source no longer lists: members stop seeing them.
  update prayer.link_prayers l
     set retired_at = now(), updated_at = now()
   where l.catalog_id = c.id and l.retired_at is null
     and not exists (select 1 from prayer.link_import_rows r where r.import_id = i.id and r.source_id = l.source_id);
  get diagnostics v_retired = row_count;

  -- Labels, exactly as the source has them now.
  delete from prayer.link_prayer_topics pt
   using prayer.link_prayers l
   where pt.prayer_id = l.id and l.catalog_id = c.id
     and exists (select 1 from prayer.link_import_rows r where r.import_id = i.id and r.source_id = l.source_id)
     and not exists (select 1 from prayer.link_topics t, prayer.link_import_rows r
                      where t.id = pt.topic_id and r.import_id = i.id and r.source_id = l.source_id
                        and lower(btrim(t.name)) = any (select lower(x) from unnest(r.topics) x));

  insert into prayer.link_prayer_topics (prayer_id, topic_id)
  select l.id, t.id
    from prayer.link_import_rows r
    join prayer.link_prayers l on l.catalog_id = c.id and l.source_id = r.source_id
    cross join unnest(r.topics) as label(name)
    join prayer.link_topics t on t.catalog_id = c.id and lower(btrim(t.name)) = lower(label.name)
   where r.import_id = i.id
  on conflict (prayer_id, topic_id) do nothing;

  perform prayer.link_reindex_catalog(c.id);

  v_result := jsonb_build_object(
    'staged', v_staged,
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_staged - v_inserted - v_updated,
    'retired', v_retired,
    'restored', v_restored,
    'topics_added', v_topics_new,
    'topics_archived', v_topics_archived,
    'total', (select count(*)::integer from prayer.link_prayers where catalog_id = c.id and retired_at is null),
    'published', prayer.link_count(c.id));

  update prayer.link_imports set status = 'applied', result = v_result, finished_at = now() where id = i.id;
  update prayer.link_catalogs
     set source_path = i.source_path, source_sha256 = i.source_sha256, imported_at = now(),
         updated_by = v_uid, updated_at = now()
   where id = c.id;
  -- One audit entry per import (counts only), never one per link.
  perform prayer.audit('prayer.link_imported', 'prayer_link_catalog', c.id,
                       v_result || jsonb_build_object('import_id', i.id, 'source_sha256', i.source_sha256));
  return v_result;
end;
$$;

-- Marks an import that couldn't be applied (the apply itself rolled back),
-- with the reason, or discards one on request. Staged rows are removed.
create function public.prayer_link_import_close(p_import uuid, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
begin
  if coalesce(p_status, '') not in ('failed', 'discarded') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  update prayer.link_imports set status = p_status, error = left(p_error, 1000), finished_at = now()
   where id = p_import and status = 'staging' and created_by = v_uid;
  delete from prayer.link_import_rows where import_id = p_import
     and exists (select 1 from prayer.link_imports i where i.id = p_import and i.status in ('failed', 'discarded'));
  delete from prayer.link_import_topics where import_id = p_import
     and exists (select 1 from prayer.link_imports i where i.id = p_import and i.status in ('failed', 'discarded'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: approved adult members and settings managers (rechecked inside);
-- never anon, never service_role.
-- ---------------------------------------------------------------------------
revoke all on function
  prayer.link_count(uuid, uuid), prayer.link_catalog_json(prayer.link_catalogs, integer),
  prayer.link_row_json(prayer.link_prayers), prayer.link_visible_catalog(uuid),
  prayer.link_reindex_catalog(uuid),
  prayer.link_catalog_admin_json(prayer.link_catalogs)
from public, anon, authenticated, service_role;

revoke all on function
  public.prayer_link_catalogs(), public.prayer_link_catalog(uuid),
  public.prayer_link_list(uuid, text, uuid, integer, integer),
  public.prayer_link_admin_catalogs(), public.prayer_link_admin_catalog(uuid),
  public.prayer_link_admin_list(uuid, text, uuid, text, integer, integer),
  public.prayer_link_catalog_save(uuid, text, text, integer), public.prayer_link_catalog_status(uuid, text),
  public.prayer_link_set_published(uuid[], boolean), public.prayer_link_publish_all(uuid, uuid, boolean),
  public.prayer_link_topic_archive(uuid, boolean),
  public.prayer_link_import_begin(jsonb, jsonb, integer), public.prayer_link_import_topics(uuid, jsonb),
  public.prayer_link_import_rows(uuid, jsonb), public.prayer_link_import_apply(uuid),
  public.prayer_link_import_close(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.prayer_link_catalogs(), public.prayer_link_catalog(uuid),
  public.prayer_link_list(uuid, text, uuid, integer, integer),
  public.prayer_link_admin_catalogs(), public.prayer_link_admin_catalog(uuid),
  public.prayer_link_admin_list(uuid, text, uuid, text, integer, integer),
  public.prayer_link_catalog_save(uuid, text, text, integer), public.prayer_link_catalog_status(uuid, text),
  public.prayer_link_set_published(uuid[], boolean), public.prayer_link_publish_all(uuid, uuid, boolean),
  public.prayer_link_topic_archive(uuid, boolean),
  public.prayer_link_import_begin(jsonb, jsonb, integer), public.prayer_link_import_topics(uuid, jsonb),
  public.prayer_link_import_rows(uuid, jsonb), public.prayer_link_import_apply(uuid),
  public.prayer_link_import_close(uuid, text, text)
to authenticated;

-- =========================================================================
-- Post-checks: the tables exist with RLS on and no API role can read them,
-- the member and management functions reach `authenticated` and nobody else,
-- the internal helpers stay closed, every new function is security definer
-- with an empty search_path, and nothing was created in the catalogue.
-- =========================================================================
do $check$
declare
  v_table text;
  v_fn text;
  v_open integer;
begin
  foreach v_table in array array['link_catalogs', 'link_topics', 'link_prayers', 'link_prayer_topics',
                                 'link_imports', 'link_import_topics', 'link_import_rows']
  loop
    if to_regclass('prayer.' || v_table) is null then
      raise exception 'Nothing was changed: prayer.% was not created. Send this message to the developer.', v_table;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('prayer.' || v_table)::regclass) then
      raise exception 'Nothing was changed: row level security is off on prayer.%. Send this message to the developer.', v_table;
    end if;
    if has_table_privilege('anon', 'prayer.' || v_table, 'select')
       or has_table_privilege('authenticated', 'prayer.' || v_table, 'select')
       or has_table_privilege('service_role', 'prayer.' || v_table, 'select') then
      raise exception 'Nothing was changed: an API role can read prayer.%. Send this message to the developer.', v_table;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.prayer_link_catalogs()',
    'public.prayer_link_catalog(uuid)',
    'public.prayer_link_list(uuid, text, uuid, integer, integer)',
    'public.prayer_link_admin_catalogs()',
    'public.prayer_link_admin_catalog(uuid)',
    'public.prayer_link_admin_list(uuid, text, uuid, text, integer, integer)',
    'public.prayer_link_catalog_save(uuid, text, text, integer)',
    'public.prayer_link_catalog_status(uuid, text)',
    'public.prayer_link_set_published(uuid[], boolean)',
    'public.prayer_link_publish_all(uuid, uuid, boolean)',
    'public.prayer_link_topic_archive(uuid, boolean)',
    'public.prayer_link_import_begin(jsonb, jsonb, integer)',
    'public.prayer_link_import_topics(uuid, jsonb)',
    'public.prayer_link_import_rows(uuid, jsonb)',
    'public.prayer_link_import_apply(uuid)',
    'public.prayer_link_import_close(uuid, text, text)']
  loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Nothing was changed: % was not created. Send this message to the developer.', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Nothing was changed: the grants on % are not as expected. Send this message to the developer.', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'prayer.link_count(uuid, uuid)',
    'prayer.link_catalog_json(prayer.link_catalogs, integer)',
    'prayer.link_row_json(prayer.link_prayers)',
    'prayer.link_visible_catalog(uuid)',
    'prayer.link_reindex_catalog(uuid)',
    'prayer.link_catalog_admin_json(prayer.link_catalogs)']
  loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Nothing was changed: % was not created. Send this message to the developer.', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Nothing was changed: the internal helper % is not closed. Send this message to the developer.', v_fn;
    end if;
  end loop;

  select count(*) into v_open
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname like 'prayer_link_%' and n.nspname = 'public'
     and (not p.prosecdef
          or p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c in ('search_path=', 'search_path=""')));
  if v_open > 0 then
    raise exception 'Nothing was changed: % prayer_link_ function(s) are not security definer with an empty search_path. Send this message to the developer.', v_open;
  end if;

  if (select count(*) from prayer.link_catalogs) <> 0
     or (select count(*) from prayer.link_prayers) <> 0 then
    raise exception 'Nothing was changed: the migration created content, which it must not. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261130000100', 'prayer_link_catalog', 'prayer-link-catalog');

commit;
