-- My Journal · lesson answers and notes · Apply migration
-- 20261120000100_journal_lesson_workbooks to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "My Journal: lesson
-- answers and notes"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Moves members' lesson answers and notes into My Journal: two journal link
-- kinds, the lesson workbook functions re-pointed at journal.entries (same
-- names and results), and a one-time copy of every existing answer and note
-- with owner, text, version, timestamps, lesson, question, and wording.
-- media.workbook_answers and media.workbook_notes are left unchanged as the
-- pre-migration copy. The copy is checked inside the transaction
-- (journal.verify_workbook_import): if any row isn't copied exactly, nothing
-- is changed.
--
-- It copies supabase/migrations/20261120000100_journal_lesson_workbooks.sql
-- verbatim and records it under its repository version (created_by =
-- journal-lesson-workbooks). All or nothing: one transaction; out of order
-- or a second run stops at the preflight with "Nothing was changed".
-- It needs the lesson workbooks (20261031000300) and devotional collections
-- (20261118000100) steps.
--
-- Before running, note the counts (read-only) to compare with the result:
--   select (select count(*) from media.workbook_answers) answers, (select count(*) from media.workbook_notes) notes;
begin;

do $preflight$
begin
  if to_regclass('journal.entries') is null or to_regclass('media.workbook_answers') is null or to_regclass('media.workbook_notes') is null
     or to_regprocedure('public.media_workbook_answer_save(uuid, uuid, text, integer, boolean)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'journal' and table_name = 'entries' and column_name = 'collection_reading_id') then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000300')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261118000100') then
    raise exception 'Nothing was changed: the lesson workbooks (20261031000300) or devotional collections (20261118000100) step is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261120000100')
     or exists (select 1 from information_schema.columns where table_schema = 'journal' and table_name = 'entries' and column_name = 'lesson_block_id') then
    raise exception 'Nothing was changed: 20261120000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261120000100_journal_lesson_workbooks.sql
