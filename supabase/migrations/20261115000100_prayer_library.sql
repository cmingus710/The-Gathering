-- Prayer Library: reusable prayers contributed by approved adult members.
--
-- Separate from prayer requests and practical care: its own tables in the
-- private `prayer` schema (never exposed by the Data API), reached only
-- through SECURITY DEFINER functions in public (prayer_library_*), which
-- recheck the caller on every call. Existing prayer requests are never
-- copied or turned into library prayers.
--
-- Who can do what
--   * Approved adult members (prayer.is_member: youth accounts are refused,
--     as everywhere in prayer) can contribute. Publishing is direct: there
--     is no approval step. A member whose community posting is paused can
--     keep drafts but can't publish.
--   * Published, unhidden prayers are readable by every approved adult
--     member. Drafts, archived prayers, and hidden prayers are readable only
--     by their contributor (who sees why). Everyone else gets "not found",
--     from lists and direct links alike.
--   * Saved prayers (bookmarks) are private: only the owner's own lists
--     ever read them; no counts are returned.
--   * Members can report a published prayer. Prayer moderators
--     (prayer.moderate) review library reports and can hide, restore, or
--     archive contributions, never their own and never drafts. Every action
--     needs a reason and is recorded in prayer.moderation_log and the audit
--     log (ids and reasons only, never text).
--   * Topics, purposes, and intended uses are managed by settings.manage
--     holders (archived, never deleted, so existing prayers keep their
--     labels). Initial categories are seeded below; no prayers are.
--   * Nothing here sends notifications, emails, or push messages.
--
-- Search: a weighted tsvector (title; categories, attribution, Scripture;
-- text) kept current by the save functions and triggers, with a GIN index.
-- Lists are keyset-paged on (published_at, id) — or (updated_at, id) for a
-- contributor's own list — newest first, ties broken by id.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table prayer.library_categories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('topic', 'purpose', 'use')),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index library_categories_name_idx on prayer.library_categories (kind, lower(name));
create index library_categories_order_idx on prayer.library_categories (kind, sort_order, name) where archived_at is null;

create table prayer.library_prayers (
  id uuid primary key default gen_random_uuid(),
  -- The member who shared it (shown as "Shared by"), distinct from the
  -- original author or source below.
  contributor_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  -- The community Markdown subset with safe links (no mentions, images, or HTML).
  body text not null check (char_length(btrim(body)) between 1 and 6000),
  -- original: written by the contributor; shared: from another author or source.
  origin text not null default 'original' check (origin in ('original', 'shared')),
  source_name text check (char_length(source_name) between 1 and 200),
  source_url text check (char_length(source_url) <= 500 and source_url ~ '^https?://[^\s<>"]+$'),
  scripture_refs text[] not null default '{}' check (cardinality(scripture_refs) <= 20),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- Set by a moderator; the contributor still sees it, with a notice.
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  -- Archived by a moderator: the contributor can't republish it.
  mod_archived boolean not null default false,
  archived_by uuid references public.profiles (id) on delete set null,
  client_key uuid,
  search tsvector not null default ''::tsvector,
  published_at timestamptz,
  archived_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_prayers_archived check ((status = 'archived') = (archived_at is not null)),
  constraint library_prayers_published check (status <> 'published' or published_at is not null),
  constraint library_prayers_mod_archived check (not mod_archived or status = 'archived')
);
create index library_prayers_feed_idx on prayer.library_prayers (published_at desc, id desc) where status = 'published' and hidden_at is null;
create index library_prayers_contributor_idx on prayer.library_prayers (contributor_id, updated_at desc, id desc);
create index library_prayers_search_idx on prayer.library_prayers using gin (search);
create index library_prayers_hidden_by_idx on prayer.library_prayers (hidden_by);
create index library_prayers_archived_by_idx on prayer.library_prayers (archived_by);
create index library_prayers_moderated_idx on prayer.library_prayers (updated_at desc) where hidden_at is not null or mod_archived;
create unique index library_prayers_client_key_idx on prayer.library_prayers (contributor_id, client_key) where client_key is not null;

