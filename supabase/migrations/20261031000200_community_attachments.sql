-- Phase 13 · Photo and video attachments on community discussions and replies.
--
-- Additive: one new table (no API grants, RLS on), new functions, and three
-- storage policies scoped to the `community/` folder of the existing
-- `media` and `media-uploads` buckets. Existing forum functions keep their
-- signatures; posting with media goes through new *_with_media functions
-- that call them in the same transaction. One existing function changes
-- body only: public.media_can_read_object no longer lets media managers
-- read files under `community/` (they follow discussion access instead).
--
-- Lifecycle (every step rechecks the caller):
--   community_attachment_begin       registers a draft (owner + batch key)
--                                    and its upload path
--   (browser → storage)              images to `media-uploads` (quarantine),
--                                    MP4 video to `media`
--   community_attachment_processing  verifies the stored object
--   (server)                         images: decode, orient, strip metadata,
--                                    WebP display + thumb into `media`;
--                                    video: MP4/H.264 signature check
--   community_attachment_ready       records the served files → ready; the
--                                    image original is deleted by the app
--   community_*_with_media           attaches the owner's ready drafts to
--                                    the new discussion or reply
--   community_attachment_discard     removes a draft (cancel / remove)
--   community_*_delete_with_media    author deletion; returns stored paths
--   community_attachments_objects_deleted  records that the files are gone
--
-- Reading: attachments are returned and served only while the viewer can
-- read the thread and the item is visible (hidden items: moderators of that
-- thread only; deleted items: nobody). The same rule backs the storage read
-- policy, so a signed URL can only be created through the viewer's own
-- session for files they may see. Nothing is ever public.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table community.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete set null,
  -- One composer draft; limits per post are counted per batch.
  batch_key uuid not null,
  -- Idempotency key per file: a retried begin returns the same row.
  client_key uuid not null,
  kind text not null check (kind in ('image', 'video')),
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'ready', 'failed', 'attached', 'removed')),
  target_type text check (target_type in ('thread', 'post')),
  thread_id uuid references community.threads (id) on delete set null,
  post_id uuid references community.posts (id) on delete set null,
  -- Where the browser uploads: image originals in quarantine, video in media.
  upload_bucket text not null check (upload_bucket in ('media', 'media-uploads')),
  upload_path text,
  display_path text,
  thumb_path text,
  video_path text,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer check (width is null or width between 1 and 20000),
  height integer check (height is null or height between 1 and 20000),
  duration_seconds numeric(8, 2) check (duration_seconds is null or duration_seconds >= 0),
  alt_text text not null default '' check (char_length(alt_text) <= 300),
  sort_order smallint not null default 0 check (sort_order between 0 and 50),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attached_at timestamptz,
  removed_at timestamptz,
  objects_deleted_at timestamptz,
  constraint attachments_target check (
    status <> 'attached'
    or (thread_id is not null and target_type is not null and (target_type = 'post') = (post_id is not null) and attached_at is not null)),
  constraint attachments_files check (
    status not in ('ready', 'attached')
    or (kind = 'image' and display_path is not null and thumb_path is not null)
    or (kind = 'video' and video_path is not null)),
  constraint attachments_removed check ((status = 'removed') = (removed_at is not null))
);
create unique index attachments_client_key_idx on community.attachments (owner_id, client_key);
create index attachments_batch_idx on community.attachments (owner_id, batch_key);
create index attachments_thread_idx on community.attachments (thread_id, sort_order) where thread_id is not null;
create index attachments_post_idx on community.attachments (post_id) where post_id is not null;
create index attachments_status_idx on community.attachments (status, updated_at);
create index attachments_paths_idx on community.attachments (display_path, thumb_path, video_path, upload_path);

alter table community.attachments enable row level security;
revoke all on table community.attachments from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The limits, in one place (mirrored in src/lib/community/attachments.ts).
create function community.attachment_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('per_post', 6, 'videos_per_post', 2, 'image_mb', 20, 'video_mb', 50, 'open_drafts', 18, 'alt_max', 300);
$$;

