-- Videos · Apply migrations 20261109000100_media_video_kind and
-- 20261109000200_media_videos to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/videos-guide.md, "Release"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: a new content kind 'video'; the one-video-per-item index is
-- dropped (several ordered, captioned videos per item); 'video' added to
-- the notice-preference check; new nullable columns media.assets
-- provider_status / provider_checked_at / provider_thumb_url and
-- media.photos kind (default 'photo', so every existing photo stays a
-- photo) / asset_id; two triggers; private helpers; new functions
-- media_admin_video_link_add, media_admin_video_check_save,
-- media_admin_video_publish, media_admin_album_video_add (authenticated
-- only) and media_video_thumb (anon and authenticated, rechecks access like
-- media_file); media_search gains an optional p_kind (the two-argument call
-- keeps working); create-or-replace of the shared media JSON builders,
-- access helpers, media_admin_item_status, media_admin_assets,
-- media_admin_asset, media_admin_external_video_save, the gallery member
-- and review functions. No content, file, album, or photo is published,
-- hidden, moved, or widened.
--
-- Two transactions, because PostgreSQL can't use a new enum value in the
-- transaction that adds it. Each copies its migration verbatim and records
-- it under its repository version (created_by = media-videos). Out of
-- order or a second run stops at a preflight with "Nothing was changed".

-- =========================================================================
-- Step 1 of 2 · 20261109000100_media_video_kind.sql
-- =========================================================================
begin;

do $preflight$
begin
  if to_regclass('media.items') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261108000100') then
    raise exception 'Nothing was changed: the previous step (20261108000100) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000100') then
    raise exception 'Nothing was changed: 20261109000100 is already applied.';
  end if;
end
$preflight$;

-- Videos for member discovery, part 1: a new kind of teaching content.
--
-- A published standalone video is a media.items row of kind 'video' that
-- points at one library asset (YouTube/Vimeo reference or uploaded MP4)
-- through media.item_media. It shares publishing, audiences, scheduling,
-- topics and tags, search, bookmarks, and notifications with every other
-- kind. A library asset on its own is never shown to members.
--
-- PostgreSQL can't use a new enum value in the transaction that adds it, so
-- the value is added here and used in 20261109000200.
alter type media.item_kind add value if not exists 'video';

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261109000100', 'media_video_kind', 'media-videos');

commit;

-- =========================================================================
-- Step 2 of 2 · 20261109000200_media_videos.sql
-- =========================================================================
begin;

do $preflight$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000100') then
    raise exception 'Nothing was changed: step 1 (20261109000100) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000200')
     or exists (select 1 from information_schema.columns where table_schema = 'media' and table_name = 'photos' and column_name = 'asset_id') then
    raise exception 'Nothing was changed: 20261109000200 is already applied.';
  end if;
end
$preflight$;

-- Videos for member discovery, part 2: publishing library videos, several
-- ordered videos per item, videos in Media gallery albums, a content-type
-- filter for Teaching & media search, and administrator visibility reasons.
--
-- Why linked videos weren't reaching members: an external YouTube/Vimeo
-- reference added in the media library is only a library asset. Members
-- reach files exclusively through something published (an item, a show, a
-- series, a lesson block), and nothing let a library video be published on
-- its own, so library-only videos were invisible by design. This migration
-- keeps that rule (a library asset alone is never shown) and adds:
--
--   * Standalone videos: media.items of kind 'video' (20261109000100) with
--     exactly one video attachment. They use the existing publishing panel,
--     audiences (members or one group; never public), schedule and expiry,
--     topics, tags, search, bookmarks, and notifications. Publishing one
--     reuses the library asset (no copy, no new storage).
--   * Several videos per item: the one-video-per-item index is dropped;
--     item_media.sort_order orders them and item_media.label is the caption.
--   * Album videos: media.photos rows of kind 'video' that reference a
--     library asset, so moderation, ordering, hiding, reports, removal, and
--     the Phase 10 youth consent guard (which works on media.photos) apply
--     unchanged. Only gallery moderators add them; member upload permissions
--     are unchanged (photos only).
--   * media_search(p_q, p_limit, p_kind) with a content-type filter.
--   * Provider check results (oEmbed) and administrator "why isn't this
--     visible" details. Access rules are unchanged: every read still goes
--     through media.item_visible / attachment_visible / photo_visible.
--
-- Everything here is additive: no existing row changes, and no content is
-- published, hidden, or widened by this migration.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
drop index media.item_media_one_video_idx;
create index item_media_item_role_idx on media.item_media (item_id, role, sort_order);

alter table media.member_prefs drop constraint member_prefs_muted_kinds_check;
alter table media.member_prefs add constraint member_prefs_muted_kinds_check
  check (muted_kinds <@ array['devotional', 'lesson', 'episode', 'assignment', 'playlist', 'gallery', 'video']::text[]);

-- Last provider check (YouTube/Vimeo oEmbed, run by the app server when a
-- link is added or an administrator asks). Thumbnails: YouTube's come from
-- the video ID; Vimeo's address is stored (its image host only).
alter table media.assets
  add column provider_status text check (provider_status in ('ok', 'unavailable', 'not_embeddable', 'error')),
  add column provider_checked_at timestamptz,
  add column provider_thumb_url text check (provider_thumb_url ~ '^https://i\.vimeocdn\.com/' and char_length(provider_thumb_url) <= 500);

alter table media.photos
  add column kind text not null default 'photo' check (kind in ('photo', 'video')),
  add column asset_id uuid references media.assets (id) on delete restrict;
alter table media.photos add constraint photos_video check ((kind = 'video') = (asset_id is not null));
alter table media.photos drop constraint photos_approved_files;
alter table media.photos add constraint photos_approved_files
  check (status not in ('approved', 'hidden') or kind = 'video' or (display_path is not null and thumb_path is not null));
create index photos_asset_idx on media.photos (asset_id) where asset_id is not null;
-- The same video once per album (while it is live or waiting).
create unique index photos_video_once_idx on media.photos (album_id, asset_id)
  where asset_id is not null and status in ('pending', 'approved', 'hidden');

-- A standalone video shows exactly one video.
create function media.guard_video_item_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from media.items i where i.id = new.item_id and i.kind = 'video') then
    if new.role <> 'video' or exists (select 1 from media.item_media im where im.item_id = new.item_id and im.role = 'video' and im.id <> new.id) then
      raise exception 'A standalone video has exactly one video. Attach more videos to a lesson, devotional, or reading instead.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger item_media_video_item
  before insert or update on media.item_media
  for each row execute function media.guard_video_item_media();