create table prayer.library_prayer_categories (
  prayer_id uuid not null references prayer.library_prayers (id) on delete cascade,
  category_id uuid not null references prayer.library_categories (id) on delete restrict,
  primary key (prayer_id, category_id)
);
create index library_prayer_categories_category_idx on prayer.library_prayer_categories (category_id, prayer_id);

-- Private bookmarks.
create table prayer.library_saves (
  prayer_id uuid not null references prayer.library_prayers (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (prayer_id, profile_id)
);
create index library_saves_profile_idx on prayer.library_saves (profile_id, created_at desc);

create table prayer.library_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  prayer_id uuid references prayer.library_prayers (id) on delete set null,
  reported_profile_id uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in ('inappropriate', 'privacy', 'permission', 'harassment', 'spam', 'other')),
  details text check (char_length(details) <= 1000),
  -- Snapshot of the prayer as it was when reported.
  evidence jsonb check (evidence is null or jsonb_typeof(evidence) = 'object'),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  resolution text check (char_length(resolution) <= 1000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index library_reports_status_idx on prayer.library_reports (status, created_at);
create index library_reports_prayer_idx on prayer.library_reports (prayer_id);
create index library_reports_reporter_idx on prayer.library_reports (reporter_id);
create index library_reports_reported_idx on prayer.library_reports (reported_profile_id);
create index library_reports_resolved_by_idx on prayer.library_reports (resolved_by);

-- Library moderation shares the prayer moderation log.
alter table prayer.moderation_log
  add column library_report_id uuid references prayer.library_reports (id) on delete set null;
create index prayer_mod_log_library_report_idx on prayer.moderation_log (library_report_id);

alter table prayer.library_categories enable row level security;
alter table prayer.library_prayers enable row level security;
alter table prayer.library_prayer_categories enable row level security;
alter table prayer.library_saves enable row level security;
alter table prayer.library_reports enable row level security;

-- ---------------------------------------------------------------------------
-- Initial categories (labels only; no prayers are seeded)
-- ---------------------------------------------------------------------------
insert into prayer.library_categories (kind, name, sort_order) values
  ('topic', 'Church and community', 10), ('topic', 'Family and children', 20), ('topic', 'Healing and health', 30),
  ('topic', 'Grief and loss', 40), ('topic', 'Peace and anxiety', 50), ('topic', 'Work and provision', 60),
  ('topic', 'Relationships', 70), ('topic', 'Faith and growth', 80), ('topic', 'Mission and outreach', 90),
  ('topic', 'Nation and world', 100), ('topic', 'Seasons and holidays', 110),
  ('purpose', 'Gratitude', 10), ('purpose', 'Comfort', 20), ('purpose', 'Guidance', 30), ('purpose', 'Confession', 40),
  ('purpose', 'Intercession', 50), ('purpose', 'Praise', 60), ('purpose', 'Blessing', 70), ('purpose', 'Lament', 80),
  ('use', 'Personal prayer', 10), ('use', 'Family prayer', 20), ('use', 'Meals', 30), ('use', 'Small groups', 40),
  ('use', 'Worship services', 50), ('use', 'Opening a gathering', 60), ('use', 'Closing a gathering', 70);

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

-- The read rule: the contributor (while an approved adult) always; anyone
-- else only while it is published and not hidden.
create function prayer.library_can_read(l prayer.library_prayers, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select l.id is not null and prayer.is_member(p_profile)
     and (l.contributor_id = p_profile or (l.status = 'published' and l.hidden_at is null));
$$;

-- Rebuilds one prayer's search vector (after a save, a category rename, or
-- a change to the contributor's name).
create function prayer.library_reindex(p_prayer uuid)
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
                    (select string_agg(c.name, ' ')
                       from prayer.library_prayer_categories pc
                       join prayer.library_categories c on c.id = pc.category_id
                      where pc.prayer_id = l.id),
                    array_to_string(l.scripture_refs, ' '))), 'B')
               || setweight(to_tsvector('english', l.body), 'C')
   where l.id = p_prayer;
$$;

-- Member search words as a prefix query ("comfor" finds "comfort"). Only
-- letters and digits reach to_tsquery, so no query syntax is possible.
create function prayer.library_tsquery(p text)
returns tsquery
language sql
immutable
set search_path = ''
as $$
  select case when q is null then null else to_tsquery('english', q) end
    from (select string_agg(w || ':*', ' & ') q
            from (select w from regexp_split_to_table(lower(left(coalesce(p, ''), 100)), '[^[:alnum:]]+') w
                   where w <> '' limit 8) words) x;
