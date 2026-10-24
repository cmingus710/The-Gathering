-- Media gallery album covers · Record migration 20261119000100_gallery_album_covers
-- on the hosted project.
--
-- The migration's SQL was applied in the SQL editor on 2026-10-24, when the
-- file was still numbered 20261118000100. That version is already recorded
-- as devotional_collections, so the album covers have no history row. This
-- checks that the album covers' objects exist and only adds the history row,
-- so the repository and hosted history agree. It changes no schema and no
-- data.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if to_regclass('media.album_cover_uploads') is null
     or (select count(*) from information_schema.columns
          where table_schema = 'media' and table_name = 'albums'
            and column_name in ('cover_path', 'cover_thumb_path', 'cover_width', 'cover_height', 'cover_alt',
                                'cover_framing', 'cover_set_by', 'cover_set_at')) <> 8
     or to_regprocedure('public.media_admin_album_cover_begin(uuid, text, bigint)') is null
     or to_regprocedure('public.media_admin_album_cover_processing(uuid)') is null
     or to_regprocedure('public.media_admin_album_cover_ready(uuid, text, text, integer, integer, text, jsonb, boolean)') is null
     or to_regprocedure('public.media_admin_album_cover_fail(uuid, text)') is null
     or to_regprocedure('public.media_admin_album_cover_choose(uuid, uuid, jsonb)') is null
     or to_regprocedure('public.media_admin_album_cover_framing(uuid, text, jsonb, text)') is null
     or to_regprocedure('public.media_admin_album_cover_remove(uuid)') is null
     or to_regprocedure('public.media_album_cover_can_read_object(text, text)') is null
     or (select count(*) from pg_policies
          where schemaname = 'storage' and tablename = 'objects' and policyname like 'Album covers%') <> 3 then
    raise exception 'Nothing was changed: the album covers'' objects are missing. Run supabase/migrations/20261119000100_gallery_album_covers.sql first.';
  end if;
  if has_function_privilege('anon', 'public.media_admin_album_cover_begin(uuid, text, bigint)', 'execute') then
    raise exception 'Nothing was changed: anon can call media_admin_album_cover_begin. Rerun the migration''s grants section.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261119000100') then
    raise exception 'Nothing was changed: 20261119000100 is already recorded.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261118000100' and name = 'devotional_collections') then
    raise exception 'Nothing was changed: 20261118000100 isn''t recorded as devotional_collections. Check the history before recording album covers.';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261119000100', 'gallery_album_covers', 'gallery-album-covers');

commit;
