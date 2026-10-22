-- Unified church reading page · Apply migration 20261104000100_media_reading_plan
-- to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the
-- release is approved:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: one new read-only function, public.media_reading_plan(uuid),
-- granted to `authenticated` only. Two existing objects change: the journal
-- link-kind check also accepts 'book_assignment', and
-- public.journal_entry_create is replaced with the same body plus
-- 'book_assignment' in its teaching branch (same signature and grants). No
-- table, row, or existing grant changes; existing progress, completions, and
-- journal entries are untouched. The app that is deployed now keeps working
-- before and after; the new app degrades gracefully before it is applied.
--
-- It copies supabase/migrations/20261104000100_media_reading_plan.sql
-- verbatim and records it under its repository version (created_by =
-- reading-plan). All or nothing: one transaction; out of order or a second
-- run stops at the preflight with "Nothing was changed". It needs the Phase
-- 13 church reading step (20261031000400).
begin;

do $preflight$
begin
  if to_regclass('media.items') is null or to_regclass('journal.entries') is null
     or to_regprocedure('public.journal_entry_create(uuid, text, text, jsonb)') is null
     or to_regclass('media.book_progress') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000400') then
    raise exception 'Nothing was changed: the church reading step (20261031000400) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104000100')
     or to_regprocedure('public.media_reading_plan(uuid)') is not null then
    raise exception 'Nothing was changed: 20261104000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261104000100_media_reading_plan.sql
-- =========================================================================
-- Unified church reading page: one page per book with its reading plan
-- (the book's assignments), the member's own progress and completions, and
-- the member's private notes about the book or any of its assignments.
--
-- Additive. Nothing existing changes meaning:
--   * public.media_reading_plan(book): for one book the member can see, the
--     church's date ("today", church time zone), the book's visible
--     assignments with their details and the member's own completion, and
--     the member's own active journal notes linked to the book or to one of
--     its assignments. Read-only; owner-only for completions and notes.
--   * journal link kind 'book_assignment': "Write privately" on a church
--     reading assignment (media.items kind 'assignment') links the My
--     Journal entry to it. ('assignment' already means a Bible plan day.)
--     journal.link_json already renders any media-item link generically and
--     hides the title once the member can no longer see the item.
--   * public.journal_entry_create is re-created with the same body plus
--     'book_assignment' in its teaching branch (same signature and grants).
--
-- The book-to-assignment relationship stays the explicit media.items.book_id
-- (required for every assignment). Nothing is joined by title. Book-level
-- progress stays the single media.book_progress row; assignment completion
-- stays media.completions per assignment. Neither writes the other.

alter table journal.entries drop constraint entries_link_kind_check;
alter table journal.entries add constraint entries_link_kind_check
  check (link_kind in ('none', 'passage', 'assignment', 'devotional', 'lesson', 'book', 'book_assignment'));

create function public.media_reading_plan(p_book uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if not exists (select 1 from media.items i where i.id = p_book and i.kind = 'book' and media.item_visible(i, v_uid)) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'today', media.church_today(),
    'assignments', coalesce((
      select jsonb_agg(media.item_card(x, v_uid) || jsonb_build_object(
               'instructions', x.instructions, 'questions', to_jsonb(x.questions), 'body', x.body,
               'group_id', x.group_id,
               'group_name', (select g.name from community.groups g where g.id = x.group_id and community.group_member(g.id, v_uid)),
               'attachments', media.attachments_json(x, v_uid, false),
               'discussion', (select jsonb_build_object('thread_id', t.id, 'title', t.title, 'replies', t.reply_count)
                                from community.threads t
                               where t.id = x.discussion_thread_id and t.status = 'visible'
                                 and community.can_read_thread(t.id, v_uid)))
             order by x.starts_on, x.ends_on nulls last, x.sort_order, x.id)
        from media.items x
       where x.kind = 'assignment' and x.book_id = p_book and media.item_visible(x, v_uid)), '[]'::jsonb),
    -- Only the caller's own entries; journal.link_json rechecks access.
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'excerpt', left(regexp_replace(e.body, '\s+', ' ', 'g'), 180),
                                          'updated_at', e.updated_at, 'link', journal.link_json(e))
             order by e.updated_at desc, e.id)
        from (select * from journal.entries e
               where e.profile_id = v_uid and e.status = 'active'
                 and ((e.link_kind = 'book' and e.media_item_id = p_book)
                      or (e.link_kind = 'book_assignment'
                          and e.media_item_id in (select a.id from media.items a where a.kind = 'assignment' and a.book_id = p_book)))
               order by e.updated_at desc, e.id
               limit 50) e), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Journal: allow linking an entry to a church reading assignment the member
