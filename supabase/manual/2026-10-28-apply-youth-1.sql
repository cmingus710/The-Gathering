-- Phase 10 · Step 1 of 9: apply migration 20261028000100_youth_event_audience to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- The youth event audience (an enum value, alone because it can't be used in the transaction that adds it).
--
-- It copies supabase/migrations/20261028000100_youth_event_audience.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-10).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('memory.cards') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261027000500') then
    raise exception 'Nothing was changed: the previous step (20261027000500) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000100') then
    raise exception 'Nothing was changed: 20261028000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261028000100_youth_event_audience.sql
-- =========================================================================
-- Phase 10 · Youth ministry and families, step 1: the youth event audience.
--
-- A new enum value can't be used in the transaction that adds it, so this
-- migration does nothing else. Youth events reuse the Phase 4 events system
-- (series, occurrences, capacity, deadlines, waitlists) with
-- `audience = 'youth'`; who may see and register for them is decided by the
-- youth schema in the following migrations. Until a youth group is attached
-- (youth.event_settings), a youth-audience event is visible to nobody.
alter type events.audience add value if not exists 'youth';

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261028000100', 'youth_event_audience', 'phase-10');

commit;
