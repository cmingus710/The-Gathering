-- Phase 13 · Church reading: Kindle and Audible links, reading dates,
-- private progress, and private journal notes for administrator-selected books.
--
-- Builds on what Phase 7 already has for books (media.items kind 'book':
-- title, author, description, cover image, audible_url, "current" flag, a
-- discussion thread, bookmarks) and on reading assignments (kind
-- 'assignment', one per week/chapter range with dates), which remain the
-- chapter schedule. Nothing existing changes meaning.
--
-- Added:
--   * media.book_details: optional Kindle link, the book's own reading dates,
--     and an optional related Sunday lesson. Kept in its own table so the
--     member item projection (media.item_detail / media_item) is unchanged.
--   * media.book_progress: each member's own private status and position.
--     No staff, teacher, or administrator read path exists.
--   * journal link kind 'book', so "Write privately" on a book creates a My
--     Journal entry linked to it (same owner-only privacy as every entry).
--
-- Provider limits (see docs/phase-13/reading-kindle-audible.md): the app only
-- links out to Amazon Kindle and Audible over HTTPS. It embeds nothing, signs
-- in to nothing, and stores no book text or audio. A member needs their own
-- Kindle/Audible access to the title; the church's copy doesn't grant it.

create table media.book_details (
  item_id uuid primary key references media.items (id) on delete cascade,
  -- Amazon product or Kindle Cloud Reader page, HTTPS only.
  kindle_url text check (
    kindle_url ~ '^https://((www|smile)\.)?(amazon\.(com|co\.uk|ca|com\.au|de|fr|it|es|in|co\.jp|com\.mx|com\.br|nl)|read\.amazon\.(com|co\.uk|ca|com\.au|de|fr|it|es|in|co\.jp))/'
    and char_length(kindle_url) <= 500
    and kindle_url !~ '[[:space:]<>"]'),
  reading_starts_on date,
  reading_ends_on date,
  related_lesson_id uuid references media.items (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint book_details_dates check (reading_ends_on is null or reading_starts_on is null or reading_ends_on >= reading_starts_on)
);
create index book_details_lesson_idx on media.book_details (related_lesson_id);
create index book_details_updated_by_idx on media.book_details (updated_by);

create table media.book_progress (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references media.items (id) on delete cascade,
  status text not null default 'reading' check (status in ('want', 'reading', 'finished')),
  -- Free text the member types ("Chapter 4", "52%"); never book content.
  position text check (char_length(position) <= 80),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);
create index book_progress_item_idx on media.book_progress (item_id);

alter table media.book_details enable row level security;
alter table media.book_progress enable row level security;
revoke all on table media.book_details, media.book_progress from public, anon, authenticated, service_role;

-- Journal entries can link to a book (owner-only, like every entry).
alter table journal.entries drop constraint entries_link_kind_check;
alter table journal.entries add constraint entries_link_kind_check
  check (link_kind in ('none', 'passage', 'assignment', 'devotional', 'lesson', 'book'));

-- ---------------------------------------------------------------------------
-- Member
-- ---------------------------------------------------------------------------
-- Extras for one visible book: Kindle link, reading dates, the related
-- lesson (only if the member can see it), and the member's own progress.
create function public.media_book_extras(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  d media.book_details;
  pr media.book_progress;
  l media.items;
begin
  if not exists (select 1 from media.items i where i.id = p_item and i.kind = 'book' and media.item_visible(i, v_uid)) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into d from media.book_details where item_id = p_item;
  select * into pr from media.book_progress where item_id = p_item and profile_id = v_uid;
  select * into l from media.items where id = d.related_lesson_id and kind = 'lesson';
  return jsonb_build_object(
    'kindle_url', d.kindle_url,
    'reading_starts_on', d.reading_starts_on,
    'reading_ends_on', d.reading_ends_on,
    'related_lesson', case when l.id is not null and media.item_visible(l, v_uid) then jsonb_build_object('id', l.id, 'title', l.title) end,
    'progress', case when pr.item_id is not null then jsonb_build_object('status', pr.status, 'position', pr.position, 'updated_at', pr.updated_at) end);
end;
$$;

-- The member's own progress for every book they can still see.
create function public.media_books_progress()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', p.item_id, 'status', p.status, 'position', p.position, 'updated_at', p.updated_at)
                            order by p.updated_at desc), '[]'::jsonb)
    from media.book_progress p
    join media.items i on i.id = p.item_id
   where p.profile_id = media.require_member() and media.item_visible(i, p.profile_id);
$$;

