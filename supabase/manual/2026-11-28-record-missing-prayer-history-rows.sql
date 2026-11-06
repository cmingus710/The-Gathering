-- Prayer Library · Record three migrations whose SQL is applied on hosted
-- but which have no history row:
--
--   20261124000100_prayer_library_collections
--   20261127000100_prayer_body_length
--   20261128000100_prayer_request_body_length
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- WHY THIS EXISTS. A read-only check from the development session on
-- 2026-11-06 found that all three migrations' objects are in place on hosted
-- (prayer.library_collections with its General prayers row and
-- library_prayers.collection_id, both prayer.clean_body helpers, both body
-- checks without a ceiling, and every collection function), while
-- supabase_migrations.schema_migrations holds no row for any of the three.
-- docs/migration-history.md recorded them from the owner's report at the
-- time; hosted's history is the authority, so this adds the rows it is
-- missing. See docs/migration-history.md, "Prayer Library link catalogues",
-- the note dated 2026-11-06.
--
-- WHAT IT CHANGES. Three rows in supabase_migrations.schema_migrations, and
-- nothing else. It creates, alters, and drops nothing; it reads no prayer,
-- request, profile, or membership; it writes nothing a member or
-- administrator can see; and it notifies nobody. It is not a migration: it
-- records migrations that already ran.
--
-- WHY IT MATTERS. The preflight of
-- supabase/manual/2026-11-29-apply-prayer-member-collections.sql requires
-- 20261124000100 to be *recorded*, so that step stops with "the Prayer
-- Library collections step (20261124000100) is not recorded" until this has
-- run. 20261129000100 itself is a separate matter: its SQL is genuinely NOT
-- applied on hosted (public.prayer_library_collection_add does not exist),
-- and this script neither applies nor records it.
--
-- ALL OR NOTHING. One transaction. It stops with "Nothing was changed" if
-- any of the three is already recorded (naming which), if a step before them
-- isn't recorded, or if any one of the three steps turns out not to be fully
-- applied after all — in which case don't work around it: run that step's own
-- apply script instead (2026-11-27-apply-prayer-body-length.sql,
-- 2026-11-28-apply-prayer-request-body-length.sql; 20261124000100 has no
-- operator script, so its migration file is pasted directly).
--
-- The created_by values follow each migration's name, as the other operator
-- scripts do: prayer-library-collections (which has no earlier script and so
-- no earlier value to match), prayer-body-length, prayer-request-body-length.
begin;

-- -------------------------------------------------------------------------
-- Preflight: none of the three already recorded, and the steps they build on
-- are. Checked before any object, so a database that is merely further along
-- or further behind is told that first.
-- -------------------------------------------------------------------------
do $preflight$
declare
  v_already text;
  v_missing text;
begin
  select string_agg(version, ', ' order by version) into v_already
    from supabase_migrations.schema_migrations
   where version in ('20261124000100', '20261127000100', '20261128000100');
  if v_already is not null then
    raise exception 'Nothing was changed: already recorded: %. This script records all three or none; send this message to the developer.', v_already;
  end if;

  select string_agg(v, ', ' order by v) into v_missing
    from unnest(array['20261024000100', '20261024000300', '20261115000100']) v
   where not exists (select 1 from supabase_migrations.schema_migrations m where m.version = v);
  if v_missing is not null then
    raise exception 'Nothing was changed: the step(s) these build on are not recorded (%). Run the migrations in order.', v_missing;
  end if;
end
$preflight$;

-- -------------------------------------------------------------------------
-- 20261124000100_prayer_library_collections really is applied:
-- the table with exactly one active General prayers row, the column on
-- library_prayers, every collection function with the signature the
-- migration gave it, the grants (entry points for authenticated only, never
-- anon or service_role; internal helpers and the table closed to every API
-- role), and the collection known to the list and the card.
-- -------------------------------------------------------------------------
do $collections$
declare
  v_fn text;
