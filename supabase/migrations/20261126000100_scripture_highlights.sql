-- Scripture highlights: six colors, conflict-safe saves, and the
-- "Scripture Highlights" collection in My Journal (additive).
--
-- Builds on bible.highlights (20261026000100), which already keeps one row
-- per member, translation, book, chapter, and verse (its primary key), so
-- overlapping selections and repeated saves can never make duplicates.
-- This step:
--   * adds two colors (purple, orange) to bible.highlight_color;
--   * adds updated_at (the last change; created_at stays the first time the
--     verse was highlighted) and a revision from one sequence, so a save
--     made from an older view of a verse can be told apart from the
--     member's newer change on another device;
--   * replaces public.bible_highlights (same signature; each verse also
--     returns its revision and updated_at) and public.bible_highlight_set
--     (same signature and result; a recolor keeps created_at; the two new
--     colors are accepted);
--   * adds public.bible_highlight_apply(jsonb): color or remove a verse or
--     a contiguous range in one chapter, refusing (not overwriting) verses
--     that changed since the member's view, and idempotent when retried;
--   * adds public.bible_highlight_passages(jsonb): the member's highlights
--     grouped into passages (adjacent verses of one color) for My Journal,
--     with color, translation, and reference filters and two sort orders.
--
-- Privacy is unchanged: owner only, through SECURITY DEFINER functions that
-- recheck approved membership (bible.require_member, which also admits
-- active youth accounts as before) on every call. No staff, administrator,
-- group-leader, household, or guardian path; the table stays closed.
-- Highlights keep references and colors only, never scripture text, so a
-- licensed (API.Bible) translation's wording is never stored here.
--
-- Highlights are translation-specific: a verse is validated against the
-- translation's own versification (bible.chapter_last_verse) and never
-- mapped onto another translation. A selection stays within one chapter.

-- ---------------------------------------------------------------------------
-- Colors, timestamps, revisions
-- ---------------------------------------------------------------------------
-- New enum values can't be used in the transaction that adds them, so
-- nothing below names them as literals; functions check colors against
-- enum_range at run time.
alter type bible.highlight_color add value if not exists 'purple';
alter type bible.highlight_color add value if not exists 'orange';

create sequence bible.highlight_revisions;
revoke all on sequence bible.highlight_revisions from public, anon, authenticated;

alter table bible.highlights
  add column updated_at timestamptz,
  add column revision bigint;
update bible.highlights set updated_at = created_at, revision = nextval('bible.highlight_revisions');
alter table bible.highlights
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column revision set default nextval('bible.highlight_revisions'),
  alter column revision set not null;
alter sequence bible.highlight_revisions owned by bible.highlights.revision;
create index highlights_profile_recent_idx on bible.highlights (profile_id, updated_at desc);

-- A color name the enum has (checked at run time).
create function bible.highlight_color_ok(p_color text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_color is not null and p_color = any (enum_range(null::bible.highlight_color)::text[]);
$$;

-- One chapter's highlights for a member, in verse order.
create function bible.highlight_rows(p_profile uuid, p_translation uuid, p_book text, p_chapter integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('verse', h.verse, 'color', h.color, 'revision', h.revision, 'updated_at', h.updated_at)
                            order by h.verse), '[]'::jsonb)
    from bible.highlights h
   where h.profile_id = p_profile and h.translation_id = p_translation and h.book_code = p_book and h.chapter = p_chapter;
$$;