-- Whether the caller (auth.uid()) may see this attachment now.
--   drafts: their owner only;
--   attached: the thread is readable by the caller, and the thread and the
--   reply are visible (hidden: moderators of that thread; deleted: nobody).
create function community.attachment_visible(a community.attachments)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_thread_status community.content_status;
  v_post_status community.content_status;
begin
  if v_uid is null or not community.is_member(v_uid) then
    return false;
  end if;
  if a.status in ('uploading', 'processing', 'ready', 'failed') then
    return a.owner_id = v_uid and a.thread_id is null;
  end if;
  if a.status <> 'attached' or a.thread_id is null or not community.can_read_thread(a.thread_id, v_uid) then
    return false;
  end if;
  select t.status into v_thread_status from community.threads t where t.id = a.thread_id;
  if v_thread_status is null or (a.target_type = 'thread' and v_thread_status = 'deleted') then
    return false;
  end if;
  if v_thread_status = 'hidden' and not community.can_moderate_thread(a.thread_id) then
    return false;
  end if;
  if a.target_type = 'post' then
    select p.status into v_post_status from community.posts p where p.id = a.post_id;
    if v_post_status is null or v_post_status = 'deleted' then
      return false;
    end if;
    if v_post_status = 'hidden' and not community.can_moderate_thread(a.thread_id) then
      return false;
    end if;
  end if;
  return true;
end;
$$;

-- What members see: never storage paths (files are served by id through
-- /api/community/attachments/<id>, which rechecks access).
create function community.attachment_json(a community.attachments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'alt_text', a.alt_text,
                            'width', a.width, 'height', a.height, 'duration', a.duration_seconds,
                            'mime', case when a.kind = 'image' then 'image/webp' else a.mime end,
                            'sort_order', a.sort_order, 'post_id', a.post_id);
$$;

create function community.attachment_paths(a community.attachments)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'uploads', to_jsonb(array_remove(array[case when a.upload_bucket = 'media-uploads' then a.upload_path end], null)),
    'media', to_jsonb(array_remove(array[case when a.upload_bucket = 'media' then a.upload_path end, a.display_path, a.thumb_path, a.video_path], null)));
$$;

-- Attaches the caller's ready drafts to a discussion or reply they just
-- wrote. Retried posts (same idempotency key) find them already attached.
create function community.attach_media(p_type text, p_thread uuid, p_post uuid, p_ids uuid[], p_alts text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lim jsonb := community.attachment_limits();
  a community.attachments;
  i integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > (v_lim ->> 'per_post')::integer then
    raise exception 'You can add up to % photos or videos to one post.', v_lim ->> 'per_post' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) or array_position(p_ids, null) is not null then
    raise exception 'That photo or video wasn''t found.' using errcode = 'P0002';
  end if;
  for i in 1 .. cardinality(p_ids) loop
    select * into a from community.attachments where id = p_ids[i] for update;
    if a.id is null or a.owner_id is distinct from v_uid then
      raise exception 'That photo or video wasn''t found.' using errcode = 'P0002';
    end if;
    if a.status = 'attached' and a.target_type = p_type and a.thread_id = p_thread and a.post_id is not distinct from p_post then
      continue;
    end if;
    if a.status in ('uploading', 'processing') then
      raise exception 'A photo or video is still uploading. Wait for it to finish, or remove it.' using errcode = '22023';
    end if;
    if a.status <> 'ready' or a.thread_id is not null then
      raise exception 'A photo or video couldn''t be added. Remove it and try again.' using errcode = '22023';
    end if;
    update community.attachments
       set status = 'attached', target_type = p_type, thread_id = p_thread, post_id = p_post,
           alt_text = case when a.kind = 'image'
                           then community.clean_text(coalesce(p_alts[i], ''), 0, (v_lim ->> 'alt_max')::integer, 'A photo description')
                           else '' end,
           sort_order = i - 1, attached_at = now(), updated_at = now()
     where id = a.id;
  end loop;
  if (select count(*) from community.attachments x
       where x.status = 'attached' and x.thread_id = p_thread and x.target_type = p_type and x.post_id is not distinct from p_post)
     > (v_lim ->> 'per_post')::integer then
    raise exception 'You can add up to % photos or videos to one post.', v_lim ->> 'per_post' using errcode = '22023';
  end if;
  if (select count(*) from community.attachments x
       where x.status = 'attached' and x.kind = 'video' and x.thread_id = p_thread and x.target_type = p_type
         and x.post_id is not distinct from p_post)
     > (v_lim ->> 'videos_per_post')::integer then
    raise exception 'You can add up to % videos to one post.', v_lim ->> 'videos_per_post' using errcode = '22023';
  end if;
