-- Prayer Library · collections (additive).
--
-- A collection is a shelf members browse ("Morning Prayers", "Biblical
-- Prayers"): every published prayer belongs to exactly one. Collections are
-- their own records in the private `prayer` schema, separate from church
-- groups, from the topic / purpose / intended-use labels (which stay as they
-- are, many per prayer), and from private Saved prayers.
--
-- Who can do what
--   * Approved adult members (prayer.is_member: youth accounts are refused,
--     as everywhere in prayer) choose one active collection when they publish
--     or edit their own prayer. Drafts may stay unassigned. Members can't
--     create, rename, or reorder collections, and can't move anyone else's
--     prayer.
--   * Settings managers (settings.manage, the same people who manage the
--     library's topics, purposes, and uses) create, rename, describe,
--     reorder, archive, and restore collections, set or remove a cover, and
--     reassign existing prayers one at a time or in bulk. Drafts stay
--     private: administrators never list or move another member's draft.
--   * One "General prayers" collection always exists (it can't be archived)
--     for prayers that don't fit elsewhere.
--
-- Members see a collection only while it is active and holds at least one
-- published, unhidden prayer; counts and covers come from those prayers
-- alone, and a direct link to any other collection reads as not found.
--
-- Existing content: every existing prayer (whatever its status) is placed
-- in General prayers, without guessing from its text. No other column is
-- changed: ids, owners, attribution, Scripture, labels, bookmarks,
-- publication state and dates, and updated_at all stay as they were.
-- Personal prayer requests are untouched. Nothing here sends notifications.
--
-- Covers: WebP files in the private `prayer-library` bucket under
-- collections/<collection id>/, re-encoded by the app (metadata removed).
-- Approved adult members may read a cover only while it belongs to a
-- collection they can see; settings managers may read, add, and remove them.
--
-- Search now also matches a prayer's collection name, and card excerpts are
-- plain text even when a prayer's text contains HTML tags or entities.
--
-- Function changes: prayer_library_list and prayer_library_save each gain a
-- trailing p_collection argument (default null, so existing positional calls
-- keep working); prayer_library_meta, prayer.library_card, and
-- prayer.library_reindex return or index the collection; publishing (save or
-- prayer_library_status) needs a collection.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table prayer.library_collections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 300),
  sort_order integer not null default 1000 check (sort_order between 0 and 1000000),
  -- The catch-all collection: exactly one, never archived.
  is_general boolean not null default false,
  cover_path text unique,
  cover_alt text not null default '' check (char_length(cover_alt) <= 200),
  cover_set_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_collections_general_active check (not is_general or archived_at is null),
  constraint library_collections_cover_path check (cover_path is null or cover_path like 'collections/' || id::text || '/%')
);
create unique index library_collections_name_idx on prayer.library_collections (lower(btrim(name)));
create unique index library_collections_general_idx on prayer.library_collections (is_general) where is_general;
create index library_collections_order_idx on prayer.library_collections (sort_order, lower(name), id) where archived_at is null;
create index library_collections_created_by_idx on prayer.library_collections (created_by);
alter table prayer.library_collections enable row level security;

insert into prayer.library_collections (name, description, sort_order, is_general)
values ('General prayers', 'Prayers that don''t fit another collection yet.', 900000, true);

alter table prayer.library_prayers
  add column collection_id uuid references prayer.library_collections (id) on delete restrict;

-- Existing prayers go to General prayers; nothing else on the row changes.
update prayer.library_prayers
   set collection_id = (select id from prayer.library_collections where is_general)
 where collection_id is null;

-- Published prayers (and archived ones, which can be restored) always have a
-- collection; drafts may not yet.
alter table prayer.library_prayers
  add constraint library_prayers_collection check (status = 'draft' or collection_id is not null);

create index library_prayers_collection_idx on prayer.library_prayers (collection_id, published_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------
-- Published, unhidden prayers in a collection: what every approved adult
-- member can read, so the same count for each of them.
create function prayer.library_collection_count(p_collection uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from prayer.library_prayers l
   where l.collection_id = p_collection and l.status = 'published' and l.hidden_at is null;
$$;

create function prayer.library_collection_json(c prayer.library_collections, p_count integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'is_general', c.is_general,
    'count', p_count,
    'cover', case when c.cover_path is not null then jsonb_build_object('path', c.cover_path, 'alt', c.cover_alt) end);
$$;

-- An active collection a member can see (active, with something to read), or null.
create function prayer.library_visible_collection(p_collection uuid)
returns prayer.library_collections
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from prayer.library_collections c
   where c.id = p_collection and c.archived_at is null and prayer.library_collection_count(c.id) > 0;
$$;

-- Rebuilds one prayer's search vector: unchanged from 20261115000100 except
-- the collection name, weighted with the labels.
create or replace function prayer.library_reindex(p_prayer uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update prayer.library_prayers l
     set search = setweight(to_tsvector('english', l.title), 'A')
               || setweight(to_tsvector('english', concat_ws(' ',
                    l.source_name,
                    community.display_name(l.contributor_id),
                    (select c.name from prayer.library_collections c where c.id = l.collection_id),
                    (select string_agg(c.name, ' ')
                       from prayer.library_prayer_categories pc
                       join prayer.library_categories c on c.id = pc.category_id
                      where pc.prayer_id = l.id),
                    array_to_string(l.scripture_refs, ' '))), 'B')
               || setweight(to_tsvector('english', l.body), 'C')
   where l.id = p_prayer;
$$;

-- A short plain-text excerpt: HTML tags and common entities removed as well
-- as Markdown markers and link targets (the full prayer is rendered by the
-- app's safe renderer, unchanged).
create or replace function prayer.library_excerpt(p_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(btrim(regexp_replace(
           replace(replace(replace(replace(replace(replace(
             regexp_replace(regexp_replace(regexp_replace(p_body,
               '<[^>]*>', ' ', 'g'),
               '\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
               '[*_`>#~]+', '', 'g'),
             '&nbsp;', ' '), '&quot;', '"'), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&'),
           '\s+', ' ', 'g')), 200);
$$;

-- Unchanged from 20261115000100 except 'collection'.
create or replace function prayer.library_card(l prayer.library_prayers, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id,
    'title', l.title,
    'excerpt', prayer.library_excerpt(l.body),
    'status', l.status,
    'hidden', l.hidden_at is not null,
    'mod_archived', l.mod_archived,
    'mine', l.contributor_id = p_viewer,
    'contributor', community.display_name(l.contributor_id),
    'origin', l.origin,
    'source_name', l.source_name,
    'categories', prayer.library_categories_json(l.id),
    'collection', (select jsonb_build_object('id', c.id, 'name', c.name) from prayer.library_collections c where c.id = l.collection_id),
    'saved', exists (select 1 from prayer.library_saves s where s.prayer_id = l.id and s.profile_id = p_viewer),
    'published_at', l.published_at,
    'updated_at', l.updated_at,
    'edited_at', l.edited_at,
    'created_at', l.created_at);
$$;

-- Every prayer's search now includes its collection.
select prayer.library_reindex(l.id) from prayer.library_prayers l where l.id is not null;

-- ---------------------------------------------------------------------------
-- Reading (members)
-- ---------------------------------------------------------------------------
-- Unchanged from 20261115000100 except the active collections (for the
-- editor's Collection field).
create or replace function public.prayer_library_meta()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name)
                                             order by c.kind, c.sort_order, lower(c.name))
                              from prayer.library_categories c where c.archived_at is null), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'is_general', c.is_general)
                                              order by c.sort_order, lower(c.name), c.id)
                               from prayer.library_collections c where c.archived_at is null), '[]'::jsonb),
    'can_moderate', prayer.holds(v_uid, 'prayer.moderate'),
    'can_manage', public.has_capability('settings.manage'),
    'posting_restricted', community.restricted(v_uid, 'posting'));
end;
$$;

-- The collections a member can browse: active, with at least one published,
-- unhidden prayer, in the administrators' order. `total` is every published
-- prayer (All prayers).
create function public.prayer_library_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_member();
  return jsonb_build_object(
    'total', (select count(*) from prayer.library_prayers l where l.status = 'published' and l.hidden_at is null),
    'collections', coalesce((
      select jsonb_agg(prayer.library_collection_json(x.c, x.n) order by (x.c).sort_order, lower((x.c).name), (x.c).id)
        from (select c, prayer.library_collection_count(c.id) as n
                from prayer.library_collections c where c.archived_at is null) x
       where x.n > 0), '[]'::jsonb));
end;
$$;

-- One collection for its page. Archived, empty, or unknown: not found.
create function public.prayer_library_collection(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c prayer.library_collections;
begin
  perform prayer.require_member();
  c := prayer.library_visible_collection(p_id);
  if c.id is null then
    raise exception 'That collection wasn''t found.' using errcode = 'P0002';
  end if;
  return prayer.library_collection_json(c, prayer.library_collection_count(c.id));
end;
$$;

-- Unchanged from 20261115000100 except p_collection: only prayers in that
-- collection (combined with the view, search, and labels).
drop function public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer);
create function public.prayer_library_list(
  p_view text default 'library', p_query text default null,
  p_topic uuid default null, p_purpose uuid default null, p_use uuid default null,
  p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 20,
  p_collection uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_has_query boolean := nullif(btrim(coalesce(p_query, '')), '') is not null;
  v_tsq tsquery := prayer.library_tsquery(p_query);
  v_pattern text := prayer.like_pattern(left(p_query, 100));
  -- A constant column name (never caller text): the contributor's own list
  -- is ordered by last change, everything else by first publication.
  v_sort text := case when p_view = 'mine' then 'updated_at' else 'published_at' end;
  v_items jsonb;
  v_count integer;
begin
  if coalesce(p_view, '') not in ('library', 'mine', 'saved') then
    raise exception 'Choose a valid view.' using errcode = '22023';
  end if;
  -- Only stop words ("the", "and"): match the title instead.
  if v_has_query and (v_tsq is null or numnode(v_tsq) = 0) then
    v_tsq := null;
  end if;
  execute format($q$
    select coalesce(jsonb_agg(prayer.library_card(x.r, $1) || jsonb_build_object('cursor_at', x.sort_at)
                              order by x.sort_at desc, (x.r).id desc) filter (where x.n <= $2), '[]'::jsonb),
           count(*)::integer
      from (select l as r, l.%1$I as sort_at, row_number() over (order by l.%1$I desc, l.id desc) as n
              from prayer.library_prayers l
             where case $3
                     when 'mine' then l.contributor_id = $1
                     when 'saved' then l.status = 'published' and l.hidden_at is null
                                       and exists (select 1 from prayer.library_saves s where s.prayer_id = l.id and s.profile_id = $1)
                     else l.status = 'published' and l.hidden_at is null end
               and prayer.library_can_read(l, $1)
               and ($12::uuid is null or l.collection_id = $12::uuid)
               and (not $4 or ($5::tsquery is not null and l.search @@ $5::tsquery) or ($5::tsquery is null and l.title ilike $6))
               and ($7::uuid is null or exists (select 1 from prayer.library_prayer_categories pc where pc.prayer_id = l.id and pc.category_id = $7))
               and ($8::uuid is null or exists (select 1 from prayer.library_prayer_categories pc where pc.prayer_id = l.id and pc.category_id = $8))
               and ($9::uuid is null or exists (select 1 from prayer.library_prayer_categories pc where pc.prayer_id = l.id and pc.category_id = $9))
               and ($10::timestamptz is null or (l.%1$I, l.id) < ($10::timestamptz, coalesce($11::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
             order by l.%1$I desc, l.id desc
             limit $2 + 1) x
  $q$, v_sort)
  into v_items, v_count
  using v_uid, v_limit, p_view, v_has_query, v_tsq, v_pattern, p_topic, p_purpose, p_use, p_before, p_before_id, p_collection;
  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

-- ---------------------------------------------------------------------------
-- Contributing
-- ---------------------------------------------------------------------------
-- Unchanged from 20261115000100 except p_collection: an active collection,
-- required to publish (a draft may leave it empty).
drop function public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid);
create function public.prayer_library_save(
  p_id uuid, p_title text, p_body text, p_origin text, p_source_name text, p_source_url text,
  p_scripture text[], p_categories uuid[], p_publish boolean, p_client_key uuid default null,
  p_collection uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_title text := community.clean_text(p_title, 3, 120, 'The title');
  v_body text := community.clean_text(p_body, 1, 6000, 'The prayer');
  v_source text := nullif(community.clean_text(coalesce(p_source_name, ''), 0, 200, 'The author or source'), '');
  v_url text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_refs text[];
  v_cats uuid[] := array(select distinct c from unnest(coalesce(p_categories, '{}')) c where c is not null);
  v_publish boolean := coalesce(p_publish, false);
  old prayer.library_prayers;
  v_id uuid;
begin
  if coalesce(p_origin, '') not in ('original', 'shared') then
    raise exception 'Say whether the prayer is your own or shared from another source.' using errcode = '22023';
  end if;
  if v_body ~ '\]\((mention|group):' then
    raise exception 'Mentions aren''t used in the Prayer Library. Remove the @mention and try again.' using errcode = '22023';
  end if;
  if v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https?://[^\s<>"]+$') then
    raise exception 'Enter the source link as a full web address starting with https://.' using errcode = '22023';
  end if;
  select coalesce(array_agg(r order by ord), '{}') into v_refs
    from (select distinct on (lower(btrim(r))) btrim(r) r, ord
            from unnest(coalesce(p_scripture, '{}')) with ordinality u(r, ord)
           where btrim(coalesce(r, '')) <> ''
           order by lower(btrim(r)), ord) x;
  if cardinality(v_refs) > 20 or exists (select 1 from unnest(v_refs) r where char_length(r) > 80) then
    raise exception 'Add up to 20 Scripture references, each a short reference such as “Psalm 23”.' using errcode = '22023';
  end if;
  -- Active categories, or archived ones the prayer already had (it keeps its labels).
  if (select count(*) from prayer.library_categories c
       where c.id = any (v_cats)
         and (c.archived_at is null
              or (p_id is not null and exists (select 1 from prayer.library_prayer_categories pc where pc.prayer_id = p_id and pc.category_id = c.id)))) <> cardinality(v_cats) then
    raise exception 'One of the chosen topics, purposes, or uses is no longer available. Choose again.' using errcode = '22023';
  end if;
  if (select count(*) from prayer.library_categories c where c.id = any (v_cats) and c.kind = 'topic') > 8
     or (select count(*) from prayer.library_categories c where c.id = any (v_cats) and c.kind = 'purpose') > 4
     or (select count(*) from prayer.library_categories c where c.id = any (v_cats) and c.kind = 'use') > 7 then
    raise exception 'Choose up to 8 topics, 4 purposes, and 7 uses.' using errcode = '22023';
  end if;
  if p_collection is not null and not exists (select 1 from prayer.library_collections c where c.id = p_collection and c.archived_at is null) then
    raise exception 'That collection is no longer available. Choose another.' using errcode = '22023';
  end if;
  if v_publish and community.restricted(v_uid, 'posting') then
    raise exception 'Your community posting is paused by a moderator, so you can''t publish right now. You can still save a draft.' using errcode = '42501';
  end if;

  if p_id is null then
    if p_client_key is not null then
      select id into v_id from prayer.library_prayers where contributor_id = v_uid and client_key = p_client_key;
      if v_id is not null then
        return v_id;
      end if;
    end if;
    if v_publish and p_collection is null then
      raise exception 'Choose a collection before publishing.' using errcode = '22023';
    end if;
    perform community.rate_limit(v_uid, 'prayer_library_save', 30, interval '1 hour');
    insert into prayer.library_prayers (contributor_id, title, body, origin, source_name, source_url, scripture_refs,
                                        status, published_at, client_key, collection_id)
    values (v_uid, v_title, v_body, p_origin, v_source, v_url, v_refs,
            case when v_publish then 'published' else 'draft' end, case when v_publish then now() end, p_client_key, p_collection)
    returning id into v_id;
  else
    select * into old from prayer.library_prayers where id = p_id for update;
    if not found or old.contributor_id <> v_uid then
      raise exception 'That prayer wasn''t found.' using errcode = 'P0002';
    end if;
    if old.status = 'archived' then
      raise exception 'Restore this prayer from the archive before editing it.' using errcode = '22023';
    end if;
    if v_publish and p_collection is null then
      raise exception 'Choose a collection before publishing.' using errcode = '22023';
    end if;
    perform community.rate_limit(v_uid, 'prayer_library_save', 30, interval '1 hour');
    v_id := old.id;
    update prayer.library_prayers
       set title = v_title, body = v_body, origin = p_origin, source_name = v_source, source_url = v_url,
           scripture_refs = v_refs, collection_id = p_collection,
           status = case when v_publish then 'published' else 'draft' end,
           -- The first publication date is kept, so editing never moves a prayer to the top.
           published_at = coalesce(published_at, case when v_publish then now() end),
           edited_at = case when old.status = 'published' then now() else edited_at end,
           updated_at = now()
     where id = v_id;
    delete from prayer.library_prayer_categories where prayer_id = v_id;
  end if;
  insert into prayer.library_prayer_categories (prayer_id, category_id)
  select v_id, c from unnest(v_cats) c;
  perform prayer.library_reindex(v_id);
  return v_id;
end;
$$;

-- Unchanged from 20261115000100 except that publishing needs a collection.
create or replace function public.prayer_library_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  l prayer.library_prayers;
begin
  select * into l from prayer.library_prayers where id = p_id for update;
  if not found or l.contributor_id <> v_uid then
    raise exception 'That prayer wasn''t found.' using errcode = 'P0002';
  end if;
  if coalesce(p_status, '') not in ('published', 'draft', 'archived') then
    raise exception 'That change isn''t available.' using errcode = '22023';
  end if;
  if l.status = p_status then
    return;
  end if;
  if p_status = 'archived' then
    if l.collection_id is null then
      update prayer.library_prayers
         set collection_id = (select id from prayer.library_collections where is_general)
       where id = l.id;
    end if;
    update prayer.library_prayers
       set status = 'archived', archived_at = now(), archived_by = v_uid, mod_archived = false, updated_at = now()
     where id = l.id;
    return;
  end if;
  if l.mod_archived then
    raise exception 'A prayer moderator archived this prayer, so it can''t be restored here.' using errcode = '42501';
  end if;
  if p_status = 'published' and community.restricted(v_uid, 'posting') then
    raise exception 'Your community posting is paused by a moderator, so you can''t publish right now.' using errcode = '42501';
  end if;
  if p_status = 'published' and (l.collection_id is null
       or not exists (select 1 from prayer.library_collections c where c.id = l.collection_id and c.archived_at is null)) then
    raise exception 'Choose a collection before publishing: edit the prayer and pick one.' using errcode = '22023';
  end if;
  update prayer.library_prayers
     set status = p_status,
         published_at = coalesce(published_at, case when p_status = 'published' then now() end),
         archived_at = null, archived_by = null, updated_at = now()
   where id = l.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Managing collections (settings.manage)
-- ---------------------------------------------------------------------------
-- Shared with the church at some point (published now, hidden, or archived
-- after publishing), as opposed to private work: a draft, or a prayer its
-- contributor archived before ever publishing it.
create function prayer.library_shared(l prayer.library_prayers)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select l.status <> 'draft' and l.published_at is not null;
$$;

create function prayer.library_collection_admin_json(c prayer.library_collections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select prayer.library_collection_json(c, prayer.library_collection_count(c.id)) || jsonb_build_object(
    'sort_order', c.sort_order,
    'archived', c.archived_at is not null,
    'archived_at', c.archived_at,
    'updated_at', c.updated_at,
    -- Numbers only for private work (drafts, and anything archived before it
    -- was ever published): it stays its contributor's alone.
    'counts', jsonb_build_object(
      'published', prayer.library_collection_count(c.id),
      'hidden', (select count(*) from prayer.library_prayers l where l.collection_id = c.id and l.status = 'published' and l.hidden_at is not null),
      'archived', (select count(*) from prayer.library_prayers l where l.collection_id = c.id and l.status = 'archived' and l.published_at is not null),
      'private', (select count(*) from prayer.library_prayers l where l.collection_id = c.id and not prayer.library_shared(l))));
$$;

create function public.prayer_library_admin_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_settings_manager();
  return coalesce((
    select jsonb_agg(prayer.library_collection_admin_json(c) order by c.archived_at is not null, c.sort_order, lower(c.name), c.id)
      from prayer.library_collections c), '[]'::jsonb);
end;
$$;

create function public.prayer_library_admin_collection(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c prayer.library_collections;
begin
  perform prayer.require_settings_manager();
  select * into c from prayer.library_collections where id = p_id;
  if c.id is null then
    raise exception 'That collection wasn''t found.' using errcode = 'P0002';
  end if;
  return prayer.library_collection_admin_json(c);
end;
$$;

-- The prayers in a collection that administrators may move: everything that
-- was ever shared (published, hidden, and archived after publishing), never
-- private work, newest first, keyset paged on (published_at, id). p_query
-- matches titles.
create function public.prayer_library_admin_collection_prayers(
  p_collection uuid, p_query text default null, p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_pattern text := case when nullif(btrim(coalesce(p_query, '')), '') is null then null else prayer.like_pattern(left(p_query, 100)) end;
  v_items jsonb;
  v_count integer;
begin
  perform prayer.require_settings_manager();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'contributor', community.display_name(x.contributor_id),
           'status', x.status, 'hidden', x.hidden_at is not null, 'published_at', x.published_at)
           order by x.published_at desc, x.id desc) filter (where x.n <= v_limit), '[]'::jsonb),
         count(*)::integer
    into v_items, v_count
    from (select l.*, row_number() over (order by l.published_at desc, l.id desc) as n
            from prayer.library_prayers l
           where l.collection_id = p_collection and prayer.library_shared(l)
             and (v_pattern is null or l.title ilike v_pattern)
             and (p_before is null or (l.published_at, l.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           order by l.published_at desc, l.id desc
           limit v_limit + 1) x;
  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

-- Create (p_id null) or rename / describe. New collections go last among
-- the active ones (before General prayers).
create function public.prayer_library_collection_save(p_id uuid, p_name text, p_description text, p_cover_alt text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_settings_manager();
  v_name text := regexp_replace(community.clean_text(p_name, 2, 80, 'The name'), '\s+', ' ', 'g');
  v_desc text := regexp_replace(community.clean_text(coalesce(p_description, ''), 0, 300, 'The description'), '\s+', ' ', 'g');
  v_alt text := left(btrim(coalesce(p_cover_alt, '')), 200);
  c prayer.library_collections;
  v_id uuid;
  v_prayer uuid;
begin
  if exists (select 1 from prayer.library_collections x where lower(btrim(x.name)) = lower(v_name) and x.id is distinct from p_id) then
    raise exception 'A collection with that name already exists.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into prayer.library_collections (name, description, cover_alt, sort_order, created_by)
    values (v_name, v_desc, v_alt,
            coalesce((select max(x.sort_order) + 10 from prayer.library_collections x where not x.is_general and x.sort_order < 900000), 10),
            v_uid)
    returning id into v_id;
    perform prayer.audit('prayer.library_collection_created', 'prayer_library_collection', v_id, '{}'::jsonb);
    return v_id;
  end if;
  select * into c from prayer.library_collections where id = p_id for update;
  if c.id is null then
    raise exception 'That collection wasn''t found.' using errcode = 'P0002';
  end if;
  update prayer.library_collections
     set name = v_name, description = v_desc, cover_alt = case when p_cover_alt is null then cover_alt else v_alt end, updated_at = now()
   where id = c.id;
  if v_name is distinct from c.name then
    for v_prayer in select l.id from prayer.library_prayers l where l.collection_id = c.id loop
      perform prayer.library_reindex(v_prayer);
    end loop;
  end if;
  perform prayer.audit('prayer.library_collection_updated', 'prayer_library_collection', c.id, '{}'::jsonb);
  return c.id;
end;
$$;

-- Moves an active collection one place up or down among the active ones.
create function public.prayer_library_collection_move(p_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_pos integer;
  v_other integer;
begin
  perform prayer.require_settings_manager();
  if coalesce(p_direction, '') not in ('up', 'down') then
    raise exception 'Choose up or down.' using errcode = '22023';
  end if;
  perform 1 from prayer.library_collections where archived_at is null for update;
  select array_agg(c.id order by c.sort_order, lower(c.name), c.id) into v_ids
    from prayer.library_collections c where c.archived_at is null;
  v_pos := array_position(v_ids, p_id);
  if v_pos is null then
    raise exception 'That collection wasn''t found.' using errcode = 'P0002';
  end if;
  v_other := v_pos + case when p_direction = 'up' then -1 else 1 end;
  if v_other < 1 or v_other > cardinality(v_ids) then
    return;
  end if;
  v_ids[v_pos] := v_ids[v_other];
  v_ids[v_other] := p_id;
  update prayer.library_collections c
     set sort_order = o.ord * 10, updated_at = now()
    from unnest(v_ids) with ordinality o(id, ord)
   where c.id = o.id and c.sort_order is distinct from (o.ord * 10)::integer;
  perform prayer.audit('prayer.library_collection_reordered', 'prayer_library_collection', p_id, jsonb_build_object('direction', p_direction));
end;
$$;

-- Sets (p_path) or removes (null) the cover. p_path must be a stored file in
-- this collection's folder. Returns the previous cover's path, if any, for
-- the app to delete.
create function public.prayer_library_collection_cover(p_id uuid, p_path text, p_alt text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c prayer.library_collections;
begin
  perform prayer.require_settings_manager();
  select * into c from prayer.library_collections where id = p_id for update;
  if c.id is null then
    raise exception 'That collection wasn''t found.' using errcode = 'P0002';
  end if;
  if p_path is not null and (p_path not like 'collections/' || c.id::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'prayer-library' and o.name = p_path)) then
    raise exception 'The cover image wasn''t found. Choose it again.' using errcode = '22023';
  end if;
  update prayer.library_collections
     set cover_path = p_path,
         cover_alt = case when p_path is null then '' when p_alt is null then cover_alt else left(btrim(p_alt), 200) end,
         cover_set_at = case when p_path is null then null else now() end,
         updated_at = now()
   where id = c.id;
  perform prayer.audit(case when p_path is null then 'prayer.library_collection_cover_removed' else 'prayer.library_collection_cover_set' end,
                       'prayer_library_collection', c.id, '{}'::jsonb);
  return case when c.cover_path is distinct from p_path then c.cover_path end;
end;
$$;

-- Moves prayers (never private work: drafts stay with their contributors) into an
-- active collection, one or many at once. Publication state, dates, owners,
-- and bookmarks are unchanged, and no one is notified. Returns how many moved.
create function public.prayer_library_reassign(p_ids uuid[], p_collection uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_ids, '{}')) x where x is not null);
  v_moved uuid[];
  v_id uuid;
begin
  perform prayer.require_settings_manager();
  if cardinality(v_ids) = 0 then
    raise exception 'Choose at least one prayer.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Move up to 500 prayers at a time.' using errcode = '22023';
  end if;
  if p_collection is null or not exists (select 1 from prayer.library_collections c where c.id = p_collection and c.archived_at is null) then
    raise exception 'Choose an active collection to move them to.' using errcode = '22023';
  end if;
  with moved as (
    update prayer.library_prayers l
       set collection_id = p_collection
     where l.id = any (v_ids) and prayer.library_shared(l) and l.collection_id is distinct from p_collection
    returning l.id)
  select coalesce(array_agg(id), '{}') into v_moved from moved;
  foreach v_id in array v_moved loop
    perform prayer.library_reindex(v_id);
  end loop;
  if cardinality(v_moved) > 0 then
    perform prayer.audit('prayer.library_reassigned', 'prayer_library_collection', p_collection, jsonb_build_object('count', cardinality(v_moved)));
  end if;
  return cardinality(v_moved);
end;
$$;

-- Archive or restore. Archiving needs the collection's prayers moved first,
-- or p_reassign_to (an active collection) to move them now; any drafts in it
-- go along to p_reassign_to, or become unassigned without one (their
-- contributors choose again when they publish). General prayers can't be
-- archived. A restored collection stays out of members' view until it holds
-- a published prayer.
create function public.prayer_library_collection_archive(p_id uuid, p_archived boolean, p_reassign_to uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c prayer.library_collections;
  v_remaining integer;
  v_moved integer := 0;
  v_id uuid;
begin
  perform prayer.require_settings_manager();
  select * into c from prayer.library_collections where id = p_id for update;
  if c.id is null then
    raise exception 'That collection wasn''t found.' using errcode = 'P0002';
  end if;
  if not coalesce(p_archived, false) then
    update prayer.library_collections set archived_at = null, updated_at = now() where id = c.id and archived_at is not null;
    perform prayer.audit('prayer.library_collection_restored', 'prayer_library_collection', c.id, '{}'::jsonb);
    return 0;
  end if;
  if c.is_general then
    raise exception 'General prayers can''t be archived: it holds prayers that don''t fit another collection.' using errcode = '22023';
  end if;
  if c.archived_at is not null then
    return 0;
  end if;
  if p_reassign_to is not null then
    if p_reassign_to = c.id or not exists (select 1 from prayer.library_collections x where x.id = p_reassign_to and x.archived_at is null) then
      raise exception 'Choose another active collection to move its prayers to.' using errcode = '22023';
    end if;
    for v_id in
      update prayer.library_prayers set collection_id = p_reassign_to where collection_id = c.id returning id
    loop
      v_moved := v_moved + 1;
      perform prayer.library_reindex(v_id);
    end loop;
  end if;
  select count(*) into v_remaining from prayer.library_prayers l where l.collection_id = c.id and prayer.library_shared(l);
  if v_remaining > 0 then
    raise exception 'Move this collection''s % prayers to another collection before archiving it.', v_remaining using errcode = '22023';
  end if;
  -- Private work left behind: drafts become unassigned; archived ones (which
  -- need a collection) go to General prayers.
  update prayer.library_prayers set collection_id = null where collection_id = c.id and status = 'draft';
  update prayer.library_prayers set collection_id = (select x.id from prayer.library_collections x where x.is_general)
   where collection_id = c.id;
  update prayer.library_collections set archived_at = now(), updated_at = now() where id = c.id;
  perform prayer.audit('prayer.library_collection_archived', 'prayer_library_collection', c.id,
                       jsonb_build_object('moved', v_moved, 'to', p_reassign_to));
  return v_moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cover files: private bucket, read only with the collection
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prayer-library', 'prayer-library', false, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Settings managers (approved adults) read every file; other approved adult
-- members only the current cover of a collection they can see.
create function public.prayer_library_can_read_cover(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and prayer.is_member((select auth.uid()))
     and (public.has_capability('settings.manage')
          or exists (select 1 from prayer.library_collections c
                      where c.cover_path = p_name and c.archived_at is null and prayer.library_collection_count(c.id) > 0));
$$;

create function public.prayer_library_can_manage_covers()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and prayer.is_member((select auth.uid())) and public.has_capability('settings.manage');
$$;

create policy "Prayer collection covers follow their collection"
  on storage.objects for select to authenticated
  using (bucket_id = 'prayer-library' and (select public.prayer_library_can_read_cover(storage.objects.name)));

create policy "Settings managers upload prayer collection covers"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'prayer-library' and name like 'collections/%' and (select public.prayer_library_can_manage_covers()));

create policy "Settings managers remove prayer collection covers"
  on storage.objects for delete to authenticated
  using (bucket_id = 'prayer-library' and (select public.prayer_library_can_manage_covers()));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema prayer from public, anon, authenticated;

revoke execute on function
  public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer, uuid),
  public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid, uuid),
  public.prayer_library_collections(), public.prayer_library_collection(uuid),
  public.prayer_library_admin_collections(), public.prayer_library_admin_collection(uuid),
  public.prayer_library_admin_collection_prayers(uuid, text, timestamptz, uuid, integer),
  public.prayer_library_collection_save(uuid, text, text, text), public.prayer_library_collection_move(uuid, text),
  public.prayer_library_collection_cover(uuid, text, text), public.prayer_library_reassign(uuid[], uuid),
  public.prayer_library_collection_archive(uuid, boolean, uuid),
  public.prayer_library_can_read_cover(text), public.prayer_library_can_manage_covers()
from public, anon, service_role;

grant execute on function
  public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer, uuid),
  public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid, uuid),
  public.prayer_library_collections(), public.prayer_library_collection(uuid),
  public.prayer_library_admin_collections(), public.prayer_library_admin_collection(uuid),
  public.prayer_library_admin_collection_prayers(uuid, text, timestamptz, uuid, integer),
  public.prayer_library_collection_save(uuid, text, text, text), public.prayer_library_collection_move(uuid, text),
  public.prayer_library_collection_cover(uuid, text, text), public.prayer_library_reassign(uuid[], uuid),
  public.prayer_library_collection_archive(uuid, boolean, uuid),
  public.prayer_library_can_read_cover(text), public.prayer_library_can_manage_covers()
to authenticated;
