-- Phase 8 · Bible sources: translations, the scripture reader, structured
-- text imports (staged → reviewed → published), and reference PDFs.
--
-- Member functions (bible_translations, bible_books, bible_chapter,
-- bible_passage) return only active translations. Stored text comes from a
-- published import; API translations return their configuration so the
-- server can fetch the passage from the licensed provider with a key that
-- never leaves the server. The database never caches API text (members
-- could otherwise write it); the server's fetch cache honors each
-- translation's caching permission.
--
-- Imports never touch published scripture until an administrator with
-- bible.manage reviews the staged lines and confirms publication. Unreadable
-- or ambiguous lines are flagged, never repaired: an excluded line leaves its
-- verse missing, and missing verses must be acknowledged before publishing.

-- ---------------------------------------------------------------------------
-- Member reading
-- ---------------------------------------------------------------------------
create function bible.translation_json(t bible.translations)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'code', t.code, 'name', t.name, 'language', t.language, 'source_kind', t.source_kind,
    'attribution', t.attribution, 'copyright', t.copyright, 'source_url', t.source_url,
    'allow_copy', t.allow_copy, 'allow_print', t.allow_print, 'allow_export', t.allow_export,
    'max_verses_per_view', t.max_verses_per_view, 'tracking_required', t.tracking_required,
    'text_version', t.text_version);
$$;

create function public.bible_translations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_default uuid;
begin
  select s.default_translation_id into v_default
    from bible.settings s join bible.translations t on t.id = s.default_translation_id and t.status = 'active';
  return jsonb_build_object(
    'default_id', v_default,
    'preferred_id', (select p.translation_id from bible.reader_prefs p
                      where p.profile_id = v_uid and bible.translation_active(p.translation_id)),
    'items', coalesce((select jsonb_agg(bible.translation_json(t) order by t.id = v_default desc, t.name)
                         from bible.translations t where t.status = 'active'), '[]'::jsonb));
end;
$$;

create function public.bible_books(p_translation uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform bible.require_member();
  if not bible.translation_active(p_translation) then
    raise exception 'That translation isn''t available.' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'testament', b.testament, 'chapters', c.n) order by b.ordinal)
      from bible.books b
      cross join lateral (select bible.chapter_count(p_translation, b.code) as n) c
     where c.n is not null), '[]'::jsonb);
end;
$$;

-- Verses of a range from stored text, in reading order.
create function bible.verses_json(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('c', v.chapter, 'v', v.verse, 't', v.text, 'o', v.omitted,
                                               'h', v.heading, 'p', v.para_start, 'q', v.poetry)
                            order by v.chapter, v.verse), '[]'::jsonb)
    from bible.verses v
   where v.translation_id = p_translation and v.book_code = p_book
     and (v.chapter, v.verse) >= (p_sc, coalesce(p_sv, 1))
     and (v.chapter, v.verse) <= (p_ec, coalesce(p_ev, 1000));
$$;

