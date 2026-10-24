-- Media gallery · album cover images (additive).
--
-- First merged as 20261118000100, renumbered because that version belongs to
-- devotional_collections (merged in #70) on main and hosted. The body is
-- unchanged. The two touch no common object, so their order doesn't matter.
--
-- An album's cover is album metadata, never a gallery item: it is not a
-- media.photos row, so it never changes photo or video counts, never shows
-- in the album itself, and replacing or removing it never touches a photo,
-- a video, or a library asset. A cover is one of:
--
--   * an uploaded cover image: a file only this album uses, stored under
--     album-covers/<album>/ (originals in the restricted `media-uploads`
--     bucket while they are processed, served copies in the private `media`
--     bucket; never a public bucket);
--   * a published photo chosen from the album (cover_photo_id, as before;
--     gallery moderators only, since only they review the album's photos);
--   * otherwise, as before, the album's first published photo; and for an
--     album with only videos, its first YouTube/Vimeo video's still (served
--     by /api/media/<asset>/thumb, which rechecks access to that video).
--
-- The uploaded cover follows the album's audience exactly: the storage read
-- rule is album_visible (published, approved members or the one group), or
-- the people who may edit the album. Changing the album's audience changes
-- who can load its cover at once. A chosen photo stays the cover only while
-- it is published (hidden, removed, or consent-hidden photos stop being
-- shown at once, as before).
--
-- Upload lifecycle (each step rechecks that the caller may edit the album):
--   media_admin_album_cover_begin       registers the original's quarantine
--                                       path (type and gallery size limit)
--   (browser → storage)                 direct upload to `media-uploads`
--   media_admin_album_cover_processing  verifies the stored object
--   (server)                            decode, orient, sRGB, strip metadata,
--                                       WebP display + thumb into `media`
--   media_admin_album_cover_ready       makes it the cover with its framing;
--                                       returns the previous cover's files
--   media_admin_album_cover_fail        cancel / failure; the saved cover is
--                                       unchanged
-- media_admin_album_cover_choose, _framing, and _remove change the cover
-- without uploading. Framing is the same {"x","y","zoom"} as content covers
-- (20261110000100) and belongs to one cover: a different cover starts
-- centred unless a framing is saved with it.
--
-- Who may change the cover: the people who may save the album (gallery
-- moderators, and event coordinators for albums they created). Choosing a
-- photo from the album, or positioning a chosen photo, needs gallery
-- moderation. An uploaded cover can't show anyone under 18: the editor
-- confirms that, and a photo of children goes through the album's review and
-- photo consent instead (then a moderator can choose it as the cover).
--
-- media_admin_album and media_admin_album_options also return the cover
-- editor's details and limit (same signatures).
--
-- Also: media_can_read_object no longer lets media managers read files under
-- album-covers/ (they follow the album instead), and media cleanup no longer
-- lists a cover in use (or an upload in progress) as an unreferenced file.
-- No existing row is rewritten, no function signature changes, and every
-- album looks the same until someone sets a cover.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table media.albums
  add column cover_path text unique,
  add column cover_thumb_path text unique,
  add column cover_width integer check (cover_width between 1 and 20000),
  add column cover_height integer check (cover_height between 1 and 20000),
  add column cover_alt text not null default '' check (char_length(cover_alt) <= 500),
  add column cover_framing jsonb,
  add column cover_set_by uuid references public.profiles (id) on delete set null,
  add column cover_set_at timestamptz;
alter table media.albums add constraint albums_cover_files check ((cover_path is null) = (cover_thumb_path is null));
alter table media.albums add constraint albums_cover_one check (cover_path is null or cover_photo_id is null);
alter table media.albums add constraint albums_cover_paths check (
  cover_path is null or (cover_path like 'album-covers/' || id::text || '/%' and cover_thumb_path like 'album-covers/' || id::text || '/%'));
-- Same rule as media.items.cover_framing (20261110000100).
alter table media.albums add constraint albums_cover_framing_check check (
  cover_framing is null or case
    when jsonb_typeof(cover_framing) = 'object' and jsonb_typeof(cover_framing -> 'x') = 'number'
         and jsonb_typeof(cover_framing -> 'y') = 'number' and jsonb_typeof(cover_framing -> 'zoom') = 'number'
    then (cover_framing ->> 'x')::numeric between 0 and 100 and (cover_framing ->> 'y')::numeric between 0 and 100
         and (cover_framing ->> 'zoom')::numeric between 1 and 4
    else false end);
create index albums_cover_set_by_idx on media.albums (cover_set_by);

-- Cover uploads in progress (one row per chosen file). Not exposed to the
-- API: only the functions below read or write it.
create table media.album_cover_uploads (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references media.albums (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'done', 'failed')),
  original_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0),
  error text check (char_length(error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index album_cover_uploads_album_idx on media.album_cover_uploads (album_id, status);
create index album_cover_uploads_created_by_idx on media.album_cover_uploads (created_by);
alter table media.album_cover_uploads enable row level security;
revoke all on media.album_cover_uploads from public, anon, authenticated;

-- A framing belongs to one cover: a different cover starts centred, unless
-- the same update saves a framing for it.
create function media.reset_album_cover_framing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.cover_photo_id is distinct from old.cover_photo_id or new.cover_path is distinct from old.cover_path)
     and new.cover_framing is not distinct from old.cover_framing then
    new.cover_framing := null;
  end if;
  return new;
end;
$$;

create trigger albums_reset_cover_framing before update of cover_photo_id, cover_path on media.albums
  for each row execute function media.reset_album_cover_framing();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Whether the caller may change this album (same rule as
-- media_admin_album_save): gallery moderators, and event coordinators for
-- albums they created.
create function media.can_edit_album(a media.albums)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a.id is not null and media.is_member((select auth.uid()))
     and (public.has_capability('gallery.moderate')
          or (public.has_capability('events.manage') and a.created_by = (select auth.uid())));
$$;

create function media.require_album_editor(p_album uuid, p_lock boolean default false)
returns media.albums
language plpgsql
security definer
set search_path = ''
as $$
declare
  a media.albums;
begin
  perform media.require_album_admin();
  if p_lock then
    select * into a from media.albums where id = p_album for update;
  else
    select * into a from media.albums where id = p_album;
  end if;
  if a.id is null or not media.can_edit_album(a) then
    raise exception 'Album not found.' using errcode = 'P0002';
  end if;
  return a;
end;
$$;

-- The album id an album-covers/ object belongs to (null for anything else).
create function media.cover_object_album(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select (substring(p_name from '^album-covers/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'))::uuid;
$$;

-- The cover as members and editors see it. source:
--   upload       an uploaded cover image (with the editor's framing)
--   photo        a published photo chosen from the album (with framing)
--   first_photo  no cover chosen: the first published photo, centred
--   video        no photos: the first video with a provider still
-- photo_id and thumb_path keep their earlier meaning for photo covers.
create function media.album_cover_json(a media.albums)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case when a.cover_path is not null then
      jsonb_build_object('source', 'upload', 'photo_id', null, 'thumb_path', a.cover_thumb_path, 'display_path', a.cover_path,
                         'alt', a.cover_alt, 'width', a.cover_width, 'height', a.cover_height, 'framing', a.cover_framing)
    end,
    (select jsonb_build_object('source', 'photo', 'photo_id', ph.id, 'thumb_path', ph.thumb_path, 'display_path', ph.display_path,
                               'alt', ph.alt_text, 'width', ph.width, 'height', ph.height, 'framing', a.cover_framing)
       from media.photos ph where ph.id = a.cover_photo_id and ph.album_id = a.id and ph.status = 'approved' and ph.kind = 'photo'),
    (select jsonb_build_object('source', 'first_photo', 'photo_id', ph.id, 'thumb_path', ph.thumb_path, 'display_path', ph.display_path,
                               'alt', ph.alt_text, 'width', ph.width, 'height', ph.height, 'framing', null)
       from media.photos ph where ph.album_id = a.id and ph.status = 'approved' and ph.kind = 'photo'
      order by ph.sort_order, ph.approved_at limit 1),
    (select jsonb_build_object('source', 'video', 'photo_id', null, 'thumb_path', null, 'display_path', null,
                               'video_asset_id', v.id, 'alt', '', 'framing', null)
       from media.photos ph join media.assets v on v.id = ph.asset_id
      where ph.album_id = a.id and ph.status = 'approved' and ph.kind = 'video'
        and v.status = 'ready' and v.kind = 'external_video' and (v.provider = 'youtube' or v.provider_thumb_url is not null)
      order by ph.sort_order, ph.approved_at limit 1));
$$;

-- Unchanged from 20261109000200 except 'cover' (media.album_cover_json).
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
    'cover', media.album_cover_json(a),
    'photo_count', (select count(*) from media.photos ph where ph.album_id = a.id and ph.status = 'approved' and ph.kind = 'photo'),
    'video_count', (select count(*) from media.photos ph where ph.album_id = a.id and ph.status = 'approved' and ph.kind = 'video'),
    'can_upload', a.uploads_open and a.status = 'published' and media.can_contribute(a, p_viewer));
$$;

-- Unchanged from 20261025000500 except the cover editing details at the end.
create or replace function public.media_admin_album(p_id uuid, p_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  v_mod boolean := public.has_capability('gallery.moderate');
  a media.albums;
begin
  select * into a from media.albums where id = p_id;
  if a.id is null or not (v_mod or a.created_by = v_uid) then
    raise exception 'Album not found.' using errcode = 'P0002';
  end if;
  return media.album_json(a, v_uid, true) || jsonb_build_object(
    'can_moderate', v_mod, 'event_series_id', a.event_series_id, 'group_id', a.group_id, 'sort_order', a.sort_order,
    'cover_photo_id', a.cover_photo_id, 'raw_uploads_open', a.uploads_open,
    'counts', (select jsonb_object_agg(s, n) from (select ph.status::text s, count(*) n from media.photos ph where ph.album_id = a.id group by ph.status) x),
    -- Only moderators see member submissions.
    'photos', case when v_mod then coalesce((
                select jsonb_agg(media.photo_json(ph, v_uid, true) order by ph.sort_order, ph.created_at)
                  from media.photos ph
                 where ph.album_id = a.id
                   and (case when p_status is null then ph.status in ('pending', 'approved', 'hidden') else ph.status::text = p_status end)), '[]'::jsonb)
              else '[]'::jsonb end,
    'cover_editor', jsonb_build_object(
      'can_edit', media.can_edit_album(a),
      'file_mb', (select st.gallery_file_mb from media.settings st),
      'set_at', a.cover_set_at,
      'set_by', case when a.cover_set_by is not null then community.display_name(a.cover_set_by) end));
end;
$$;

-- Unchanged from 20261025000500 except cover_file_mb (the new-album form's
-- cover limit; the same gallery limit photos use).
create or replace function public.media_admin_album_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform media.require_album_admin();
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'start_date', s.start_date) order by s.start_date desc)
                          from (select * from events.series s
                                 where s.status in ('published', 'canceled')
                                   and s.start_date between current_date - 400 and current_date + 120
                                 order by s.start_date desc limit 200) s), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                          from community.groups g where g.status = 'active'), '[]'::jsonb),
    'cover_file_mb', (select st.gallery_file_mb from media.settings st));
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage access for album-covers/ (both media buckets)
-- ---------------------------------------------------------------------------
-- Read: the current cover files with the album (album_visible: published,
-- its members or its group), and everything under the album's folder for the
-- people who may edit it (previews, processing, and deleting a replaced
-- cover; Storage deletes only rows the caller can also select). Files of a
-- deleted album: gallery moderators. Files no album or upload refers to:
-- media managers (Media → Cleanup).
create function public.media_album_cover_can_read_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_album uuid := media.cover_object_album(p_name);
  a media.albums;
