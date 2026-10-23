-- Book collections · Apply migration 20261116000100_media_book_collections
-- to the hosted project.
--
-- Use this only if supabase/manual/2026-11-16-record-media-book-collections.sql
-- stopped with "objects are missing" (the migration was never applied).
--
-- It copies supabase/migrations/20261116000100_media_book_collections.sql
-- verbatim and records it under its repository version (created_by =
-- media-book-collections). All or nothing: one transaction; a second run, or
-- a run after the objects exist, stops at the preflight with "Nothing was
-- changed".
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if to_regclass('media.topics') is null or to_regprocedure('public.media_admin_topic_save(text)') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261116000100')
     or to_regprocedure('public.media_books(uuid, text)') is not null then
    raise exception 'Nothing was changed: 20261116000100 is already applied. If it has no history row, run the record script.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261116000100_media_book_collections.sql
-- =========================================================================
-- Books · collections from topics (additive).
--
-- A book's existing topics (media.item_topics, the "Organize → Topics" field)
-- now also group books into collections on the member Books page. There is
-- no separate collection table: a collection is a topic that has at least one
-- book the viewer can open, so an administrator assigns a topic once and the
-- book appears in that collection (and in every other topic's collection).
-- Topics behave exactly as before everywhere else (lessons, devotionals,
-- search, the archive filters).
--
--   * Topic names are stored normalized: trimmed, with any run of whitespace
--     (including no-break spaces) collapsed to one space. The existing unique
--     index (lower(btrim(name))) then also catches names that differ only in
--     capitalization or extra spaces. Existing topics that collide once
--     normalized are merged into the oldest one (its assignments kept, none
--     lost), and a check keeps every future name normalized.
--   * media_admin_topic_save normalizes the same way, reuses an existing topic
--     regardless of capitalization or spacing, and is safe when two saves
--     create the same new topic at once.
--   * public.media_book_collections(): the viewer's collections, each with
--     its name, the number of books the viewer can open, and up to three of
--     those books' covers; plus the same summary for All Books. Topics with
--     no book the viewer can open are left out entirely.
--   * public.media_books(p_collection, p_q): the books in one collection (or
--     all books when p_collection is null), optionally searched by title,
--     author, summary, tags, topics, and people. A collection with no book
--     the viewer can open reads as not found, whether it is empty, restricted,
--     or doesn't exist, so nothing about restricted books is revealed.
--
-- Every book read uses media.item_visible (publication, scheduling, expiry,
-- audience, and group membership), the same rule as the rest of the app.

create function media.topic_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(coalesce(p, ''), '[[:space:]   ﻿]+', ' ', 'g'));
$$;

-- Merge topics whose names only differ by capitalization or whitespace into
-- the oldest of them, keeping every assignment.
create temporary table topic_merge as
with keyed as (
  select t.id, t.created_at, lower(media.topic_name(t.name)) as k from media.topics t
), canon as (
  select distinct on (k) k, id from keyed order by k, created_at, id
)
select keyed.id as dup_id, canon.id as keep_id
  from keyed join canon on canon.k = keyed.k
 where keyed.id <> canon.id;

insert into media.item_topics (item_id, topic_id)
select it.item_id, m.keep_id from media.item_topics it join topic_merge m on m.dup_id = it.topic_id
on conflict do nothing;

delete from media.topics t using topic_merge m where t.id = m.dup_id;

update media.topics set name = media.topic_name(name) where name <> media.topic_name(name);
drop table topic_merge;

alter table media.topics add constraint topics_name_normalized check (name = media.topic_name(name));

create or replace function public.media_admin_topic_save(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := media.topic_name(p_name);
  v_id uuid;
begin
  perform media.require_cap('content.edit');
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Keep each topic between 1 and 60 characters.' using errcode = '22023';
  end if;
  select id into v_id from media.topics where lower(btrim(name)) = lower(v_name);
  if v_id is null then
    insert into media.topics (name) values (v_name) on conflict do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from media.topics where lower(btrim(name)) = lower(v_name);
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member
-- ---------------------------------------------------------------------------
create function public.media_book_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  return jsonb_build_object(
    'all', (select jsonb_build_object(
                     'count', count(*),
                     'covers', coalesce((select jsonb_agg(c.cover) from (
                                 select media.cover_json(b2, v_uid, false) as cover
                                   from media.items b2
                                  where b2.kind = 'book' and b2.cover_asset_id is not null and media.item_visible(b2, v_uid)
                                    and media.cover_json(b2, v_uid, false) is not null
                                  order by b2.book_current desc, b2.sort_order, b2.publish_at desc, b2.id
                                  limit 3) c), '[]'::jsonb))
              from media.items b where b.kind = 'book' and media.item_visible(b, v_uid)),
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'count', t.n,
               'covers', coalesce((select jsonb_agg(c.cover) from (
                           select media.cover_json(b2, v_uid, false) as cover
                             from media.item_topics it2 join media.items b2 on b2.id = it2.item_id
                            where it2.topic_id = t.id and b2.kind = 'book' and b2.cover_asset_id is not null
                              and media.item_visible(b2, v_uid) and media.cover_json(b2, v_uid, false) is not null
                            order by b2.book_current desc, b2.sort_order, b2.publish_at desc, b2.id
                            limit 3) c), '[]'::jsonb))
             order by lower(t.name), t.id)
        from (select tp.id, tp.name, count(*) as n
                from media.topics tp
                join media.item_topics it on it.topic_id = tp.id
                join media.items b on b.id = it.item_id
               where b.kind = 'book' and media.item_visible(b, v_uid)
               group by tp.id, tp.name) t), '[]'::jsonb));
end;
$$;

create function public.media_books(p_collection uuid default null, p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_q text := nullif(left(media.topic_name(p_q), 80), '');
  t media.topics;
  v_total integer;
  v_books jsonb;
begin
  if p_collection is not null then
    select * into t from media.topics where id = p_collection;
  end if;
  select count(*) into v_total
    from media.items b
   where b.kind = 'book' and media.item_visible(b, v_uid)
     and (p_collection is null or exists (select 1 from media.item_topics it where it.item_id = b.id and it.topic_id = p_collection));
  if p_collection is not null and (t.id is null or v_total = 0) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(media.item_card(b, v_uid) order by lower(b.title), b.id), '[]'::jsonb) into v_books
    from media.items b
   where b.kind = 'book' and media.item_visible(b, v_uid)
     and (p_collection is null or exists (select 1 from media.item_topics it where it.item_id = b.id and it.topic_id = p_collection))
     and (v_q is null or media.matches(b, jsonb_build_object('q', v_q)) or b.book_author ilike media.like_pattern(v_q));
  return jsonb_build_object(
    'collection', case when t.id is not null then jsonb_build_object('id', t.id, 'name', t.name) end,
    'q', v_q,
    'total', v_total,
    'books', v_books);
end;
$$;

revoke all on function media.topic_name(text) from public, anon, authenticated, service_role;
revoke all on function public.media_book_collections(), public.media_books(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.media_book_collections(), public.media_books(uuid, text) to authenticated;
-- =========================================================================

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261116000100', 'media_book_collections', 'media-book-collections');

commit;
