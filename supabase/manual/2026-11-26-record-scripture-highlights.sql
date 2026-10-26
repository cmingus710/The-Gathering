-- Scripture highlights · Record migration 20261126000100_scripture_highlights
-- on the hosted project when its SQL was already run without a history row.
--
-- Use this ONLY if the migration's SQL was pasted and run on its own (so
-- public.bible_highlight_apply exists) and 20261126000100 isn't recorded.
-- Otherwise use 2026-11-26-apply-scripture-highlights.sql.
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Changes nothing but the history row. All or nothing: the preflight checks
-- that every part of the migration is in place (functions, grants, both
-- new colors, the new columns on every row) before recording it
-- (created_by = scripture-highlights).
begin;

do $preflight$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126000100') then
    raise exception 'Nothing was changed: 20261126000100 is already recorded.';
  end if;
  if to_regprocedure('public.bible_highlight_apply(jsonb)') is null
     or to_regprocedure('public.bible_highlight_passages(jsonb)') is null
     or to_regprocedure('bible.highlight_rows(uuid, uuid, text, integer)') is null
     or to_regprocedure('bible.highlight_color_ok(text)') is null
     or to_regclass('bible.highlight_revisions') is null
     or to_regclass('bible.highlights_profile_recent_idx') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'bible' and table_name = 'highlights' and column_name = 'revision')
     or not exists (select 1 from information_schema.columns where table_schema = 'bible' and table_name = 'highlights' and column_name = 'updated_at') then
    raise exception 'Nothing was changed: the Scripture highlights migration is not (fully) in this database. Use 2026-11-26-apply-scripture-highlights.sql.';
  end if;
end
$preflight$;

do $check$
begin
  if has_function_privilege('anon', 'public.bible_highlight_apply(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.bible_highlight_passages(jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.bible_highlight_apply(jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.bible_highlight_passages(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.bible_highlight_apply(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.bible_highlight_passages(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.bible_highlights(uuid, text, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.bible_highlight_set(uuid, text, integer, integer[], text)', 'execute')
     or has_function_privilege('anon', 'public.bible_highlights(uuid, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'bible.highlight_rows(uuid, uuid, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'bible.highlight_color_ok(text)', 'execute')
     or has_table_privilege('authenticated', 'bible.highlights', 'select')
     or has_table_privilege('anon', 'bible.highlights', 'select')
     or not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'bible' and t.typname = 'highlight_color' and e.enumlabel = 'purple')
     or not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'bible' and t.typname = 'highlight_color' and e.enumlabel = 'orange')
     or exists (select 1 from bible.highlights where updated_at is null or revision is null) then
    raise exception 'Nothing was changed: the highlight grants, colors, or columns are not as expected. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261126000100', 'scripture_highlights', 'scripture-highlights');

commit;