-- Replacing a library file (media_admin_asset_replace) moves album videos
-- to the replacement too, like lesson blocks.
create function media.album_videos_follow_replacement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update media.photos ph set asset_id = new.replaced_by, updated_at = now()
   where ph.asset_id = new.id
     and not exists (select 1 from media.photos x
                      where x.album_id = ph.album_id and x.asset_id = new.replaced_by and x.status in ('pending', 'approved', 'hidden'));
  return new;
end;
$$;

create trigger assets_album_videos_follow_replacement
  after update of replaced_by on media.assets
  for each row
  when (new.replaced_by is not null and new.replaced_by is distinct from old.replaced_by)
  execute function media.album_videos_follow_replacement();

-- ---------------------------------------------------------------------------
-- Access: album videos count as visible uses of their asset
-- ---------------------------------------------------------------------------
-- Unchanged from 20261031000300 except the last clause: a video in an album
-- the person can see (approved only; hidden/pending/removed never count).
create or replace function media.asset_used_visibly(p_asset uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from media.assets a
     where a.id = p_asset and a.status = 'ready'
       and (exists (select 1 from media.item_media im join media.items i on i.id = im.item_id
                     where im.asset_id = a.id and media.attachment_visible(i, im.members_only, a.public_ok, p_profile))
            or exists (select 1 from media.items i
                        where i.cover_asset_id = a.id and media.attachment_visible(i, false, a.public_ok, p_profile))
            or exists (select 1 from media.shows s
                        where s.artwork_asset_id = a.id and media.show_visible(s, p_profile)
                          and (s.audience <> 'public' or a.public_ok or media.is_member(p_profile)))
            or exists (select 1 from media.series sr
                        where sr.cover_asset_id = a.id
                          and (a.public_ok or media.is_member(p_profile))
                          and exists (select 1 from media.items i where i.series_id = sr.id and media.item_visible(i, p_profile)))
            or exists (select 1 from media.lesson_blocks lb join media.items i on i.id = lb.item_id
                        where lb.asset_id = a.id and lb.removed_at is null and not lb.teacher_only
                          and media.is_member(p_profile) and media.item_visible(i, p_profile))
            or exists (select 1 from media.photos ph
                        where ph.asset_id = a.id and ph.kind = 'video' and media.photo_visible(ph, p_profile))));
$$;

-- Unchanged from 20261031000300 except the last clause: album videos are
-- uses (so a file can't be removed while an album shows it).
create or replace function media.asset_usage(p_asset uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(u order by u ->> 'title'), '[]'::jsonb) from (
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', im.role) u
      from media.item_media im join media.items i on i.id = im.item_id where im.asset_id = p_asset
    union all
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', 'cover')
      from media.items i where i.cover_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'show', 'id', s.id, 'kind', s.kind, 'title', s.title, 'status', s.status, 'role', 'artwork')
      from media.shows s where s.artwork_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'series', 'id', sr.id, 'kind', sr.scope, 'title', sr.title, 'status', case when sr.archived then 'archived' else 'active' end, 'role', 'cover')
      from media.series sr where sr.cover_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', 'lesson block')
      from (select distinct lb.item_id from media.lesson_blocks lb where lb.asset_id = p_asset and lb.removed_at is null) x
      join media.items i on i.id = x.item_id
    union all
    select jsonb_build_object('type', 'album', 'id', al.id, 'kind', 'album', 'title', al.title, 'status', ph.status, 'role', 'album video')
      from media.photos ph join media.albums al on al.id = ph.album_id
     where ph.asset_id = p_asset and ph.status in ('pending', 'approved', 'hidden')
  ) x(u);
$$;

-- ---------------------------------------------------------------------------
-- JSON builders
-- ---------------------------------------------------------------------------
-- What a player needs (identifiers only; embed URLs are rebuilt by the app).
create function media.video_json(a media.assets)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'asset_id', a.id, 'kind', a.kind, 'title', a.title,
    'provider', a.provider, 'provider_ref', a.provider_ref, 'provider_hash', a.provider_hash,
    'duration_seconds', a.duration_seconds, 'width', a.width, 'height', a.height,
    'has_thumb', a.kind = 'external_video' and (a.provider = 'youtube' or a.provider_thumb_url is not null),
    'unavailable', coalesce(a.provider_status in ('unavailable', 'not_embeddable'), false),
    'attribution', a.attribution,
    'captions', coalesce((select jsonb_agg(jsonb_build_object('asset_id', c.id, 'language', c.language,
                                                              'label', coalesce(c.label, upper(c.language))) order by c.created_at)
                            from media.assets c where c.parent_id = a.id and c.kind = 'captions' and c.status = 'ready'), '[]'::jsonb));
$$;

-- Unchanged from 20261025000300 except two added keys (has_thumb,
-- unavailable) for the shared video player.
create or replace function media.attachments_json(i media.items, p_viewer uuid, p_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'asset_id', a.id, 'role', im.role, 'label', coalesce(im.label, a.title), 'title', a.title, 'kind', a.kind,
           'mime', a.mime, 'size_bytes', a.size_bytes, 'duration_seconds', a.duration_seconds, 'width', a.width, 'height', a.height,
           'members_only', im.members_only, 'public_ok', a.public_ok, 'status', a.status,
           'provider', a.provider, 'provider_ref', a.provider_ref, 'provider_hash', a.provider_hash, 'external_url', a.external_url,
           'path', a.path, 'has_transcript', a.transcript is not null,
           'rights', case when p_admin then a.rights end,
           'rights_confirmed', a.rights_confirmed_at is not null,
           'attribution', a.attribution,
           'caption', im.label,
           'has_thumb', a.kind = 'external_video' and (a.provider = 'youtube' or a.provider_thumb_url is not null),
           'unavailable', coalesce(a.provider_status in ('unavailable', 'not_embeddable'), false),
           'captions', coalesce((select jsonb_agg(jsonb_build_object('asset_id', c.id, 'language', c.language,
                                                                     'label', coalesce(c.label, upper(c.language))) order by c.created_at)
                                   from media.assets c where c.parent_id = a.id and c.kind = 'captions' and c.status = 'ready'), '[]'::jsonb))
         order by case im.role when 'video' then 0 when 'audio' then 1 when 'handout' then 2 when 'slides' then 3 else 4 end, im.sort_order, a.title), '[]'::jsonb)
    from media.item_media im join media.assets a on a.id = im.asset_id
   where im.item_id = i.id
     and (p_admin or (a.status = 'ready' and media.attachment_visible(i, im.members_only, a.public_ok, p_viewer)));