$$;

-- A short plain-text excerpt (Markdown markers and link targets removed).
create function prayer.library_excerpt(p_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(p_body,
           '\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
           '[*_`>#~]+', '', 'g'),
           '\s+', ' ', 'g')), 200);
$$;

create function prayer.library_categories_json(p_prayer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name)
                            order by c.kind, c.sort_order, c.name), '[]'::jsonb)
    from prayer.library_prayer_categories pc
    join prayer.library_categories c on c.id = pc.category_id
   where pc.prayer_id = p_prayer;
$$;

create function prayer.library_card(l prayer.library_prayers, p_viewer uuid)
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
    'saved', exists (select 1 from prayer.library_saves s where s.prayer_id = l.id and s.profile_id = p_viewer),
    'published_at', l.published_at,
    'updated_at', l.updated_at,
    'edited_at', l.edited_at,
    'created_at', l.created_at);
$$;

create function prayer.library_mod_log(p_action text, p_report uuid, p_target uuid, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into prayer.moderation_log (actor_id, action, library_report_id, target_type, target_id, reason)
  values ((select auth.uid()), p_action, p_report, 'library_prayer', p_target, left(p_reason, 1000));
$$;

-- A library report is reviewable by prayer moderators, never by the
-- reporter or the contributor.
create function prayer.library_can_review(rep prayer.library_reports)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_capability('prayer.moderate')
     and rep.reporter_id is distinct from (select auth.uid())
     and rep.reported_profile_id is distinct from (select auth.uid());
$$;

create function prayer.require_settings_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  if not public.has_capability('settings.manage') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Keep "Shared by" searchable after a member changes their name.
create function prayer.on_profile_name_library()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if new.full_name is distinct from old.full_name or new.preferred_name is distinct from old.preferred_name then
    for v_id in select id from prayer.library_prayers where contributor_id = new.id loop
      perform prayer.library_reindex(v_id);
    end loop;
  end if;
  return new;
end;
$$;

create trigger profiles_prayer_library_names
  after update of full_name, preferred_name on public.profiles
  for each row execute function prayer.on_profile_name_library();

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
-- Categories for forms and filters, plus what the caller may do.
create function public.prayer_library_meta()
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
    'can_moderate', prayer.holds(v_uid, 'prayer.moderate'),
    'can_manage', public.has_capability('settings.manage'),
    'posting_restricted', community.restricted(v_uid, 'posting'));
end;
$$;

