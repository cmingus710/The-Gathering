-- All six memory exercises for licensed versions · Record migration
-- 20261125000100_memory_provider_exercises on the hosted project.
--
-- The migration's schema is already on hosted: it was run in the SQL editor
-- without its history row. A read-only check on 2026-10-26 (owner's SQL
-- editor) found the new functions present with the expected grants
-- (memory_card_parts callable by authenticated, not by anon;
-- memory.provider_text not callable by clients), no exercise permission on,
-- and AMP, NASB, and NIV still limited to flashcards and self-check.
--
-- This only verifies that state and adds the history row. It changes no
-- schema and no data. Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if to_regprocedure('public.memory_card_parts(uuid, jsonb)') is null
     or to_regprocedure('public.memory_admin_provider_exercises_save(uuid, jsonb)') is null
     or to_regprocedure('memory.provider_text(memory.passages, jsonb)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'memory' and table_name = 'provider_permissions' and column_name = 'exercise_modes') then
    raise exception 'Nothing was changed: the migration''s schema is missing. Run 2026-11-25-apply-memory-provider-exercises.sql instead.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125000100') then
    raise exception 'Nothing was changed: 20261125000100 is already recorded.';
  end if;
  if exists (select 1 from memory.provider_permissions where exercise_modes) then
    raise exception 'Nothing was changed: an exercise permission is already on. Send this message to the developer.';
  end if;
  -- NIV's direct Biblica agreement must be marked (the migration sets it on NIV's existing row).
  if exists (select 1 from memory.provider_permissions pp join bible.translations t on t.id = pp.translation_id
              where t.code = 'NIV' and not pp.publisher_approval_required) then
    raise exception 'Nothing was changed: NIV isn''t marked as needing Biblica''s feature approval. Send this message to the developer.';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261125000100', 'memory_provider_exercises', 'memory-provider-exercises');

commit;
