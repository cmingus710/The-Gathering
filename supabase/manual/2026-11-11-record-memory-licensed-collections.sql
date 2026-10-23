-- Licensed versions in memory collections · Record migration
-- 20261111000100_memory_licensed_collections on the hosted project.
--
-- The migration's schema is already on hosted: it was run in the SQL editor
-- without a history row (the version it was written under, 20261109000100,
-- belongs to media_video_kind). A read-only check on 2026-10-23 found all 22
-- of its functions identical to the repository's (md5 of
-- pg_get_functiondef). This only adds the history row, so the repository and
-- hosted history agree. It changes no schema and no data.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if to_regprocedure('public.memory_translation_options()') is null
     or to_regprocedure('public.memory_admin_item_update_text(uuid, text, jsonb)') is null
     or to_regprocedure('memory.translation_eligibility(uuid)') is null then
    raise exception 'Nothing was changed: the migration''s functions are missing. Run 2026-11-11-apply-memory-licensed-collections.sql instead.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261111000100') then
    raise exception 'Nothing was changed: 20261111000100 is already recorded.';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261111000100', 'memory_licensed_collections', 'memory-licensed-collections');

commit;