-- p_view: library (published) | mine (everything I contributed) | saved (my bookmarks)
-- p_topic / p_purpose / p_use: optional category ids, combined with AND.
-- p_query: words matched as prefixes against title, text, categories, and
-- attribution. Cursor: the last item's published_at (updated_at for mine) and id.
create function public.prayer_library_list(
  p_view text default 'library', p_query text default null,
  p_topic uuid default null, p_purpose uuid default null, p_use uuid default null,
  p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 20)
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
               and (not $4 or ($5::tsquery is not null and l.search @@ $5::tsquery) or ($5::tsquery is null and l.title ilike $6))
               and ($7::uuid is null or exists (select 1 from prayer.library_prayer_categories pc where pc.prayer_id = l.id and pc.category_id = $7))
               and ($8::uuid is null or exists (select 1 from prayer.library_prayer_categories pc where pc.prayer_id = l.id and pc.category_id = $8))
               and ($9::uuid is null or exists (select 1 from prayer.library_prayer_categories pc where pc.prayer_id = l.id and pc.category_id = $9))
               and ($10::timestamptz is null or (l.%1$I, l.id) < ($10::timestamptz, coalesce($11::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
             order by l.%1$I desc, l.id desc
             limit $2 + 1) x
  $q$, v_sort)
  into v_items, v_count
  using v_uid, v_limit, p_view, v_has_query, v_tsq, v_pattern, p_topic, p_purpose, p_use, p_before, p_before_id;
  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

create function public.prayer_library_prayer(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  l prayer.library_prayers;
  v_visible boolean;
begin
  select * into l from prayer.library_prayers where id = p_id;
  if not found or not prayer.library_can_read(l, v_uid) then
    raise exception 'That prayer wasn''t found.' using errcode = 'P0002';
  end if;
  v_visible := l.status = 'published' and l.hidden_at is null;
  return prayer.library_card(l, v_uid) || jsonb_build_object(
    'body', l.body,
    'source_url', l.source_url,
    'scripture_refs', to_jsonb(l.scripture_refs),
    'archived_at', l.archived_at,
    'can_edit', l.contributor_id = v_uid and not l.mod_archived,
    'can_save', v_visible,
    'can_report', v_visible and l.contributor_id <> v_uid,
    'reported', exists (select 1 from prayer.library_reports rep
                         where rep.prayer_id = l.id and rep.reporter_id = v_uid and rep.status in ('open', 'reviewing')),
    'can_moderate', l.contributor_id <> v_uid and v_visible and prayer.holds(v_uid, 'prayer.moderate'),
    'posting_restricted', community.restricted(v_uid, 'posting'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Contributing
-- ---------------------------------------------------------------------------
-- Create (p_id null) or edit the caller's own prayer. p_publish: true
-- publishes (or keeps it published), false keeps or makes it a draft.
-- p_categories: topic, purpose, and use ids (active ones only).
create function public.prayer_library_save(
  p_id uuid, p_title text, p_body text, p_origin text, p_source_name text, p_source_url text,
  p_scripture text[], p_categories uuid[], p_publish boolean, p_client_key uuid default null)
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
    perform community.rate_limit(v_uid, 'prayer_library_save', 30, interval '1 hour');
    insert into prayer.library_prayers (contributor_id, title, body, origin, source_name, source_url, scripture_refs,
                                        status, published_at, client_key)
    values (v_uid, v_title, v_body, p_origin, v_source, v_url, v_refs,
            case when v_publish then 'published' else 'draft' end, case when v_publish then now() end, p_client_key)
    returning id into v_id;
  else
    select * into old from prayer.library_prayers where id = p_id for update;
    if not found or old.contributor_id <> v_uid then
      raise exception 'That prayer wasn''t found.' using errcode = 'P0002';
    end if;
    if old.status = 'archived' then
      raise exception 'Restore this prayer from the archive before editing it.' using errcode = '22023';
    end if;
    perform community.rate_limit(v_uid, 'prayer_library_save', 30, interval '1 hour');
    v_id := old.id;
    update prayer.library_prayers
       set title = v_title, body = v_body, origin = p_origin, source_name = v_source, source_url = v_url,
           scripture_refs = v_refs,
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

-- The contributor's own lifecycle: published | draft | archived.
create function public.prayer_library_status(p_id uuid, p_status text)
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
  update prayer.library_prayers
     set status = p_status,
         published_at = coalesce(published_at, case when p_status = 'published' then now() end),
         archived_at = null, archived_by = null, updated_at = now()
   where id = l.id;
end;
$$;

-- Private bookmark. Saving needs a readable published prayer; unsaving always works.
create function public.prayer_library_bookmark(p_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  l prayer.library_prayers;
begin
  if coalesce(p_on, false) then
    select * into l from prayer.library_prayers where id = p_id;
    if not found or not prayer.library_can_read(l, v_uid) or l.status <> 'published' or l.hidden_at is not null then
      raise exception 'That prayer wasn''t found.' using errcode = 'P0002';
    end if;
    perform community.rate_limit(v_uid, 'prayer_library_bookmark', 200, interval '1 hour');
    insert into prayer.library_saves (prayer_id, profile_id) values (l.id, v_uid) on conflict do nothing;
    return true;
  end if;
  delete from prayer.library_saves where prayer_id = p_id and profile_id = v_uid;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports and moderation
-- ---------------------------------------------------------------------------
create function public.prayer_library_report(p_id uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  l prayer.library_prayers;
  v_id uuid;
begin
  if coalesce(p_reason, '') not in ('inappropriate', 'privacy', 'permission', 'harassment', 'spam', 'other') then
    raise exception 'Choose a reason.' using errcode = '22023';
  end if;
  select * into l from prayer.library_prayers where id = p_id;
  if not found or not prayer.library_can_read(l, v_uid) or l.status <> 'published' or l.hidden_at is not null then
    raise exception 'That prayer wasn''t found.' using errcode = 'P0002';
  end if;
  if l.contributor_id = v_uid then
    raise exception 'You can edit or archive your own prayer instead of reporting it.' using errcode = '22023';
  end if;
  select id into v_id from prayer.library_reports
   where reporter_id = v_uid and prayer_id = l.id and status in ('open', 'reviewing');
  if v_id is not null then
    return v_id;
  end if;
  perform community.rate_limit(v_uid, 'prayer_report', 10, interval '1 hour');
  insert into prayer.library_reports (reporter_id, prayer_id, reported_profile_id, reason, details, evidence)
  values (v_uid, l.id, l.contributor_id, p_reason,
          nullif(community.clean_text(coalesce(p_details, ''), 0, 1000, 'The details'), ''),
          jsonb_build_object('title', l.title, 'body', l.body, 'contributor', community.display_name(l.contributor_id),
                             'origin', l.origin, 'source_name', l.source_name, 'source_url', l.source_url,
                             'published_at', l.published_at, 'edited_at', l.edited_at))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.prayer_library_mod_reports(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_capability('prayer.moderate');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', rep.id, 'reason', rep.reason, 'status', rep.status, 'created_at', rep.created_at,
             'title', rep.evidence ->> 'title',
             'reported', community.display_name(rep.reported_profile_id))
           order by rep.created_at)
      from prayer.library_reports rep
     where case when p_status = 'closed' then rep.status in ('actioned', 'dismissed') else rep.status in ('open', 'reviewing') end
       and prayer.library_can_review(rep)), '[]'::jsonb);
end;
$$;

create function public.prayer_library_mod_report(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep prayer.library_reports;
  l prayer.library_prayers;
begin
  perform prayer.require_capability('prayer.moderate');
  select * into rep from prayer.library_reports where id = p_id;
  if not found or not prayer.library_can_review(rep) then
    raise exception 'That report wasn''t found.' using errcode = 'P0002';
  end if;
  perform prayer.library_mod_log('library_report.viewed', rep.id, rep.prayer_id);
  if rep.status = 'open' then
    update prayer.library_reports set status = 'reviewing', updated_at = now() where id = rep.id;
  end if;
  select * into l from prayer.library_prayers where id = rep.prayer_id;
  return jsonb_build_object(
    'id', rep.id, 'reason', rep.reason, 'details', rep.details,
    'status', case when rep.status = 'open' then 'reviewing' else rep.status end,
    'resolution', rep.resolution, 'resolved_at', rep.resolved_at,
    'resolved_by', case when rep.resolved_by is null then null else community.display_name(rep.resolved_by) end,
    'created_at', rep.created_at,
    'reporter', community.display_name(rep.reporter_id),
    'reported', community.display_name(rep.reported_profile_id),
    'evidence', rep.evidence,
    'prayer_id', l.id,
    'current', case when l.id is null then null
                    else jsonb_build_object('status', l.status, 'hidden', l.hidden_at is not null, 'mod_archived', l.mod_archived) end,
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', m.action, 'actor', community.display_name(m.actor_id),
                                                         'reason', m.reason, 'at', m.created_at) order by m.created_at)
                       from prayer.moderation_log m where m.library_report_id = rep.id), '[]'::jsonb));
