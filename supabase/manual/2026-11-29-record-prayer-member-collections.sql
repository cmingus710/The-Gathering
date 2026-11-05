-- Prayer Library member collections · Record migration
-- 20261129000100_prayer_member_collections on the hosted project when its
-- SQL was already run without a history row.
--
-- Use this ONLY if the migration's SQL was pasted and run on its own (so
-- public.prayer_library_collection_add exists) and 20261129000100 isn't
-- recorded. Otherwise use
-- 2026-11-29-apply-prayer-member-collections.sql.
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Changes nothing but the history row. All or nothing: the preflight checks
-- that every part of the migration is in place (the new function, the four
-- replaced functions, the grants, the closed helpers and table) before
-- recording it (created_by = prayer-member-collections).
--
-- The migration was numbered 20261127000100 when it was written; hosted
-- already holds that version for prayer_body_length, so it is recorded here
-- as 20261129000100. Its SQL is unchanged.
begin;

do $preflight$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261129000100') then
    raise exception 'Nothing was changed: 20261129000100 is already recorded.';
  end if;
  if to_regprocedure('public.prayer_library_collection_add(text, text)') is null
     or to_regclass('prayer.library_collections') is null
     or to_regprocedure('public.prayer_library_collections()') is null
     or to_regprocedure('prayer.library_visible_collection(uuid)') is null
     or to_regprocedure('prayer.library_collection_json(prayer.library_collections, integer)') is null
     or to_regprocedure('prayer.library_collection_admin_json(prayer.library_collections)') is null
     or pg_get_functiondef(to_regprocedure('prayer.library_collection_json(prayer.library_collections, integer)')) not like '%''mine''%'
     or pg_get_functiondef(to_regprocedure('prayer.library_collection_admin_json(prayer.library_collections)')) not like '%''started_by''%'
     or pg_get_functiondef(to_regprocedure('prayer.library_visible_collection(uuid)')) not like '%created_by%'
     or pg_get_functiondef(to_regprocedure('public.prayer_library_collections()')) not like '%created_by%' then
    raise exception 'Nothing was changed: the member collections migration is not (fully) in this database. Use 2026-11-29-apply-prayer-member-collections.sql.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261124000100') then
    raise exception 'Nothing was changed: the Prayer Library collections step (20261124000100) is not recorded. Send this message to the developer.';
  end if;
end
$preflight$;

do $check$
begin
  if not has_function_privilege('authenticated', 'public.prayer_library_collection_add(text, text)', 'execute')
     or has_function_privilege('anon', 'public.prayer_library_collection_add(text, text)', 'execute')
     or has_function_privilege('service_role', 'public.prayer_library_collection_add(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.prayer_library_collections()', 'execute')
     or not has_function_privilege('authenticated', 'public.prayer_library_collection(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.prayer_library_admin_collections()', 'execute')
     or has_function_privilege('anon', 'public.prayer_library_collections()', 'execute')
     or has_function_privilege('anon', 'public.prayer_library_collection(uuid)', 'execute')
     or has_function_privilege('authenticated', 'prayer.library_collection_json(prayer.library_collections, integer)', 'execute')
     or has_function_privilege('authenticated', 'prayer.library_visible_collection(uuid)', 'execute')
     or has_function_privilege('authenticated', 'prayer.library_collection_admin_json(prayer.library_collections)', 'execute')
     or has_function_privilege('authenticated', 'prayer.library_collection_count(uuid)', 'execute')
     or has_table_privilege('authenticated', 'prayer.library_collections', 'select')
     or has_table_privilege('anon', 'prayer.library_collections', 'select')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'prayer_library_collection_add'
                       and p.prosecdef
                       and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=', 'search_path=""')))
     or (select count(*) from prayer.library_collections where is_general and archived_at is null) <> 1 then
    raise exception 'Nothing was changed: the prayer collection grants or the General prayers collection are not as expected. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261129000100', 'prayer_member_collections', 'prayer-member-collections');

commit;