end;
$$;

-- Deleted or removed content takes its attachments with it at once, in the
-- same statement (author deletion, a hard-deleted thread, a deleted group).
-- Stored files are deleted by the app with the returned paths, or later
-- from Moderation → Attachment cleanup.
create function community.attachments_on_content_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'threads' then
    update community.attachments
       set status = 'removed', removed_at = now(), updated_at = now()
     where thread_id = old.id and status <> 'removed'
       and (tg_op = 'DELETE' or target_type = 'thread');
  else
    update community.attachments
       set status = 'removed', removed_at = now(), updated_at = now()
     where post_id = old.id and status <> 'removed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger threads_attachments_on_delete before delete on community.threads
  for each row execute function community.attachments_on_content_delete();
create trigger threads_attachments_on_erase after update of status on community.threads
  for each row when (new.status = 'deleted' and old.status <> 'deleted')
  execute function community.attachments_on_content_delete();
create trigger posts_attachments_on_delete before delete on community.posts
  for each row execute function community.attachments_on_content_delete();
create trigger posts_attachments_on_erase after update of status on community.posts
  for each row when (new.status = 'deleted' and old.status <> 'deleted')
  execute function community.attachments_on_content_delete();

-- ---------------------------------------------------------------------------
-- Storage access (community/ folder of the media buckets)
-- ---------------------------------------------------------------------------
create function public.community_attachment_can_read_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cleanup boolean;
begin
  if v_uid is null or p_name is null or p_name not like 'community/%' or not community.is_member(v_uid) then
    return false;
  end if;
  v_cleanup := (select public.has_capability('community.moderate')) or (select public.has_capability('media.manage'));
  return exists (
    select 1 from community.attachments a
     where (p_bucket = 'media' and p_name in (a.display_path, a.thumb_path, a.video_path) and community.attachment_visible(a))
        -- The upload itself, for the server processing it as its owner.
        or (p_bucket = a.upload_bucket and p_name = a.upload_path and a.owner_id = v_uid
            and a.status in ('uploading', 'processing', 'failed'))
        -- Removed files waiting to be deleted (Storage deletes only rows the
        -- caller can also select): their owner, and the people cleaning up.
        or (a.status = 'removed' and p_name in (a.upload_path, a.display_path, a.thumb_path, a.video_path)
            and (a.owner_id = v_uid or v_cleanup)))
      -- Files no attachment refers to (Moderation → Attachment cleanup).
      or (v_cleanup and not exists (select 1 from community.attachments a
                                     where p_name in (a.upload_path, a.display_path, a.thumb_path, a.video_path)));
end;
$$;

create function public.community_attachment_can_write_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not community.is_member(v_uid) or p_name is null or p_name not like 'community/' || v_uid::text || '/%' then
    return false;
  end if;
  return exists (
    select 1 from community.attachments a
     where a.owner_id = v_uid
       and ((a.status = 'uploading' and p_bucket = a.upload_bucket and p_name = a.upload_path)
            or (a.status = 'processing' and a.kind = 'image' and p_bucket = 'media'
                and p_name like 'community/' || v_uid::text || '/' || a.id::text || '/v-%')));
end;
$$;

create function public.community_attachment_can_delete_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not community.is_member(v_uid) or p_name is null or p_name not like 'community/%' then
    return false;
  end if;
  return p_name like 'community/' || v_uid::text || '/%'
      or (select public.has_capability('community.moderate')) or (select public.has_capability('media.manage'));
