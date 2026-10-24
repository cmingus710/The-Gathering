-- Learn & Play activities · Record migration 20261118000200_youth_activities
-- on the hosted project.
--
-- The migration was first numbered 20261118000100, which is recorded on
-- hosted as devotional_collections. Its SQL was run in the SQL editor, so the
-- objects exist but have no history row (checked read-only 2026-10-24). This
-- checks that the objects exist and only adds the history row. It changes no
-- schema and no data.
--
-- If it stops with "objects are missing", the migration was never applied:
-- run supabase/manual/2026-11-18-apply-youth-activities.sql instead.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261118000200') then
    raise exception 'Nothing was changed: 20261118000200 is already recorded.';
  end if;
  if to_regclass('youth.activities') is null or to_regclass('youth.activity_versions') is null
     or to_regclass('youth.activity_assets') is null or to_regclass('youth.activity_groups') is null
     or to_regclass('youth.activity_progress') is null
     or to_regprocedure('public.youth_activities_home()') is null
     or to_regprocedure('public.youth_admin_activity_groups()') is null
     or not exists (select 1 from pg_trigger where tgname = 'activity_versions_immutable')
     or pg_get_functiondef('public.youth_can_read_object(text)'::regprocedure) not like '%activity_object_readable%'
     or pg_get_functiondef('public.youth_me()'::regprocedure) not like '%youth.activities%'
     or (select array_agg(capability_key) from public.role_capabilities where role_key = 'youth_activity_editor') is distinct from array['youth.activities'] then
    raise exception 'Nothing was changed: the Learn & Play objects are missing. Run supabase/manual/2026-11-18-apply-youth-activities.sql instead.';
  end if;
  if has_function_privilege('anon', 'public.youth_activities_home()', 'execute')
     or not has_function_privilege('authenticated', 'public.youth_activity_progress_save(uuid, uuid, uuid, jsonb)', 'execute')
     or has_table_privilege('authenticated', 'youth.activity_progress', 'select') then
    raise exception 'Nothing was changed: the grants are not as expected. Rerun the migration''s last two statements (revoke/grant).';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261118000200', 'youth_activities', 'youth-activities');

commit;