-- =========================================================================
-- My Journal · lesson answers and notes move into the journal.
--
-- Until now a member's personal writing lived in two places: My Journal
-- (journal.entries) and lesson workbooks (media.workbook_answers and
-- media.workbook_notes, 20261031000300). This step makes journal.entries the
-- one store for both, so My Journal lists, searches, archives, exports, and
-- deletes lesson answers and notes like every other entry.
--
--   * journal.entries gets two link kinds:
--       lesson_answer  one per member per lesson question (lesson block):
--                      media_item_id (the lesson), lesson_block_id,
--                      block_revision (the question's prompt_revision it was
--                      written against), and question (the wording as the
--                      member saw it, the old prompt_snapshot);
--       lesson_notes   one per member per lesson: media_item_id.
--     Unique indexes keep it to one of each, whatever the client sends.
--   * The member workbook functions keep their names, arguments, and
--     results (media_lesson_workbook, media_workbook_answer_save,
--     media_workbook_answer_accept, media_workbook_note_save,
--     media_workbooks, media_workbook_delete) and now read and write
--     journal.entries. Answers also carry entry_id so the lesson can open
--     the entry in My Journal. Same rules as before: approved adult members
--     only (media.require_member: never youth, pending, or visitors), only
--     on a lesson they can open, only questions members can see, autosave
--     against the version the browser edited, and the same rate limit.
--   * Every existing answer and note is copied into journal.entries by
--     journal.import_workbooks(): same owner, text, version, created_at,
--     updated_at, lesson, question block, question revision, and wording.
--     journal.workbook_imports records each source row it has handled
--     (ids only, no text), so running it again imports nothing twice and
--     never brings back an entry the member later deleted.
--     journal.verify_workbook_import() returns counts only (no text, no
--     names) for the operator. Neither is executable by any API role.
--   * media.workbook_answers and media.workbook_notes are left in place,
--     unchanged and still closed to every API role, as the pre-migration
--     copy. Nothing writes to them any more. Dropping them is a later,
--     separate step for the owner to approve.
--   * journal.link_json names a lesson answer's lesson and question block
--     only while the owner can still open the lesson (like every link).
--     journal_entry_save keeps lesson answers and notes to 10,000
--     characters (the lesson's own limit); journal_entry_unlink clears the
--     new columns; journal_entries leaves out lesson boxes that were never
--     written in (no title, blank text). journal_entry_create still refuses
--     the new kinds: they are only made from the lesson.
--
-- Privacy is unchanged: entries stay owner-only. There is no teacher,
-- administrator, super administrator, group leader, or guardian path to
-- them, not even counts, and no text goes to the audit log or
-- notifications. A lesson that is deleted keeps its members' answers in My
-- Journal (the link is set to null), like every other journal link; before,
-- deleting a lesson deleted the answers.

-- ---------------------------------------------------------------------------
-- Columns and indexes
-- ---------------------------------------------------------------------------
alter table journal.entries add column lesson_block_id uuid references media.lesson_blocks (id) on delete set null;
alter table journal.entries add column block_revision integer check (block_revision >= 1);
alter table journal.entries drop constraint entries_link_kind_check;
alter table journal.entries add constraint entries_link_kind_check
  check (link_kind in ('none', 'passage', 'assignment', 'devotional', 'lesson', 'book', 'book_assignment', 'collection_reading',
                       'lesson_answer', 'lesson_notes'));
create index entries_lesson_block_idx on journal.entries (lesson_block_id);
-- One answer per member per question, one notes entry per member per lesson.
create unique index entries_one_lesson_answer_idx on journal.entries (profile_id, lesson_block_id)
  where link_kind = 'lesson_answer' and lesson_block_id is not null;
create unique index entries_one_lesson_notes_idx on journal.entries (profile_id, media_item_id)
  where link_kind = 'lesson_notes' and media_item_id is not null;

-- Which workbook rows have been brought into the journal (ids only).
create table journal.workbook_imports (
  source text not null check (source in ('answer', 'note')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- The answer's block id, or the note's lesson id.
  source_key uuid not null,
  item_id uuid not null,
  -- The journal entry holding the text (not a foreign key: the member may
  -- delete the entry later, and the row must stay so it isn't re-imported).
  entry_id uuid not null,
  imported_at timestamptz not null default now(),
  primary key (source, profile_id, source_key)
);
alter table journal.workbook_imports enable row level security;
revoke all on table journal.workbook_imports from public, anon, authenticated, service_role;

comment on table media.workbook_answers is 'Superseded by journal.entries (link_kind lesson_answer, 20261120000100). Kept unchanged as the pre-migration copy; nothing writes here.';
comment on table media.workbook_notes is 'Superseded by journal.entries (link_kind lesson_notes, 20261120000100). Kept unchanged as the pre-migration copy; nothing writes here.';

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------
-- Whether an answer's question is still the one it was written for.
create function media.workbook_answer_state(p_block uuid, p_revision integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when b.id is null or b.removed_at is not null or b.teacher_only or not media.block_answerable(b.kind) then 'removed'
           when b.prompt_revision is distinct from p_revision then 'changed'
           else 'current' end
    from (select 1) one
    left join media.lesson_blocks b on b.id = p_block;
$$;

-- An answer entry in the shape the workbook has always returned, plus its entry id.
create function media.workbook_entry_answer_json(e journal.entries)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'entry_id', e.id, 'block_id', e.lesson_block_id, 'body', e.body, 'version', e.version, 'updated_at', e.updated_at,
    'block_revision', e.block_revision, 'prompt_snapshot', coalesce(e.question, ''),
    'state', media.workbook_answer_state(e.lesson_block_id, e.block_revision));
$$;

-- ---------------------------------------------------------------------------
-- My Journal (same signatures; changes noted on each)
-- ---------------------------------------------------------------------------
-- Unchanged from 20261118000100 except the 'lesson_answer' branch: the
-- lesson and its question block are named only while the owner can still
-- open the lesson; the wording they answered is always theirs to see.
-- ('lesson_notes' uses the generic teaching-item branch.)
create or replace function journal.link_json(e journal.entries)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case e.link_kind
    when 'none' then null
    when 'passage' then jsonb_build_object(
      'kind', 'passage', 'label', e.passage_label,
      'translation_code', (select t.code from bible.translations t where t.id = e.translation_id),
      'translation_id', e.translation_id, 'book', e.book_code, 'chapter', e.chapter,
      'start_verse', e.start_verse, 'end_verse', e.end_verse,
      'available', e.translation_id is not null and bible.translation_active(e.translation_id))
    when 'assignment' then (
      select jsonb_build_object(
        'kind', 'assignment', 'question', e.question, 'revision', e.day_revision,
        'available', d.id is not null and p.id is not null and bible.member_can_read_plan(p, e.profile_id),
        'day_id', case when bible.member_can_read_plan(p, e.profile_id) then d.id end,
        'label', case when bible.member_can_read_plan(p, e.profile_id) then bible.day_label(d) end,
        'plan_title', case when bible.member_can_read_plan(p, e.profile_id) then p.title end,
        'passages', case when bible.member_can_read_plan(p, e.profile_id) then
                      coalesce((select r.snapshot -> 'passages' from bible.day_revisions r where r.day_id = d.id and r.revision = e.day_revision),
                               (select coalesce(jsonb_agg(jsonb_build_object('label', pp.label) order by pp.position), '[]'::jsonb)
                                  from bible.plan_passages pp where pp.day_id = d.id)) end,
        'changed_since', d.id is not null and e.day_revision is not null and d.revision <> e.day_revision)
        from (select 1) one
        left join bible.plan_days d on d.id = e.day_id
        left join bible.plans p on p.id = d.plan_id)
    when 'collection_reading' then (
      select jsonb_build_object('kind', 'collection_reading', 'reading_date', e.reading_date,
                                'available', r.id is not null and media.collection_visible(c, e.profile_id),
                                'reading_id', case when media.collection_visible(c, e.profile_id) then r.id end,
                                'collection_key', case when media.collection_visible(c, e.profile_id) then c.key end,
                                'title', case when media.collection_visible(c, e.profile_id) then c.title end,
                                'label', case when media.collection_visible(c, e.profile_id) then media.reading_label(r) end,
                                'scripture_ref', case when media.collection_visible(c, e.profile_id) then r.scripture_ref end)
        from (select 1) one
        left join media.collection_readings r on r.id = e.collection_reading_id
        left join media.collections c on c.id = r.collection_id)
    when 'lesson_answer' then (
      select jsonb_build_object('kind', 'lesson_answer', 'question', e.question, 'revision', e.block_revision,
                                'available', i.id is not null and media.item_visible(i, e.profile_id),
                                'item_id', case when media.item_visible(i, e.profile_id) then i.id end,
                                'title', case when media.item_visible(i, e.profile_id) then i.title end,
                                'state', media.workbook_answer_state(e.lesson_block_id, e.block_revision),
                                'block_id', case when media.item_visible(i, e.profile_id)
                                                  and media.workbook_answer_state(e.lesson_block_id, e.block_revision) <> 'removed'
                                                 then e.lesson_block_id end)
        from (select 1) one left join media.items i on i.id = e.media_item_id)
    else (
      select jsonb_build_object('kind', e.link_kind,
                                'available', i.id is not null and media.item_visible(i, e.profile_id),
                                'item_id', case when media.item_visible(i, e.profile_id) then i.id end,
                                'title', case when media.item_visible(i, e.profile_id) then i.title end)
        from (select 1) one left join media.items i on i.id = e.media_item_id)
  end;
$$;

-- Unchanged from 20261026000500 except that lesson boxes never written in
-- (no title, blank text) aren't listed.
create or replace function public.journal_entries(p_query text default null, p_status text default 'active', p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  return jsonb_build_object(
    'total', (select count(*) from journal.entries e
               where e.profile_id = v_uid and e.status = coalesce(p_status, 'active')
                 and not (e.link_kind in ('lesson_answer', 'lesson_notes') and e.title = '' and btrim(e.body) = '')
                 and (v_q is null or e.title ilike media.like_pattern(v_q) or e.body ilike media.like_pattern(v_q))),
    'items', coalesce((
       select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'excerpt', left(regexp_replace(e.body, '\s+', ' ', 'g'), 180),
                                           'status', e.status, 'updated_at', e.updated_at, 'created_at', e.created_at,
                                           'link', journal.link_json(e)) order by e.updated_at desc, e.id)
         from (select * from journal.entries e
                where e.profile_id = v_uid and e.status = coalesce(p_status, 'active')
                  and not (e.link_kind in ('lesson_answer', 'lesson_notes') and e.title = '' and btrim(e.body) = '')
                  and (v_q is null or e.title ilike media.like_pattern(v_q) or e.body ilike media.like_pattern(v_q))
                order by e.updated_at desc, e.id
                limit v_limit offset greatest(coalesce(p_offset, 0), 0)) e), '[]'::jsonb));
end;
$$;

-- Unchanged from 20261026000500 except the 10,000-character limit on lesson
-- answers and notes (what the lesson page can hold).
create or replace function public.journal_entry_save(p_id uuid, p_title text, p_body text, p_base_version integer, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  e journal.entries;
begin
  if char_length(coalesce(p_title, '')) > 200 or char_length(coalesce(p_body, '')) > 100000 then
    raise exception 'This entry is too long to save.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'journal_save', 600, interval '10 minutes');
  select * into e from journal.entries where id = p_id and profile_id = v_uid for update;
  if not found then
    raise exception 'Entry not found.' using errcode = 'P0002';
  end if;
  if e.link_kind in ('lesson_answer', 'lesson_notes') and char_length(coalesce(p_body, '')) > 10000 then
    raise exception 'A lesson answer or notes can be at most 10,000 characters.' using errcode = '22023';
  end if;
  -- A retried save that already landed: same content one version later.
  if e.version = p_base_version + 1 and e.title = coalesce(p_title, '') and e.body = coalesce(p_body, '') then
    return jsonb_build_object('status', 'saved', 'version', e.version, 'updated_at', e.updated_at);
  end if;
  if e.version <> p_base_version and not coalesce(p_force, false) then
    return jsonb_build_object('status', 'conflict',
                              'current', jsonb_build_object('title', e.title, 'body', e.body, 'version', e.version, 'updated_at', e.updated_at));
  end if;
  if e.title = coalesce(p_title, '') and e.body = coalesce(p_body, '') then
    return jsonb_build_object('status', 'saved', 'version', e.version, 'updated_at', e.updated_at);
  end if;
  update journal.entries set title = coalesce(p_title, ''), body = coalesce(p_body, ''), version = version + 1, updated_at = now()
   where id = e.id and profile_id = v_uid
  returning * into e;
  return jsonb_build_object('status', 'saved', 'version', e.version, 'updated_at', e.updated_at);
end;
$$;

-- Unchanged from 20261118000100 except clearing the lesson question link too.
create or replace function public.journal_entry_unlink(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e journal.entries := journal.require_owner(p_id);
begin
  update journal.entries set link_kind = 'none', translation_id = null, book_code = null, chapter = null, start_verse = null,
                             end_verse = null, passage_label = null, plan_id = null, day_id = null, day_revision = null,
                             question = null, media_item_id = null, collection_reading_id = null, reading_date = null,
                             lesson_block_id = null, block_revision = null, updated_at = now()
   where id = e.id;
  select * into e from journal.entries where id = e.id;
  return journal.entry_json(e);
end;
$$;

-- ---------------------------------------------------------------------------
-- The lesson workbook, now on journal.entries (same signatures and results)
-- ---------------------------------------------------------------------------
-- Unchanged from 20261031000300 except where answers and the note are read
-- from; each answer and the note also carry entry_id. An archived entry is
-- still the member's answer, so it is shown on the lesson too.
create or replace function public.media_lesson_workbook(p_item uuid, p_preview boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  i media.items;
  n journal.entries;
begin
  if coalesce(p_preview, false) then
    v_uid := media.require_cap('content.edit');
    i := media.lesson_for_builder(p_item, false);
    return jsonb_build_object('preview', true, 'available', true, 'lesson', media.workbook_lesson_json(i, v_uid),
                              'blocks', media.lesson_member_blocks(i.id), 'answers', '[]'::jsonb, 'note', null);
  end if;
  v_uid := media.require_member();
  select * into i from media.items where id = p_item and kind = 'lesson';
  select * into n from journal.entries where profile_id = v_uid and link_kind = 'lesson_notes' and media_item_id = p_item;
  if i.id is null or not media.item_visible(i, v_uid) then
    if n.id is null and not exists (select 1 from journal.entries e where e.profile_id = v_uid and e.link_kind = 'lesson_answer'
                                                                       and e.media_item_id = p_item and e.lesson_block_id is not null) then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object(
    'preview', false,
    'available', i.id is not null and media.item_visible(i, v_uid),
    'lesson', case when media.item_visible(i, v_uid) then media.workbook_lesson_json(i, v_uid) end,
    'blocks', case when media.item_visible(i, v_uid) then media.lesson_member_blocks(i.id) else '[]'::jsonb end,
    'answers', coalesce((select jsonb_agg(media.workbook_entry_answer_json(e) order by e.created_at, e.id)
                           from journal.entries e
                          where e.profile_id = v_uid and e.link_kind = 'lesson_answer' and e.media_item_id = p_item
                            and e.lesson_block_id is not null), '[]'::jsonb),
    'note', case when n.id is not null then jsonb_build_object('entry_id', n.id, 'body', n.body, 'version', n.version, 'updated_at', n.updated_at) end);
end;
$$;

-- Same autosave contract as 20261031000300 (0 is the base version of a new
-- answer):
--   saved:    {status: 'saved', version, updated_at}
--   conflict: {status: 'conflict', current: {body, version, updated_at}}
-- p_force = true overwrites the newer text (the member chose "keep mine").
-- A new answer is a new My Journal entry, so the journal's entry limit applies.
create or replace function public.media_workbook_answer_save(p_item uuid, p_block uuid, p_text text, p_base_version integer, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  v_text text := coalesce(p_text, '');
  b media.lesson_blocks;
  e journal.entries;
begin
  if char_length(v_text) > 10000 then
    raise exception 'An answer can be at most 10,000 characters.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'workbook_save', 600, interval '10 minutes');
  if not media.item_visible_id(p_item, v_uid) or not exists (select 1 from media.items where id = p_item and kind = 'lesson') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into b from media.lesson_blocks
   where id = p_block and item_id = p_item and removed_at is null and not teacher_only and media.block_answerable(kind);
  if b.id is null then
    raise exception 'This question is no longer part of the lesson.' using errcode = 'P0002';
  end if;
  select * into e from journal.entries
   where profile_id = v_uid and link_kind = 'lesson_answer' and lesson_block_id = b.id for update;
  if e.id is null then
    if coalesce(p_base_version, 0) <> 0 and not coalesce(p_force, false) then
      -- Deleted in another tab, on another device, or from My Journal.
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', '', 'version', 0, 'updated_at', null));
    end if;
    if (select count(*) from journal.entries where profile_id = v_uid) >= 10000 then
      raise exception 'You have reached the journal limit. Export and delete older entries first.' using errcode = '22023';
    end if;
    insert into journal.entries (profile_id, title, body, link_kind, media_item_id, lesson_block_id, block_revision, question)
    values (v_uid, '', v_text, 'lesson_answer', p_item, b.id, b.prompt_revision, coalesce(b.prompt, ''))
    on conflict (profile_id, lesson_block_id) where link_kind = 'lesson_answer' and lesson_block_id is not null do nothing
    returning * into e;
    if e.id is null then
      select * into e from journal.entries where profile_id = v_uid and link_kind = 'lesson_answer' and lesson_block_id = b.id;
      if e.body = v_text then
        return jsonb_build_object('status', 'saved', 'version', e.version, 'updated_at', e.updated_at);
      end if;
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', e.body, 'version', e.version, 'updated_at', e.updated_at));
    end if;
    return jsonb_build_object('status', 'saved', 'version', e.version, 'updated_at', e.updated_at);
  end if;
  -- A retried save that already landed.
  if e.version = coalesce(p_base_version, 0) + 1 and e.body = v_text then
    return jsonb_build_object('status', 'saved', 'version', e.version, 'updated_at', e.updated_at);
  end if;
  if e.version <> coalesce(p_base_version, 0) and not coalesce(p_force, false) then
    return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', e.body, 'version', e.version, 'updated_at', e.updated_at));
  end if;
  if e.body = v_text then
    return jsonb_build_object('status', 'saved', 'version', e.version, 'updated_at', e.updated_at);
  end if;
  update journal.entries set body = v_text, version = version + 1, updated_at = now()
   where id = e.id and profile_id = v_uid
  returning * into e;
  return jsonb_build_object('status', 'saved', 'version', e.version, 'updated_at', e.updated_at);
end;
$$;

-- The member read the reworded question and keeps their answer for it.
create or replace function public.media_workbook_answer_accept(p_item uuid, p_block uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  b media.lesson_blocks;
  e journal.entries;
begin
  if not media.item_visible_id(p_item, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into b from media.lesson_blocks
   where id = p_block and item_id = p_item and removed_at is null and not teacher_only and media.block_answerable(kind);
  if b.id is null then
    raise exception 'This question is no longer part of the lesson.' using errcode = 'P0002';
  end if;
  update journal.entries set block_revision = b.prompt_revision, question = coalesce(b.prompt, '')
   where profile_id = v_uid and link_kind = 'lesson_answer' and lesson_block_id = b.id
  returning * into e;
  if e.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return media.workbook_entry_answer_json(e);
end;
$$;

-- The member's free notes for the lesson (same autosave contract).
create or replace function public.media_workbook_note_save(p_item uuid, p_text text, p_base_version integer, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  v_text text := coalesce(p_text, '');
  n journal.entries;
begin
  if char_length(v_text) > 10000 then
    raise exception 'Notes can be at most 10,000 characters.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'workbook_save', 600, interval '10 minutes');
  if not media.item_visible_id(p_item, v_uid) or not exists (select 1 from media.items where id = p_item and kind = 'lesson') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into n from journal.entries where profile_id = v_uid and link_kind = 'lesson_notes' and media_item_id = p_item for update;
  if n.id is null then
    if coalesce(p_base_version, 0) <> 0 and not coalesce(p_force, false) then
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', '', 'version', 0, 'updated_at', null));
    end if;
    if (select count(*) from journal.entries where profile_id = v_uid) >= 10000 then
      raise exception 'You have reached the journal limit. Export and delete older entries first.' using errcode = '22023';
    end if;
    insert into journal.entries (profile_id, title, body, link_kind, media_item_id)
    values (v_uid, '', v_text, 'lesson_notes', p_item)
    on conflict (profile_id, media_item_id) where link_kind = 'lesson_notes' and media_item_id is not null do nothing
    returning * into n;
    if n.id is null then
      select * into n from journal.entries where profile_id = v_uid and link_kind = 'lesson_notes' and media_item_id = p_item;
      if n.body = v_text then
        return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
      end if;
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', n.body, 'version', n.version, 'updated_at', n.updated_at));
    end if;
    return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
  end if;
  if n.version = coalesce(p_base_version, 0) + 1 and n.body = v_text then
    return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
  end if;
  if n.version <> coalesce(p_base_version, 0) and not coalesce(p_force, false) then
    return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', n.body, 'version', n.version, 'updated_at', n.updated_at));
  end if;
  if n.body = v_text then
    return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
  end if;
  update journal.entries set body = v_text, version = version + 1, updated_at = now()
   where id = n.id and profile_id = v_uid
  returning * into n;
  return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
end;
$$;

-- The caller's lessons with answers or notes, most recently written first
-- (kept for compatibility; My Journal is where members find them now).
create or replace function public.media_workbooks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'item_id', w.item_id,
             'available', media.item_visible(i, v_uid),
             'title', case when media.item_visible(i, v_uid) then i.title end,
             'delivered_on', case when media.item_visible(i, v_uid) then i.delivered_on end,
             'answers', w.answers, 'has_note', w.has_note, 'updated_at', w.updated_at)
           order by w.updated_at desc)
      from (select e.media_item_id as item_id,
                   count(*) filter (where e.link_kind = 'lesson_answer' and btrim(e.body) <> '')::integer as answers,
                   coalesce(bool_or(e.link_kind = 'lesson_notes' and btrim(e.body) <> ''), false) as has_note,
                   max(e.updated_at) as updated_at
              from journal.entries e
             where e.profile_id = v_uid and e.link_kind in ('lesson_answer', 'lesson_notes') and e.media_item_id is not null
             group by e.media_item_id
             order by max(e.updated_at) desc
             limit 200) w
      left join media.items i on i.id = w.item_id), '[]'::jsonb);
end;
$$;

-- Deletes the caller's own lesson writing: one answer (p_block), or every
-- answer and the notes for the lesson (p_block null). Entries the member
-- unlinked in My Journal are no longer lesson writing and are kept.
create or replace function public.media_workbook_delete(p_item uuid, p_block uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if p_block is not null then
    delete from journal.entries
     where profile_id = v_uid and link_kind = 'lesson_answer' and media_item_id = p_item and lesson_block_id = p_block;
  else
    delete from journal.entries
     where profile_id = v_uid and link_kind in ('lesson_answer', 'lesson_notes') and media_item_id = p_item;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Import and verification (operator only; no API role can run these)
-- ---------------------------------------------------------------------------
-- Copies every workbook answer and note not yet recorded in
-- journal.workbook_imports into journal.entries, keeping owner, text,
-- version, timestamps, lesson, question block, revision, and wording.
-- Safe to run again: recorded rows are skipped, and the unique indexes stop
-- a second answer for the same question. If the member already has a
-- journal answer for that question with different text (only possible when
-- run after members started writing in the journal), the old text is kept
-- as a separate entry linked to the lesson, so nothing is lost or
-- overwritten. Returns counts only.
create function journal.import_workbooks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a media.workbook_answers;
  n media.workbook_notes;
  e journal.entries;
  v_answers integer := 0;
  v_notes integer := 0;
  v_same integer := 0;
  v_copies integer := 0;
begin
  for a in
    select w.* from media.workbook_answers w
     where not exists (select 1 from journal.workbook_imports l where l.source = 'answer' and l.profile_id = w.profile_id and l.source_key = w.block_id)
     order by w.created_at, w.profile_id, w.block_id
  loop
    select * into e from journal.entries x where x.profile_id = a.profile_id and x.link_kind = 'lesson_answer' and x.lesson_block_id = a.block_id;
    if e.id is not null and e.body = a.body then
      v_same := v_same + 1;
    elsif e.id is not null then
      insert into journal.entries (profile_id, title, body, version, link_kind, media_item_id, lesson_block_id, block_revision, question,
                                   created_at, updated_at)
      values (a.profile_id, 'Earlier lesson answer', a.body, a.version, 'lesson', a.item_id, a.block_id, a.block_revision, a.prompt_snapshot,
              a.created_at, a.updated_at)
      returning * into e;
      v_copies := v_copies + 1;
    else
      insert into journal.entries (profile_id, title, body, version, link_kind, media_item_id, lesson_block_id, block_revision, question,
                                   created_at, updated_at)
      values (a.profile_id, '', a.body, a.version, 'lesson_answer', a.item_id, a.block_id, a.block_revision, a.prompt_snapshot,
              a.created_at, a.updated_at)
      returning * into e;
      v_answers := v_answers + 1;
    end if;
    insert into journal.workbook_imports (source, profile_id, source_key, item_id, entry_id)
    values ('answer', a.profile_id, a.block_id, a.item_id, e.id);
  end loop;

  for n in
    select w.* from media.workbook_notes w
     where not exists (select 1 from journal.workbook_imports l where l.source = 'note' and l.profile_id = w.profile_id and l.source_key = w.item_id)
     order by w.created_at, w.profile_id, w.item_id
  loop
    select * into e from journal.entries x where x.profile_id = n.profile_id and x.link_kind = 'lesson_notes' and x.media_item_id = n.item_id;
    if e.id is not null and e.body = n.body then
      v_same := v_same + 1;
    elsif e.id is not null then
      insert into journal.entries (profile_id, title, body, version, link_kind, media_item_id, created_at, updated_at)
      values (n.profile_id, 'Earlier lesson notes', n.body, n.version, 'lesson', n.item_id, n.created_at, n.updated_at)
      returning * into e;
      v_copies := v_copies + 1;
    else
      insert into journal.entries (profile_id, title, body, version, link_kind, media_item_id, created_at, updated_at)
      values (n.profile_id, '', n.body, n.version, 'lesson_notes', n.item_id, n.created_at, n.updated_at)
      returning * into e;
      v_notes := v_notes + 1;
    end if;
    insert into journal.workbook_imports (source, profile_id, source_key, item_id, entry_id)
    values ('note', n.profile_id, n.item_id, n.item_id, e.id);
  end loop;

  return jsonb_build_object('answers_imported', v_answers, 'notes_imported', v_notes,
                            'already_in_journal', v_same, 'kept_as_separate_entries', v_copies);
end;
$$;

-- Counts for the operator (no text, no names, no ids):
--   source_answers / source_notes      rows in the old tables
--   not_imported                       old rows with no import record (must be 0)
--   association_mismatch               imported entries whose owner, lesson, or question block
--                                      differs from the old row (must be 0)
--   duplicate_answers / duplicate_notes  more than one lesson answer per member and question,
--                                      or notes per member and lesson (must be 0)
--   unchanged                          imported entries still identical to the old row
--                                      (text, version, wording, revision, created_at, updated_at)
--   changed_since_import               imported entries the member has edited, re-worded, or
--                                      accepted since (expected to grow after release)
--   deleted_since_import               imported entries the member has since deleted
create function journal.verify_workbook_import()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with src as (
    select 'answer'::text as source, w.profile_id, w.block_id as source_key, w.item_id, w.block_id, w.body, w.version,
           w.prompt_snapshot as question, w.block_revision, w.created_at, w.updated_at
      from media.workbook_answers w
    union all
    select 'note', w.profile_id, w.item_id, w.item_id, null::uuid, w.body, w.version, null::text, null::integer, w.created_at, w.updated_at
      from media.workbook_notes w
  ), joined as (
    select s.*, l.entry_id, l.source is not null as recorded, e.id as e_id, e.profile_id as e_profile, e.media_item_id as e_item,
           e.lesson_block_id as e_block, e.body as e_body, e.version as e_version, e.question as e_question,
           e.block_revision as e_revision, e.created_at as e_created, e.updated_at as e_updated
      from src s
      left join journal.workbook_imports l on l.source = s.source and l.profile_id = s.profile_id and l.source_key = s.source_key
      left join journal.entries e on e.id = l.entry_id
  )
  select jsonb_build_object(
    'source_answers', (select count(*) from media.workbook_answers),
    'source_notes', (select count(*) from media.workbook_notes),
    'not_imported', (select count(*) from joined where not recorded),
    'association_mismatch', (select count(*) from joined
                              where e_id is not null
                                and (e_profile <> profile_id or e_item is distinct from item_id or e_block is distinct from block_id)),
    'duplicate_answers', (select count(*) from (select 1 from journal.entries where link_kind = 'lesson_answer' and lesson_block_id is not null
                                                group by profile_id, lesson_block_id having count(*) > 1) d),
    'duplicate_notes', (select count(*) from (select 1 from journal.entries where link_kind = 'lesson_notes' and media_item_id is not null
                                              group by profile_id, media_item_id having count(*) > 1) d),
    'unchanged', (select count(*) from joined
                   where e_id is not null and e_body = body and e_version = version and e_created = created_at and e_updated = updated_at
                     and e_question is not distinct from question and e_revision is not distinct from block_revision),
    'changed_since_import', (select count(*) from joined
                              where e_id is not null
                                and not (e_body = body and e_version = version and e_created = created_at and e_updated = updated_at
                                         and e_question is not distinct from question and e_revision is not distinct from block_revision)),
    'deleted_since_import', (select count(*) from joined where recorded and e_id is null));
$$;

-- ---------------------------------------------------------------------------
-- Grants: new helpers for no one (replaced functions keep their grants).
-- ---------------------------------------------------------------------------
revoke execute on function
  media.workbook_answer_state(uuid, integer), media.workbook_entry_answer_json(journal.entries),
  journal.import_workbooks(), journal.verify_workbook_import()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Bring the existing workbooks over, and check.
-- ---------------------------------------------------------------------------
select journal.import_workbooks();

do $verify$
declare
  v jsonb := journal.verify_workbook_import();
begin
  if (v ->> 'not_imported')::integer <> 0 or (v ->> 'association_mismatch')::integer <> 0
     or (v ->> 'duplicate_answers')::integer <> 0 or (v ->> 'duplicate_notes')::integer <> 0
     or (v ->> 'unchanged')::integer <> (v ->> 'source_answers')::integer + (v ->> 'source_notes')::integer then
    raise exception 'Workbook import check failed: %', v;
  end if;
end
$verify$;

-- Expected afterwards: every workbook row copied, no API role can run the
-- import or verification, and the lesson functions still granted as before.
do $check$
declare
  v jsonb := journal.verify_workbook_import();
begin
  if (v ->> 'not_imported')::integer <> 0 or (v ->> 'association_mismatch')::integer <> 0
     or (v ->> 'unchanged')::integer <> (v ->> 'source_answers')::integer + (v ->> 'source_notes')::integer then
    raise exception 'Nothing was changed: the workbook copy check failed (%). Send this message to the developer.', v;
  end if;
  if has_function_privilege('authenticated', 'journal.import_workbooks()', 'execute')
     or has_function_privilege('authenticated', 'journal.verify_workbook_import()', 'execute')
     or has_function_privilege('anon', 'public.media_workbook_answer_save(uuid, uuid, text, integer, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.media_workbook_answer_save(uuid, uuid, text, integer, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.media_lesson_workbook(uuid, boolean)', 'execute') then
    raise exception 'Nothing was changed: function grants are not as expected. Send this message to the developer.';
  end if;
  raise notice 'Workbook copy: %', v;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261120000100', 'journal_lesson_workbooks', 'journal-lesson-workbooks');

commit;