end;
$$;

create function public.prayer_library_mod_resolve(p_id uuid, p_status text, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep prayer.library_reports;
begin
  perform prayer.require_capability('prayer.moderate');
  select * into rep from prayer.library_reports where id = p_id for update;
  if not found or not prayer.library_can_review(rep) then
    raise exception 'That report wasn''t found.' using errcode = 'P0002';
  end if;
  if coalesce(p_status, '') not in ('actioned', 'dismissed', 'open') then
    raise exception 'Choose an outcome.' using errcode = '22023';
  end if;
  if p_status <> 'open' and char_length(btrim(coalesce(p_resolution, ''))) < 3 then
    raise exception 'Record what was decided.' using errcode = '22023';
  end if;
  update prayer.library_reports
     set status = p_status,
         resolution = case when p_status = 'open' then resolution else left(btrim(p_resolution), 1000) end,
         resolved_by = case when p_status = 'open' then null else (select auth.uid()) end,
         resolved_at = case when p_status = 'open' then null else now() end,
         updated_at = now()
   where id = rep.id;
  perform prayer.library_mod_log(case p_status when 'open' then 'library_report.reopened' else 'library_report.' || p_status end,
                                 rep.id, rep.prayer_id, p_resolution);
  perform prayer.audit('prayer.library_report_' || case p_status when 'open' then 'reopened' else p_status end,
                       'prayer_library_report', rep.id, '{}'::jsonb);
end;
$$;

-- hide | restore | archive. Never on a draft or the moderator's own prayer.
-- restore clears a moderator's hide and a moderator's archive (an archive by
-- the contributor is theirs to undo).
create function public.prayer_library_mod_action(p_id uuid, p_action text, p_reason text, p_report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('prayer.moderate');
  l prayer.library_prayers;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason.' using errcode = '22023';
  end if;
  if p_report is not null and not exists (
       select 1 from prayer.library_reports rep where rep.id = p_report and rep.prayer_id = p_id and prayer.library_can_review(rep)) then
    raise exception 'That report wasn''t found.' using errcode = 'P0002';
  end if;
  select * into l from prayer.library_prayers where id = p_id for update;
  if not found or l.status = 'draft' then
    raise exception 'That prayer wasn''t found.' using errcode = 'P0002';
  end if;
  if l.contributor_id = v_uid then
    raise exception 'Another prayer moderator needs to review your own contribution.' using errcode = '42501';
  end if;
  case p_action
    when 'hide' then
      if l.hidden_at is not null or l.status <> 'published' then
        raise exception 'Only a visible, published prayer can be hidden.' using errcode = '22023';
      end if;
      update prayer.library_prayers set hidden_at = now(), hidden_by = v_uid, updated_at = now() where id = l.id;
    when 'archive' then
      if l.status <> 'published' then
        raise exception 'Only a published prayer can be archived by a moderator.' using errcode = '22023';
      end if;
      update prayer.library_prayers
         set status = 'archived', archived_at = now(), archived_by = v_uid, mod_archived = true, updated_at = now()
       where id = l.id;
    when 'restore' then
      if l.hidden_at is null and not l.mod_archived then
        raise exception 'This prayer isn''t hidden or archived by a moderator.' using errcode = '22023';
      end if;
      update prayer.library_prayers
         set hidden_at = null, hidden_by = null,
             status = case when mod_archived then 'published' else status end,
             archived_at = case when mod_archived then null else archived_at end,
             archived_by = case when mod_archived then null else archived_by end,
             mod_archived = false, updated_at = now()
       where id = l.id;
    else
      raise exception 'Unknown action.' using errcode = '22023';
  end case;
  perform prayer.library_mod_log('library_prayer.' || p_action, p_report, l.id, p_reason);
  perform prayer.audit('prayer.library_' || p_action, 'prayer_library', l.id, jsonb_build_object('report', p_report));
end;
$$;

-- Prayers a moderator hid or archived, for review and restoring.
create function public.prayer_library_mod_items()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_capability('prayer.moderate');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'title', l.title, 'contributor', community.display_name(l.contributor_id),
             'state', case when l.mod_archived then 'archived' else 'hidden' end,
             'mine', l.contributor_id = (select auth.uid()),
             'at', coalesce(l.hidden_at, l.archived_at),
             'last', (select jsonb_build_object('actor', community.display_name(m.actor_id), 'reason', m.reason)
                        from prayer.moderation_log m
                       where m.target_type = 'library_prayer' and m.target_id = l.id and m.action in ('library_prayer.hide', 'library_prayer.archive')
                       order by m.created_at desc limit 1))
           order by l.updated_at desc)
      from (select * from prayer.library_prayers
             where hidden_at is not null or mod_archived
             order by updated_at desc limit 200) l), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Categories (settings.manage)