begin
  if v_uid is null or v_album is null or not media.is_member(v_uid) or p_bucket not in ('media', 'media-uploads') then
    return false;
  end if;
  select * into a from media.albums where id = v_album;
  if a.id is null then
    return public.has_capability('gallery.moderate') or public.has_capability('media.manage');
  end if;
  if media.can_edit_album(a) then
    return true;
  end if;
  if p_bucket = 'media' and p_name in (a.cover_path, a.cover_thumb_path) then
    return media.album_visible(a, v_uid);
  end if;
  return public.has_capability('media.manage')
     and p_name is distinct from a.cover_path and p_name is distinct from a.cover_thumb_path
     and not exists (select 1 from media.album_cover_uploads u where u.original_path = p_name and u.status in ('uploading', 'processing'));
end;
$$;

-- Insert: the original at its registered path while uploading, then the
-- processed WebP copies in that upload's folder while processing, by the
-- person who registered it and only while they may edit the album.
create function public.media_album_cover_can_write_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not media.is_member(v_uid) or media.cover_object_album(p_name) is null then
    return false;
  end if;
  return exists (
    select 1 from media.album_cover_uploads u join media.albums a on a.id = u.album_id
     where u.created_by = v_uid and media.can_edit_album(a)
       and ((p_bucket = 'media-uploads' and u.status = 'uploading' and p_name = u.original_path)
            or (p_bucket = 'media' and u.status = 'processing'
                and p_name like 'album-covers/' || a.id::text || '/' || u.id::text || '/%' and p_name like '%.webp')));