-- can see. (Same function as 20261031000400 with 'book_assignment' added to
-- the teaching branch, checked against item kind 'assignment'.)
-- ---------------------------------------------------------------------------
create or replace function public.journal_entry_create(p_client_key uuid, p_title text, p_body text, p_link jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  e journal.entries;
  v_kind text := coalesce(nullif(p_link ->> 'kind', ''), 'none');
  v_day bible.plan_days;
  v_plan bible.plans;
  v_tr uuid;
  v_book text;
  v_ch integer;
  v_sv integer;
  v_ev integer;
  v_item uuid;
  v_question text;
begin
  if p_client_key is null then
    raise exception 'Missing request key.' using errcode = '22023';
  end if;
  select * into e from journal.entries where profile_id = v_uid and client_key = p_client_key;
  if found then
    return journal.entry_json(e);
  end if;
  if char_length(coalesce(p_title, '')) > 200 or char_length(coalesce(p_body, '')) > 100000 then
    raise exception 'This entry is too long to save.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'journal_create', 60, interval '10 minutes');
  if (select count(*) from journal.entries where profile_id = v_uid) >= 10000 then
    raise exception 'You have reached the journal limit. Export and delete older entries first.' using errcode = '22023';
  end if;
  case v_kind
    when 'none' then null;
    when 'passage' then
      v_tr := (p_link ->> 'translation_id')::uuid;
      v_book := p_link ->> 'book';
      v_ch := (p_link ->> 'chapter')::integer;
      v_sv := nullif(p_link ->> 'start_verse', '')::integer;
      v_ev := nullif(p_link ->> 'end_verse', '')::integer;
      if not bible.translation_active(v_tr) or bible.passage_problem(v_tr, v_book, v_ch, v_sv, v_ch, coalesce(v_ev, v_sv)) is not null then
        raise exception 'That passage can''t be linked.' using errcode = '22023';
      end if;
    when 'assignment' then
      select * into v_day from bible.plan_days where id = (p_link ->> 'day_id')::uuid;
      select * into v_plan from bible.plans where id = v_day.plan_id;
      if v_day.id is null or not bible.member_can_read_plan(v_plan, v_uid) then
        raise exception 'That reading can''t be linked.' using errcode = '22023';
      end if;
      -- Only one of the day's own reflection questions can be attached.
      if nullif(p_link ->> 'question', '') is not null then
        if (p_link ->> 'question') <> all (v_day.questions) then
          raise exception 'That question isn''t part of this reading.' using errcode = '22023';
        end if;
        v_question := p_link ->> 'question';
      end if;
    when 'devotional', 'lesson', 'book', 'book_assignment' then
      v_item := (p_link ->> 'media_item_id')::uuid;
      if not exists (select 1 from media.items i where i.id = v_item and i.kind::text = case v_kind when 'book_assignment' then 'assignment' else v_kind end and media.item_visible(i, v_uid)) then
        raise exception 'That teaching or book can''t be linked.' using errcode = '22023';
      end if;
    else
      raise exception 'Unknown link.' using errcode = '22023';
  end case;
  insert into journal.entries (profile_id, client_key, title, body, link_kind, translation_id, book_code, chapter, start_verse, end_verse,
                               passage_label, plan_id, day_id, day_revision, question, media_item_id)
  values (v_uid, p_client_key, coalesce(p_title, ''), coalesce(p_body, ''), v_kind, v_tr, v_book, v_ch, v_sv, v_ev,
          case when v_kind = 'passage' then bible.passage_label(v_book, v_ch, v_sv, v_ch, coalesce(v_ev, v_sv)) end,
          v_plan.id, v_day.id, v_day.revision, v_question, v_item)
  returning * into e;
  return journal.entry_json(e);
end;
$$;

revoke all on function public.media_reading_plan(uuid) from public, anon, authenticated, service_role;
grant execute on function public.media_reading_plan(uuid) to authenticated;

-- Expected afterwards: nothing new is callable without signing in.
do $check$
begin
  if has_function_privilege('anon', 'public.media_reading_plan(uuid)', 'execute') then
    raise exception 'Nothing was changed: the reading plan function would be callable without signing in. Send this message to the developer.';
  end if;
  if not has_function_privilege('authenticated', 'public.media_reading_plan(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.journal_entry_create(uuid, text, text, jsonb)', 'execute') then
    raise exception 'Nothing was changed: signed-in members would lose access. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261104000100', 'media_reading_plan', 'reading-plan');

commit;
