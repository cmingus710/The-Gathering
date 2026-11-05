-- Prayer Library member collections · Apply migration
-- 20261129000100_prayer_member_collections to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "Members start their own
-- Prayer Library collections"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- This migration shipped in cmingus710/The-Gathering#94 without an operator
-- script, and was renumbered from 20261127000100 to 20261129000100 in
-- cmingus710/The-Gathering#95 because the prayer length step had already
-- been applied and recorded on hosted under the first number. Its SQL is
-- unchanged by that renumbering.
--
-- If the migration's SQL was already pasted and run on its own (the
-- function exists but the version isn't recorded), this script stops at its
-- preflight and says so; ask for a record-only script in that case.
--
-- Additive: one new member function (prayer_library_collection_add), and
-- prayer.library_collection_json, prayer.library_visible_collection,
-- public.prayer_library_collections and prayer.library_collection_admin_json
-- replaced with the same signatures and grants. No table, column, policy, or
-- row changes, and nothing is notified.
--
-- It copies supabase/migrations/20261129000100_prayer_member_collections.sql
-- verbatim and records it under its repository version (created_by =
-- prayer-member-collections). All or nothing: one transaction; out of order
-- or a second run stops at the preflight with "Nothing was changed".
-- It needs the Prayer Library collections step (20261124000100).
begin;

do $preflight$
begin
  if to_regclass('prayer.library_collections') is null
     or to_regprocedure('prayer.library_collection_json(prayer.library_collections, integer)') is null
     or to_regprocedure('public.prayer_library_collections()') is null then
    raise exception 'Nothing was changed: the Prayer Library collections (20261124000100) are not in this database.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261124000100') then
    raise exception 'Nothing was changed: the Prayer Library collections step (20261124000100) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261129000100') then
    raise exception 'Nothing was changed: 20261129000100 is already applied.';
  end if;
  if to_regprocedure('public.prayer_library_collection_add(text, text)') is not null then
    raise exception 'Nothing was changed: the member collection function is already in this database but 20261129000100 isn''t recorded. Ask for a record-only script instead.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261129000100_prayer_member_collections.sql
-- =========================================================================
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

-- Expected afterwards: the new function exists and only `authenticated` can
-- call it; the private prayer helpers stay closed to every client role; a
-- collection reads with `mine`, and the admin view with `started_by`.
do $check$
begin
  if to_regprocedure('public.prayer_library_collection_add(text, text)') is null
     or not has_function_privilege('authenticated', 'public.prayer_library_collection_add(text, text)', 'execute')
     or has_function_privilege('anon', 'public.prayer_library_collection_add(text, text)', 'execute')
     or has_function_privilege('service_role', 'public.prayer_library_collection_add(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.prayer_library_collections()', 'execute')
     or has_function_privilege('authenticated', 'prayer.library_collection_json(prayer.library_collections, integer)', 'execute')
     or has_function_privilege('authenticated', 'prayer.library_visible_collection(uuid)', 'execute')
     or has_function_privilege('authenticated', 'prayer.library_collection_admin_json(prayer.library_collections)', 'execute')
     or has_function_privilege('anon', 'prayer.library_collection_json(prayer.library_collections, integer)', 'execute')
     or has_table_privilege('authenticated', 'prayer.library_collections', 'select')
     or has_table_privilege('anon', 'prayer.library_collections', 'select') then
    raise exception 'Nothing was changed: the member collection function or the Prayer Library grants are not as expected. Send this message to the developer.';
  end if;
  -- Read the seeded General prayers collection both ways: members see `mine`
  -- (false here, since the SQL editor has no signed-in member), and a
  -- settings manager's view carries `started_by`.
  if not (select prayer.library_collection_json(c, 0) ? 'mine' from prayer.library_collections c where c.is_general)
     or (select prayer.library_collection_json(c, 0) ->> 'mine' from prayer.library_collections c where c.is_general) <> 'false'
     or not (select prayer.library_collection_admin_json(c) ? 'started_by' from prayer.library_collections c where c.is_general) then
    raise exception 'Nothing was changed: collections do not read back with the new fields. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261129000100', 'prayer_member_collections', 'prayer-member-collections');

commit;