-- ---------------------------------------------------------------------------
create function public.prayer_library_admin_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_settings_manager();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'kind', c.kind, 'name', c.name, 'sort_order', c.sort_order, 'archived', c.archived_at is not null,
             'published_count', (select count(*) from prayer.library_prayer_categories pc
                                   join prayer.library_prayers l on l.id = pc.prayer_id
                                  where pc.category_id = c.id and l.status = 'published' and l.hidden_at is null))
           order by c.kind, c.archived_at is not null, c.sort_order, lower(c.name))
      from prayer.library_categories c), '[]'::jsonb);
end;
$$;

-- Create (p_id null) or rename / reorder.
create function public.prayer_library_category_save(p_id uuid, p_kind text, p_name text, p_sort_order integer default 100)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id uuid;
  v_prayer uuid;
begin
  perform prayer.require_settings_manager();
  v_name := community.clean_text(p_name, 2, 60, 'The name');
  if p_sort_order is null or p_sort_order not between 0 and 10000 then
    raise exception 'Use an order number from 0 to 10000.' using errcode = '22023';
  end if;
  if p_id is null then
    if coalesce(p_kind, '') not in ('topic', 'purpose', 'use') then
      raise exception 'Choose a topic, purpose, or use.' using errcode = '22023';
    end if;
    if exists (select 1 from prayer.library_categories where kind = p_kind and lower(name) = lower(v_name)) then
      raise exception 'That name is already in the list.' using errcode = '22023';
    end if;
    insert into prayer.library_categories (kind, name, sort_order) values (p_kind, v_name, p_sort_order) returning id into v_id;
    perform prayer.audit('prayer.library_category_created', 'prayer_library_category', v_id, jsonb_build_object('kind', p_kind));
  else
    select id into v_id from prayer.library_categories where id = p_id for update;
    if v_id is null then
      raise exception 'That category wasn''t found.' using errcode = 'P0002';
    end if;
    if exists (select 1 from prayer.library_categories c
                where c.id <> v_id and c.kind = (select kind from prayer.library_categories where id = v_id) and lower(c.name) = lower(v_name)) then
      raise exception 'That name is already in the list.' using errcode = '22023';
    end if;
    update prayer.library_categories set name = v_name, sort_order = p_sort_order, updated_at = now() where id = v_id;
    for v_prayer in select prayer_id from prayer.library_prayer_categories where category_id = v_id loop
      perform prayer.library_reindex(v_prayer);
    end loop;
    perform prayer.audit('prayer.library_category_updated', 'prayer_library_category', v_id, '{}'::jsonb);
  end if;
  return v_id;
