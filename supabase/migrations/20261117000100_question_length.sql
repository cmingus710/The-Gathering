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