end;
$$;

-- Delete: the album's editors (never its current cover files: replacing or
-- removing the cover first is what frees them), gallery moderators for a
-- deleted album's files. Media managers keep their existing delete rule.
create function public.media_album_cover_can_delete_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_album uuid := media.cover_object_album(p_name);
  a media.albums;
begin
  if v_uid is null or v_album is null or not media.is_member(v_uid) or p_bucket not in ('media', 'media-uploads') then
    return false;
  end if;
  select * into a from media.albums where id = v_album;
  if a.id is null then
    return public.has_capability('gallery.moderate');
  end if;
  return media.can_edit_album(a) and p_name is distinct from a.cover_path and p_name is distinct from a.cover_thumb_path;
end;
$$;

create policy "Album covers follow their album"
  on storage.objects for select to authenticated
  using (bucket_id in ('media', 'media-uploads') and name like 'album-covers/%'
         and (select public.media_album_cover_can_read_object(storage.objects.bucket_id, storage.objects.name)));

create policy "Album covers upload only to registered paths"
  on storage.objects for insert to authenticated
  with check (bucket_id in ('media', 'media-uploads') and name like 'album-covers/%'
              and (select public.media_album_cover_can_write_object(storage.objects.bucket_id, storage.objects.name)));

create policy "Album covers removed by their album's editors"
  on storage.objects for delete to authenticated
  using (bucket_id in ('media', 'media-uploads') and name like 'album-covers/%'
         and (select public.media_album_cover_can_delete_object(storage.objects.bucket_id, storage.objects.name)));