end;
$$;

-- Archived categories leave forms and filters but stay on existing prayers.
create function public.prayer_library_category_archive(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform prayer.require_settings_manager();
  update prayer.library_categories
     set archived_at = case when coalesce(p_archived, false) then coalesce(archived_at, now()) end, updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'That category wasn''t found.' using errcode = 'P0002';
  end if;
  perform prayer.audit(case when coalesce(p_archived, false) then 'prayer.library_category_archived' else 'prayer.library_category_restored' end,
                       'prayer_library_category', p_id, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema prayer from public, anon, authenticated;

revoke execute on function
  public.prayer_library_meta(), public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer),
  public.prayer_library_prayer(uuid),
  public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid),
  public.prayer_library_status(uuid, text), public.prayer_library_bookmark(uuid, boolean),
  public.prayer_library_report(uuid, text, text),
  public.prayer_library_mod_reports(text), public.prayer_library_mod_report(uuid),
  public.prayer_library_mod_resolve(uuid, text, text), public.prayer_library_mod_action(uuid, text, text, uuid),
  public.prayer_library_mod_items(),
  public.prayer_library_admin_categories(), public.prayer_library_category_save(uuid, text, text, integer),
  public.prayer_library_category_archive(uuid, boolean)
from public, anon, service_role;

grant execute on function
  public.prayer_library_meta(), public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer),
  public.prayer_library_prayer(uuid),
  public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid),
  public.prayer_library_status(uuid, text), public.prayer_library_bookmark(uuid, boolean),
  public.prayer_library_report(uuid, text, text),
  public.prayer_library_mod_reports(text), public.prayer_library_mod_report(uuid),
  public.prayer_library_mod_resolve(uuid, text, text), public.prayer_library_mod_action(uuid, text, text, uuid),
  public.prayer_library_mod_items(),
  public.prayer_library_admin_categories(), public.prayer_library_category_save(uuid, text, text, integer),
  public.prayer_library_category_archive(uuid, boolean)
to authenticated;