-- As in 20261026000400; each verse also has its revision and updated_at.
create or replace function public.bible_highlights(p_translation uuid, p_book text, p_chapter integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
begin
  return bible.highlight_rows(v_uid, p_translation, p_book, p_chapter);
end;
$$;

-- As in 20261026000400 (kept for compatibility); a recolor keeps
-- created_at and moves updated_at and the revision.
create or replace function public.bible_highlight_set(p_translation uuid, p_book text, p_chapter integer, p_verses integer[], p_color text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_last integer;
begin
  if not bible.translation_active(p_translation) then
    raise exception 'That translation isn''t available.' using errcode = 'P0002';
  end if;
  v_last := bible.chapter_last_verse(p_translation, p_book, p_chapter);
  if v_last is null or cardinality(p_verses) is null or cardinality(p_verses) > 200
     or exists (select 1 from unnest(p_verses) v where v < 1 or v > v_last) then
    raise exception 'Choose verses in this chapter.' using errcode = '22023';
  end if;
  if nullif(p_color, '') is not null and not bible.highlight_color_ok(p_color) then
    raise exception 'Choose a highlight color.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'bible_annotate', 300, interval '10 minutes');
  if p_color is null or p_color = '' then
    delete from bible.highlights
     where profile_id = v_uid and translation_id = p_translation and book_code = p_book and chapter = p_chapter and verse = any (p_verses);
  else
    if (select count(*) from bible.highlights where profile_id = v_uid) >= 10000 then
      raise exception 'You have reached the highlight limit. Remove some first.' using errcode = '22023';
    end if;
    insert into bible.highlights (profile_id, translation_id, book_code, chapter, verse, color)
    select v_uid, p_translation, p_book, p_chapter, v, p_color::bible.highlight_color from unnest(p_verses) v
    on conflict (profile_id, translation_id, book_code, chapter, verse) do update
      set color = excluded.color, updated_at = now(), revision = nextval('bible.highlight_revisions')
      where bible.highlights.color is distinct from excluded.color;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('verse', h.verse, 'color', h.color) order by h.verse)
                     from bible.highlights h
                    where h.profile_id = v_uid and h.translation_id = p_translation and h.book_code = p_book and h.chapter = p_chapter), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Applying a color (or removing it) with conflict detection