$$;

-- Unchanged from 20261025000300 except, for standalone videos, 'video'
-- (what to play) and 'used_in' (other content the viewer can open that
-- shows the same video). Other kinds get nulls for both.
create or replace function media.item_card(i media.items, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'kind', i.kind, 'title', i.title, 'summary', i.summary, 'audience', i.audience, 'featured', i.featured,
    'publish_at', i.publish_at, 'devotional_on', i.devotional_on, 'delivered_on', i.delivered_on,
    'starts_on', i.starts_on, 'ends_on', i.ends_on, 'episode_number', i.episode_number, 'season_number', i.season_number,
    'book_author', i.book_author, 'book_current', i.book_current, 'spotify_id', i.spotify_id,
    'scripture_refs', to_jsonb(i.scripture_refs), 'tags', to_jsonb(i.tags),
    'cover', media.cover_json(i, p_viewer, false),
    'series', (select jsonb_build_object('id', s.id, 'title', s.title) from media.series s where s.id = i.series_id and not s.archived),
    'show', (select jsonb_build_object('id', s.id, 'title', s.title) from media.shows s where s.id = i.show_id),
    'book', (select jsonb_build_object('id', b.id, 'title', b.title, 'book_author', b.book_author)
               from media.items b where b.id = i.book_id and media.item_visible(b, p_viewer)),
    'people', media.people_json(i.id),
    'media', (select jsonb_build_object(
                'audio', bool_or(im.role = 'audio'), 'video', bool_or(im.role = 'video'),
                'duration_seconds', max(a.duration_seconds) filter (where im.role in ('audio', 'video')))
                from media.item_media im join media.assets a on a.id = im.asset_id
               where im.item_id = i.id and a.status = 'ready' and media.attachment_visible(i, im.members_only, a.public_ok, p_viewer)),
    'bookmarked', p_viewer is not null and exists (select 1 from media.bookmarks b
                                                     where b.profile_id = p_viewer and b.target_type = 'item' and b.target_id = i.id),
    'completed', p_viewer is not null and exists (select 1 from media.completions c where c.profile_id = p_viewer and c.item_id = i.id),
    'video', case when i.kind = 'video' then (
               select media.video_json(a)
                 from media.item_media im join media.assets a on a.id = im.asset_id
                where im.item_id = i.id and im.role = 'video' and a.status = 'ready'
                  and media.attachment_visible(i, im.members_only, a.public_ok, p_viewer)
                order by im.sort_order limit 1) end,
    'used_in', case when i.kind = 'video' then coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', x.id, 'kind', x.kind, 'title', x.title,
                          'book', case when x.kind = 'assignment' and media.item_visible_id(x.book_id, p_viewer)
                                       then jsonb_build_object('id', x.book_id) end)
                        order by x.publish_at desc)
                   from media.items x
                  where x.kind <> 'video' and media.item_visible(x, p_viewer)
                    and exists (select 1 from media.item_media mine
                                  join media.item_media other on other.asset_id = mine.asset_id and other.role = 'video'
                                  join media.assets a on a.id = other.asset_id
                                 where mine.item_id = i.id and mine.role = 'video' and other.item_id = x.id
                                   and media.attachment_visible(x, other.members_only, a.public_ok, p_viewer))), '[]'::jsonb) end);
$$;

-- Unchanged from 20261025000300 except that the search text also matches
-- topic names and, for standalone videos, the longer description.
create or replace function media.matches(i media.items, f jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (nullif(f ->> 'q', '') is null
          or i.title ilike media.like_pattern(f ->> 'q') or i.summary ilike media.like_pattern(f ->> 'q')
          or exists (select 1 from unnest(i.tags) t where t ilike media.like_pattern(f ->> 'q'))
          or exists (select 1 from unnest(i.scripture_refs) r where r ilike media.like_pattern(f ->> 'q'))
          or exists (select 1 from media.item_people ip join media.people pp on pp.id = ip.person_id
                      where ip.item_id = i.id and pp.name ilike media.like_pattern(f ->> 'q'))
          or exists (select 1 from media.item_topics it join media.topics t on t.id = it.topic_id
                      where it.item_id = i.id and t.name ilike media.like_pattern(f ->> 'q'))
          or (i.kind = 'video' and i.body ilike media.like_pattern(f ->> 'q')))
     and (nullif(f ->> 'series_id', '') is null or i.series_id = (f ->> 'series_id')::uuid)
     and (nullif(f ->> 'topic_id', '') is null or exists (select 1 from media.item_topics it where it.item_id = i.id and it.topic_id = (f ->> 'topic_id')::uuid))
     and (nullif(f ->> 'person_id', '') is null or exists (select 1 from media.item_people ip where ip.item_id = i.id and ip.person_id = (f ->> 'person_id')::uuid))
     and (nullif(f ->> 'book', '') is null or exists (select 1 from unnest(i.scripture_refs) r where r = f ->> 'book' or r like (f ->> 'book') || ' %'))
     and (nullif(f ->> 'from', '') is null or coalesce(i.devotional_on, i.delivered_on, i.starts_on, (i.publish_at at time zone 'UTC')::date) >= (f ->> 'from')::date)
     and (nullif(f ->> 'to', '') is null or coalesce(i.devotional_on, i.delivered_on, i.starts_on, (i.publish_at at time zone 'UTC')::date) <= (f ->> 'to')::date)
     and (nullif(f ->> 'featured', '') is null or i.featured = (f ->> 'featured')::boolean)
     and (nullif(f ->> 'show_id', '') is null or i.show_id = (f ->> 'show_id')::uuid)
     and (nullif(f ->> 'book_id', '') is null or i.book_id = (f ->> 'book_id')::uuid)
     and (nullif(f ->> 'current', '') is null or i.book_current = (f ->> 'current')::boolean);
$$;

-- Where a library video appears, for administrators: standalone video
-- pages, other content, and albums, each with its state and audience.
create function media.video_publishing(p_asset uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'standalone', coalesce((select jsonb_agg(jsonb_build_object(
                              'id', i.id, 'title', i.title, 'state', media.item_state(i), 'audience', i.audience,
                              'group_name', (select g.name from community.groups g where g.id = i.group_id),
                              'publish_at', i.publish_at, 'expires_at', i.expires_at) order by i.created_at)
                              from media.item_media im join media.items i on i.id = im.item_id
                             where im.asset_id = p_asset and i.kind = 'video'), '[]'::jsonb),
    'attached', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', i.id, 'kind', i.kind, 'title', i.title, 'state', media.item_state(i), 'audience', i.audience,
                            'group_name', (select g.name from community.groups g where g.id = i.group_id),
                            'role', im.role, 'members_only', im.members_only) order by i.title)
                            from media.item_media im join media.items i on i.id = im.item_id
                           where im.asset_id = p_asset and i.kind <> 'video'), '[]'::jsonb),
    'albums', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', al.id, 'title', al.title, 'album_status', al.status, 'status', ph.status, 'audience', al.audience,
                          'group_name', (select g.name from community.groups g where g.id = al.group_id)) order by al.title)
                          from media.photos ph join media.albums al on al.id = ph.album_id
                         where ph.asset_id = p_asset and ph.status in ('pending', 'approved', 'hidden')), '[]'::jsonb),
    'blocks', (select count(*) from media.lesson_blocks lb where lb.asset_id = p_asset and lb.removed_at is null));