-- One chapter with its neighbors for navigation. API translations return
-- no text: the server fetches it from the provider.
create function public.bible_chapter(p_translation uuid, p_book text, p_chapter integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  t bible.translations;
  b bible.books;
  v_count integer;
  v_last integer;
  v_prev jsonb;
  v_next jsonb;
begin
  perform community.rate_limit(v_uid, 'bible_read', 600, interval '10 minutes');
  select * into t from bible.translations where id = p_translation and status = 'active';
  if not found then
    raise exception 'That translation isn''t available.' using errcode = 'P0002';
  end if;
  select * into b from bible.books where code = p_book;
  v_count := bible.chapter_count(p_translation, p_book);
  if b.code is null or v_count is null or p_chapter is null or p_chapter < 1 or p_chapter > v_count then
    raise exception 'That chapter isn''t in this translation.' using errcode = 'P0002';
  end if;
  v_last := bible.chapter_last_verse(p_translation, p_book, p_chapter);
  -- Previous/next chapter, crossing book boundaries.
  if p_chapter > 1 then
    v_prev := jsonb_build_object('book', b.code, 'name', b.name, 'chapter', p_chapter - 1);
  else
    select jsonb_build_object('book', x.code, 'name', x.name, 'chapter', bible.chapter_count(p_translation, x.code)) into v_prev
      from bible.books x where x.ordinal < b.ordinal and bible.chapter_count(p_translation, x.code) is not null
     order by x.ordinal desc limit 1;
  end if;
  if p_chapter < v_count then
    v_next := jsonb_build_object('book', b.code, 'name', b.name, 'chapter', p_chapter + 1);
  else
    select jsonb_build_object('book', x.code, 'name', x.name, 'chapter', 1) into v_next
      from bible.books x where x.ordinal > b.ordinal and bible.chapter_count(p_translation, x.code) is not null
     order by x.ordinal limit 1;
  end if;
  return jsonb_build_object(
    'translation', bible.translation_json(t),
    'book', jsonb_build_object('code', b.code, 'name', b.name, 'chapters', v_count),
    'chapter', p_chapter, 'last_verse', v_last, 'prev', v_prev, 'next', v_next,
    'verses', case when t.source_kind = 'database' then bible.verses_json(p_translation, p_book, p_chapter, null, p_chapter, null) end,
    'provider', case when t.source_kind = 'api' then jsonb_build_object(
                  'provider', t.provider, 'ref', t.provider_ref, 'credential_env', t.credential_env,
                  'cache_days', case when t.allow_cache then t.cache_days end) end);
end;
$$;

-- A passage (one plan passage or a bookmarked range), validated and capped
-- at the translation's per-view verse limit.
create function public.bible_passage(p_translation uuid, p_book text, p_sc integer, p_sv integer, p_ec integer, p_ev integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  t bible.translations;
  v_problem text;
  v_count integer;
begin
  perform community.rate_limit(v_uid, 'bible_read', 600, interval '10 minutes');
  select * into t from bible.translations where id = p_translation and status = 'active';
  if not found then
    raise exception 'That translation isn''t available.' using errcode = 'P0002';
  end if;
  v_problem := bible.passage_problem(p_translation, p_book, p_sc, p_sv, p_ec, p_ev);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if t.source_kind = 'database' then
    select count(*) into v_count from bible.verses v
     where v.translation_id = p_translation and v.book_code = p_book
       and (v.chapter, v.verse) >= (p_sc, coalesce(p_sv, 1)) and (v.chapter, v.verse) <= (p_ec, coalesce(p_ev, 1000));
    if v_count > t.max_verses_per_view then
      raise exception 'This passage is longer than this translation allows on one page. Read it chapter by chapter.' using errcode = '22023';
    end if;
  end if;
  return jsonb_build_object(
    'translation', bible.translation_json(t),
    'label', bible.passage_label(p_book, p_sc, p_sv, p_ec, p_ev),
    'book', p_book, 'start_chapter', p_sc, 'start_verse', p_sv, 'end_chapter', p_ec, 'end_verse', p_ev,
    'verses', case when t.source_kind = 'database' then bible.verses_json(p_translation, p_book, p_sc, p_sv, p_ec, p_ev) end,
    'provider', case when t.source_kind = 'api' then jsonb_build_object(
                  'provider', t.provider, 'ref', t.provider_ref, 'credential_env', t.credential_env,
                  'cache_days', case when t.allow_cache then t.cache_days end) end);
end;
$$;

-- Validates references for plan editors (CSV preview, day editor): each
-- item {book, sc, sv, ec, ev} → {ok, problem, label}.
create function public.bible_admin_validate_refs(p_translation uuid, p_refs jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform bible.require_member();
  if not (bible.is_plan_manager() or public.has_capability('bible.manage')) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if not exists (select 1 from bible.translations where id = p_translation and status <> 'retired') then
    raise exception 'Choose an available translation.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_refs) <> 'array' or jsonb_array_length(p_refs) > 5000 then
    raise exception 'Send at most 5000 references at a time.' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('ok', x.problem is null, 'problem', x.problem,
                                        'label', case when x.problem is null then bible.passage_label(x.book, x.sc, x.sv, x.ec, x.ev) end)
                     order by x.n)
      from (select r.n, r.v ->> 'book' as book, (r.v ->> 'sc')::integer as sc, (r.v ->> 'sv')::integer as sv,
                   (r.v ->> 'ec')::integer as ec, (r.v ->> 'ev')::integer as ev,
                   bible.passage_problem(p_translation, r.v ->> 'book', (r.v ->> 'sc')::integer, (r.v ->> 'sv')::integer,
                                         (r.v ->> 'ec')::integer, (r.v ->> 'ev')::integer) as problem
              from jsonb_array_elements(p_refs) with ordinality r(v, n)) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Translations (bible.manage)
-- ---------------------------------------------------------------------------
create function bible.admin_translation_json(t bible.translations)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(t) - 'created_by' - 'rights_confirmed_by'
         || jsonb_build_object(
              'is_default', exists (select 1 from bible.settings s where s.default_translation_id = t.id),
              'plans', (select count(*) from bible.plans p where p.translation_id = t.id),
              'rights_confirmed_by_name', case when t.rights_confirmed_by is null then null else community.display_name(t.rights_confirmed_by) end);
$$;

create function public.bible_admin_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform bible.require_cap('bible.manage');
  return jsonb_build_object(
    'translations', coalesce((select jsonb_agg(bible.admin_translation_json(t) order by t.status, t.name) from bible.translations t), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', i.id, 'translation_id', i.translation_id, 'translation_code', t.code, 'status', i.status, 'format', i.format,
                  'original_name', i.original_name, 'size_bytes', i.size_bytes, 'rows_staged', i.rows_staged, 'summary', i.summary,
                  'error', i.error, 'created_at', i.created_at, 'published_at', i.published_at) order by i.created_at desc)
                  from (select * from bible.imports order by created_at desc limit 30) i
                  join bible.translations t on t.id = i.translation_id), '[]'::jsonb),
    'references', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', f.id, 'translation_label', f.translation_label, 'source', f.source, 'attribution', f.attribution,
                  'status', f.status, 'original_name', f.original_name, 'size_bytes', f.size_bytes, 'page_count', f.page_count,
                  'text_layer', f.text_layer, 'error', f.error, 'created_at', f.created_at) order by f.created_at desc)
                  from bible.reference_files f where f.status <> 'removed'), '[]'::jsonb));