begin
  if to_regclass('prayer.library_collections') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'prayer' and table_name = 'library_prayers' and column_name = 'collection_id') then
    raise exception 'Nothing was changed: the Prayer Library collections step (20261124000100) is not in this database. Apply supabase/migrations/20261124000100_prayer_library_collections.sql first.';
  end if;
  if (select count(*) from prayer.library_collections where is_general and archived_at is null) <> 1 then
    raise exception 'Nothing was changed: there is not exactly one active General prayers collection. Send this message to the developer.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'prayer.library_collections'::regclass)
     or has_table_privilege('anon', 'prayer.library_collections', 'select')
     or has_table_privilege('authenticated', 'prayer.library_collections', 'select')
     or has_table_privilege('service_role', 'prayer.library_collections', 'select') then
    raise exception 'Nothing was changed: prayer.library_collections is not closed with row level security on. Send this message to the developer.';
  end if;

  -- Entry points: authenticated only.
  foreach v_fn in array array[
    'public.prayer_library_collections()',
    'public.prayer_library_collection(uuid)',
    'public.prayer_library_admin_collections()',
    'public.prayer_library_admin_collection(uuid)',
    'public.prayer_library_admin_collection_prayers(uuid, text, timestamptz, uuid, integer)',
    'public.prayer_library_collection_save(uuid, text, text, text)',
    'public.prayer_library_collection_move(uuid, text)',
    'public.prayer_library_collection_cover(uuid, text, text)',
    'public.prayer_library_collection_archive(uuid, boolean, uuid)',
    'public.prayer_library_reassign(uuid[], uuid)',
    'public.prayer_library_can_read_cover(text)',
    'public.prayer_library_can_manage_covers()',
    'public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer, uuid)',
    'public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid, uuid)']
  loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Nothing was changed: % is missing, so the collections step (20261124000100) is not fully applied. Send this message to the developer.', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Nothing was changed: the grants on % are not as expected. Send this message to the developer.', v_fn;
    end if;
  end loop;

  -- Internal helpers: closed to every API role.
  foreach v_fn in array array[
    'prayer.library_collection_count(uuid)',
    'prayer.library_collection_json(prayer.library_collections, integer)',
    'prayer.library_visible_collection(uuid)',
    'prayer.library_collection_admin_json(prayer.library_collections)',
    'prayer.library_shared(prayer.library_prayers)']
  loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Nothing was changed: the internal helper % is missing, so the collections step (20261124000100) is not fully applied. Send this message to the developer.', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Nothing was changed: the internal helper % is not closed. Send this message to the developer.', v_fn;
    end if;
  end loop;

  -- The replaced functions really know about collections.
  if pg_get_functiondef(to_regprocedure('public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer, uuid)')) not like '%collection%'
     or pg_get_functiondef(to_regprocedure('prayer.library_card(prayer.library_prayers, uuid)')) not like '%collection%'
     or pg_get_functiondef(to_regprocedure('public.prayer_library_meta()')) not like '%collection%' then
    raise exception 'Nothing was changed: the functions the collections step replaced are not the new ones. Send this message to the developer.';
  end if;
end
$collections$;

-- -------------------------------------------------------------------------
-- 20261127000100_prayer_body_length really is applied: the one-argument
-- prayer.clean_body exists, the Prayer Library's body check no longer names
-- a ceiling, a 20,000-character prayer is kept whole, and
-- public.prayer_library_save cleans the body with the helper.
-- -------------------------------------------------------------------------
do $prayer_length$
declare
  v_check text;
  v_long text := repeat('x', 20000);