-- ---------------------------------------------------------------------------
-- p: {translation_id, book, chapter, verses: [n, ...] (one verse or a
--     contiguous range), color: name | null (remove),
--     expected: {"<verse>": revision | 0}}  (0 = not highlighted)
--
-- Only the named verses change. A verse whose revision differs from
-- `expected` was changed elsewhere since the member's view: unless it
-- already has the requested state (a retried save), nothing is changed and
-- the result is {status: "conflict"} with the chapter's current highlights,
-- so a delayed save never silently overwrites a newer one. Without
-- `expected` (older callers) the change applies as asked.
--
-- Removing works while a translation is retired (the member can always
-- clear their own data); coloring needs an active translation.
create function public.bible_highlight_apply(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_tr uuid;
  v_book text := p ->> 'book';
  v_ch integer;
  v_color text := nullif(p ->> 'color', '');
  v_verses integer[];
  v_last integer;
  v_conflict boolean;
  v_changed integer := 0;
begin
  begin
    v_tr := (p ->> 'translation_id')::uuid;
    v_ch := (p ->> 'chapter')::integer;
    select array_agg(distinct x::integer order by x::integer) into v_verses
      from jsonb_array_elements_text(case when jsonb_typeof(p -> 'verses') = 'array' then p -> 'verses' else '[]'::jsonb end) x;
  exception when others then
    raise exception 'Choose verses in this chapter.' using errcode = '22023';
  end;
  if v_tr is null or v_book is null or v_ch is null or v_verses is null or cardinality(v_verses) > 200
     or v_verses[cardinality(v_verses)] - v_verses[1] + 1 <> cardinality(v_verses) then
    raise exception 'Choose one verse or a range of verses in one chapter.' using errcode = '22023';
  end if;
  if v_color is not null and not bible.highlight_color_ok(v_color) then
    raise exception 'Choose a highlight color.' using errcode = '22023';
  end if;
  if v_color is not null or bible.translation_active(v_tr) then
    if not bible.translation_active(v_tr) then
      raise exception 'That translation isn''t available.' using errcode = 'P0002';
    end if;
    -- The translation's own versification: no verse is mapped elsewhere.
    v_last := bible.chapter_last_verse(v_tr, v_book, v_ch);
    if v_last is null or v_verses[1] < 1 or v_verses[cardinality(v_verses)] > v_last then
      raise exception 'Choose verses in this chapter.' using errcode = '22023';
    end if;
  end if;
  perform community.rate_limit(v_uid, 'bible_annotate', 300, interval '10 minutes');
  -- One change at a time per member and chapter, so two devices' saves
  -- are checked against each other's results, not interleaved.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || ':' || v_tr::text || ':' || v_book || ':' || v_ch, 0));

  if jsonb_typeof(p -> 'expected') = 'object' then
    select exists (
      select 1
        from unnest(v_verses) v
        left join bible.highlights h
          on h.profile_id = v_uid and h.translation_id = v_tr and h.book_code = v_book and h.chapter = v_ch and h.verse = v
       where coalesce(h.revision, 0) is distinct from coalesce(nullif(p -> 'expected' ->> v::text, '')::bigint, 0)
         and h.color::text is distinct from v_color)
      into v_conflict;
    if v_conflict then
      return jsonb_build_object('status', 'conflict', 'changed', 0, 'highlights', bible.highlight_rows(v_uid, v_tr, v_book, v_ch));
    end if;
  end if;

  if v_color is null then
    delete from bible.highlights
     where profile_id = v_uid and translation_id = v_tr and book_code = v_book and chapter = v_ch and verse = any (v_verses);
    get diagnostics v_changed = row_count;
  else
    if (select count(*) from bible.highlights where profile_id = v_uid) + (
         select count(*) from unnest(v_verses) v
          where not exists (select 1 from bible.highlights h where h.profile_id = v_uid and h.translation_id = v_tr
                               and h.book_code = v_book and h.chapter = v_ch and h.verse = v)) > 10000 then
      raise exception 'You have reached the highlight limit. Remove some first.' using errcode = '22023';
    end if;
    insert into bible.highlights (profile_id, translation_id, book_code, chapter, verse, color)
    select v_uid, v_tr, v_book, v_ch, v, v_color::bible.highlight_color from unnest(v_verses) v
    on conflict (profile_id, translation_id, book_code, chapter, verse) do update
      set color = excluded.color, updated_at = now(), revision = nextval('bible.highlight_revisions')
      where bible.highlights.color is distinct from excluded.color;
    get diagnostics v_changed = row_count;
  end if;
  return jsonb_build_object('status', 'saved', 'changed', v_changed, 'highlights', bible.highlight_rows(v_uid, v_tr, v_book, v_ch));
end;
$$;

-- ---------------------------------------------------------------------------
-- My Journal · Scripture Highlights
-- ---------------------------------------------------------------------------
-- The member's highlights as passages: adjacent verses of one chapter,
-- translation, and color form one passage. A synchronized view of the
-- highlight rows (nothing is copied into journal.entries), so a change in
-- the reader shows here and the other way round, and removing the last
-- verse of a passage removes the passage.
--
-- p: {color?, translation_id?, ref?: {book, sc, sv?, ec, ev?} (passages
--     overlapping it), sort: "recent" (default) | "bible", limit (1–50),
--     offset}
-- Returns {total, items: [...], translations: [{id, code, name}], colors:
-- [names in use]} with references, colors, timestamps, and per-verse
-- revisions only (no scripture text).
create function public.bible_highlight_passages(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := bible.require_member();
  v_color text := nullif(p ->> 'color', '');
  v_tr uuid;
  v_ref jsonb := case when jsonb_typeof(p -> 'ref') = 'object' then p -> 'ref' end;
  v_book text := v_ref ->> 'book';
  v_sc integer;
  v_sv integer;
  v_ec integer;
  v_ev integer;
  v_sort text := coalesce(p ->> 'sort', 'recent');
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  begin
    v_tr := nullif(p ->> 'translation_id', '')::uuid;
    v_sc := nullif(v_ref ->> 'sc', '')::integer;
    v_sv := nullif(v_ref ->> 'sv', '')::integer;
    v_ec := coalesce(nullif(v_ref ->> 'ec', '')::integer, v_sc);
    v_ev := nullif(v_ref ->> 'ev', '')::integer;
    v_limit := least(greatest(coalesce(nullif(p ->> 'limit', '')::integer, 20), 1), 50);
    v_offset := least(greatest(coalesce(nullif(p ->> 'offset', '')::integer, 0), 0), 100000);
  exception when others then
    raise exception 'Those filters aren''t valid.' using errcode = '22023';
  end;
  if v_color is not null and not bible.highlight_color_ok(v_color) then
    raise exception 'Choose a highlight color.' using errcode = '22023';
  end if;
  if v_sort not in ('recent', 'bible') then
    raise exception 'Choose a sort order.' using errcode = '22023';
  end if;
  if v_ref is not null and (v_book is null or not exists (select 1 from bible.books b where b.code = v_book)) then
    raise exception 'Unknown book.' using errcode = '22023';
  end if;

  with mine as (
    select h.*, h.verse - row_number() over (partition by h.translation_id, h.book_code, h.chapter, h.color order by h.verse) as island
      from bible.highlights h
     where h.profile_id = v_uid
       and (v_tr is null or h.translation_id = v_tr)
       and (v_ref is null or h.book_code = v_book)
  ),
  passages as (
    select m.translation_id, m.book_code, m.chapter, m.color, min(m.verse) as sv, max(m.verse) as ev,
           min(m.created_at) as created_at, max(m.updated_at) as updated_at,
           jsonb_agg(jsonb_build_object('verse', m.verse, 'revision', m.revision) order by m.verse) as verses
      from mine m
     group by m.translation_id, m.book_code, m.chapter, m.color, m.island
  ),
  filtered as (
    select x.*, t.code, t.name as translation_name, t.status = 'active' as available, b.name as book_name, b.ordinal
      from passages x
      join bible.translations t on t.id = x.translation_id
      join bible.books b on b.code = x.book_code
     where (v_color is null or x.color::text = v_color)
       and (v_ref is null
            or v_sc is null
            or ((x.chapter, x.ev) >= (v_sc, coalesce(v_sv, 1)) and (x.chapter, x.sv) <= (v_ec, coalesce(v_ev, 1000))))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', f.translation_id || ':' || f.book_code || ':' || f.chapter || ':' || f.sv || '-' || f.ev,
               'translation', jsonb_build_object('id', f.translation_id, 'code', f.code, 'name', f.translation_name, 'available', f.available),
               'book', f.book_code, 'book_name', f.book_name, 'chapter', f.chapter, 'start_verse', f.sv, 'end_verse', f.ev,
               'label', bible.passage_label(f.book_code, f.chapter, f.sv, f.chapter, f.ev),
               'color', f.color, 'created_at', f.created_at, 'updated_at', f.updated_at, 'verses', f.verses)
             order by case when v_sort = 'recent' then f.updated_at end desc,
                      f.ordinal, f.chapter, f.sv, f.code)
        from (select * from filtered
               order by case when v_sort = 'recent' then filtered.updated_at end desc,
                        filtered.ordinal, filtered.chapter, filtered.sv, filtered.code
               limit v_limit offset v_offset) f), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) order by t.code)
        from bible.translations t
       where exists (select 1 from bible.highlights h where h.profile_id = v_uid and h.translation_id = t.id)), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(c order by c)
        from (select distinct h.color::text as c from bible.highlights h where h.profile_id = v_uid) used), '[]'::jsonb))
    into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: new entry points for signed-in people only (each rechecks
-- membership); internal helpers for no API role.
-- ---------------------------------------------------------------------------
revoke execute on function bible.highlight_color_ok(text), bible.highlight_rows(uuid, uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.bible_highlight_apply(jsonb), public.bible_highlight_passages(jsonb) from public, anon, service_role;
grant execute on function public.bible_highlight_apply(jsonb), public.bible_highlight_passages(jsonb) to authenticated;
