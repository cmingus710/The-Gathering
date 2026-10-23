-- Prayer Library · Record migration 20261115000100_prayer_library on the
-- hosted project.
--
-- The migration's SQL was applied in the SQL editor on 2026-10-23, when the
-- file was still numbered 20261113000100. That version is already recorded
-- as member_notification_all, so the library has no history row. This checks
-- that the library's objects exist and only adds the history row, so the
-- repository and hosted history agree. It changes no schema and no data.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if to_regclass('prayer.library_prayers') is null
     or to_regclass('prayer.library_categories') is null
     or to_regclass('prayer.library_prayer_categories') is null
     or to_regclass('prayer.library_saves') is null
     or to_regclass('prayer.library_reports') is null
     or to_regprocedure('public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer)') is null
     or to_regprocedure('public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid)') is null
     or to_regprocedure('public.prayer_library_mod_action(uuid, text, text, uuid)') is null
     or to_regprocedure('public.prayer_library_category_archive(uuid, boolean)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'prayer' and table_name = 'moderation_log' and column_name = 'library_report_id') then
    raise exception 'Nothing was changed: the Prayer Library''s objects are missing. Run supabase/migrations/20261115000100_prayer_library.sql first.';
  end if;
  if has_function_privilege('anon', 'public.prayer_library_list(text, text, uuid, uuid, uuid, timestamptz, uuid, integer)', 'execute') then
    raise exception 'Nothing was changed: anon can call prayer_library_list. Rerun the migration''s grants section.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115000100') then
    raise exception 'Nothing was changed: 20261115000100 is already recorded.';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261115000100', 'prayer_library', 'prayer-library');

commit;