begin
  if to_regprocedure('prayer.clean_body(text)') is null then
    raise exception 'Nothing was changed: the prayer body length step (20261127000100) is not in this database. Run supabase/manual/2026-11-27-apply-prayer-body-length.sql first.';
  end if;
  if has_function_privilege('anon', 'prayer.clean_body(text)', 'execute')
     or has_function_privilege('authenticated', 'prayer.clean_body(text)', 'execute')
     or has_function_privilege('service_role', 'prayer.clean_body(text)', 'execute') then
    raise exception 'Nothing was changed: prayer.clean_body(text) is not closed to the API roles. Send this message to the developer.';
  end if;
  select pg_get_constraintdef(oid) into v_check
    from pg_constraint where conname = 'library_prayers_body_check' and conrelid = 'prayer.library_prayers'::regclass;
  if v_check is null or v_check ~ '\d{3,}' then
    raise exception 'Nothing was changed: the Prayer Library body check still names a ceiling (%), so 20261127000100 is not applied. Send this message to the developer.', coalesce(v_check, 'missing');
  end if;
  if prayer.clean_body(v_long) is distinct from v_long then
    raise exception 'Nothing was changed: a 20,000-character prayer is not kept whole, so 20261127000100 is not applied. Send this message to the developer.';
  end if;
  if pg_get_functiondef(to_regprocedure('public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid, uuid)')) not like '%clean_body%' then
    raise exception 'Nothing was changed: prayer_library_save does not use prayer.clean_body, so 20261127000100 is not applied. Send this message to the developer.';
  end if;
end
$prayer_length$;

-- -------------------------------------------------------------------------
-- 20261128000100_prayer_request_body_length really is applied: the
-- two-argument prayer.clean_body exists and keeps a 20,000-character request
-- whole, the one-argument one now delegates to it in the Prayer Library's own
-- words, the request body check no longer names a ceiling, and
-- public.prayer_request_save cleans the body with the helper.
-- -------------------------------------------------------------------------
do $request_length$
declare
  v_check text;
  v_long text := repeat('y', 20000);
begin
  if to_regprocedure('prayer.clean_body(text, text)') is null then
    raise exception 'Nothing was changed: the prayer request body length step (20261128000100) is not in this database. Run supabase/manual/2026-11-28-apply-prayer-request-body-length.sql first.';
  end if;
  if has_function_privilege('anon', 'prayer.clean_body(text, text)', 'execute')
     or has_function_privilege('authenticated', 'prayer.clean_body(text, text)', 'execute')
     or has_function_privilege('service_role', 'prayer.clean_body(text, text)', 'execute') then
    raise exception 'Nothing was changed: prayer.clean_body(text, text) is not closed to the API roles. Send this message to the developer.';
  end if;
  select pg_get_constraintdef(oid) into v_check
    from pg_constraint where conname = 'requests_body_check' and conrelid = 'prayer.requests'::regclass;
  if v_check is null or v_check ~ '\d{3,}' then
    raise exception 'Nothing was changed: the prayer request body check still names a ceiling (%), so 20261128000100 is not applied. Send this message to the developer.', coalesce(v_check, 'missing');
  end if;
  if prayer.clean_body(v_long, 'Your request') is distinct from v_long then
    raise exception 'Nothing was changed: a 20,000-character request is not kept whole, so 20261128000100 is not applied. Send this message to the developer.';
  end if;
  -- The Prayer Library keeps its own wording through the one-argument helper.
  if pg_get_functiondef(to_regprocedure('prayer.clean_body(text)')) not like '%The prayer%' then
    raise exception 'Nothing was changed: the one-argument prayer.clean_body does not delegate in the Prayer Library''s words, so 20261128000100 is not applied. Send this message to the developer.';
  end if;
  if pg_get_functiondef(to_regprocedure('public.prayer_request_save(uuid, text, text, text, uuid, boolean, boolean, text, uuid)')) not like '%clean_body%' then
    raise exception 'Nothing was changed: prayer_request_save does not use prayer.clean_body, so 20261128000100 is not applied. Send this message to the developer.';
  end if;
end
$request_length$;

-- -------------------------------------------------------------------------
-- All three are in place: record them.
-- -------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name, created_by) values
  ('20261124000100', 'prayer_library_collections', 'prayer-library-collections'),
  ('20261127000100', 'prayer_body_length', 'prayer-body-length'),
  ('20261128000100', 'prayer_request_body_length', 'prayer-request-body-length');

commit;

-- The read-only check afterwards:
--
--   select version, name, created_by from supabase_migrations.schema_migrations
--    where version in ('20261124000100', '20261127000100', '20261128000100')
--    order by version;
--
-- Expected: three rows, in that order, with the names and created_by values
-- above. Then supabase/manual/2026-11-29-apply-prayer-member-collections.sql
-- can run — it is still outstanding, and its own preflight will say so.
