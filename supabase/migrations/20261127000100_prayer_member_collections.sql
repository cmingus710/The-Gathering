-- Prayer Library · members start their own collections (additive).
--
-- Until now only settings managers could create a collection
-- (20261124000100): members chose one of theirs when publishing, and could
-- do nothing when none fitted. This adds one member-facing function so an
-- approved adult member can start a collection — from the prayer editor
-- while adding a prayer, or from the Prayer Library's Collections view — and
-- makes the collection they started visible to them while it is still empty,
-- so it doesn't vanish the moment they create it.
--
-- Who can do what
--   * Approved adult members (prayer.is_member: youth accounts are refused,
--     as everywhere in prayer) create a collection with a name and an
--     optional short description. Nothing else: they still can't rename,
--     describe, reorder, cover, archive, or restore any collection, can't
--     move anyone else's prayer, and gain no claim over the collection they
--     started (anyone may publish into it, and settings managers tidy it).
--   * A member whose community posting is paused by a moderator can't start
--     one (the same rule as publishing a prayer).
--   * Settings managers keep every management function unchanged, and now
--     see who started each collection in the admin list.
--
-- Clutter and abuse
--   * At most 5 new collections an hour per member (community.rate_limit),
--     and at most 3 of a member's own collections may be waiting without a
--     published prayer at any time.
--   * Names stay unique, case- and space-insensitively, across active and
--     archived collections, as before.
--   * Every creation is audited as prayer.library_collection_created with
--     details {"by": "member"}, so settings managers can see in the audit
--     log which collections members started.
--
-- Visibility: unchanged for everyone else. A collection is still public only
-- while it is active and holds at least one published, unhidden prayer; the
-- only addition is that the member who created it also sees it (and can open
-- its page) while it is empty, marked as theirs by the new `mine` flag, so
-- they can add the first prayer. Counts and covers still come from published,
-- unhidden prayers alone.
--
-- Nothing here changes a prayer, a collection's order, or anyone's
-- membership, and nothing sends notifications.
--
-- Function changes: new public.prayer_library_collection_add; replaced
-- prayer.library_collection_json (adds `mine`),
-- prayer.library_visible_collection and public.prayer_library_collections
-- (both also admit the caller's own empty collection), and
-- prayer.library_collection_admin_json (adds `started_by`). Every other
-- signature is untouched.

-- ---------------------------------------------------------------------------
-- Reading (members)
-- ---------------------------------------------------------------------------
-- Unchanged from 20261124000100 except `mine`: whether the caller started
-- this collection (false for everyone else, and for a collection whose
-- creator's profile is gone).
create or replace function prayer.library_collection_json(c prayer.library_collections, p_count integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'is_general', c.is_general,
    'count', p_count,
    'mine', coalesce(c.created_by = (select auth.uid()), false),
    'cover', case when c.cover_path is not null then jsonb_build_object('path', c.cover_path, 'alt', c.cover_alt) end);
$$;

-- An active collection the caller may open: one with something published to
-- read, or one they started themselves (empty while they add the first
-- prayer). Anything else is still not found.
create or replace function prayer.library_visible_collection(p_collection uuid)
returns prayer.library_collections
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from prayer.library_collections c
   where c.id = p_collection and c.archived_at is null
     and (prayer.library_collection_count(c.id) > 0 or c.created_by = (select auth.uid()));
$$;

-- Unchanged from 20261124000100 except that the caller's own collections are
-- listed while they are still empty (nobody else sees them).
create or replace function public.prayer_library_collections()
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
    'total', (select count(*) from prayer.library_prayers l where l.status = 'published' and l.hidden_at is null),
    'collections', coalesce((
      select jsonb_agg(prayer.library_collection_json(x.c, x.n) order by (x.c).sort_order, lower((x.c).name), (x.c).id)
        from (select c, prayer.library_collection_count(c.id) as n
                from prayer.library_collections c where c.archived_at is null) x
       where x.n > 0 or (x.c).created_by = v_uid), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Starting a collection (members)
-- ---------------------------------------------------------------------------
-- A member adds a collection: a name (2-80 characters, unique) and an
-- optional short description (up to 300). It goes last among the active
-- collections, before General prayers, exactly as one a settings manager
-- creates. Returns the new collection the way members read it, so the
-- editor can choose it straight away.
create function public.prayer_library_collection_add(p_name text, p_description text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_name text := regexp_replace(community.clean_text(p_name, 2, 80, 'The name'), '\s+', ' ', 'g');
  v_desc text := regexp_replace(community.clean_text(coalesce(p_description, ''), 0, 300, 'The description'), '\s+', ' ', 'g');
  v_waiting integer;
  c prayer.library_collections;
begin
  if community.restricted(v_uid, 'posting') then
    raise exception 'Your community posting is paused by a moderator, so you can''t start a collection right now.' using errcode = '42501';
  end if;
  if exists (select 1 from prayer.library_collections x where lower(btrim(x.name)) = lower(v_name)) then
    raise exception 'A collection with that name already exists. Choose it from the list, or use a different name.' using errcode = '22023';
  end if;
  -- Collections this member started that nobody else can see yet.
  select count(*) into v_waiting
    from prayer.library_collections x
   where x.created_by = v_uid and x.archived_at is null and prayer.library_collection_count(x.id) = 0;
  if v_waiting >= 3 then
    raise exception 'You have 3 collections without a published prayer yet. Add a prayer to one of those before starting another.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'prayer_library_collection_add', 5, interval '1 hour');
  insert into prayer.library_collections (name, description, sort_order, created_by)
  values (v_name, v_desc,
          coalesce((select max(x.sort_order) + 10 from prayer.library_collections x where not x.is_general and x.sort_order < 900000), 10),
          v_uid)
  returning * into c;
  perform prayer.audit('prayer.library_collection_created', 'prayer_library_collection', c.id, jsonb_build_object('by', 'member'));
  return prayer.library_collection_json(c, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Managing collections (settings.manage)
-- ---------------------------------------------------------------------------
-- Unchanged from 20261124000100 except `started_by`: who created the
-- collection, so a settings manager can see which ones members started. The
-- seeded General prayers collection has no creator.
create or replace function prayer.library_collection_admin_json(c prayer.library_collections)
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
    'started_by', case when c.created_by is not null then community.display_name(c.created_by) end,
    -- Numbers only for private work (drafts, and anything archived before it
    -- was ever published): it stays its contributor's alone.
    'counts', jsonb_build_object(
      'published', prayer.library_collection_count(c.id),
      'hidden', (select count(*) from prayer.library_prayers l where l.collection_id = c.id and l.status = 'published' and l.hidden_at is not null),
      'archived', (select count(*) from prayer.library_prayers l where l.collection_id = c.id and l.status = 'archived' and l.published_at is not null),
      'private', (select count(*) from prayer.library_prayers l where l.collection_id = c.id and not prayer.library_shared(l))));
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The private helpers stay closed to every client role.
revoke execute on all functions in schema prayer from public, anon, authenticated;

revoke execute on function public.prayer_library_collection_add(text, text) from public, anon, service_role;
grant execute on function public.prayer_library_collection_add(text, text) to authenticated;