end;
$$;

create function public.bible_admin_translation(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t bible.translations;
begin
  perform bible.require_cap('bible.manage');
  select * into t from bible.translations where id = p_id;
  if not found then
    raise exception 'Translation not found.' using errcode = 'P0002';
  end if;
  return bible.admin_translation_json(t) || jsonb_build_object(
    'imports', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'format', i.format, 'original_name', i.original_name,
                                                             'rows_staged', i.rows_staged, 'summary', i.summary, 'error', i.error,
                                                             'created_at', i.created_at, 'published_at', i.published_at)
                                          order by i.created_at desc)
                           from bible.imports i where i.translation_id = t.id), '[]'::jsonb));
end;
$$;

-- Create or edit a translation. Changing rights or permissions clears the
-- rights confirmation unless the same save confirms it again, and an active
-- translation can't be left unconfirmed.
create function public.bible_admin_translation_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  t bible.translations;
  v_new bible.translations;
  v_fields text[];
  v_kind bible.source_kind := coalesce(nullif(p ->> 'source_kind', ''), 'database')::bible.source_kind;
  v_confirm boolean := coalesce((p ->> 'confirm_rights')::boolean, false);
begin
  if p_id is null then
    insert into bible.translations (code, name, language, source_kind, provider, provider_ref, credential_env, created_by)
    values (upper(btrim(p ->> 'code')), btrim(p ->> 'name'), coalesce(nullif(p ->> 'language', ''), 'en'), v_kind,
            case when v_kind = 'api' then coalesce(nullif(p ->> 'provider', ''), 'api_bible') end,
            nullif(btrim(p ->> 'provider_ref'), ''), nullif(btrim(p ->> 'credential_env'), ''), v_uid)
    returning * into t;
  else
    select * into t from bible.translations where id = p_id for update;
    if not found then
      raise exception 'Translation not found.' using errcode = 'P0002';
    end if;
  end if;

  update bible.translations set
    name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
    language = coalesce(nullif(p ->> 'language', ''), language),
    provider_ref = case when source_kind = 'api' and p ? 'provider_ref' then nullif(btrim(p ->> 'provider_ref'), '') else provider_ref end,
    credential_env = case when source_kind = 'api' and p ? 'credential_env' then nullif(btrim(p ->> 'credential_env'), '') else credential_env end,
    attribution = coalesce(p ->> 'attribution', attribution),
    copyright = coalesce(p ->> 'copyright', copyright),
    source_url = case when p ? 'source_url' then nullif(btrim(p ->> 'source_url'), '') else source_url end,
    source_notes = coalesce(p ->> 'source_notes', source_notes),
    rights = coalesce(nullif(p ->> 'rights', '')::bible.rights, rights),
    rights_notes = coalesce(p ->> 'rights_notes', rights_notes),
    allow_cache = coalesce((p ->> 'allow_cache')::boolean, allow_cache),
    cache_days = case when coalesce((p ->> 'allow_cache')::boolean, allow_cache)
                      then coalesce(nullif(p ->> 'cache_days', '')::integer, cache_days, 1) end,
    allow_copy = coalesce((p ->> 'allow_copy')::boolean, allow_copy),
    allow_print = coalesce((p ->> 'allow_print')::boolean, allow_print),
    allow_export = coalesce((p ->> 'allow_export')::boolean, allow_export),
    max_verses_per_view = coalesce(nullif(p ->> 'max_verses_per_view', '')::integer, max_verses_per_view),
    tracking_required = coalesce((p ->> 'tracking_required')::boolean, tracking_required),
    updated_at = now()
  where id = t.id
  returning * into v_new;

  select array_agg(k) into v_fields from (
    select k from unnest(array['name', 'language', 'provider_ref', 'credential_env', 'attribution', 'copyright', 'source_url',
                               'source_notes', 'rights', 'rights_notes', 'allow_cache', 'cache_days', 'allow_copy', 'allow_print',
                               'allow_export', 'max_verses_per_view', 'tracking_required']) k
     where to_jsonb(t) -> k is distinct from to_jsonb(v_new) -> k) x;

  if v_confirm then
    if v_new.rights = 'unverified' then
      raise exception 'Choose the rights basis before confirming it.' using errcode = '22023';
    end if;
    update bible.translations set rights_confirmed_at = now(), rights_confirmed_by = v_uid where id = t.id returning * into v_new;
  elsif p_id is not null and v_fields && array['rights', 'rights_notes', 'allow_cache', 'cache_days', 'allow_copy', 'allow_print',
                                                'allow_export', 'max_verses_per_view', 'provider_ref', 'tracking_required'] then
    if v_new.status = 'active' then
      raise exception 'Confirm the rights again when changing permissions of an active translation.' using errcode = '22023';
    end if;
    update bible.translations set rights_confirmed_at = null, rights_confirmed_by = null where id = t.id returning * into v_new;
  end if;

  perform bible.audit(case when p_id is null then 'bible.translation_created' else 'bible.translation_updated' end, 'bible_translation', t.id,
                      jsonb_build_object('fields', coalesce(to_jsonb(v_fields), '[]'::jsonb), 'rights_confirmed', v_confirm));
  return bible.admin_translation_json(v_new);
