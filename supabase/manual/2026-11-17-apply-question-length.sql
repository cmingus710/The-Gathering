-- Questions up to 1,000 characters · Apply migration
-- 20261117000100_question_length to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "Questions up to 1,000
-- characters"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: bible.clean_questions keeps up to 1,000 characters of each
-- reflection question (was 500), and the journal.entries.question check
-- allows 1,000 (every value allowed before is still allowed, so no row is
-- rewritten; adding the check re-validates the existing rows). No function
-- signature, grant, or policy changes.
--
-- It copies supabase/migrations/20261117000100_question_length.sql verbatim
-- and records it under its repository version (created_by =
-- question-length). All or nothing: one transaction; out of order or a
-- second run stops at the preflight with "Nothing was changed".
-- It needs the Bible plans (20261026000300) and journal (20261026000500) steps.
begin;

do $preflight$
begin
  if to_regprocedure('bible.clean_questions(jsonb)') is null or to_regclass('journal.entries') is null
     or not exists (select 1 from pg_constraint where conrelid = 'journal.entries'::regclass and conname = 'entries_question_check') then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000500') then
    raise exception 'Nothing was changed: the journal step (20261026000500) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261117000100') then
    raise exception 'Nothing was changed: 20261117000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261117000100_question_length.sql
-- =========================================================================
-- Questions · up to 1,000 characters each (additive).
--
-- Reflection questions (Bible plan days) and discussion questions (content)
-- are now edited one per box and may run to several paragraphs, so the limit
-- per question goes from 500 to 1,000 characters:
--
--   * bible.clean_questions (used by every day save, revision, and import)
--     now keeps up to 1,000 characters of each question instead of cutting
--     at 500. Still at most 5 questions, trimmed, empty ones dropped.
--   * journal.entries.question (the question a journal answer is about, as it
--     read when chosen) now allows 1,000 characters, so an answer can link to
--     any question a day can hold. Every value the old check allowed is still
--     allowed, so no row is rewritten.
--
-- media.items.questions has no per-question length in the database (the app
-- checks it), so content questions need no change here. No function
-- signature, grant, or policy changes.

create or replace function bible.clean_questions(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select left(btrim(q), 1000) from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) q
                         where btrim(q) <> '' limit 5), '{}');
$$;

alter table journal.entries drop constraint entries_question_check;
alter table journal.entries add constraint entries_question_check check (char_length(question) <= 1000);

-- Expected afterwards: a 1,000-character question is kept whole, and longer
-- ones are cut at 1,000.
do $check$
begin
  if char_length((bible.clean_questions(jsonb_build_array(repeat('q', 1000))))[1]) <> 1000
     or char_length((bible.clean_questions(jsonb_build_array(repeat('q', 1200))))[1]) <> 1000 then
    raise exception 'Nothing was changed: questions are not kept up to 1,000 characters. Send this message to the developer.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'journal.entries'::regclass and conname = 'entries_question_check')) not like '%1000%' then
    raise exception 'Nothing was changed: the journal question check was not widened. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261117000100', 'question_length', 'question-length');

commit;