-- Media managers read library files, but album covers follow their album
-- only (unchanged otherwise from 20261031000200).
create or replace function public.media_can_read_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_bucket = 'media' then
    -- Managers read library files (for the library and previews), but not
    -- gallery copies unless they moderate the gallery, and never community
    -- attachments or album covers (those have their own policies).
    if p_name like 'community/%' or p_name like 'album-covers/%' then
      return false;
    end if;
    if p_name not like 'gallery/%' and v_uid is not null and media.is_manager() then
      return true;
    end if;
    if p_name like 'gallery/%' then
      return (v_uid is not null and public.has_capability('gallery.moderate'))
          or exists (select 1 from media.photos ph
                      where (ph.display_path = p_name or ph.thumb_path = p_name)
                        and (media.photo_visible(ph, v_uid)
                             or (ph.uploader_id = v_uid and media.is_member(v_uid) and ph.status in ('approved', 'hidden'))));
    end if;
    return exists (select 1 from media.assets a
                    where (a.path = p_name or a.variant_path = p_name) and media.asset_visible(a.id, v_uid));
  elsif p_bucket = 'media-uploads' then
    if v_uid is null then
      return false;
    end if;
    return exists (select 1 from media.photos ph
                    where p_name in (ph.original_path, ph.review_display_path, ph.review_thumb_path)
                      and ((ph.uploader_id = v_uid and media.is_member(v_uid))
                           or (p_name <> coalesce(ph.original_path, '') and public.has_capability('gallery.moderate'))));
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Upload lifecycle
-- ---------------------------------------------------------------------------
create function public.media_admin_album_cover_begin(p_album uuid, p_mime text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  a media.albums := media.require_album_editor(p_album);
  v_id uuid := gen_random_uuid();
  v_mb integer := (select st.gallery_file_mb from media.settings st);
  u media.album_cover_uploads;
begin
  if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then
    raise exception 'Choose a JPEG, PNG, WebP, or HEIC image.' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > v_mb::bigint * 1024 * 1024 then
    raise exception 'The cover image must be % MB or smaller.', v_mb using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'media.album_cover', 40, interval '1 hour');
  insert into media.album_cover_uploads (id, album_id, created_by, original_path, size_bytes)
  values (v_id, a.id, v_uid, 'album-covers/' || a.id || '/' || v_id || '/original.' || media.mime_ext(p_mime), p_size)
  returning * into u;
  return jsonb_build_object('id', u.id, 'album_id', a.id, 'path', u.original_path);