create function public.media_book_progress_save(p_item uuid, p_status text, p_position text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  v_pos text := nullif(btrim(coalesce(p_position, '')), '');
  pr media.book_progress;
begin
  if not exists (select 1 from media.items i where i.id = p_item and i.kind = 'book' and media.item_visible(i, v_uid)) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_status is null or p_status not in ('want', 'reading', 'finished') then
    raise exception 'Choose where you are with this book.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_pos, '')) > 80 then
    raise exception 'Keep your place note to 80 characters.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'media.book_progress', 60, interval '10 minutes');
  insert into media.book_progress (profile_id, item_id, status, position, updated_at)
  values (v_uid, p_item, p_status, v_pos, now())
  on conflict (profile_id, item_id) do update set status = excluded.status, position = excluded.position, updated_at = now()
  returning * into pr;
  return jsonb_build_object('status', pr.status, 'position', pr.position, 'updated_at', pr.updated_at);
end;
$$;

-- Forget progress for one book (or all books when p_item is null).
create function public.media_book_progress_clear(p_item uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from media.book_progress where profile_id = media.require_member() and (p_item is null or item_id = p_item);
$$;

-- ---------------------------------------------------------------------------
-- Administration (content.edit, like the book itself)
-- ---------------------------------------------------------------------------
create function public.media_admin_book_details(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d media.book_details;
begin
  perform media.require_cap('content.edit');
  if not exists (select 1 from media.items where id = p_item and kind = 'book') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into d from media.book_details where item_id = p_item;
  return jsonb_build_object('kindle_url', d.kindle_url, 'reading_starts_on', d.reading_starts_on, 'reading_ends_on', d.reading_ends_on,
                            'related_lesson_id', d.related_lesson_id, 'updated_at', d.updated_at,
                            'lessons', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'delivered_on', i.delivered_on)
                                                                  order by i.delivered_on desc nulls last), '[]'::jsonb)
                                          from (select * from media.items where kind = 'lesson' and status <> 'archived'
                                                 order by delivered_on desc nulls last limit 200) i));
end;
$$;

create function public.media_admin_book_details_save(p_item uuid, p_kindle_url text, p_starts date, p_ends date, p_related_lesson uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  v_url text := nullif(btrim(coalesce(p_kindle_url, '')), '');
begin
  if not exists (select 1 from media.items where id = p_item and kind = 'book') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_related_lesson is not null and not exists (select 1 from media.items where id = p_related_lesson and kind = 'lesson') then
    raise exception 'Choose a Sunday lesson.' using errcode = '22023';
  end if;
  if p_starts is not null and p_ends is not null and p_ends < p_starts then
    raise exception 'The reading end date is before the start date.' using errcode = '22023';
  end if;
  begin
    insert into media.book_details (item_id, kindle_url, reading_starts_on, reading_ends_on, related_lesson_id, updated_by, updated_at)
    values (p_item, v_url, p_starts, p_ends, p_related_lesson, v_uid, now())
    on conflict (item_id) do update set kindle_url = excluded.kindle_url, reading_starts_on = excluded.reading_starts_on,
      reading_ends_on = excluded.reading_ends_on, related_lesson_id = excluded.related_lesson_id, updated_by = v_uid, updated_at = now();
  exception when check_violation then
    raise exception 'Use an https:// Amazon or Kindle link (for example https://www.amazon.com/dp/…).' using errcode = '22023';
  end;
  perform media.audit('media.book_details_saved', 'media_item', p_item,
                      jsonb_build_object('kindle', v_url is not null, 'dates', p_starts is not null or p_ends is not null,
                                         'related_lesson', p_related_lesson is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- Journal: allow linking an entry to a book the member can see.
-- (Same function as 20261026000500 with 'book' added to the teaching branch;
-- journal.link_json already renders any media item link generically.)
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
    when 'devotional', 'lesson', 'book' then
      v_item := (p_link ->> 'media_item_id')::uuid;
      if not exists (select 1 from media.items i where i.id = v_item and i.kind::text = v_kind and media.item_visible(i, v_uid)) then
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

revoke all on function
  public.media_book_extras(uuid), public.media_books_progress(), public.media_book_progress_save(uuid, text, text),
  public.media_book_progress_clear(uuid), public.media_admin_book_details(uuid),
  public.media_admin_book_details_save(uuid, text, date, date, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.media_book_extras(uuid), public.media_books_progress(), public.media_book_progress_save(uuid, text, text),
  public.media_book_progress_clear(uuid), public.media_admin_book_details(uuid),
  public.media_admin_book_details_save(uuid, text, date, date, uuid)
to authenticated;
