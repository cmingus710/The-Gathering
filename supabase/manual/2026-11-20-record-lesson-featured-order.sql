-- Sunday lessons featured lesson and date order · Record migration
-- 20261120000100_lesson_featured_order on the hosted project.
--
-- The migration's SQL was applied in the SQL editor on 2026-10-24, when the
-- file was still numbered 20261119000100. That version is already recorded
-- as gallery_album_covers, so the lessons change has no history row. This
-- checks that its objects and grants are in place and only adds the history
-- row, so the repository and hosted history agree. It changes no schema and
-- no data.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if to_regprocedure('public.media_lessons(jsonb, integer, integer)') is null
     or to_regprocedure('media.lessons_page(uuid, date, jsonb, integer, integer)') is null
     or to_regprocedure('media.church_date_at(timestamptz)') is null
     or (select prosrc from pg_proc where oid = 'media.church_today()'::regprocedure) not like '%church_date_at%' then
    raise exception 'Nothing was changed: the lessons objects are missing. Run supabase/migrations/20261120000100_lesson_featured_order.sql first.';
  end if;
  if not has_function_privilege('anon', 'public.media_lessons(jsonb, integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.media_lessons(jsonb, integer, integer)', 'execute')
     or has_function_privilege('service_role', 'public.media_lessons(jsonb, integer, integer)', 'execute')
     or has_function_privilege('anon', 'media.lessons_page(uuid, date, jsonb, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'media.lessons_page(uuid, date, jsonb, integer, integer)', 'execute')
     or has_function_privilege('anon', 'media.church_date_at(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'media.church_date_at(timestamptz)', 'execute') then
    raise exception 'Nothing was changed: the lessons grants are not as expected. Rerun the migration''s grants section.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261120000100') then
    raise exception 'Nothing was changed: 20261120000100 is already recorded.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261119000100' and name = 'gallery_album_covers') then
    raise exception 'Nothing was changed: 20261119000100 isn''t recorded as gallery_album_covers. Check the history before recording the lessons change.';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261120000100', 'lesson_featured_order', 'lesson-featured-order');

commit;
