-- Bible imports: refresh planner statistics after bulk staging and publishing.
--
-- On the hosted project, the first review-page load after staging a whole
-- Bible (31,000+ lines) and the finishing step of a later import ran past the
-- API's 8-second statement timeout: autovacuum hadn't analyzed
-- bible.staged_verses yet, so the planner still assumed it was (nearly)
-- empty. Both functions now ANALYZE the tables they have just filled. Bodies
-- are otherwise unchanged from 20261026000200_bible_sources.sql; grants are
-- kept by CREATE OR REPLACE.

create or replace function public.bible_admin_import_finish(p_id uuid, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  i bible.imports;
  v_summary jsonb;
begin
  select * into i from bible.imports where id = p_id and created_by = v_uid and status = 'processing' for update;
  if not found then
    raise exception 'This import isn''t being processed.' using errcode = '22023';
  end if;
  if p_error is not null then
    delete from bible.staged_verses where import_id = p_id;
    update bible.imports set status = 'failed', error = left(p_error, 300), processed_at = now(), rows_staged = 0 where id = p_id;
    perform bible.audit('bible.import_failed', 'bible_import', p_id, '{}'::jsonb);
    return jsonb_build_object('id', p_id, 'status', 'failed');
  end if;
  -- The staged lines arrive in bulk just before this; refresh the planner's
  -- statistics so the checks below (and the review page) don't plan for an
  -- empty table and run past the API's statement timeout.
  analyze bible.staged_verses;
  -- Later lines repeating a verse are duplicates (the first one stays).
  update bible.staged_verses s set issue = 'duplicate'
    from (select line_no, row_number() over (partition by book_code, chapter, verse order by line_no) as n
            from bible.staged_verses where import_id = p_id and issue is null) d
   where s.import_id = p_id and s.line_no = d.line_no and d.n > 1;
  -- Verses beyond the reference versification (needs acceptance).
  update bible.staged_verses s set issue = 'out_of_range'
    from bible.books b
   where s.import_id = p_id and s.issue is null and b.code = s.book_code
     and (s.chapter > cardinality(b.chapter_verses) or s.verse > b.chapter_verses[s.chapter]);
  -- A verse number with no text (needs acceptance as deliberately omitted).
  update bible.staged_verses s set issue = 'empty'
   where s.import_id = p_id and s.issue is null and btrim(s.text) = '';
  v_summary := bible.import_summary(p_id);
  update bible.imports set status = 'staged', summary = v_summary, processed_at = now(), error = null where id = p_id;
  perform bible.audit('bible.import_staged', 'bible_import', p_id, v_summary);
  return jsonb_build_object('id', p_id, 'status', 'staged', 'summary', v_summary);
end;
$$;

create or replace function public.bible_admin_import_publish(p_id uuid, p_confirm text, p_acknowledge_missing boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  i bible.imports;
  t bible.translations;
  s jsonb;
  v_count integer;
  v_problems integer;
begin
  select * into i from bible.imports where id = p_id for update;
  if not found or i.status <> 'staged' then
    raise exception 'Only a staged import can be published.' using errcode = '22023';
  end if;
  select * into t from bible.translations where id = i.translation_id for update;
  if p_confirm is distinct from t.code then
    raise exception 'Type the translation code to confirm publication.' using errcode = '22023';
  end if;
  s := bible.import_summary(p_id);
  if (s ->> 'duplicate')::integer > 0 then
    raise exception 'Some verses appear more than once. Correct the source file and import it again.' using errcode = '22023';
  end if;
  if exists (select 1 from bible.staged_verses where import_id = p_id and issue is not null and not accepted) then
    raise exception 'Review every flagged line before publishing.' using errcode = '22023';
  end if;
  if (s ->> 'verses')::integer + (select count(*) from bible.staged_verses where import_id = p_id and issue in ('out_of_range', 'empty') and accepted) = 0 then
    raise exception 'There is no text to publish.' using errcode = '22023';
  end if;
  if (s ->> 'missing')::integer > 0 and not coalesce(p_acknowledge_missing, false) then
    raise exception 'Acknowledge the missing verses before publishing.' using errcode = '22023';
  end if;

  delete from bible.verses where translation_id = t.id;
  insert into bible.verses (translation_id, book_code, chapter, verse, text, omitted, heading, para_start, poetry)
  select t.id, s2.book_code, s2.chapter, s2.verse,
         case when s2.issue = 'empty' then '' else s2.text end, coalesce(s2.issue = 'empty', false), s2.heading, s2.para_start, s2.poetry
    from bible.staged_verses s2
   where s2.import_id = p_id and (s2.issue is null or (s2.issue in ('out_of_range', 'empty') and s2.accepted));
  get diagnostics v_count = row_count;
  update bible.translations set verse_count = v_count, text_version = text_version + 1, updated_at = now() where id = t.id;
  update bible.imports set status = 'published', published_at = now(), published_by = v_uid, summary = s,
                           review_note = left(nullif(btrim(p_note), ''), 1000)
   where id = p_id;
  -- Staged lines are no longer needed (the summary is kept).
  delete from bible.staged_verses where import_id = p_id;
  -- The translation's text was just replaced in bulk; refresh statistics so
  -- the first readers aren't planned against the old row counts.
  analyze bible.verses;
  analyze bible.staged_verses;
  -- Plan passages that no longer fit the new text (reported, not changed).
  select count(*) into v_problems from bible.plan_passages pp
    join bible.plan_days d on d.id = pp.day_id and d.retired_at is null
    join bible.plans p on p.id = d.plan_id and p.translation_id = t.id and p.status <> 'archived'
   where bible.passage_problem(t.id, pp.book_code, pp.start_chapter, pp.start_verse, pp.end_chapter, pp.end_verse) is not null;
  perform bible.audit('bible.import_published', 'bible_import', p_id,
                      jsonb_build_object('translation', t.code, 'verses', v_count, 'missing', s -> 'missing', 'plan_passage_problems', v_problems));
  return jsonb_build_object('id', p_id, 'status', 'published', 'verses', v_count, 'plan_passage_problems', v_problems);
end;
$$;