end;
$$;

create function public.media_admin_album_cover_processing(p_upload uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  u media.album_cover_uploads;
  a media.albums;
  v_meta jsonb;
begin
  select * into u from media.album_cover_uploads where id = p_upload and created_by = v_uid for update;
  if u.id is null then
    raise exception 'That upload wasn''t found.' using errcode = 'P0002';
  end if;
  a := media.require_album_editor(u.album_id);
  if u.status not in ('uploading', 'processing') then
    raise exception 'That upload has already finished. Choose the image again.' using errcode = '22023';
  end if;
  v_meta := media.object_meta('media-uploads', u.original_path);
  if v_meta is null then
    raise exception 'The image hasn''t finished uploading. Try again.' using errcode = '22023';
  end if;
  if (v_meta ->> 'size') is not null and (v_meta ->> 'size')::bigint > (select st.gallery_file_mb from media.settings st)::bigint * 1024 * 1024 then
    raise exception 'That image is larger than the limit.' using errcode = '22023';
  end if;
  update media.album_cover_uploads set status = 'processing', error = null, updated_at = now() where id = u.id;
  return jsonb_build_object('id', u.id, 'album_id', a.id, 'original_path', u.original_path);
end;
$$;

-- Makes the processed upload the album's cover. Returns the previous
-- uploaded cover's files (never a photo's) for the app to delete.
create function public.media_admin_album_cover_ready(p_upload uuid, p_display text, p_thumb text, p_width integer, p_height integer,
                                                     p_alt text, p_framing jsonb, p_no_minors boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  v_framing jsonb := media.clean_framing(p_framing);
  u media.album_cover_uploads;
  a media.albums;
  v_prefix text;
  v_old text[];
begin
  select * into u from media.album_cover_uploads where id = p_upload and created_by = v_uid for update;
  if u.id is null or u.status <> 'processing' then
    raise exception 'That upload wasn''t found.' using errcode = 'P0002';
  end if;
  a := media.require_album_editor(u.album_id, true);
  if not coalesce(p_no_minors, false) then
    raise exception 'Confirm that no one under 18 can be identified in the cover image. To use a photo of children or youth, add it to the album for review and photo consent, then choose it as the cover.' using errcode = '22023';
  end if;
  v_prefix := 'album-covers/' || a.id || '/' || u.id || '/';
  if p_display is null or p_thumb is null or p_display = p_thumb
     or p_display not like v_prefix || '%' or p_thumb not like v_prefix || '%'
     or media.object_meta('media', p_display) is null or media.object_meta('media', p_thumb) is null then
    raise exception 'The processed cover image wasn''t found.' using errcode = '22023';
  end if;
  v_old := array_remove(array[a.cover_path, a.cover_thumb_path], null);
  update media.albums
     set cover_path = p_display, cover_thumb_path = p_thumb, cover_width = p_width, cover_height = p_height,
         cover_alt = left(btrim(coalesce(p_alt, '')), 500), cover_framing = v_framing, cover_photo_id = null,
         cover_set_by = v_uid, cover_set_at = now(), updated_at = now()
   where id = a.id;
  update media.album_cover_uploads set status = 'done', updated_at = now() where id = u.id;
  perform media.mod_log('album.cover_uploaded', null, a.id);
  perform media.audit('media.album_cover_set', 'media_album', a.id, jsonb_build_object('source', 'upload', 'no_minors_confirmed', true));
  return jsonb_build_object('remove', to_jsonb(v_old), 'uploads', to_jsonb(array[u.original_path]));
end;
$$;

-- Cancelled or failed: the saved cover is unchanged. Returns the original's
-- path for the app to delete.
create function public.media_admin_album_cover_fail(p_upload uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  u media.album_cover_uploads;
begin
  update media.album_cover_uploads
     set status = 'failed', error = left(coalesce(nullif(btrim(p_error), ''), 'Cancelled'), 300), updated_at = now()
   where id = p_upload and created_by = v_uid and status in ('uploading', 'processing')
  returning * into u;
  return jsonb_build_object('uploads', case when u.id is null then '[]'::jsonb else to_jsonb(array[u.original_path]) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Changing the cover without uploading
-- ---------------------------------------------------------------------------
-- A published photo from this album (moderated, reviewed for people under
-- 18, and passed photo consent before it could be published). Returns the
-- previous uploaded cover's files for the app to delete.
create function public.media_admin_album_cover_choose(p_album uuid, p_photo uuid, p_framing jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('gallery.moderate');
  v_framing jsonb := media.clean_framing(p_framing);
  a media.albums := media.require_album_editor(p_album, true);
  v_old text[];
begin
  if p_photo is null or not exists (select 1 from media.photos where id = p_photo and album_id = a.id and status = 'approved' and kind = 'photo') then
    raise exception 'Choose a published photo from this album.' using errcode = '22023';
  end if;
  v_old := array_remove(array[a.cover_path, a.cover_thumb_path], null);
  update media.albums
     set cover_photo_id = p_photo, cover_path = null, cover_thumb_path = null, cover_width = null, cover_height = null, cover_alt = '',
         cover_framing = v_framing, cover_set_by = v_uid, cover_set_at = now(), updated_at = now()
   where id = a.id;
  perform media.mod_log('album.cover', p_photo, a.id);
  perform media.audit('media.album_cover_set', 'media_album', a.id, jsonb_build_object('source', 'photo', 'photo_id', p_photo));
  return jsonb_build_object('remove', to_jsonb(v_old));
end;
$$;

-- Repositions the current cover. p_cover names the cover the editor framed
-- (an uploaded cover's path, or a chosen photo's id); if the cover changed
-- meanwhile, nothing is stored and false is returned. Alt text applies to
-- uploaded covers (a chosen photo keeps its own description).
create function public.media_admin_album_cover_framing(p_album uuid, p_cover text, p_framing jsonb, p_alt text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  v_framing jsonb := media.clean_framing(p_framing);
  a media.albums := media.require_album_editor(p_album, true);
begin
  if a.cover_path is not null then
    if p_cover is distinct from a.cover_path then
      return false;
    end if;
    update media.albums
       set cover_framing = v_framing, cover_alt = case when p_alt is null then cover_alt else left(btrim(p_alt), 500) end,
           cover_set_by = v_uid, cover_set_at = now(), updated_at = now()
     where id = a.id;
  elsif a.cover_photo_id is not null then
    if not public.has_capability('gallery.moderate') then
      raise exception 'Only gallery moderators can change a cover chosen from the album''s photos.' using errcode = '42501';
    end if;
    if p_cover is distinct from a.cover_photo_id::text then
      return false;
    end if;
    update media.albums set cover_framing = v_framing, cover_set_by = v_uid, cover_set_at = now(), updated_at = now() where id = a.id;
  else
    return false;
  end if;
  perform media.audit('media.album_cover_framed', 'media_album', a.id, '{}'::jsonb);
  return true;
end;
$$;

-- Back to the automatic cover (first published photo, a video still, or
-- the placeholder). A chosen photo stays in the album; only an uploaded
-- cover's own files are returned for deletion.
create function public.media_admin_album_cover_remove(p_album uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  a media.albums := media.require_album_editor(p_album, true);
  v_old text[] := array_remove(array[a.cover_path, a.cover_thumb_path], null);
begin
  update media.albums
     set cover_photo_id = null, cover_path = null, cover_thumb_path = null, cover_width = null, cover_height = null, cover_alt = '',
         cover_framing = null, cover_set_by = v_uid, cover_set_at = now(), updated_at = now()
   where id = a.id;
  perform media.mod_log('album.cover_removed', null, a.id);
  perform media.audit('media.album_cover_removed', 'media_album', a.id, '{}'::jsonb);
  return jsonb_build_object('remove', to_jsonb(v_old));
end;
$$;

-- ---------------------------------------------------------------------------
-- Cleanup: covers in use and uploads in progress are never "unreferenced"
-- ---------------------------------------------------------------------------
-- Unchanged from 20261025000200 except the two album clauses on orphans.
create or replace function public.media_admin_cleanup_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st media.settings;
begin
  perform media.require_cap('media.manage');
  select * into st from media.settings;
  return jsonb_build_object(
    'abandoned', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'status', a.status, 'created_at', a.created_at,
                                                               'paths', to_jsonb(array_remove(array[a.upload_path, a.path, a.variant_path], null))))
                             from (select * from media.assets a
                                    where a.status in ('uploading', 'processing', 'failed')
                                      and a.updated_at < now() - make_interval(hours => st.abandoned_upload_hours)
                                    order by a.created_at limit 200) a), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'removed_at', a.removed_at,
                                                             'paths', to_jsonb(array_remove(array[a.upload_path, a.path, a.variant_path], null))))
                           from (select * from media.assets a
                                  where a.status = 'removed' and a.objects_deleted_at is null
                                  order by a.removed_at limit 200) a), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'status', ph.status, 'updated_at', ph.updated_at,
                                                            'uploads', to_jsonb(array_remove(array[ph.original_path, ph.review_display_path, ph.review_thumb_path], null)),
                                                            'media', to_jsonb(array_remove(array[ph.display_path, ph.thumb_path], null))))
                          from (select * from media.photos ph
                                 where ph.objects_deleted_at is null
                                   and (ph.status in ('rejected', 'removed')
                                        or (ph.status in ('uploading', 'processing', 'failed')
                                            and ph.updated_at < now() - make_interval(hours => st.abandoned_upload_hours)))
                                 order by ph.updated_at limit 200) ph), '[]'::jsonb),
    -- Stored objects no record refers to (for example an upload whose
    -- record was never created), older than a day.
    'orphans', coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name, 'created_at', o.created_at))
                           from (select o.* from storage.objects o
                                  where o.bucket_id in ('media', 'media-uploads') and o.created_at < now() - interval '1 day'
                                    and not exists (select 1 from media.assets a where o.name in (a.path, a.variant_path, a.upload_path))
                                    and not exists (select 1 from media.photos ph
                                                     where o.name in (ph.original_path, ph.review_display_path, ph.review_thumb_path,
                                                                      ph.display_path, ph.thumb_path))
                                    and not exists (select 1 from media.albums al where o.name in (al.cover_path, al.cover_thumb_path))
                                    and not exists (select 1 from media.album_cover_uploads u
                                                     where u.original_path = o.name and u.status in ('uploading', 'processing'))
                                  order by o.created_at limit 200) o), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  media.reset_album_cover_framing(), media.can_edit_album(media.albums), media.require_album_editor(uuid, boolean),
  media.cover_object_album(text), media.album_cover_json(media.albums)
