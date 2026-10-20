-- Phase 7 · Photo galleries: albums for approved members or one group
-- (never public), member uploads with moderation before publication,
-- reports and removal requests.
--
-- Upload lifecycle (each step rechecks membership and album eligibility):
--   media_photo_begin       registers the original's quarantine path
--   (browser → storage)     direct resumable upload to `media-uploads`
--   media_photo_processing  verifies the stored object; server processes it
--   media_photo_ready       review copies stored (oriented, sRGB, no
--                           metadata); the original is deleted → pending
--   media_admin_photo_review  approve (moderator re-encodes into `media`),
--                           reject, hide, unhide, or remove
-- Hidden, rejected, and removed photos fail the storage read rule at once;
-- links already on someone's screen last at most their 5-minute signature.
-- Rejected and removed photos' files are deleted by the acting person.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Whether a person may contribute to an album now (album audience and
-- membership; the moderator may still be reviewing a draft album).
create function media.can_contribute(a media.albums, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select media.is_member(p_profile) and a.status <> 'archived' and media.audience_allows(a.audience, a.group_id, p_profile);
$$;

create function media.photo_json(ph media.photos, p_viewer uuid, p_admin boolean)
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

create function media.album_json(a media.albums, p_viewer uuid, p_admin boolean)
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
         from media.photos ph where ph.id = a.cover_photo_id and ph.status = 'approved'),
      (select jsonb_build_object('photo_id', ph.id, 'thumb_path', ph.thumb_path, 'alt', ph.alt_text)
         from media.photos ph where ph.album_id = a.id and ph.status = 'approved' order by ph.sort_order, ph.approved_at limit 1)),
    'photo_count', (select count(*) from media.photos ph where ph.album_id = a.id and ph.status = 'approved'),
    'can_upload', a.uploads_open and a.status = 'published' and media.can_contribute(a, p_viewer));
$$;

-- Replaced in the notifications migration to tell uploaders the outcome.
create function media.after_review(ph media.photos, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

create function media.mod_log(p_action text, p_photo uuid, p_album uuid, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into media.moderation_log (actor_id, action, photo_id, album_id, reason)
  values ((select auth.uid()), p_action, p_photo, p_album, left(p_reason, 500));
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
create function public.media_albums()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  return coalesce((select jsonb_agg(media.album_json(a, v_uid, false) order by a.album_on desc nulls last, a.sort_order, a.created_at desc)
                     from media.albums a where media.album_visible(a, v_uid)), '[]'::jsonb);
end;
$$;

create function public.media_album(p_id uuid)
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
                             where ph.album_id = a.id and ph.uploader_id = v_uid
                               and ph.status in ('uploading', 'processing', 'pending', 'rejected', 'hidden', 'failed')), '[]'::jsonb),
    'limits', jsonb_build_object('file_mb', st.gallery_file_mb, 'batch_max', st.gallery_batch_max, 'daily_max', st.gallery_daily_max));
end;
$$;

create function public.media_my_photos()
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
                    where ph.uploader_id = v_uid and ph.status <> 'removed' and media.can_contribute(a, v_uid)), '[]'::jsonb);
end;
$$;