$$;

-- ---------------------------------------------------------------------------
-- Publishing (content.publish): a standalone video needs its video
-- ---------------------------------------------------------------------------
-- Unchanged from 20261025000300 except the standalone-video check.
create or replace function public.media_admin_item_status(p_id uuid, p_action text, p_publish_at timestamptz, p_expires_at timestamptz, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.publish');
  i media.items;
  v_missing text;
  v_at timestamptz;
begin
  select * into i from media.items where id = p_id for update;
  if i.id is null then
    raise exception 'Content not found.' using errcode = 'P0002';
  end if;
  if p_action = 'publish' then
    if i.status = 'archived' then
      raise exception 'Restore this item before publishing it.' using errcode = '22023';
    end if;
    if char_length(btrim(i.title)) < 3 or i.title = 'Untitled' then
      raise exception 'Give it a title before publishing.' using errcode = '22023';
    end if;
    if i.audience = 'public' and coalesce(p_confirm, '') <> 'public' then
      raise exception 'Confirm that this will be visible to anyone, including people who are not signed in.' using errcode = '22023';
    end if;
    if i.kind = 'episode' and not exists (select 1 from media.item_media where item_id = i.id and role = 'audio') then
      raise exception 'Attach the episode''s audio before publishing.' using errcode = '22023';
    end if;
    if i.kind = 'video' and not exists (select 1 from media.item_media im join media.assets a on a.id = im.asset_id
                                         where im.item_id = i.id and im.role = 'video' and a.status = 'ready') then
      raise exception 'Choose the video before publishing.' using errcode = '22023';
    end if;
    select string_agg(a.title, ', ' order by a.title) into v_missing
      from media.item_media im join media.assets a on a.id = im.asset_id
     where im.item_id = i.id and (a.status <> 'ready'
                                  or (a.kind in ('audio', 'video', 'document') and (a.rights = 'unknown' or a.rights_confirmed_at is null)));
    if v_missing is not null then
      raise exception 'Confirm the source and permission for church-hosted files before publishing: %.', v_missing using errcode = '22023';
    end if;
    if not media.thread_fits(i.discussion_thread_id, i.audience, i.group_id) then
      raise exception 'The linked discussion would reach people outside this content''s audience.' using errcode = '22023';
    end if;
    v_at := coalesce(p_publish_at, now());
    if p_expires_at is not null and p_expires_at <= v_at then
      raise exception 'The expiry time must be after the publish time.' using errcode = '22023';
    end if;
    update media.items
       set status = case when v_at > now() then 'scheduled'::media.pub_status else 'published'::media.pub_status end,
           publish_at = v_at, expires_at = p_expires_at,
           first_published_at = coalesce(first_published_at, v_at),
           updated_by = v_uid, updated_at = now()
     where id = i.id
    returning * into i;
  elsif p_action = 'unpublish' then
    update media.items set status = 'draft', updated_by = v_uid, updated_at = now() where id = i.id returning * into i;
  elsif p_action = 'archive' then
    update media.items set status = 'archived', archived_at = now(), featured = false, book_current = false,
                           updated_by = v_uid, updated_at = now()
     where id = i.id returning * into i;
  elsif p_action = 'restore' then
    update media.items set status = 'draft', archived_at = null, updated_by = v_uid, updated_at = now()
     where id = i.id and status = 'archived' returning * into i;
  elsif p_action = 'expiry' then
    if p_expires_at is not null and i.publish_at is not null and p_expires_at <= i.publish_at then
      raise exception 'The expiry time must be after the publish time.' using errcode = '22023';
    end if;
    update media.items set expires_at = p_expires_at, updated_by = v_uid, updated_at = now() where id = i.id returning * into i;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform media.audit('media.item_' || p_action, 'media_item', i.id,
                      jsonb_build_object('kind', i.kind, 'state', media.item_state(i), 'audience', i.audience));
  return jsonb_build_object('id', i.id, 'state', media.item_state(i));
end;
$$;

-- ---------------------------------------------------------------------------
-- Library: external links without duplicates, provider checks, publishing
-- ---------------------------------------------------------------------------
-- The existing reference for the same video when there is one (never a
-- second record), otherwise a new one. Callers check capabilities.
create function media.external_video_upsert(p_uid uuid, p_provider text, p_ref text, p_hash text, p_url text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_provider not in ('youtube', 'vimeo') then
    raise exception 'Only YouTube and Vimeo videos are supported.' using errcode = '22023';
  end if;
  select a.id into v_id from media.assets a
   where a.kind = 'external_video' and a.status = 'ready' and a.provider = p_provider and a.provider_ref = p_ref
     and coalesce(a.provider_hash, '') = coalesce(nullif(p_hash, ''), '')
   order by a.created_at limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;
  insert into media.assets (kind, status, title, provider, provider_ref, provider_hash, external_url, created_by, ready_at)
  values ('external_video', 'ready', left(coalesce(nullif(btrim(p_title), ''), 'Video'), 160), p_provider, p_ref,
          nullif(p_hash, ''), left(p_url, 500), p_uid, now())
  returning id into v_id;
  perform media.audit('media.asset_created', 'media_asset', v_id, jsonb_build_object('kind', 'external_video', 'provider', p_provider));
  return jsonb_build_object('id', v_id, 'created', true);
end;
$$;

-- Unchanged from 20261025000200 except that adding a link that is already
-- in the library returns the existing record instead of a duplicate.
create or replace function public.media_admin_external_video_save(p_id uuid, p_provider text, p_ref text, p_hash text, p_url text, p_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
  v_id uuid;
begin
  if p_provider not in ('youtube', 'vimeo') then
    raise exception 'Only YouTube and Vimeo videos are supported.' using errcode = '22023';
  end if;
  if p_id is null then
    return (media.external_video_upsert(v_uid, p_provider, p_ref, p_hash, p_url, p_title) ->> 'id')::uuid;
  end if;
  update media.assets
     set provider = p_provider, provider_ref = p_ref, provider_hash = nullif(p_hash, ''), external_url = left(p_url, 500),
         title = left(coalesce(nullif(btrim(p_title), ''), title), 160),
         provider_status = null, provider_checked_at = null, provider_thumb_url = null, updated_at = now()
   where id = p_id and kind = 'external_video' and status <> 'removed'
  returning id into v_id;
  if v_id is null then
    raise exception 'Video not found.' using errcode = 'P0002';
  end if;
  perform media.audit('media.asset_updated', 'media_asset', v_id, jsonb_build_object('fields', array['provider']));
  return v_id;
end;
$$;

-- Adds (or finds) a YouTube/Vimeo link from inside a content editor and
-- returns it as a picker choice. Same permission as the library itself.
create function public.media_admin_video_link_add(p_provider text, p_ref text, p_hash text, p_url text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
  v_r jsonb;
  a media.assets;
begin
  v_r := media.external_video_upsert(v_uid, p_provider, p_ref, p_hash, p_url, p_title);
  select * into a from media.assets where id = (v_r ->> 'id')::uuid;
  return media.asset_json(a) || media.video_json(a) || jsonb_build_object('created', v_r -> 'created');
end;
$$;

-- Records the result of the app server's oEmbed check (never a guess).
create function public.media_admin_video_check_save(p_id uuid, p_status text, p_thumb text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform media.require_member();
  if not (media.is_manager() or public.has_capability('gallery.moderate')) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if p_status not in ('ok', 'unavailable', 'not_embeddable', 'error') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update media.assets
     set provider_status = p_status, provider_checked_at = now(),
         provider_thumb_url = case when provider = 'vimeo' then coalesce(nullif(p_thumb, ''), provider_thumb_url) end
   where id = p_id and kind = 'external_video';
end;
$$;

-- "Publish for members": a draft standalone video for a library video,
-- reusing the asset. The title starts as the library title; the editor
-- sets the description, thumbnail, topics, audience, and date, and a
-- publisher publishes it. An existing standalone page is returned instead
-- of a second one.
create function public.media_admin_video_publish(p_asset uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  a media.assets;
  i media.items;
begin
  select * into a from media.assets where id = p_asset and kind in ('video', 'external_video');
  if a.id is null then
    raise exception 'Video not found.' using errcode = 'P0002';
  end if;
  if a.status <> 'ready' then
    raise exception 'This video isn''t ready yet.' using errcode = '22023';
  end if;
  select x.* into i from media.items x join media.item_media im on im.item_id = x.id
   where im.asset_id = a.id and x.kind = 'video' and x.status <> 'archived'
   order by x.created_at limit 1;
  if i.id is not null then
    return jsonb_build_object('id', i.id, 'created', false);
  end if;
  insert into media.items (kind, title, audience, created_by, updated_by)
  values ('video', left(a.title, 200), 'members', v_uid, v_uid)
  returning * into i;
  insert into media.item_media (item_id, asset_id, role) values (i.id, a.id, 'video');
  perform media.audit('media.item_created', 'media_item', i.id, jsonb_build_object('kind', 'video', 'from_asset', a.id));
  return jsonb_build_object('id', i.id, 'created', true);
end;
$$;

-- Unchanged from 20261025000200 except: video files include where they
-- are published ('publishing'), and p_status 'needs_decision' lists ready
-- videos that aren't used anywhere yet.
create or replace function public.media_admin_assets(p_kind text, p_status text, p_q text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform media.require_member();
  if not media.is_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return (
    with f as (
      select a.* from media.assets a
       where (p_kind is null or a.kind::text = p_kind)
         and (case when p_status is null then a.status <> 'removed'
                   when p_status = 'needs_decision' then a.status = 'ready' and a.kind in ('video', 'external_video')
                                                        and jsonb_array_length(media.asset_usage(a.id)) = 0
                   else a.status::text = p_status end)
         and (p_q is null or a.title ilike media.like_pattern(p_q) or a.original_name ilike media.like_pattern(p_q))
         and a.kind <> 'captions')
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(media.asset_json(a) || jsonb_build_object(
                           'usage_count', jsonb_array_length(media.asset_usage(a.id)),
                           'provider_status', a.provider_status,
                           'publishing', case when a.kind in ('video', 'external_video') then media.video_publishing(a.id) end)
                         order by a.created_at desc)
          from (select * from f order by f.created_at desc limit v_limit offset v_offset) a), '[]'::jsonb),
      'total', (select count(*) from f)));
end;
$$;

-- Unchanged from 20261025000200 except the added video details.
create or replace function public.media_admin_asset(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a media.assets;
begin
  perform media.require_member();
  if not media.is_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  select * into a from media.assets where id = p_id;
  if a.id is null then
    raise exception 'File not found.' using errcode = 'P0002';
  end if;
  return media.asset_json(a) || jsonb_build_object(
    'transcript', a.transcript,
    'usage', media.asset_usage(a.id),
    'captions', coalesce((select jsonb_agg(media.asset_json(c) order by c.created_at)
                            from media.assets c where c.parent_id = a.id and c.status <> 'removed'), '[]'::jsonb),
    'rights_confirmed_by', case when a.rights_confirmed_by is not null then community.display_name(a.rights_confirmed_by) end,
    'created_by', case when a.created_by is not null then community.display_name(a.created_by) end,
    'provider_status', a.provider_status, 'provider_checked_at', a.provider_checked_at,
    'video', case when a.kind in ('video', 'external_video') then media.video_json(a) end,
    'publishing', case when a.kind in ('video', 'external_video') then media.video_publishing(a.id) end,
    'can_publish_video', public.has_capability('content.edit'));
end;
$$;

-- What the thumbnail route needs, when the caller may see the video (or
-- manages media or the gallery). Signed-out visitors get public uses only.
create function public.media_video_thumb(p_asset uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a media.assets;
begin
  select * into a from media.assets where id = p_asset and status = 'ready' and kind = 'external_video';
  if a.id is null
     or not (media.asset_visible(a.id, v_uid)
             or (v_uid is not null and media.is_member(v_uid) and (media.is_manager() or public.has_capability('gallery.moderate')))) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('provider', a.provider, 'provider_ref', a.provider_ref, 'provider_thumb_url', a.provider_thumb_url);
end;
$$;

-- ---------------------------------------------------------------------------
-- Search with a content-type filter
-- ---------------------------------------------------------------------------
-- p_kind: null (everything), 'video', 'devotional', 'lesson', 'podcast'
-- (church episodes, shows, external episodes), 'reading' (books and
-- assignments), 'music' (playlists), or 'gallery' (Media gallery albums).
-- A standalone video is one item, so it appears once however many lessons
-- also show it; videos only attached to other content are reached through
-- that content (never listed on their own).
drop function public.media_search(text, integer);
create function public.media_search(p_q text, p_limit integer, p_kind text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_f jsonb := jsonb_build_object('q', p_q);
  v_pat text := media.like_pattern(p_q);
  v_kind text := nullif(p_kind, 'all');
  v_items text[] := case v_kind
                      when 'video' then array['video'] when 'devotional' then array['devotional'] when 'lesson' then array['lesson']
                      when 'podcast' then array['episode'] when 'reading' then array['book', 'assignment']
                      when 'music' then array['playlist'] when 'gallery' then array[]::text[] end;
  v_shows boolean := v_kind is null or v_kind = 'podcast';
  v_albums boolean := v_kind is null or v_kind = 'gallery';
begin
  if char_length(btrim(coalesce(p_q, ''))) < 2 then
    return '[]'::jsonb;
  end if;
  if v_kind is not null and v_items is null then
    raise exception 'Unknown content type.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(r.j order by r.rank, r.at desc nulls last) from (
    select y.* from (
      select media.item_card(i, v_uid) || jsonb_build_object('type', 'item') j,
             case when i.title ilike v_pat then 0 else 1 end rank, media.sort_key(i) at
        from media.items i
       where (v_items is null or i.kind::text = any (v_items)) and media.item_visible(i, v_uid) and media.matches(i, v_f)
      union all
      select media.show_json(s, v_uid, false) || jsonb_build_object('type', 'show'), 0, s.updated_at
        from media.shows s
       where v_shows and media.show_visible(s, v_uid) and (s.title ilike v_pat or s.author ilike v_pat or s.description ilike v_pat)
      union all
      select media.external_episode_json(e, s, v_uid) || jsonb_build_object('type', 'external'),
             case when e.title ilike v_pat then 0 else 1 end, e.published_at
        from media.external_episodes e join media.shows s on s.id = e.show_id
       where v_shows and e.missing_since is null and media.show_visible(s, v_uid) and (e.title ilike v_pat or e.description ilike v_pat)
      union all
      select jsonb_build_object('type', 'album', 'id', a.id, 'title', a.title, 'album_on', a.album_on), 0, a.album_on::timestamptz
        from media.albums a where v_albums and media.album_visible(a, v_uid) and a.title ilike v_pat) y
    order by y.rank, y.at desc nulls last limit v_limit) r), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Media gallery: videos in albums
-- ---------------------------------------------------------------------------
-- Unchanged from 20261025000500 except 'kind' and, for videos, 'video'.
create or replace function media.photo_json(ph media.photos, p_viewer uuid, p_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', ph.id, 'album_id', ph.album_id, 'status', ph.status, 'caption', ph.caption, 'alt_text', ph.alt_text,
    'width', ph.width, 'height', ph.height, 'sort_order', ph.sort_order, 'created_at', ph.created_at,
    'approved_at', ph.approved_at, 'mine', ph.uploader_id = p_viewer,
    'kind', ph.kind,
    'video', case when ph.kind = 'video' then (select media.video_json(a) from media.assets a where a.id = ph.asset_id and a.status = 'ready') end,
    'display_path', case when ph.status in ('approved', 'hidden') then ph.display_path end,
    'thumb_path', case when ph.status in ('approved', 'hidden') then ph.thumb_path end,
    -- Review copies: only for the uploader and moderators.
    'review_display_path', case when p_admin or ph.uploader_id = p_viewer then ph.review_display_path end,
    'review_thumb_path', case when p_admin or ph.uploader_id = p_viewer then ph.review_thumb_path end,
    'review_reason', case when p_admin or ph.uploader_id = p_viewer then ph.review_reason end,
    'uploader', case when p_admin and ph.uploader_id is not null then community.display_name(ph.uploader_id) end,
    'minors', case when p_admin then ph.minors end,
    'permission_confirmed', case when p_admin then ph.permission_confirmed end,
    'caption_edited_at', case when p_admin then ph.caption_edited_at end,
    'open_reports', case when p_admin then (select count(*) from media.photo_reports r where r.photo_id = ph.id and r.status = 'open') end);
$$;

-- Unchanged from 20261025000500 except: covers are photos only, and
-- photo_count / video_count are separate.
create or replace function media.album_json(a media.albums, p_viewer uuid, p_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'title', a.title, 'description', a.description, 'album_on', a.album_on, 'audience', a.audience,
    'group_name', (select g.name from community.groups g where g.id = a.group_id and (p_admin or community.group_member(g.id, p_viewer))),
    'uploads_open', a.uploads_open and a.status = 'published', 'status', a.status,
    -- Event context, shown only to people who can see that event.
    'event', (select jsonb_build_object('series_id', s.id, 'title', s.title)
                from events.series s where s.id = a.event_series_id and (p_admin or events.visible_to(s.id, p_viewer))),
    'cover', coalesce(
      (select jsonb_build_object('photo_id', ph.id, 'thumb_path', ph.thumb_path, 'alt', ph.alt_text)
         from media.photos ph where ph.id = a.cover_photo_id and ph.status = 'approved' and ph.kind = 'photo'),
      (select jsonb_build_object('photo_id', ph.id, 'thumb_path', ph.thumb_path, 'alt', ph.alt_text)
         from media.photos ph where ph.album_id = a.id and ph.status = 'approved' and ph.kind = 'photo' order by ph.sort_order, ph.approved_at limit 1)),
    'photo_count', (select count(*) from media.photos ph where ph.album_id = a.id and ph.status = 'approved' and ph.kind = 'photo'),
    'video_count', (select count(*) from media.photos ph where ph.album_id = a.id and ph.status = 'approved' and ph.kind = 'video'),
    'can_upload', a.uploads_open and a.status = 'published' and media.can_contribute(a, p_viewer));
$$;

-- Unchanged from 20261025000500 except that "your photos waiting" lists
-- photos only (moderators add videos; they're reviewed in Administration).
create or replace function public.media_album(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  a media.albums;
  st media.settings;
begin
  select * into a from media.albums where id = p_id;
  if a.id is null or not media.album_visible(a, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into st from media.settings;
  return media.album_json(a, v_uid, false) || jsonb_build_object(
    'photos', coalesce((select jsonb_agg(media.photo_json(ph, v_uid, false) order by ph.sort_order, ph.approved_at, ph.id)
                          from media.photos ph where ph.album_id = a.id and ph.status = 'approved'), '[]'::jsonb),
    'my_pending', coalesce((select jsonb_agg(media.photo_json(ph, v_uid, false) order by ph.created_at desc)
                              from media.photos ph
                             where ph.album_id = a.id and ph.uploader_id = v_uid and ph.kind = 'photo'
                               and ph.status in ('uploading', 'processing', 'pending', 'rejected', 'hidden', 'failed')), '[]'::jsonb),
    'limits', jsonb_build_object('file_mb', st.gallery_file_mb, 'batch_max', st.gallery_batch_max, 'daily_max', st.gallery_daily_max));
end;
$$;

-- Unchanged from 20261025000500 except photos only.
create or replace function public.media_my_photos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  return coalesce((select jsonb_agg(media.photo_json(ph, v_uid, false) || jsonb_build_object('album_title', a.title) order by ph.created_at desc)
                     from media.photos ph join media.albums a on a.id = ph.album_id
                    where ph.uploader_id = v_uid and ph.kind = 'photo' and ph.status <> 'removed' and media.can_contribute(a, v_uid)), '[]'::jsonb);
end;
$$;

-- A gallery moderator adds a video to an album: a ready library video
-- (p_asset), or a YouTube/Vimeo link (found or added to the library). It
-- waits for review like a member photo, so the minors review and the youth
-- consent guard apply before anyone sees it. Members can't add videos.
create function public.media_admin_album_video_add(p_album uuid, p_asset uuid, p_provider text, p_ref text, p_hash text, p_url text, p_title text, p_caption text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('gallery.moderate');
  al media.albums;
  a media.assets;
  v_asset uuid := p_asset;
  v_id uuid;
begin
  select * into al from media.albums where id = p_album for update;
  if al.id is null then
    raise exception 'Album not found.' using errcode = 'P0002';
  end if;
  if al.status = 'archived' then
    raise exception 'Restore the album before adding videos.' using errcode = '22023';
  end if;
  if v_asset is null then
    v_asset := (media.external_video_upsert(v_uid, p_provider, p_ref, p_hash, p_url, p_title) ->> 'id')::uuid;
  end if;
  select * into a from media.assets where id = v_asset;
  if a.id is null or a.status <> 'ready' or a.kind not in ('video', 'external_video') then
    raise exception 'Choose a ready video.' using errcode = '22023';
  end if;
  if exists (select 1 from media.photos where album_id = al.id and asset_id = a.id and status in ('pending', 'approved', 'hidden')) then
    raise exception 'This video is already in the album.' using errcode = '22023';
  end if;
  insert into media.photos (album_id, uploader_id, status, kind, asset_id, caption, permission_confirmed, client_key)
  values (al.id, v_uid, 'pending', 'video', a.id, left(btrim(coalesce(p_caption, '')), 500), true, gen_random_uuid())
  returning id into v_id;
  perform media.mod_log('video.added', v_id, al.id);
  return v_id;
end;
$$;

-- Unchanged from 20261025000500 except for videos: approval needs no
-- re-encoded copies and doesn't depend on the adding moderator's own group
-- membership; the minors review and the youth consent trigger still apply.
create or replace function public.media_admin_photo_review(p_id uuid, p_action text, p_reason text, p_minors text, p_display text, p_thumb text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('gallery.moderate');
  ph media.photos;
  a media.albums;
  v_uploads text[] := '{}';
  v_media text[] := '{}';
  v_prefix text;
begin
  select * into ph from media.photos where id = p_id for update;
  if ph.id is null then
    raise exception 'Photo not found.' using errcode = 'P0002';
  end if;
  select * into a from media.albums where id = ph.album_id;
  if p_action = 'approve' then
    if ph.status <> 'pending' then
      raise exception 'Only photos waiting for review can be approved.' using errcode = '22023';
    end if;
    if p_minors not in ('none', 'permission_confirmed') then
      raise exception 'Confirm whether the photo shows anyone under 18, and that permission has been confirmed if so.' using errcode = '22023';
    end if;
    if ph.kind = 'video' then
      if not exists (select 1 from media.assets x where x.id = ph.asset_id and x.status = 'ready') then
        raise exception 'This video isn''t available in the library any more.' using errcode = '22023';
      end if;
      update media.photos
         set status = 'approved', minors = p_minors, reviewed_by = v_uid, reviewed_at = now(), review_reason = null, approved_at = now(),
             sort_order = coalesce((select max(sort_order) + 1 from media.photos where album_id = ph.album_id and status in ('approved', 'hidden')), 0),
             updated_at = now()
       where id = ph.id
      returning * into ph;
    else
      if ph.uploader_id is null or not media.can_contribute(a, ph.uploader_id) then
        raise exception 'The person who shared this photo can no longer access this album, so it can''t be published.' using errcode = '22023';
      end if;
      v_prefix := 'gallery/' || ph.album_id || '/' || ph.id || '/';
      if p_display not like v_prefix || '%' or p_thumb not like v_prefix || '%'
         or media.object_meta('media', p_display) is null or media.object_meta('media', p_thumb) is null then
        raise exception 'The published copies weren''t found.' using errcode = '22023';
      end if;
      v_uploads := array_remove(array[ph.review_display_path, ph.review_thumb_path, ph.original_path], null);
      update media.photos
         set status = 'approved', minors = p_minors, display_path = p_display, thumb_path = p_thumb,
             review_display_path = null, review_thumb_path = null, original_path = null,
             reviewed_by = v_uid, reviewed_at = now(), review_reason = null, approved_at = now(),
             sort_order = coalesce((select max(sort_order) + 1 from media.photos where album_id = ph.album_id and status in ('approved', 'hidden')), 0),
             updated_at = now()
       where id = ph.id
      returning * into ph;
    end if;
  elsif p_action = 'reject' then
    if ph.status not in ('pending', 'failed') then
      raise exception 'Only photos waiting for review can be rejected.' using errcode = '22023';
    end if;
    v_uploads := array_remove(array[ph.review_display_path, ph.review_thumb_path, ph.original_path], null);
    update media.photos
       set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
           updated_at = now()
     where id = ph.id
    returning * into ph;
  elsif p_action = 'hide' then
    if ph.status <> 'approved' then
      raise exception 'Only published photos can be hidden.' using errcode = '22023';
    end if;
    update media.photos set status = 'hidden', reviewed_by = v_uid, reviewed_at = now(),
                            review_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''), updated_at = now()
     where id = ph.id returning * into ph;
    update media.albums set cover_photo_id = null, updated_at = now() where cover_photo_id = ph.id;
  elsif p_action = 'unhide' then
    if ph.status <> 'hidden' then
      raise exception 'This photo isn''t hidden.' using errcode = '22023';
    end if;
    if ph.kind = 'photo' and ph.uploader_id is not null and not media.can_contribute(a, ph.uploader_id) then
      raise exception 'The person who shared this photo can no longer access this album, so it can''t be shown again.' using errcode = '22023';
    end if;
    update media.photos set status = 'approved', reviewed_by = v_uid, reviewed_at = now(), review_reason = null, updated_at = now()
     where id = ph.id returning * into ph;
  elsif p_action = 'remove' then
    if ph.status = 'removed' then
      raise exception 'This photo was already removed.' using errcode = '22023';
    end if;
    v_uploads := array_remove(array[ph.review_display_path, ph.review_thumb_path, ph.original_path], null);
    v_media := array_remove(array[ph.display_path, ph.thumb_path], null);
    update media.photos set status = 'removed', reviewed_by = v_uid, reviewed_at = now(),
                            review_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''), updated_at = now()
     where id = ph.id returning * into ph;
    update media.albums set cover_photo_id = null, updated_at = now() where cover_photo_id = ph.id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform media.mod_log('photo.' || p_action, ph.id, ph.album_id, p_reason);
  perform media.after_review(ph, p_action);
  return jsonb_build_object('status', ph.status, 'uploads', to_jsonb(v_uploads), 'media', to_jsonb(v_media));
end;
$$;

-- Unchanged from 20261025000600 except that videos a moderator added don't
-- send that moderator "your photo was reviewed" notices.
create or replace function media.after_review(ph media.photos, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if ph.uploader_id is null or ph.kind = 'video' or p_action not in ('approve', 'reject', 'hide', 'unhide', 'remove') then
    return;
  end if;
  perform community.notify(ph.uploader_id, 'gallery_outcome', null,
    jsonb_build_object('media_album_id', ph.album_id, 'detail', jsonb_build_object('action', p_action)),
    'gallery_outcome:' || ph.album_id || ':' || p_action);
end;
$$;

-- Unchanged from 20261025000500 except that the cover must be a photo.
create or replace function public.media_admin_album_cover(p_album uuid, p_photo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform media.require_cap('gallery.moderate');
  if p_photo is not null and not exists (select 1 from media.photos where id = p_photo and album_id = p_album and status = 'approved' and kind = 'photo') then
    raise exception 'Choose a published photo from this album.' using errcode = '22023';
  end if;
  update media.albums set cover_photo_id = p_photo, updated_at = now() where id = p_album;
  perform media.mod_log('album.cover', p_photo, p_album);
end;
$$;

-- ---------------------------------------------------------------------------
-- "Gallery" is now "Media gallery" in the app; the role's display name and
-- descriptions follow (its key, grants, and holders are unchanged).
-- ---------------------------------------------------------------------------
update public.roles
   set name = 'Media gallery moderator',
       description = 'Creates Media gallery albums, reviews member photo uploads, and adds videos before they are shown.'
 where key = 'gallery_moderator' and name = 'Gallery moderator';
update public.capabilities
   set description = 'Manage Media gallery albums, review member photo uploads, and add album videos'
 where key = 'gallery.moderate';

-- ---------------------------------------------------------------------------
-- Grants: private helpers stay private; administrator entry points for
-- signed-in users (each rechecks capabilities); search and the thumbnail
-- lookup also for visitors (they apply audience rules themselves, like
-- media_file).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema media from public, anon, authenticated, service_role;

revoke execute on function
  public.media_admin_video_link_add(text, text, text, text, text), public.media_admin_video_check_save(uuid, text, text),
  public.media_admin_video_publish(uuid), public.media_admin_album_video_add(uuid, uuid, text, text, text, text, text, text),
  public.media_video_thumb(uuid), public.media_search(text, integer, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.media_admin_video_link_add(text, text, text, text, text), public.media_admin_video_check_save(uuid, text, text),
  public.media_admin_video_publish(uuid), public.media_admin_album_video_add(uuid, uuid, text, text, text, text, text, text)
to authenticated;

grant execute on function public.media_video_thumb(uuid), public.media_search(text, integer, text) to anon, authenticated;

-- =========================================================================
-- Post-checks (any failure rolls back step 2)
-- =========================================================================
do $check$
declare
  f text;
begin
  foreach f in array array['public.media_admin_video_link_add(text, text, text, text, text)', 'public.media_admin_video_check_save(uuid, text, text)',
                           'public.media_admin_video_publish(uuid)', 'public.media_admin_album_video_add(uuid, uuid, text, text, text, text, text, text)'] loop
    if not has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'Nothing was changed: % has the wrong grants. Send this message to the developer.', f;
    end if;
  end loop;
  foreach f in array array['public.media_video_thumb(uuid)', 'public.media_search(text, integer, text)'] loop
    if not has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'Nothing was changed: % has the wrong grants. Send this message to the developer.', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'media.external_video_upsert(uuid, text, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'media.video_json(media.assets)', 'execute') then
    raise exception 'Nothing was changed: a private helper would be callable through the API. Send this message to the developer.';
  end if;
  if (select count(*) from pg_trigger where tgname in ('item_media_video_item', 'assets_album_videos_follow_replacement')) <> 2 then
    raise exception 'Nothing was changed: the triggers are missing. Send this message to the developer.';
  end if;
  if exists (select 1 from media.photos where kind <> 'photo') or exists (select 1 from media.items where kind = 'video') then
    raise exception 'Nothing was changed: existing rows changed. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261109000200', 'media_videos', 'media-videos');

commit;