end;
$$;

-- activate (p_confirm = the code), retire, make_default.
create function public.bible_admin_translation_status(p_id uuid, p_action text, p_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  t bible.translations;
begin
  select * into t from bible.translations where id = p_id for update;
  if not found then
    raise exception 'Translation not found.' using errcode = 'P0002';
  end if;
  case p_action
    when 'activate' then
      if p_confirm is distinct from t.code then
        raise exception 'Type the translation code to confirm.' using errcode = '22023';
      end if;
      if t.rights = 'unverified' or t.rights_confirmed_at is null then
        raise exception 'Confirm the rights and permissions first.' using errcode = '22023';
      end if;
      if t.source_kind = 'database' and t.verse_count = 0 then
        raise exception 'Publish a reviewed import of this translation''s text first.' using errcode = '22023';
      end if;
      if t.source_kind = 'api' and (t.provider_ref is null or t.credential_env is null) then
        raise exception 'Enter the provider''s translation ID and the name of the server setting holding the key.' using errcode = '22023';
      end if;
      update bible.translations set status = 'active', published_at = coalesce(published_at, now()), updated_at = now() where id = t.id;
    when 'retire' then
      if exists (select 1 from bible.settings where default_translation_id = t.id) then
        raise exception 'Choose another default translation first.' using errcode = '22023';
      end if;
      if exists (select 1 from bible.plans where translation_id = t.id and status = 'published') then
        raise exception 'Published reading plans use this translation. Archive them or move them to another translation first.' using errcode = '22023';
      end if;
      update bible.translations set status = 'retired', updated_at = now() where id = t.id;
    when 'make_default' then
      if t.status <> 'active' then
        raise exception 'Only an active translation can be the default.' using errcode = '22023';
      end if;
      update bible.settings set default_translation_id = t.id, updated_at = now(), updated_by = v_uid where id;
    else
      raise exception 'Unknown action.' using errcode = '22023';
  end case;
  perform bible.audit('bible.translation_' || p_action, 'bible_translation', t.id, '{}'::jsonb);
  select * into t from bible.translations where id = p_id;
  return bible.admin_translation_json(t);
end;
$$;

-- ---------------------------------------------------------------------------
-- Structured imports: begin → (browser uploads) → processing → stage rows in
-- batches → finish (summary) → review (accept flagged lines) → publish.
-- ---------------------------------------------------------------------------
create function public.bible_admin_import_begin(p_translation uuid, p_format text, p_name text, p_size bigint, p_client_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  i bible.imports;
  v_id uuid := gen_random_uuid();
begin
  select * into i from bible.imports where created_by = v_uid and client_key = p_client_key;
  if found then
    return jsonb_build_object('id', i.id, 'path', i.path, 'status', i.status);
  end if;
  if not exists (select 1 from bible.translations where id = p_translation and source_kind = 'database' and status <> 'retired') then
    raise exception 'Choose a translation whose text is stored in the app.' using errcode = '22023';
  end if;
  if p_format not in ('csv', 'tsv', 'vpl') then
    raise exception 'Upload a CSV, TSV, or verse-per-line text file.' using errcode = '22023';
  end if;
  if p_size is null or p_size < 1 or p_size > 52428800 then
    raise exception 'The file must be smaller than 50 MB.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'bible_import', 10, interval '1 hour');
  insert into bible.imports (id, translation_id, format, path, original_name, size_bytes, client_key, created_by)
  values (v_id, p_translation, p_format,
          'imports/' || v_id || '/source.' || case p_format when 'vpl' then 'txt' else p_format end,
          left(btrim(p_name), 200), p_size, p_client_key, v_uid)
  returning * into i;
  perform bible.audit('bible.import_started', 'bible_import', i.id, jsonb_build_object('format', p_format, 'size', p_size));
  return jsonb_build_object('id', i.id, 'path', i.path, 'status', i.status);
end;
$$;

create function public.bible_admin_import_processing(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  i bible.imports;
begin
  update bible.imports set status = 'processing', rows_staged = 0, summary = '{}'::jsonb, error = null
   where id = p_id and created_by = v_uid and status in ('uploading', 'processing')
  returning * into i;
  if not found then
    raise exception 'This import can''t be processed now.' using errcode = '22023';
  end if;
  delete from bible.staged_verses where import_id = p_id;
  return jsonb_build_object('id', i.id, 'path', i.path, 'format', i.format, 'translation_id', i.translation_id);
end;
$$;

-- A batch of parsed lines: [{line, ref, book, chapter, verse, text, heading,
-- para, poetry, issue}]. The parser marks malformed lines and unknown books;
-- duplicates, versification, and empty text are checked when staging ends.
create function public.bible_admin_import_stage(p_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  v_n integer;
begin
  if not exists (select 1 from bible.imports where id = p_id and created_by = v_uid and status = 'processing') then
    raise exception 'This import isn''t being processed.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Send at most 5000 lines at a time.' using errcode = '22023';
  end if;
  insert into bible.staged_verses (import_id, line_no, book_code, chapter, verse, text, heading, para_start, poetry, source_ref, issue)
  select p_id, (r ->> 'line')::integer,
         case when exists (select 1 from bible.books b where b.code = r ->> 'book') then r ->> 'book' end,
         case when (r ->> 'chapter') ~ '^\d{1,3}$' and (r ->> 'chapter')::integer between 1 and 150 then (r ->> 'chapter')::smallint end,
         case when (r ->> 'verse') ~ '^\d{1,3}$' and (r ->> 'verse')::integer between 1 and 200 then (r ->> 'verse')::smallint end,
         left(coalesce(r ->> 'text', ''), 4000), left(nullif(btrim(r ->> 'heading'), ''), 300),
         coalesce((r ->> 'para')::boolean, false), coalesce((r ->> 'poetry')::boolean, false),
         left(coalesce(nullif(r ->> 'ref', ''), 'line ' || (r ->> 'line')), 60),
         case when r ->> 'issue' in ('malformed', 'unknown_book') then r ->> 'issue'
              when not exists (select 1 from bible.books b where b.code = r ->> 'book') then 'unknown_book'
              when not ((r ->> 'chapter') ~ '^\d{1,3}$' and (r ->> 'chapter')::integer between 1 and 150
                        and (r ->> 'verse') ~ '^\d{1,3}$' and (r ->> 'verse')::integer between 1 and 200) then 'malformed' end
    from jsonb_array_elements(p_rows) r;
  get diagnostics v_n = row_count;
  update bible.imports set rows_staged = rows_staged + v_n where id = p_id;
  return v_n;
end;
$$;

create function bible.import_summary(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lines', (select count(*) from bible.staged_verses where import_id = p_id),
    'verses', (select count(*) from bible.staged_verses where import_id = p_id and issue is null),
    'books', (select count(distinct book_code) from bible.staged_verses where import_id = p_id and issue is null),
    'malformed', (select count(*) from bible.staged_verses where import_id = p_id and issue = 'malformed'),
    'unknown_book', (select count(*) from bible.staged_verses where import_id = p_id and issue = 'unknown_book'),
    'duplicate', (select count(*) from bible.staged_verses where import_id = p_id and issue = 'duplicate'),
    'out_of_range', (select count(*) from bible.staged_verses where import_id = p_id and issue = 'out_of_range'),
    'empty', (select count(*) from bible.staged_verses where import_id = p_id and issue = 'empty'),
    'accepted', (select count(*) from bible.staged_verses where import_id = p_id and issue is not null and accepted),
    -- Verses the reference versification expects (in books and chapters the
    -- file covers) that no publishable line provides.
    'missing', (select count(*) from (
                  select b.code, c.chapter, gs.verse
                    from bible.books b
                    cross join lateral generate_subscripts(b.chapter_verses, 1) c(chapter)
                    cross join lateral generate_series(1, b.chapter_verses[c.chapter]) gs(verse)
                   where exists (select 1 from bible.staged_verses s where s.import_id = p_id and s.book_code = b.code and s.chapter = c.chapter)
                  except
                  select s.book_code, s.chapter, s.verse from bible.staged_verses s
                   where s.import_id = p_id and (s.issue is null or (s.issue in ('out_of_range', 'empty') and s.accepted))) m),
    'missing_chapters', (select count(*) from (
                  select b.code, c.chapter from bible.books b cross join lateral generate_subscripts(b.chapter_verses, 1) c(chapter)
                   where exists (select 1 from bible.staged_verses s where s.import_id = p_id and s.book_code = b.code)
                  except
                  select s.book_code, s.chapter from bible.staged_verses s where s.import_id = p_id and s.issue is null) mc));
$$;

create function public.bible_admin_import_finish(p_id uuid, p_error text default null)
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

-- Review: summary, flagged lines (paged), and the staged text of one
-- chapter with its source references.
create function public.bible_admin_import(p_id uuid, p_issue text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i bible.imports;
begin
  perform bible.require_cap('bible.manage');
  select * into i from bible.imports where id = p_id;
  if not found then
    raise exception 'Import not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', i.id, 'status', i.status, 'format', i.format, 'original_name', i.original_name, 'size_bytes', i.size_bytes,
    'rows_staged', i.rows_staged, 'error', i.error, 'created_at', i.created_at, 'processed_at', i.processed_at,
    'published_at', i.published_at, 'review_note', i.review_note,
    'summary', case when i.status = 'staged' then bible.import_summary(i.id) else i.summary end,
    'translation', (select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'status', t.status, 'verse_count', t.verse_count)
                      from bible.translations t where t.id = i.translation_id),
    'books', coalesce((select jsonb_agg(jsonb_build_object('code', x.book_code, 'name', b.name, 'chapters', x.n) order by b.ordinal)
                         from (select book_code, count(distinct chapter) as n from bible.staged_verses
                                where import_id = i.id and book_code is not null group by book_code) x
                         join bible.books b on b.code = x.book_code), '[]'::jsonb),
    'issues', coalesce((select jsonb_agg(jsonb_build_object('line', s.line_no, 'book', s.book_code, 'chapter', s.chapter, 'verse', s.verse,
                                                            'text', left(s.text, 200), 'source_ref', s.source_ref, 'issue', s.issue,
                                                            'accepted', s.accepted) order by s.line_no)
                          from (select * from bible.staged_verses
                                 where import_id = i.id and issue is not null and (p_issue is null or issue = p_issue)
                                 order by line_no limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) s),
                       '[]'::jsonb),
    'missing', case when i.status = 'staged' then coalesce((
                  select jsonb_agg(jsonb_build_object('book', m.code, 'chapter', m.chapter, 'verse', m.verse) order by m.ordinal, m.chapter, m.verse)
                    from (select b.code, b.ordinal, c.chapter, gs.verse
                            from bible.books b
                            cross join lateral generate_subscripts(b.chapter_verses, 1) c(chapter)
                            cross join lateral generate_series(1, b.chapter_verses[c.chapter]) gs(verse)
                           where exists (select 1 from bible.staged_verses s where s.import_id = i.id and s.book_code = b.code and s.chapter = c.chapter)
                             and not exists (select 1 from bible.staged_verses s
                                              where s.import_id = i.id and s.book_code = b.code and s.chapter = c.chapter and s.verse = gs.verse
                                                and (s.issue is null or (s.issue in ('out_of_range', 'empty') and s.accepted)))
                           order by b.ordinal, c.chapter, gs.verse limit 200) m), '[]'::jsonb) end);
end;
$$;

create function public.bible_admin_import_chapter(p_id uuid, p_book text, p_chapter integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform bible.require_cap('bible.manage');
  return coalesce((select jsonb_agg(jsonb_build_object('line', s.line_no, 'verse', s.verse, 'text', s.text, 'heading', s.heading,
                                                       'para', s.para_start, 'poetry', s.poetry, 'source_ref', s.source_ref,
                                                       'issue', s.issue, 'accepted', s.accepted) order by s.verse, s.line_no)
                     from bible.staged_verses s where s.import_id = p_id and s.book_code = p_book and s.chapter = p_chapter), '[]'::jsonb);
end;
$$;

-- Accept (or un-accept) flagged lines: out_of_range and empty lines are then
-- published (empty as a deliberately omitted verse); malformed and
-- unknown-book lines are excluded. Duplicates can't be accepted: fix the file.
create function public.bible_admin_import_accept(p_id uuid, p_lines integer[], p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform bible.require_cap('bible.manage');
  if not exists (select 1 from bible.imports where id = p_id and status = 'staged') then
    raise exception 'Only a staged import can be reviewed.' using errcode = '22023';
  end if;
  if cardinality(p_lines) > 5000 then
    raise exception 'Choose at most 5000 lines at a time.' using errcode = '22023';
  end if;
  update bible.staged_verses set accepted = coalesce(p_accept, false)
   where import_id = p_id and line_no = any (p_lines) and issue in ('malformed', 'unknown_book', 'out_of_range', 'empty');
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n, 'summary', bible.import_summary(p_id));
end;
$$;

-- Publishing replaces the translation's stored text as a whole, in one
-- transaction. Requires: no duplicates, every flagged line decided, missing
-- verses acknowledged, and the translation code typed as confirmation.
create function public.bible_admin_import_publish(p_id uuid, p_confirm text, p_acknowledge_missing boolean, p_note text default null)
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

create function public.bible_admin_import_discard(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i bible.imports;
begin
  perform bible.require_cap('bible.manage');
  update bible.imports set status = 'discarded', discarded_at = now()
   where id = p_id and status in ('uploading', 'processing', 'staged', 'failed')
  returning * into i;
  if not found then
    raise exception 'This import can''t be discarded.' using errcode = '22023';
  end if;
  delete from bible.staged_verses where import_id = p_id;
  perform bible.audit('bible.import_discarded', 'bible_import', p_id, '{}'::jsonb);
  return jsonb_build_object('id', i.id, 'status', i.status, 'path', i.path);
end;
$$;

-- The stored source file was deleted (by the manager's session).
create function public.bible_admin_objects_deleted(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform bible.require_cap('bible.manage');
  if p_kind = 'import' then
    update bible.imports set objects_deleted_at = now() where id = p_id and status in ('published', 'discarded', 'failed');
  elsif p_kind = 'reference' then
    update bible.reference_files set objects_deleted_at = now() where id = p_id and status = 'removed';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference PDFs (administrators only; never shown to members)
-- ---------------------------------------------------------------------------
create function public.bible_admin_reference_begin(p jsonb, p_client_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  f bible.reference_files;
  v_id uuid := gen_random_uuid();
begin
  select * into f from bible.reference_files where created_by = v_uid and client_key = p_client_key;
  if found then
    return jsonb_build_object('id', f.id, 'path', f.path, 'status', f.status);
  end if;
  if not coalesce((p ->> 'confirm_rights')::boolean, false) then
    raise exception 'Confirm that the church has permission to keep this file.' using errcode = '22023';
  end if;
  if coalesce((p ->> 'size')::bigint, 0) not between 1 and 52428800 then
    raise exception 'The PDF must be smaller than 50 MB.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'bible_import', 10, interval '1 hour');
  insert into bible.reference_files (id, translation_label, source, attribution, rights_statement, rights_confirmed_by,
                                     path, original_name, size_bytes, client_key, created_by)
  values (v_id, btrim(p ->> 'translation_label'), btrim(p ->> 'source'), coalesce(p ->> 'attribution', ''),
          btrim(p ->> 'rights_statement'), v_uid, 'references/' || v_id || '/source.pdf', left(btrim(p ->> 'name'), 200),
          (p ->> 'size')::bigint, p_client_key, v_uid)
  returning * into f;
  perform bible.audit('bible.reference_uploaded', 'bible_reference', f.id, jsonb_build_object('size', f.size_bytes));
  return jsonb_build_object('id', f.id, 'path', f.path, 'status', f.status);
end;
$$;

create function public.bible_admin_reference_processing(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  f bible.reference_files;
begin
  update bible.reference_files set status = 'processing', updated_at = now()
   where id = p_id and created_by = v_uid and status in ('uploading', 'processing')
  returning * into f;
  if not found then
    raise exception 'This file can''t be processed now.' using errcode = '22023';
  end if;
  return jsonb_build_object('id', f.id, 'path', f.path);
end;
$$;

create function public.bible_admin_reference_complete(p_id uuid, p_pages integer, p_text_layer text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_cap('bible.manage');
  f bible.reference_files;
begin
  update bible.reference_files
     set status = case when p_error is null then 'ready'::bible.file_status else 'failed'::bible.file_status end,
         page_count = case when p_error is null then p_pages end,
         text_layer = case when p_error is null then coalesce(p_text_layer, 'unknown') end,
         error = left(p_error, 300), updated_at = now()
   where id = p_id and created_by = v_uid and status = 'processing'
  returning * into f;
  if not found then
    raise exception 'This file isn''t being processed.' using errcode = '22023';
  end if;
  return jsonb_build_object('id', f.id, 'status', f.status);
end;
$$;

create function public.bible_admin_reference(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f bible.reference_files;
begin
  perform bible.require_cap('bible.manage');
  select * into f from bible.reference_files where id = p_id and status <> 'removed';
  if not found then
    raise exception 'File not found.' using errcode = 'P0002';
  end if;
  return to_jsonb(f) - 'client_key' - 'created_by' - 'rights_confirmed_by'
         || jsonb_build_object('confirmed_by_name', case when f.rights_confirmed_by is null then null else community.display_name(f.rights_confirmed_by) end);
end;
$$;

create function public.bible_admin_reference_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f bible.reference_files;
begin
  perform bible.require_cap('bible.manage');
  update bible.reference_files set status = 'removed', removed_at = now(), updated_at = now()
   where id = p_id and status <> 'removed'
  returning * into f;
  if not found then
    raise exception 'File not found.' using errcode = 'P0002';
  end if;
  perform bible.audit('bible.reference_removed', 'bible_reference', p_id, '{}'::jsonb);
  return jsonb_build_object('id', f.id, 'path', f.path);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
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