create function public.media_photo_begin(p_album uuid, p_client_key uuid, p_batch_key uuid, p_name text, p_mime text, p_size bigint,
                                         p_permission boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  a media.albums;
  st media.settings;
  ph media.photos;
  v_id uuid := gen_random_uuid();
begin
  if p_client_key is null then
    raise exception 'Missing upload key.' using errcode = '22023';
  end if;
  select * into ph from media.photos where uploader_id = v_uid and client_key = p_client_key;
  if ph.id is not null then
    -- A retried request: the same photo, never a duplicate.
    return jsonb_build_object('id', ph.id, 'path', ph.original_path, 'status', ph.status);
  end if;
  select * into a from media.albums where id = p_album;
  if a.id is null or not media.album_visible(a, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if not a.uploads_open then
    raise exception 'This album isn''t accepting photos right now.' using errcode = '22023';
  end if;
  if not coalesce(p_permission, false) then
    raise exception 'Confirm that you have permission to share these photos.' using errcode = '22023';
  end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then
    raise exception 'Choose a JPEG, PNG, WebP, or HEIC photo.' using errcode = '22023';
  end if;
  select * into st from media.settings;
  if p_size is null or p_size <= 0 or p_size > st.gallery_file_mb::bigint * 1024 * 1024 then
    raise exception 'Each photo must be % MB or smaller.', st.gallery_file_mb using errcode = '22023';
  end if;
  if p_batch_key is not null and (select count(*) from media.photos where uploader_id = v_uid and batch_key = p_batch_key) >= st.gallery_batch_max then
    raise exception 'You can add up to % photos at a time.', st.gallery_batch_max using errcode = '22023';
  end if;
  if (select count(*) from media.photos where uploader_id = v_uid and created_at > now() - interval '24 hours') >= st.gallery_daily_max then
    raise exception 'You''ve reached today''s limit of % photos. Please try again tomorrow.', st.gallery_daily_max using errcode = '22023';
  end if;
  if (select count(*) from media.photos where uploader_id = v_uid and status in ('uploading', 'processing', 'pending')) >= st.gallery_pending_max then
    raise exception 'You have many photos waiting for review. Please wait for moderators to catch up.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'media.photo', 200, interval '1 hour');
  insert into media.photos (id, album_id, uploader_id, status, permission_confirmed, original_path, size_bytes, client_key, batch_key)
  values (v_id, a.id, v_uid, 'uploading', true,
          'photos/' || v_uid || '/' || v_id || '/original.' || media.mime_ext(p_mime), p_size, p_client_key, p_batch_key)
  returning * into ph;
  return jsonb_build_object('id', ph.id, 'path', ph.original_path, 'status', ph.status);
end;
$$;

create function public.media_photo_processing(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  ph media.photos;
  a media.albums;
  v_meta jsonb;
begin
  select * into ph from media.photos where id = p_id and uploader_id = v_uid for update;
  if ph.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into a from media.albums where id = ph.album_id;
  if not media.album_visible(a, v_uid) or not a.uploads_open then
    raise exception 'This album isn''t accepting photos right now.' using errcode = '22023';
  end if;
  if ph.status not in ('uploading', 'processing', 'failed') or ph.original_path is null then
    raise exception 'This photo has already been processed.' using errcode = '22023';
  end if;
  v_meta := media.object_meta('media-uploads', ph.original_path);
  if v_meta is null then
    raise exception 'The photo hasn''t finished uploading. Try again.' using errcode = '22023';
  end if;
  if (v_meta ->> 'size') is not null and (v_meta ->> 'size')::bigint > (select gallery_file_mb from media.settings)::bigint * 1024 * 1024 then
    raise exception 'That photo is larger than the limit.' using errcode = '22023';
  end if;
  update media.photos set status = 'processing', error = null, updated_at = now() where id = ph.id;
  return jsonb_build_object('id', ph.id, 'original_path', ph.original_path);
end;
$$;

create function public.media_photo_ready(p_id uuid, p_display text, p_thumb text, p_width integer, p_height integer, p_size bigint,
                                         p_hash text, p_caption text, p_alt text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  ph media.photos;
  a media.albums;
  v_prefix text;
begin
  select * into ph from media.photos where id = p_id and uploader_id = v_uid for update;
  if ph.id is null or ph.status <> 'processing' then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into a from media.albums where id = ph.album_id;
  if not media.album_visible(a, v_uid) or not a.uploads_open then
    raise exception 'This album isn''t accepting photos right now.' using errcode = '22023';
  end if;
  v_prefix := 'photos/' || v_uid || '/' || ph.id || '/review-';
  if p_display not like v_prefix || '%' or p_thumb not like v_prefix || '%'
     or media.object_meta('media-uploads', p_display) is null or media.object_meta('media-uploads', p_thumb) is null then
    raise exception 'The processed photo wasn''t found.' using errcode = '22023';
  end if;
  if p_hash is not null and exists (select 1 from media.photos x
                                     where x.album_id = ph.album_id and x.content_hash = p_hash and x.id <> ph.id
                                       and x.status in ('processing', 'pending', 'approved', 'hidden')) then
    -- The app then marks the upload failed and deletes its copies.
    raise exception 'This photo is already in the album.' using errcode = '22023';
  end if;
  update media.photos
     set status = 'pending', review_display_path = p_display, review_thumb_path = p_thumb, original_path = null,
         width = p_width, height = p_height, size_bytes = coalesce(p_size, size_bytes), content_hash = p_hash,
         caption = left(btrim(coalesce(p_caption, '')), 500), alt_text = left(btrim(coalesce(p_alt, '')), 500),
         error = null, updated_at = now()
   where id = ph.id
  returning * into ph;
  return jsonb_build_object('id', ph.id, 'status', ph.status);
end;
$$;

create function public.media_photo_fail(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  update media.photos
     set status = 'failed', error = left(coalesce(nullif(btrim(p_error), ''), 'Processing failed'), 300), updated_at = now()
   where id = p_id and uploader_id = v_uid and status in ('uploading', 'processing');
end;
$$;

create function public.media_photo_update(p_id uuid, p_caption text, p_alt text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  ph media.photos;
begin
  select * into ph from media.photos where id = p_id and uploader_id = v_uid for update;
  if ph.id is null or ph.status not in ('pending', 'approved', 'hidden') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform community.rate_limit(v_uid, 'media.caption', 60, interval '10 minutes');
  update media.photos
     set caption = left(btrim(coalesce(p_caption, '')), 500), alt_text = left(btrim(coalesce(p_alt, '')), 500),
         caption_edited_at = case when status <> 'pending' then now() else caption_edited_at end, updated_at = now()
   where id = ph.id;
end;
$$;

-- The uploader removes their own photo at any time. Returns the stored
-- files for the app to delete with the same session.
create function public.media_photo_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  ph media.photos;
begin
  select * into ph from media.photos where id = p_id and uploader_id = v_uid for update;
  if ph.id is null or ph.status = 'removed' then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  update media.photos set status = 'removed', updated_at = now() where id = ph.id;
  update media.albums set cover_photo_id = null, updated_at = now() where cover_photo_id = ph.id;
  insert into media.moderation_log (actor_id, action, photo_id, album_id) values (v_uid, 'photo.removed_by_uploader', ph.id, ph.album_id);
  return jsonb_build_object(
    'uploads', to_jsonb(array_remove(array[ph.original_path, ph.review_display_path, ph.review_thumb_path], null)),
    'media', to_jsonb(array_remove(array[ph.display_path, ph.thumb_path], null)));
end;
$$;

-- Report a photo or ask for it to be removed (for example, you're in it).
create function public.media_photo_report(p_id uuid, p_reason text, p_details text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  ph media.photos;
begin
  select * into ph from media.photos where id = p_id;
  if ph.id is null or not media.photo_visible(ph, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_reason not in ('removal_request', 'privacy', 'minor', 'inappropriate', 'other') then
    raise exception 'Choose a reason.' using errcode = '22023';
  end if;
  if exists (select 1 from media.photo_reports where photo_id = ph.id and reporter_id = v_uid and status = 'open') then
    return;
  end if;
  perform community.rate_limit(v_uid, 'media.photo_report', 10, interval '1 hour');
  insert into media.photo_reports (photo_id, reporter_id, reason, details)
  values (ph.id, v_uid, p_reason, nullif(left(btrim(coalesce(p_details, '')), 1000), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------
create function media.require_album_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if not (public.has_capability('gallery.moderate') or public.has_capability('events.manage')) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function public.media_admin_albums()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  v_mod boolean := public.has_capability('gallery.moderate');
begin
  return jsonb_build_object(
    'can_moderate', v_mod,
    'albums', coalesce((select jsonb_agg(media.album_json(a, v_uid, true) || jsonb_build_object(
                          'sort_order', a.sort_order, 'mine', a.created_by = v_uid,
                          'pending', (select count(*) from media.photos ph where ph.album_id = a.id and ph.status = 'pending'),
                          'hidden', (select count(*) from media.photos ph where ph.album_id = a.id and ph.status = 'hidden'))
                        order by a.status = 'archived', a.album_on desc nulls last, a.created_at desc)
                         from media.albums a where v_mod or a.created_by = v_uid), '[]'::jsonb),
    'open_reports', case when v_mod then (select count(*) from media.photo_reports where status = 'open') end);
end;
$$;

create function public.media_admin_album(p_id uuid, p_status text)
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
              else '[]'::jsonb end);
end;
$$;

create function public.media_admin_album_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_album_admin();
  v_mod boolean := public.has_capability('gallery.moderate');
  a media.albums;
  v_audience media.audience;
  v_group uuid;
  v_event uuid;
  v_fields text[] := array(select jsonb_object_keys(p));
begin
  if p_id is not null then
    select * into a from media.albums where id = p_id for update;
    if a.id is null or not (v_mod or a.created_by = v_uid) then
      raise exception 'Album not found.' using errcode = 'P0002';
    end if;
  end if;
  v_audience := coalesce(nullif(p ->> 'audience', '')::media.audience, a.audience, 'members');
  if v_audience = 'public' then
    raise exception 'Photo albums are shared with members or a group, never publicly.' using errcode = '22023';
  end if;
  v_group := case when v_audience = 'group' then coalesce(nullif(p ->> 'group_id', '')::uuid, a.group_id) end;
  if v_audience = 'group' and not exists (select 1 from community.groups where id = v_group and status = 'active') then
    raise exception 'Choose an active group.' using errcode = '22023';
  end if;
  v_event := case when p ? 'event_series_id' then nullif(p ->> 'event_series_id', '')::uuid else a.event_series_id end;
  if v_event is not null and not exists (select 1 from events.series where id = v_event) then
    raise exception 'Choose an event.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into media.albums (title, audience, group_id, created_by)
    values (coalesce(nullif(btrim(p ->> 'title'), ''), 'Untitled album'), v_audience, v_group, v_uid)
    returning * into a;
  end if;
  update media.albums
     set title = case when p ? 'title' then btrim(p ->> 'title') else title end,
         description = case when p ? 'description' then left(coalesce(p ->> 'description', ''), 2000) else description end,
         album_on = case when p ? 'album_on' then nullif(p ->> 'album_on', '')::date else album_on end,
         event_series_id = v_event,
         audience = v_audience, group_id = v_group,
         uploads_open = case when p ? 'uploads_open' then coalesce((p ->> 'uploads_open')::boolean, false) else uploads_open end,
         sort_order = case when p ? 'sort_order' then coalesce((p ->> 'sort_order')::integer, 100) else sort_order end,
         updated_at = now()
   where id = a.id
  returning * into a;
  perform media.audit(case when p_id is null then 'media.album_created' else 'media.album_updated' end, 'media_album', a.id,
                      jsonb_build_object('fields', v_fields, 'audience', a.audience));
  return a.id;
end;
$$;

create function public.media_admin_album_status(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('gallery.moderate');
  a media.albums;
begin
  select * into a from media.albums where id = p_id for update;
  if a.id is null then
    raise exception 'Album not found.' using errcode = 'P0002';
  end if;
  if p_action = 'publish' then
    update media.albums set status = 'published', updated_at = now() where id = a.id;
  elsif p_action = 'unpublish' then
    update media.albums set status = 'draft', updated_at = now() where id = a.id;
  elsif p_action = 'archive' then
    update media.albums set status = 'archived', uploads_open = false, updated_at = now() where id = a.id;
  elsif p_action = 'restore' then
    update media.albums set status = 'draft', updated_at = now() where id = a.id and status = 'archived';
  elsif p_action = 'delete' then
    if exists (select 1 from media.photos where album_id = a.id and objects_deleted_at is null
                and status not in ('removed', 'rejected', 'failed')) then
      raise exception 'Remove the album''s photos before deleting it, or archive it instead.' using errcode = '22023';
    end if;
    delete from media.albums where id = a.id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform media.mod_log('album.' || p_action, null, a.id);
  perform media.audit('media.album_' || p_action, 'media_album', a.id, '{}'::jsonb);
end;
$$;

-- Review actions (gallery.moderate):
--   approve  needs the minors review and the moderator's re-encoded copies
--            under gallery/<album>/<photo>/; the uploader must still be
--            eligible for the album
--   reject   with an optional reason shown to the uploader
--   hide / unhide, remove
-- Returns the files to delete for the acting moderator.
create function public.media_admin_photo_review(p_id uuid, p_action text, p_reason text, p_minors text, p_display text, p_thumb text)
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
    if ph.uploader_id is not null and not media.can_contribute(a, ph.uploader_id) then
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

create function public.media_admin_photo_order(p_album uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform media.require_cap('gallery.moderate');
  update media.photos ph set sort_order = x.n, updated_at = now()
    from unnest(p_ids) with ordinality as x(id, n)
   where ph.id = x.id and ph.album_id = p_album;
end;
$$;

create function public.media_admin_album_cover(p_album uuid, p_photo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform media.require_cap('gallery.moderate');
  if p_photo is not null and not exists (select 1 from media.photos where id = p_photo and album_id = p_album and status = 'approved') then
    raise exception 'Choose a published photo from this album.' using errcode = '22023';
  end if;
  update media.albums set cover_photo_id = p_photo, updated_at = now() where id = p_album;
  perform media.mod_log('album.cover', p_photo, p_album);
end;
$$;

create function public.media_admin_photo_reports(p_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('gallery.moderate');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
                     'id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at,
                     'resolution', r.resolution, 'resolved_at', r.resolved_at,
                     'reporter', case when r.reporter_id is not null then community.display_name(r.reporter_id) end,
                     'album', jsonb_build_object('id', a.id, 'title', a.title),
                     'photo', media.photo_json(ph, v_uid, true))
                   order by r.created_at desc)
                     from (select * from media.photo_reports r
                            where r.status = coalesce(p_status, 'open') order by r.created_at desc limit 100) r
                     join media.photos ph on ph.id = r.photo_id
                     join media.albums a on a.id = ph.album_id), '[]'::jsonb);
end;
$$;

create function public.media_admin_photo_report_resolve(p_id uuid, p_status text, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('gallery.moderate');
begin
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'Choose an outcome.' using errcode = '22023';
  end if;
  update media.photo_reports
     set status = p_status, resolution = nullif(left(btrim(coalesce(p_resolution, '')), 1000), ''), resolved_by = v_uid, resolved_at = now()
   where id = p_id and status = 'open';
  perform media.mod_log('report.' || p_status, (select photo_id from media.photo_reports where id = p_id), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema media from public, anon, authenticated;
revoke execute on function
  public.media_albums(), public.media_album(uuid), public.media_my_photos(),
  public.media_photo_begin(uuid, uuid, uuid, text, text, bigint, boolean), public.media_photo_processing(uuid),
  public.media_photo_ready(uuid, text, text, integer, integer, bigint, text, text, text), public.media_photo_fail(uuid, text),
  public.media_photo_update(uuid, text, text), public.media_photo_remove(uuid), public.media_photo_report(uuid, text, text),
  public.media_admin_albums(), public.media_admin_album(uuid, text), public.media_admin_album_save(uuid, jsonb),
  public.media_admin_album_status(uuid, text), public.media_admin_photo_review(uuid, text, text, text, text, text),
  public.media_admin_photo_order(uuid, uuid[]), public.media_admin_album_cover(uuid, uuid),
  public.media_admin_photo_reports(text), public.media_admin_photo_report_resolve(uuid, text, text)
from public;

grant execute on function
  public.media_albums(), public.media_album(uuid), public.media_my_photos(),
  public.media_photo_begin(uuid, uuid, uuid, text, text, bigint, boolean), public.media_photo_processing(uuid),
  public.media_photo_ready(uuid, text, text, integer, integer, bigint, text, text, text), public.media_photo_fail(uuid, text),
  public.media_photo_update(uuid, text, text), public.media_photo_remove(uuid), public.media_photo_report(uuid, text, text),
  public.media_admin_albums(), public.media_admin_album(uuid, text), public.media_admin_album_save(uuid, jsonb),
  public.media_admin_album_status(uuid, text), public.media_admin_photo_review(uuid, text, text, text, text, text),
  public.media_admin_photo_order(uuid, uuid[]), public.media_admin_album_cover(uuid, uuid),
  public.media_admin_photo_reports(text), public.media_admin_photo_report_resolve(uuid, text, text)
to authenticated;