end;
$$;

create policy "Community attachments follow discussion access"
  on storage.objects for select to authenticated
  using (bucket_id in ('media', 'media-uploads') and name like 'community/%'
         and (select public.community_attachment_can_read_object(storage.objects.bucket_id, storage.objects.name)));

create policy "Community attachments upload only to registered paths"
  on storage.objects for insert to authenticated
  with check (bucket_id in ('media', 'media-uploads') and name like 'community/%'
              and (select public.community_attachment_can_write_object(storage.objects.bucket_id, storage.objects.name)));

create policy "Community attachments removed by their owners and moderators"
  on storage.objects for delete to authenticated
  using (bucket_id in ('media', 'media-uploads') and name like 'community/%'
         and (select public.community_attachment_can_delete_object(storage.objects.bucket_id, storage.objects.name)));

-- Media managers read library files, but community attachments follow
-- discussion access only (unchanged otherwise from 20261025000200).
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
    -- attachments (those have their own policy).
    if p_name like 'community/%' then
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
-- Upload lifecycle (the owner, through their own session)
-- ---------------------------------------------------------------------------
create function public.community_attachment_begin(p_batch_key uuid, p_client_key uuid, p_kind text, p_mime text, p_size bigint,
                                                  p_width integer default null, p_height integer default null,
                                                  p_duration numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_poster();
  v_lim jsonb := community.attachment_limits();
  a community.attachments;
  v_id uuid := gen_random_uuid();
  v_max bigint;
  v_order integer;
begin
  if p_batch_key is null or p_client_key is null then
    raise exception 'Missing upload key.' using errcode = '22023';
  end if;
  select * into a from community.attachments where owner_id = v_uid and client_key = p_client_key;
  if a.id is not null then
    -- A retried request: the same attachment, never a duplicate.
    return jsonb_build_object('id', a.id, 'bucket', a.upload_bucket, 'path', a.upload_path, 'status', a.status);
  end if;
  if p_kind = 'image' then
    if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then
      raise exception 'Choose a JPEG, PNG, WebP, or iPhone (HEIC) photo.' using errcode = '22023';
    end if;
    v_max := (v_lim ->> 'image_mb')::bigint * 1024 * 1024;
  elsif p_kind = 'video' then
    if p_mime is distinct from 'video/mp4' then
      raise exception 'This video format can''t be played on every device; export as MP4 (H.264) and try again.' using errcode = '22023';
    end if;
    v_max := (v_lim ->> 'video_mb')::bigint * 1024 * 1024;
  else
    raise exception 'Choose a photo or a video.' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > v_max then
    raise exception '% must be % MB or smaller.', case when p_kind = 'image' then 'Each photo' else 'Each video' end,
      v_max / 1024 / 1024 using errcode = '22023';
  end if;
  select count(*) into v_order from community.attachments
   where owner_id = v_uid and batch_key = p_batch_key and status not in ('removed', 'failed');
  if v_order >= (v_lim ->> 'per_post')::integer then
    raise exception 'You can add up to % photos or videos to one post.', v_lim ->> 'per_post' using errcode = '22023';
  end if;
  if p_kind = 'video' and (select count(*) from community.attachments
                            where owner_id = v_uid and batch_key = p_batch_key and kind = 'video'
                              and status not in ('removed', 'failed')) >= (v_lim ->> 'videos_per_post')::integer then
    raise exception 'You can add up to % videos to one post.', v_lim ->> 'videos_per_post' using errcode = '22023';
  end if;
  if (select count(*) from community.attachments
       where owner_id = v_uid and status in ('uploading', 'processing', 'ready')) >= (v_lim ->> 'open_drafts')::integer then
    raise exception 'You have several photos or videos that were never posted. Post or remove them first.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'attachment', 40, interval '1 hour');
  insert into community.attachments (id, owner_id, batch_key, client_key, kind, status, upload_bucket, upload_path, mime, size_bytes,
                                     width, height, duration_seconds, sort_order)
  values (v_id, v_uid, p_batch_key, p_client_key, p_kind, 'uploading',
          case when p_kind = 'image' then 'media-uploads' else 'media' end,
          'community/' || v_uid || '/' || v_id || case when p_kind = 'image' then '/original.' || media.mime_ext(p_mime) else '/video.mp4' end,
          p_mime, p_size,
          case when p_width between 1 and 20000 then p_width end,
          case when p_height between 1 and 20000 then p_height end,
          case when p_duration >= 0 and p_duration < 1000000 then round(p_duration, 2) end,
          v_order)
  returning * into a;
  return jsonb_build_object('id', a.id, 'bucket', a.upload_bucket, 'path', a.upload_path, 'status', a.status);
end;
$$;

create function public.community_attachment_processing(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_poster();
  v_lim jsonb := community.attachment_limits();
  a community.attachments;
  v_meta jsonb;
begin
  select * into a from community.attachments where id = p_id and owner_id = v_uid for update;
  if a.id is null then
    raise exception 'That upload wasn''t found.' using errcode = 'P0002';
  end if;
  if a.status not in ('uploading', 'processing', 'failed') or a.upload_path is null then
    raise exception 'This file has already been processed.' using errcode = '22023';
  end if;
  v_meta := media.object_meta(a.upload_bucket, a.upload_path);
  if v_meta is null then
    raise exception 'The file hasn''t finished uploading. Try again.' using errcode = '22023';
  end if;
  if (v_meta ->> 'size') is not null
     and (v_meta ->> 'size')::bigint > (v_lim ->> case when a.kind = 'image' then 'image_mb' else 'video_mb' end)::bigint * 1024 * 1024 then
    raise exception 'That file is larger than the limit.' using errcode = '22023';
  end if;
  update community.attachments
     set status = 'processing', error = null, size_bytes = coalesce((v_meta ->> 'size')::bigint, size_bytes), updated_at = now()
   where id = a.id;
  return jsonb_build_object('id', a.id, 'kind', a.kind, 'bucket', a.upload_bucket, 'path', a.upload_path, 'mime', a.mime);
end;
$$;

-- Images: p_display / p_thumb are the processed WebP copies in `media`.
-- Video: the uploaded file becomes the served file (no variants).
-- Returns the original's path for the app to delete (images).
create function public.community_attachment_ready(p_id uuid, p_display text default null, p_thumb text default null,
                                                  p_width integer default null, p_height integer default null,
                                                  p_size bigint default null, p_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_poster();
  a community.attachments;
  v_prefix text;
begin
  select * into a from community.attachments where id = p_id and owner_id = v_uid for update;
  if a.id is null or a.status <> 'processing' then
    raise exception 'That upload wasn''t found.' using errcode = 'P0002';
  end if;
  if a.kind = 'image' then
    v_prefix := 'community/' || v_uid || '/' || a.id || '/v-';
    if p_display is null or p_thumb is null or p_display not like v_prefix || '%' or p_thumb not like v_prefix || '%'
       or media.object_meta('media', p_display) is null or media.object_meta('media', p_thumb) is null then
      raise exception 'The processed photo wasn''t found.' using errcode = '22023';
    end if;
    update community.attachments
       set status = 'ready', display_path = p_display, thumb_path = p_thumb, upload_path = null, mime = 'image/webp',
           width = case when p_width between 1 and 20000 then p_width end,
           height = case when p_height between 1 and 20000 then p_height end,
           size_bytes = case when p_size > 0 then p_size else size_bytes end,
           content_hash = case when p_hash ~ '^[0-9a-f]{64}$' then p_hash end,
           error = null, updated_at = now()
     where id = a.id;
    return jsonb_build_object('id', a.id, 'status', 'ready', 'original', a.upload_path, 'original_bucket', a.upload_bucket);
  end if;
  if media.object_meta('media', a.upload_path) is null then
    raise exception 'The video wasn''t found.' using errcode = '22023';
  end if;
  update community.attachments
     set status = 'ready', video_path = upload_path, upload_path = null, mime = 'video/mp4',
         width = coalesce(case when p_width between 1 and 20000 then p_width end, width),
         height = coalesce(case when p_height between 1 and 20000 then p_height end, height),
         content_hash = case when p_hash ~ '^[0-9a-f]{64}$' then p_hash end,
         error = null, updated_at = now()
   where id = a.id;
  return jsonb_build_object('id', a.id, 'status', 'ready', 'original', null, 'original_bucket', null);
end;
$$;

create function public.community_attachment_fail(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  update community.attachments
     set status = 'failed', error = left(coalesce(nullif(btrim(p_error), ''), 'Processing failed'), 300), updated_at = now()
   where id = p_id and owner_id = v_uid and status in ('uploading', 'processing');
end;
$$;

-- Cancel an upload, or remove a draft before posting. Returns the stored
-- files for the app to delete with the same session; attached files are
-- removed only by deleting the post.
create function public.community_attachment_discard(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  a community.attachments;
begin
  select * into a from community.attachments where id = p_id and owner_id = v_uid for update;
  if a.id is null then
    return jsonb_build_object('id', p_id, 'uploads', '[]'::jsonb, 'media', '[]'::jsonb);
  end if;
  if a.status = 'attached' then
    raise exception 'This is part of a post. Delete the post to remove it.' using errcode = '22023';
  end if;
  if a.status <> 'removed' then
    update community.attachments set status = 'removed', removed_at = now(), updated_at = now() where id = a.id returning * into a;
  end if;
  return community.attachment_paths(a);
end;
$$;

-- Records that the stored files of removed attachments are gone. Checked
-- against Storage itself, so it can't be used to hide files that remain.
-- Drafts that were never posted leave no row behind.
create function public.community_attachments_objects_deleted(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_mod boolean := (select public.has_capability('community.moderate')) or (select public.has_capability('media.manage'));
  v_ids uuid[];
  v_count integer := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  select coalesce(array_agg(a.id), '{}') into v_ids
    from community.attachments a
   where a.id = any (p_ids) and a.status = 'removed' and a.objects_deleted_at is null
     and (a.owner_id = v_uid or v_mod)
     and not exists (select 1 from storage.objects o
                      where o.bucket_id in ('media', 'media-uploads')
                        and o.name in (a.upload_path, a.display_path, a.thumb_path, a.video_path));
  delete from community.attachments where id = any (v_ids) and attached_at is null;
  get diagnostics v_count = row_count;
  update community.attachments
     set objects_deleted_at = now(), upload_path = null, display_path = null, thumb_path = null, video_path = null, updated_at = now()
   where id = any (v_ids) and attached_at is not null;
  return v_count + (select count(*) from community.attachments where id = any (v_ids))::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- Posting and deleting with media
-- ---------------------------------------------------------------------------
create function public.community_thread_create_with_media(p_category uuid, p_group uuid, p_title text, p_body text,
                                                          p_client_key uuid, p_attachments uuid[], p_alts text[] default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Every posting rule (membership, group, guidelines, restriction, rate
  -- limit) is checked by community_thread_create itself.
  v_id := public.community_thread_create(p_category, p_group, p_title, p_body, p_client_key);
  perform community.attach_media('thread', v_id, null, p_attachments, p_alts);
  return v_id;
end;
$$;

create function public.community_reply_with_media(p_thread uuid, p_body text, p_client_key uuid, p_attachments uuid[],
                                                  p_alts text[] default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := public.community_reply(p_thread, p_body, p_client_key);
  perform community.attach_media('post', p_thread, v_id, p_attachments, p_alts);
  return v_id;
end;
$$;

create function public.community_thread_delete_with_media(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_result text;
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from community.attachments where thread_id = p_id and target_type = 'thread' and status = 'attached';
  v_result := public.community_thread_delete(p_id);
  return jsonb_build_object(
    'result', v_result,
    'files', coalesce((select jsonb_agg(community.attachment_paths(a)) from community.attachments a where a.id = any (v_ids)), '[]'::jsonb));
end;
$$;

create function public.community_reply_delete_with_media(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from community.attachments where post_id = p_id and status = 'attached';
  perform public.community_reply_delete(p_id);
  return jsonb_build_object(
    'files', coalesce((select jsonb_agg(community.attachment_paths(a)) from community.attachments a where a.id = any (v_ids)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
-- A thread's visible attachments: {thread: [...], posts: {post_id: [...]}}.
-- Null when the caller can't read the thread.
create function public.community_thread_attachments(p_thread uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if not community.can_read_thread(p_thread, v_uid) then
    return null;
  end if;
  return jsonb_build_object(
    'thread', coalesce((select jsonb_agg(community.attachment_json(a) order by a.sort_order, a.created_at)
                          from community.attachments a
                         where a.thread_id = p_thread and a.target_type = 'thread' and a.status = 'attached'
                           and community.attachment_visible(a)), '[]'::jsonb),
    'posts', coalesce((select jsonb_object_agg(x.post_id, x.items)
                         from (select a.post_id, jsonb_agg(community.attachment_json(a) order by a.sort_order, a.created_at) items
                                 from community.attachments a
                                where a.thread_id = p_thread and a.target_type = 'post' and a.status = 'attached'
                                  and community.attachment_visible(a)
                                group by a.post_id) x), '{}'::jsonb));
end;
$$;

-- The stored file behind one attachment variant, if the caller may see it
-- now (rechecked on every request by the serving route).
create function public.community_attachment_file(p_id uuid, p_variant text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  a community.attachments;
  v_path text;
begin
  select * into a from community.attachments where id = p_id;
  if a.id is null or a.status not in ('ready', 'attached') or not community.attachment_visible(a) then
    return null;
  end if;
  v_path := case
    when a.kind = 'image' and p_variant = 'thumb' then a.thumb_path
    when a.kind = 'image' and p_variant = 'display' then a.display_path
    when a.kind = 'video' and p_variant = 'video' then a.video_path end;
  if v_path is null then
    return null;
  end if;
  return jsonb_build_object('bucket', 'media', 'path', v_path, 'kind', a.kind,
                            'mime', case when a.kind = 'image' then 'image/webp' else a.mime end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cleanup (community moderators and media managers)
-- ---------------------------------------------------------------------------
create function community.require_cleanup()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if not ((select public.has_capability('community.moderate')) or (select public.has_capability('media.manage'))) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Candidates for review before deleting. Nothing is deleted automatically.
--   abandoned: drafts never posted, untouched for media.settings.abandoned_upload_hours
--   removed:   deleted with their post, stored files still present
--   orphans:   files under community/ that no attachment refers to, over a day old
-- No names, captions, or discussion details are included.
create function public.community_mod_attachment_cleanup()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours integer;
begin
  perform community.require_cleanup();
  select abandoned_upload_hours into v_hours from media.settings;
  v_hours := coalesce(v_hours, 24);
  return jsonb_build_object(
    'hours', v_hours,
    'abandoned', coalesce((select jsonb_agg(community.attachment_paths(a) || jsonb_build_object(
                                     'kind', a.kind, 'status', a.status, 'size', a.size_bytes, 'created_at', a.created_at, 'updated_at', a.updated_at)
                                   order by a.updated_at)
                             from (select * from community.attachments a
                                    where a.status in ('uploading', 'processing', 'ready', 'failed')
                                      and a.updated_at < now() - make_interval(hours => v_hours)
                                    order by a.updated_at limit 200) a), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(community.attachment_paths(a) || jsonb_build_object(
                                   'kind', a.kind, 'status', a.status, 'size', a.size_bytes, 'created_at', a.created_at, 'updated_at', a.removed_at)
                                 order by a.removed_at)
                           from (select * from community.attachments a
                                  where a.status = 'removed' and a.objects_deleted_at is null
                                  order by a.removed_at limit 200) a), '[]'::jsonb),
    'orphans', coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name, 'created_at', o.created_at) order by o.created_at)
                           from (select o.* from storage.objects o
                                  where o.bucket_id in ('media', 'media-uploads') and o.name like 'community/%'
                                    and o.created_at < now() - interval '1 day'
                                    and not exists (select 1 from community.attachments a
                                                     where o.name in (a.upload_path, a.display_path, a.thumb_path, a.video_path))
                                  order by o.created_at limit 200) o), '[]'::jsonb));
end;
$$;

-- Marks the chosen abandoned drafts removed and returns the stored files of
-- those and of the chosen removed attachments, for the app to delete.
create function public.community_mod_attachment_discard(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer;
  v_count integer;
begin
  perform community.require_cleanup();
  if p_ids is null or cardinality(p_ids) = 0 then
    return '[]'::jsonb;
  end if;
  select coalesce(abandoned_upload_hours, 24) into v_hours from media.settings;
  update community.attachments
     set status = 'removed', removed_at = now(), updated_at = now()
   where id = any (p_ids) and status in ('uploading', 'processing', 'ready', 'failed')
     and updated_at < now() - make_interval(hours => coalesce(v_hours, 24));
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform community.audit('community.attachments_discarded', 'community_attachment', null, jsonb_build_object('count', v_count));
  end if;
  return coalesce((select jsonb_agg(community.attachment_paths(a)) from community.attachments a
                    where a.id = any (p_ids) and a.status = 'removed' and a.objects_deleted_at is null), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: nothing for visitors; signed-in users call the public entry
-- points (each checks its caller); helpers stay internal.
-- ---------------------------------------------------------------------------
revoke execute on function
  community.attachment_limits(),
  community.attachment_visible(community.attachments),
  community.attachment_json(community.attachments),
  community.attachment_paths(community.attachments),
  community.attach_media(text, uuid, uuid, uuid[], text[]),
  community.attachments_on_content_delete(),
  community.require_cleanup()
from public, anon, authenticated, service_role;

revoke execute on function
  public.community_attachment_can_read_object(text, text),
  public.community_attachment_can_write_object(text, text),
  public.community_attachment_can_delete_object(text, text),
  public.community_attachment_begin(uuid, uuid, text, text, bigint, integer, integer, numeric),
  public.community_attachment_processing(uuid),
  public.community_attachment_ready(uuid, text, text, integer, integer, bigint, text),
  public.community_attachment_fail(uuid, text),
  public.community_attachment_discard(uuid),
  public.community_attachments_objects_deleted(uuid[]),
  public.community_thread_create_with_media(uuid, uuid, text, text, uuid, uuid[], text[]),
  public.community_reply_with_media(uuid, text, uuid, uuid[], text[]),
  public.community_thread_delete_with_media(uuid),
  public.community_reply_delete_with_media(uuid),
  public.community_thread_attachments(uuid),
  public.community_attachment_file(uuid, text),
  public.community_mod_attachment_cleanup(),
  public.community_mod_attachment_discard(uuid[])
from public, anon, authenticated, service_role;

grant execute on function
  public.community_attachment_can_read_object(text, text),
  public.community_attachment_can_write_object(text, text),
  public.community_attachment_can_delete_object(text, text),
  public.community_attachment_begin(uuid, uuid, text, text, bigint, integer, integer, numeric),
  public.community_attachment_processing(uuid),
  public.community_attachment_ready(uuid, text, text, integer, integer, bigint, text),
  public.community_attachment_fail(uuid, text),
  public.community_attachment_discard(uuid),
  public.community_attachments_objects_deleted(uuid[]),
  public.community_thread_create_with_media(uuid, uuid, text, text, uuid, uuid[], text[]),
  public.community_reply_with_media(uuid, text, uuid, uuid[], text[]),
  public.community_thread_delete_with_media(uuid),
  public.community_reply_delete_with_media(uuid),
  public.community_thread_attachments(uuid),
  public.community_attachment_file(uuid, text),
  public.community_mod_attachment_cleanup(),
  public.community_mod_attachment_discard(uuid[])
to authenticated;
