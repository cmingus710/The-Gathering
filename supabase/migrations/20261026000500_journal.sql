-- Phase 8 · My Journal: private journal entries, owner only.
--
-- Every function acts only on the caller's own rows (profile_id =
-- auth.uid()) and rechecks approved membership. There is no staff, group
-- leader, household, guardian, or moderator path: no capability (not even
-- a super administrator's) opens another member's journal, and "not found"
-- is the same answer for someone else's entry and a nonexistent one.
--
-- Journal text never leaves these functions except to its owner: it isn't
-- written to the audit log, notifications, search indexes, or change logs,
-- and nothing here logs it. This is access control, not encryption.
--
-- Autosave: journal_entry_save takes the version the browser edited. A save
-- against an older version doesn't overwrite; it returns the current text
-- so the member can choose (keep mine / use the saved one / keep both).
-- Saves are idempotent per (entry, version): retrying a request that
-- already succeeded returns the same result instead of a conflict.

create function journal.require_owner(p_id uuid)
returns journal.entries
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  e journal.entries;
begin
  select * into e from journal.entries where id = p_id and profile_id = v_uid;
  if not found then
    raise exception 'Entry not found.' using errcode = 'P0002';
  end if;
  return e;
end;
$$;

-- The entry's link, resolved for the owner now: teaching content and plan
-- days are named only while the owner can still open them.
create function journal.link_json(e journal.entries)
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
    else (
      select jsonb_build_object('kind', e.link_kind,
                                'available', i.id is not null and media.item_visible(i, e.profile_id),
                                'item_id', case when media.item_visible(i, e.profile_id) then i.id end,
                                'title', case when media.item_visible(i, e.profile_id) then i.title end)
        from (select 1) one left join media.items i on i.id = e.media_item_id)
  end;
$$;

create function journal.entry_json(e journal.entries)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', e.id, 'title', e.title, 'body', e.body, 'status', e.status, 'version', e.version,
                            'created_at', e.created_at, 'updated_at', e.updated_at, 'archived_at', e.archived_at,
                            'link', journal.link_json(e));
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
-- The owner's entries, newest first; optional search of their own title
-- and text (LIKE wildcards are literal).
create function public.journal_entries(p_query text default null, p_status text default 'active', p_limit integer default 30, p_offset integer default 0)
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
                 and (v_q is null or e.title ilike media.like_pattern(v_q) or e.body ilike media.like_pattern(v_q))),
    'items', coalesce((
       select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'excerpt', left(regexp_replace(e.body, '\s+', ' ', 'g'), 180),
                                           'status', e.status, 'updated_at', e.updated_at, 'created_at', e.created_at,
                                           'link', journal.link_json(e)) order by e.updated_at desc, e.id)
         from (select * from journal.entries e
                where e.profile_id = v_uid and e.status = coalesce(p_status, 'active')
                  and (v_q is null or e.title ilike media.like_pattern(v_q) or e.body ilike media.like_pattern(v_q))
                order by e.updated_at desc, e.id
                limit v_limit offset greatest(coalesce(p_offset, 0), 0)) e), '[]'::jsonb));
end;
$$;

create function public.journal_entry(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return journal.entry_json(journal.require_owner(p_id));
end;
$$;

-- Entries linked to a plan day, passage chapter, or teaching item (for
-- "Your notes" beside the reading). Owner only.
create function public.journal_linked(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'excerpt', left(regexp_replace(e.body, '\s+', ' ', 'g'), 140),
                                        'updated_at', e.updated_at, 'question', e.question) order by e.updated_at desc)
      from (select * from journal.entries e
             where e.profile_id = v_uid and e.status = 'active'
               and ((p ? 'day_id' and e.day_id = (p ->> 'day_id')::uuid)
                    or (p ? 'media_item_id' and e.media_item_id = (p ->> 'media_item_id')::uuid)
                    or (p ? 'book' and e.link_kind = 'passage' and e.translation_id = (p ->> 'translation_id')::uuid
                        and e.book_code = p ->> 'book' and e.chapter = (p ->> 'chapter')::integer))
             order by e.updated_at desc limit 20) e), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------
-- Creates an entry (idempotent per client key, so a retried first save
-- never makes two entries). p_link: {kind, ...reference}.
create function public.journal_entry_create(p_client_key uuid, p_title text, p_body text, p_link jsonb default null)
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
    when 'devotional', 'lesson' then
      v_item := (p_link ->> 'media_item_id')::uuid;
      if not exists (select 1 from media.items i where i.id = v_item and i.kind::text = v_kind and media.item_visible(i, v_uid)) then
        raise exception 'That teaching can''t be linked.' using errcode = '22023';
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

-- Saves title and text against the version the browser edited.
--   ok:       {status: 'saved', version, updated_at}
--   conflict: {status: 'conflict', current: {title, body, version, updated_at}}
-- p_force = true overwrites a newer version (after the member chose "keep mine").
create function public.journal_entry_save(p_id uuid, p_title text, p_body text, p_base_version integer, p_force boolean default false)
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

create function public.journal_entry_status(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e journal.entries := journal.require_owner(p_id);
begin
  if p_action = 'archive' then
    update journal.entries set status = 'archived', archived_at = now(), updated_at = now() where id = e.id and status = 'active';
  elsif p_action = 'restore' then
    update journal.entries set status = 'active', archived_at = null, updated_at = now() where id = e.id and status = 'archived';
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  select * into e from journal.entries where id = e.id;
  return journal.entry_json(e);
end;
$$;

-- Removes the link (keeps the text).
create function public.journal_entry_unlink(p_id uuid)
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
                             question = null, media_item_id = null, updated_at = now()
   where id = e.id;
  select * into e from journal.entries where id = e.id;
  return journal.entry_json(e);
end;
$$;

create function public.journal_entry_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e journal.entries := journal.require_owner(p_id);
begin
  delete from journal.entries where id = e.id and profile_id = e.profile_id;
end;
$$;

-- Deletes every entry the member has (typed confirmation).
create function public.journal_delete_all(p_confirm text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_n integer;
begin
  if p_confirm is distinct from 'DELETE' then
    raise exception 'Type DELETE to confirm.' using errcode = '22023';
  end if;
  delete from journal.entries where profile_id = v_uid;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The member's whole journal (active and archived), for download.
create function public.journal_export()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  perform community.rate_limit(v_uid, 'journal_export', 10, interval '1 hour');
  return jsonb_build_object(
    'exported_at', now(),
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
                           'title', e.title, 'body', e.body, 'status', e.status, 'created_at', e.created_at, 'updated_at', e.updated_at,
                           'link', journal.link_json(e) - 'translation_id' - 'day_id' - 'item_id') order by e.created_at)
                           from journal.entries e where e.profile_id = v_uid), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema journal from public, anon, authenticated;
revoke execute on all functions in schema bible from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'bible\_%' or p.proname like 'journal\_%')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;