from public, anon, authenticated;

revoke execute on function
  public.media_album_cover_can_read_object(text, text), public.media_album_cover_can_write_object(text, text),
  public.media_album_cover_can_delete_object(text, text),
  public.media_admin_album_cover_begin(uuid, text, bigint), public.media_admin_album_cover_processing(uuid),
  public.media_admin_album_cover_ready(uuid, text, text, integer, integer, text, jsonb, boolean),
  public.media_admin_album_cover_fail(uuid, text), public.media_admin_album_cover_choose(uuid, uuid, jsonb),
  public.media_admin_album_cover_framing(uuid, text, jsonb, text), public.media_admin_album_cover_remove(uuid)
from public, anon, service_role;

grant execute on function
  public.media_album_cover_can_read_object(text, text), public.media_album_cover_can_write_object(text, text),
  public.media_album_cover_can_delete_object(text, text),
  public.media_admin_album_cover_begin(uuid, text, bigint), public.media_admin_album_cover_processing(uuid),
  public.media_admin_album_cover_ready(uuid, text, text, integer, integer, text, jsonb, boolean),
  public.media_admin_album_cover_fail(uuid, text), public.media_admin_album_cover_choose(uuid, uuid, jsonb),
  public.media_admin_album_cover_framing(uuid, text, jsonb, text), public.media_admin_album_cover_remove(uuid)
to authenticated;
