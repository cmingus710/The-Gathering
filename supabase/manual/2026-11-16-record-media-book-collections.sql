-- Book collections · Record migration 20261116000100_media_book_collections
-- on the hosted project.
--
-- The migration was first numbered 20261115000100, which is recorded on
-- hosted as prayer_library. If its SQL was run in the SQL editor under that
-- number, the objects exist but have no history row. This checks that the
-- objects exist and only adds the history row. It changes no schema and no
-- data.
--
-- If it stops with "objects are missing", the migration was never applied:
-- run supabase/manual/2026-11-16-apply-media-book-collections.sql instead.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261116000100') then
    raise exception 'Nothing was changed: 20261116000100 is already recorded.';
  end if;
  if to_regprocedure('media.topic_name(text)') is null
     or to_regprocedure('public.media_book_collections()') is null
     or to_regprocedure('public.media_books(uuid, text)') is null
     or not exists (select 1 from pg_constraint where conname = 'topics_name_normalized' and conrelid = 'media.topics'::regclass) then
    raise exception 'Nothing was changed: the book collection objects are missing. Run supabase/manual/2026-11-16-apply-media-book-collections.sql instead.';
  end if;
  if has_function_privilege('anon', 'public.media_books(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.media_book_collections()', 'execute')
     or not has_function_privilege('authenticated', 'public.media_books(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.media_book_collections()', 'execute') then
    raise exception 'Nothing was changed: the grants are not as expected. Rerun the migration''s last three lines (revoke/grant).';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261116000100', 'media_book_collections', 'media-book-collections');

commit;
