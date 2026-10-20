-- Phase 7 · Media library: storage buckets and policies, the upload
-- lifecycle (uploading → processing → ready / failed), rights details,
-- usage references, safe replacement, cleanup, settings, and taxonomy.
--
-- Uploads go straight from the browser to Supabase Storage (resumable TUS
-- with a signed upload token created through the uploader's own session),
-- never through an app server route. Storage RLS admits only the exact path
-- registered by media_admin_asset_begin / media_photo_begin, by the person
-- who registered it, while it is still uploading or processing.

-- ---------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------
-- `media`: every served file (library assets and approved gallery copies).
-- 50 MB per file is the Supabase Free plan's ceiling; raise it (and the
-- settings limits) only after moving to a paid plan.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array[
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
  'video/mp4',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/vtt'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- `media-uploads`: quarantine for member photo originals and review copies.
-- Never readable by ordinary viewers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-uploads', 'media-uploads', false, 52428800, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Storage access
-- ---------------------------------------------------------------------------
create function public.media_can_read_object(p_bucket text, p_name text)
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
    -- gallery copies unless they moderate the gallery.
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

create function public.media_can_write_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not media.is_member(v_uid) then
    return false;
  end if;
  if p_bucket = 'media' then
    if p_name like 'assets/%' then
      return public.has_capability('media.manage') and exists (
        select 1 from media.assets a
         where a.status in ('uploading', 'processing') and a.created_by = v_uid
           and (p_name = a.upload_path or p_name like 'assets/' || a.id::text || '/%'));
    elsif p_name like 'gallery/%' then
      return public.has_capability('gallery.moderate') and exists (
        select 1 from media.photos ph
         where ph.status in ('pending', 'approved', 'hidden')
           and p_name like 'gallery/' || ph.album_id::text || '/' || ph.id::text || '/%');
    end if;
    return false;
  elsif p_bucket = 'media-uploads' then
    return exists (
      select 1 from media.photos ph
       where ph.uploader_id = v_uid
         and ((ph.status = 'uploading' and p_name = ph.original_path)
              or (ph.status = 'processing' and p_name like 'photos/' || v_uid::text || '/' || ph.id::text || '/review-%')));
  end if;
  return false;
end;
$$;

create function public.media_can_delete_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not media.is_member(v_uid) then
    return false;
  end if;
  if public.has_capability('media.manage') then
    return p_bucket in ('media', 'media-uploads');
  end if;
  if p_bucket = 'media' then
    if p_name like 'gallery/%' then
      return public.has_capability('gallery.moderate')
          or exists (select 1 from media.photos ph
                      where ph.uploader_id = v_uid and p_name in (ph.display_path, ph.thumb_path));
    end if;
    return false;
  elsif p_bucket = 'media-uploads' then
    return public.has_capability('gallery.moderate')
        or exists (select 1 from media.photos ph
                    where ph.uploader_id = v_uid
                      and p_name in (ph.original_path, ph.review_display_path, ph.review_thumb_path));
  end if;
  return false;
end;
$$;

create policy "Media files follow content visibility"
  on storage.objects for select to anon, authenticated
  using (bucket_id in ('media', 'media-uploads') and (select public.media_can_read_object(storage.objects.bucket_id, storage.objects.name)));

create policy "Media uploads only to registered paths"
  on storage.objects for insert to authenticated
  with check (bucket_id in ('media', 'media-uploads') and (select public.media_can_write_object(storage.objects.bucket_id, storage.objects.name)));

create policy "Media files removed by their managers"
  on storage.objects for delete to authenticated
  using (bucket_id in ('media', 'media-uploads') and (select public.media_can_delete_object(storage.objects.bucket_id, storage.objects.name)));

-- ---------------------------------------------------------------------------
-- Upload rules
-- ---------------------------------------------------------------------------
create function media.allowed_mime(p_kind text, p_mime text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'audio' then p_mime in ('audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac')
    when 'video' then p_mime = 'video/mp4'
    when 'image' then p_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
    when 'document' then p_mime in ('application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    when 'captions' then p_mime = 'text/vtt'
    else false
  end;
$$;

create function media.mime_ext(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mime
    when 'audio/mpeg' then 'mp3' when 'audio/mp4' then 'm4a' when 'audio/x-m4a' then 'm4a' when 'audio/aac' then 'aac'
    when 'video/mp4' then 'mp4'
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/heic' then 'heic' when 'image/heif' then 'heif'
    when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
    when 'text/vtt' then 'vtt'
    else 'bin' end;
$$;

create function media.max_bytes(p_kind text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (case p_kind
            when 'audio' then s.audio_max_mb
            when 'video' then s.video_max_mb
            when 'image' then s.image_max_mb
            when 'document' then s.document_max_mb
            when 'captions' then 2
            else 0 end)::bigint * 1024 * 1024
    from media.settings s;
$$;

-- Size and type recorded by Storage for an uploaded object.
create function media.object_meta(p_bucket text, p_name text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('size', nullif(o.metadata ->> 'size', '')::bigint, 'mimetype', o.metadata ->> 'mimetype')
    from storage.objects o where o.bucket_id = p_bucket and o.name = p_name;
$$;

-- ---------------------------------------------------------------------------
-- Asset lifecycle
-- ---------------------------------------------------------------------------
create function public.media_admin_asset_begin(p_kind text, p_title text, p_name text, p_mime text, p_size bigint,
                                               p_client_key uuid, p_parent uuid default null, p_language text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
  a media.assets;
  v_id uuid := gen_random_uuid();
  v_max bigint;
begin
  if p_client_key is not null then
    select * into a from media.assets where created_by = v_uid and client_key = p_client_key;
    if a.id is not null then
      if a.status <> 'uploading' then
        raise exception 'That upload has already finished.' using errcode = '22023';
      end if;
      return jsonb_build_object('id', a.id, 'upload_path', a.upload_path, 'max_bytes', media.max_bytes(a.kind::text));
    end if;
  end if;
  if p_kind not in ('audio', 'video', 'image', 'document', 'captions') then
    raise exception 'Choose a supported kind of file.' using errcode = '22023';
  end if;
  if not media.allowed_mime(p_kind, p_mime) then
    raise exception 'That file type isn''t supported here. Audio: MP3 or M4A. Video: MP4 (H.264/AAC). Images: JPEG, PNG, WebP, or HEIC. Documents: PDF or PowerPoint (.pptx). Captions: WebVTT (.vtt).' using errcode = '22023';
  end if;
  v_max := media.max_bytes(p_kind);
  if p_size is null or p_size <= 0 or p_size > v_max then
    raise exception 'That file is too large. The limit for this kind of file is % MB.', v_max / 1024 / 1024 using errcode = '22023';
  end if;
  if p_kind = 'captions' and not exists (select 1 from media.assets where id = p_parent and kind in ('audio', 'video') and status <> 'removed') then
    raise exception 'Captions must belong to an audio or video file.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'media.upload', 120, interval '1 hour');
  insert into media.assets (id, kind, status, title, upload_path, original_name, mime, size_bytes, parent_id, language, client_key, created_by)
  values (v_id, p_kind::media.asset_kind, 'uploading', left(coalesce(nullif(btrim(p_title), ''), nullif(btrim(p_name), ''), 'Untitled'), 160),
          'assets/' || v_id || '/upload-' || encode(extensions.gen_random_bytes(8), 'hex') || '.' || media.mime_ext(p_mime),
          left(p_name, 200), p_mime, p_size, case when p_kind = 'captions' then p_parent end,
          case when p_kind = 'captions' then coalesce(nullif(p_language, ''), 'en') end, p_client_key, v_uid)
  returning * into a;
  perform media.audit('media.asset_created', 'media_asset', a.id, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('id', a.id, 'upload_path', a.upload_path, 'max_bytes', v_max);
end;
$$;

-- The upload finished: verify the stored object and move to processing.
create function public.media_admin_asset_processing(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
  a media.assets;
  v_meta jsonb;
begin
  select * into a from media.assets where id = p_id for update;
  if a.id is null or a.created_by is distinct from v_uid then
    raise exception 'Upload not found.' using errcode = 'P0002';
  end if;
  if a.status = 'processing' then
    return jsonb_build_object('id', a.id, 'kind', a.kind, 'upload_path', a.upload_path, 'mime', a.mime, 'size', a.size_bytes);
  end if;
  if a.status <> 'uploading' then
    raise exception 'That upload is no longer waiting to be processed.' using errcode = '22023';
  end if;
  v_meta := media.object_meta('media', a.upload_path);
  if v_meta is null then
    raise exception 'The upload hasn''t reached storage yet. Try again, or upload the file again.' using errcode = '22023';
  end if;
  if (v_meta ->> 'size') is not null and (v_meta ->> 'size')::bigint > media.max_bytes(a.kind::text) then
    update media.assets set status = 'failed', error = 'File is larger than the limit', updated_at = now() where id = a.id;
    raise exception 'That file is larger than the limit.' using errcode = '22023';
  end if;
  update media.assets
     set status = 'processing', updated_at = now(),
         size_bytes = coalesce((v_meta ->> 'size')::bigint, size_bytes)
   where id = a.id
  returning * into a;
  return jsonb_build_object('id', a.id, 'kind', a.kind, 'upload_path', a.upload_path, 'mime', a.mime, 'size', a.size_bytes);
end;
$$;

create function public.media_admin_asset_complete(p_id uuid, p_path text, p_variant text, p_mime text,
                                                  p_width integer, p_height integer, p_duration numeric, p_duration_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
  a media.assets;
  v_meta jsonb;
begin
  select * into a from media.assets where id = p_id for update;
  if a.id is null or a.created_by is distinct from v_uid or a.status <> 'processing' then
    raise exception 'Upload not found.' using errcode = 'P0002';
  end if;
  if p_path is null or p_path not like 'assets/' || a.id::text || '/%'
     or (p_variant is not null and p_variant not like 'assets/' || a.id::text || '/%') then
    raise exception 'That file location isn''t valid.' using errcode = '22023';
  end if;
  v_meta := media.object_meta('media', p_path);
  if v_meta is null then
    raise exception 'The processed file wasn''t found in storage.' using errcode = '22023';
  end if;
  if not media.allowed_mime(a.kind::text, p_mime) and not (a.kind = 'image' and p_mime = 'image/webp') then
    raise exception 'That file type isn''t supported here.' using errcode = '22023';
  end if;
  update media.assets
     set status = 'ready', path = p_path, variant_path = p_variant, mime = p_mime,
         -- The original upload of an image is deleted after processing.
         upload_path = case when p_path = upload_path then upload_path end,
         size_bytes = coalesce((v_meta ->> 'size')::bigint, size_bytes),
         width = p_width, height = p_height,
         duration_seconds = case when a.kind in ('audio', 'video') then p_duration end,
         duration_source = case when a.kind in ('audio', 'video') and p_duration is not null then p_duration_source end,
         error = null, ready_at = now(), updated_at = now()
   where id = a.id
  returning * into a;
  perform media.audit('media.asset_ready', 'media_asset', a.id, jsonb_build_object('kind', a.kind));
  return jsonb_build_object('id', a.id, 'status', a.status);
end;
$$;

create function public.media_admin_asset_fail(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
begin
  update media.assets
     set status = 'failed', error = left(coalesce(nullif(btrim(p_error), ''), 'Processing failed'), 300), updated_at = now()
   where id = p_id and created_by = v_uid and status in ('uploading', 'processing');
end;
$$;

-- External YouTube/Vimeo reference (no file). The app parses the URL; the
-- database stores only the provider and its identifiers.
create function public.media_admin_external_video_save(p_id uuid, p_provider text, p_ref text, p_hash text, p_url text, p_title text)
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
    insert into media.assets (kind, status, title, provider, provider_ref, provider_hash, external_url, created_by, ready_at)
    values ('external_video', 'ready', left(coalesce(nullif(btrim(p_title), ''), 'Video'), 160), p_provider, p_ref,
            nullif(p_hash, ''), left(p_url, 500), v_uid, now())
    returning id into v_id;
    perform media.audit('media.asset_created', 'media_asset', v_id, jsonb_build_object('kind', 'external_video', 'provider', p_provider));
  else
    update media.assets
       set provider = p_provider, provider_ref = p_ref, provider_hash = nullif(p_hash, ''), external_url = left(p_url, 500),
           title = left(coalesce(nullif(btrim(p_title), ''), title), 160), updated_at = now()
     where id = p_id and kind = 'external_video' and status <> 'removed'
    returning id into v_id;
    if v_id is null then
      raise exception 'Video not found.' using errcode = 'P0002';
    end if;
    perform media.audit('media.asset_updated', 'media_asset', v_id, jsonb_build_object('fields', array['provider']));
  end if;
  return v_id;
end;
$$;

-- Details, rights, and public approval. Approving a file for public use
-- needs confirmed rights (never assumed from a feed, subscription, purchase,
-- or third-party URL).
create function public.media_admin_asset_update(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
  a media.assets;
  v_fields text[] := array(select jsonb_object_keys(p));
  v_rights media.rights;
begin
  select * into a from media.assets where id = p_id and status <> 'removed' for update;
  if a.id is null then
    raise exception 'File not found.' using errcode = 'P0002';
  end if;
  v_rights := coalesce(nullif(p ->> 'rights', '')::media.rights, a.rights);
  update media.assets
     set title = case when p ? 'title' then left(coalesce(nullif(btrim(p ->> 'title'), ''), title), 160) else title end,
         alt_text = case when p ? 'alt_text' then nullif(left(btrim(p ->> 'alt_text'), 500), '') else alt_text end,
         transcript = case when p ? 'transcript' and kind in ('audio', 'video', 'external_video')
                           then nullif(left(p ->> 'transcript', 200000), '') else transcript end,
         label = case when p ? 'label' and kind = 'captions' then nullif(left(btrim(p ->> 'label'), 60), '') else label end,
         language = case when p ? 'language' and kind = 'captions' then coalesce(nullif(p ->> 'language', ''), language) else language end,
         rights = v_rights,
         source = case when p ? 'source' then nullif(left(btrim(p ->> 'source'), 300), '') else source end,
         attribution = case when p ? 'attribution' then nullif(left(btrim(p ->> 'attribution'), 300), '') else attribution end,
         rights_notes = case when p ? 'rights_notes' then nullif(left(btrim(p ->> 'rights_notes'), 1000), '') else rights_notes end,
         rights_confirmed_at = case when (p ->> 'confirm_rights')::boolean and v_rights <> 'unknown' then now()
                                    when v_rights = 'unknown' or v_rights is distinct from a.rights then null
                                    else rights_confirmed_at end,
         rights_confirmed_by = case when (p ->> 'confirm_rights')::boolean and v_rights <> 'unknown' then v_uid
                                    when v_rights = 'unknown' or v_rights is distinct from a.rights then null
                                    else rights_confirmed_by end,
         public_ok = case when p ? 'public_ok' then coalesce((p ->> 'public_ok')::boolean, false) else public_ok end,
         updated_at = now()
   where id = a.id
  returning * into a;
  if a.public_ok and (a.rights = 'unknown' or a.rights_confirmed_at is null) then
    raise exception 'Confirm the rights for this file before approving it for public use.' using errcode = '22023';
  end if;
  perform media.audit('media.asset_updated', 'media_asset', a.id, jsonb_build_object('fields', v_fields));
  return jsonb_build_object('id', a.id, 'public_ok', a.public_ok, 'rights', a.rights);
end;
$$;

-- Where a file is used (shown before removal or replacement).
create function media.asset_usage(p_asset uuid)
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
  ) x(u);
$$;

create function media.asset_json(a media.assets)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'status', a.status, 'title', a.title, 'path', a.path, 'variant_path', a.variant_path,
    'original_name', a.original_name, 'mime', a.mime, 'size_bytes', a.size_bytes, 'width', a.width, 'height', a.height,
    'duration_seconds', a.duration_seconds, 'duration_source', a.duration_source, 'alt_text', a.alt_text,
    'parent_id', a.parent_id, 'language', a.language, 'label', a.label, 'has_transcript', a.transcript is not null,
    'provider', a.provider, 'provider_ref', a.provider_ref, 'provider_hash', a.provider_hash, 'external_url', a.external_url,
    'public_ok', a.public_ok, 'rights', a.rights, 'source', a.source, 'attribution', a.attribution,
    'rights_notes', a.rights_notes, 'rights_confirmed_at', a.rights_confirmed_at,
    'error', a.error, 'created_at', a.created_at, 'ready_at', a.ready_at, 'replaced_by', a.replaced_by);
$$;

create function public.media_admin_assets(p_kind text, p_status text, p_q text, p_limit integer, p_offset integer)
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
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(media.asset_json(a) || jsonb_build_object('usage_count', jsonb_array_length(media.asset_usage(a.id)))
                       order by a.created_at desc)
        from (select * from media.assets a
               where (p_kind is null or a.kind::text = p_kind)
                 and (case when p_status is null then a.status <> 'removed' else a.status::text = p_status end)
                 and (p_q is null or a.title ilike media.like_pattern(p_q) or a.original_name ilike media.like_pattern(p_q))
                 and a.kind <> 'captions'
               order by a.created_at desc
               limit v_limit offset v_offset) a), '[]'::jsonb),
    'total', (select count(*) from media.assets a
               where (p_kind is null or a.kind::text = p_kind)
                 and (case when p_status is null then a.status <> 'removed' else a.status::text = p_status end)
                 and (p_q is null or a.title ilike media.like_pattern(p_q) or a.original_name ilike media.like_pattern(p_q))
                 and a.kind <> 'captions'));
end;
$$;

create function public.media_admin_asset(p_id uuid)
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
    'created_by', case when a.created_by is not null then community.display_name(a.created_by) end);
end;
$$;

-- Removal: refused while the file is in use. Returns the storage paths for
-- the app to delete (as the same manager), then media_admin_objects_deleted.
create function public.media_admin_asset_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
  a media.assets;
  v_usage jsonb;
  v_paths text[];
begin
  select * into a from media.assets where id = p_id for update;
  if a.id is null or a.status = 'removed' then
    raise exception 'File not found.' using errcode = 'P0002';
  end if;
  v_usage := media.asset_usage(a.id);
  if jsonb_array_length(v_usage) > 0 then
    raise exception 'This file is still used by % item(s). Replace it or remove it from them first.', jsonb_array_length(v_usage) using errcode = '22023';
  end if;
  select array_agg(p) into v_paths from (
    select unnest(array[a.path, a.variant_path, a.upload_path]) p
    union all
    select unnest(array[c.path, c.upload_path]) from media.assets c where c.parent_id = a.id) x where p is not null;
  update media.assets set status = 'removed', removed_at = now(), updated_at = now()
   where id = a.id or (parent_id = a.id and status <> 'removed');
  perform media.audit('media.asset_removed', 'media_asset', a.id, jsonb_build_object('kind', a.kind));
  return jsonb_build_object('paths', coalesce(to_jsonb(v_paths), '[]'::jsonb),
                            'asset_ids', (select jsonb_agg(id) from media.assets where id = a.id or parent_id = a.id));
end;
$$;

-- Safe replacement: every reference moves to the new file in one
-- transaction; the old file is then removed. Public approval is never
-- carried over (the new file needs its own).
create function public.media_admin_asset_replace(p_old uuid, p_new uuid, p_move_captions boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('media.manage');
  o media.assets;
  n media.assets;
  v_paths text[];
begin
  select * into o from media.assets where id = p_old for update;
  select * into n from media.assets where id = p_new for update;
  if o.id is null or n.id is null or o.status = 'removed' then
    raise exception 'File not found.' using errcode = 'P0002';
  end if;
  if n.status <> 'ready' or o.id = n.id then
    raise exception 'Choose a different file that has finished processing.' using errcode = '22023';
  end if;
  if not ((o.kind = n.kind) or (o.kind in ('video', 'external_video') and n.kind in ('video', 'external_video'))) or o.kind = 'captions' then
    raise exception 'A file can only be replaced by the same kind of file.' using errcode = '22023';
  end if;
  -- Attachments: drop duplicates that already point at the new file.
  delete from media.item_media im
   where im.asset_id = o.id
     and exists (select 1 from media.item_media x where x.item_id = im.item_id and x.asset_id = n.id and x.role = im.role);
  update media.item_media set asset_id = n.id where asset_id = o.id;
  update media.items set cover_asset_id = n.id, updated_at = now() where cover_asset_id = o.id;
  update media.shows set artwork_asset_id = n.id, updated_at = now() where artwork_asset_id = o.id;
  update media.series set cover_asset_id = n.id, updated_at = now() where cover_asset_id = o.id;
  if p_move_captions and n.kind in ('audio', 'video') then
    update media.assets set parent_id = n.id, updated_at = now() where parent_id = o.id and status <> 'removed';
  end if;
  select array_agg(p) into v_paths from (
    select unnest(array[o.path, o.variant_path, o.upload_path]) p
    union all
    select unnest(array[c.path, c.upload_path]) from media.assets c where c.parent_id = o.id and c.status <> 'removed') x where p is not null;
  update media.assets set status = 'removed', removed_at = now(), replaced_by = case when id = o.id then n.id end, updated_at = now()
   where id = o.id or (parent_id = o.id and status <> 'removed');
  perform media.audit('media.asset_replaced', 'media_asset', o.id, jsonb_build_object('replacement', n.id, 'kind', o.kind));
  return jsonb_build_object('paths', coalesce(to_jsonb(v_paths), '[]'::jsonb),
                            'asset_ids', (select jsonb_agg(id) from media.assets where id = o.id or parent_id = o.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Usage report and cleanup
-- ---------------------------------------------------------------------------
create function public.media_admin_storage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform media.require_cap('media.manage');
  return jsonb_build_object(
    'quota_mb', (select storage_quota_mb from media.settings),
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('bucket', b, 'objects', n, 'bytes', bytes) order by b)
                           from (select o.bucket_id b, count(*) n, coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0) bytes
                                   from storage.objects o where o.bucket_id in ('media', 'media-uploads') group by o.bucket_id) x), '[]'::jsonb),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', k, 'files', n, 'bytes', bytes) order by k)
                           from (select a.kind::text k, count(*) n, coalesce(sum(a.size_bytes), 0) bytes
                                   from media.assets a where a.status = 'ready' and a.kind <> 'external_video' group by a.kind) x), '[]'::jsonb),
    'gallery', (select jsonb_build_object('photos', count(*), 'bytes', coalesce(sum(size_bytes), 0))
                  from media.photos where status in ('approved', 'hidden', 'pending')));
end;
$$;

-- Candidates for cleanup, for an administrator to review before deleting.
-- Nothing is deleted automatically.
create function public.media_admin_cleanup_candidates()
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
                                  order by o.created_at limit 200) o), '[]'::jsonb));
end;
$$;

-- Records that the app deleted the stored objects for these records.
create function public.media_admin_objects_deleted(p_asset_ids uuid[], p_photo_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  v_assets integer := 0;
  v_photos integer := 0;
begin
  if coalesce(cardinality(p_asset_ids), 0) > 0 then
    perform media.require_cap('media.manage');
    update media.assets
       set status = 'removed', removed_at = coalesce(removed_at, now()), objects_deleted_at = now(), updated_at = now()
     where id = any (p_asset_ids)
       and (status in ('removed', 'failed')
            or (status in ('uploading', 'processing')
                and updated_at < now() - make_interval(hours => (select abandoned_upload_hours from media.settings))));
    get diagnostics v_assets = row_count;
  end if;
  if coalesce(cardinality(p_photo_ids), 0) > 0 then
    if not (public.has_capability('media.manage') or public.has_capability('gallery.moderate')) then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    update media.photos
       set status = case when status in ('uploading', 'processing', 'failed') then 'removed'::media.photo_status else status end,
           original_path = null, review_display_path = null, review_thumb_path = null,
           display_path = case when status in ('rejected', 'removed', 'uploading', 'processing', 'failed') then null else display_path end,
           thumb_path = case when status in ('rejected', 'removed', 'uploading', 'processing', 'failed') then null else thumb_path end,
           objects_deleted_at = now(), updated_at = now()
     where id = any (p_photo_ids)
       and (status in ('rejected', 'removed')
            or (status in ('uploading', 'processing', 'failed')
                and updated_at < now() - make_interval(hours => (select abandoned_upload_hours from media.settings))));
    get diagnostics v_photos = row_count;
  end if;
  if v_assets + v_photos > 0 then
    perform media.audit('media.cleanup', 'media', null, jsonb_build_object('assets', v_assets, 'photos', v_photos));
  end if;
  return jsonb_build_object('assets', v_assets, 'photos', v_photos);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create function public.media_admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s media.settings;
begin
  perform media.require_member();
  if not (media.is_manager() or public.has_capability('gallery.moderate')) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  select * into s from media.settings;
  return to_jsonb(s) - 'id' - 'updated_by';
end;
$$;

-- Library limits need media.manage, gallery limits gallery.moderate, and
-- the feed refresh interval podcasts.manage. Only keys present change.
create function public.media_admin_settings_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  v_keys text[] := array(select jsonb_object_keys(p));
  k text;
begin
  foreach k in array v_keys loop
    if k in ('audio_max_mb', 'video_max_mb', 'document_max_mb', 'image_max_mb', 'storage_quota_mb', 'abandoned_upload_hours') then
      perform media.require_cap('media.manage');
    elsif k in ('gallery_file_mb', 'gallery_batch_max', 'gallery_daily_max', 'gallery_pending_max') then
      perform media.require_cap('gallery.moderate');
    elsif k = 'feed_refresh_minutes' then
      perform media.require_cap('podcasts.manage');
    else
      raise exception 'Unknown setting.' using errcode = '22023';
    end if;
  end loop;
  update media.settings
     set audio_max_mb = coalesce((p ->> 'audio_max_mb')::integer, audio_max_mb),
         video_max_mb = coalesce((p ->> 'video_max_mb')::integer, video_max_mb),
         document_max_mb = coalesce((p ->> 'document_max_mb')::integer, document_max_mb),
         image_max_mb = coalesce((p ->> 'image_max_mb')::integer, image_max_mb),
         storage_quota_mb = coalesce((p ->> 'storage_quota_mb')::integer, storage_quota_mb),
         abandoned_upload_hours = coalesce((p ->> 'abandoned_upload_hours')::integer, abandoned_upload_hours),
         gallery_file_mb = coalesce((p ->> 'gallery_file_mb')::integer, gallery_file_mb),
         gallery_batch_max = coalesce((p ->> 'gallery_batch_max')::integer, gallery_batch_max),
         gallery_daily_max = coalesce((p ->> 'gallery_daily_max')::integer, gallery_daily_max),
         gallery_pending_max = coalesce((p ->> 'gallery_pending_max')::integer, gallery_pending_max),
         feed_refresh_minutes = coalesce((p ->> 'feed_refresh_minutes')::integer, feed_refresh_minutes),
         updated_at = now(), updated_by = v_uid
   where id;
  perform media.audit('media.settings_updated', 'media_settings', null, jsonb_build_object('fields', v_keys));
end;
$$;

-- ---------------------------------------------------------------------------
-- Series, people, and topics
-- ---------------------------------------------------------------------------
create function public.media_admin_taxonomy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform media.require_member();
  if not media.is_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'scope', s.scope, 'title', s.title, 'description', s.description,
                                                            'cover_asset_id', s.cover_asset_id, 'archived', s.archived,
                                                            'items', (select count(*) from media.items i where i.series_id = s.id))
                                         order by s.archived, s.title) from media.series s), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'archived', p.archived,
                                                            'items', (select count(*) from media.item_people ip where ip.person_id = p.id))
                                         order by p.archived, p.name) from media.people p), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
                                                            'items', (select count(*) from media.item_topics it where it.topic_id = t.id))
                                         order by t.name) from media.topics t), '[]'::jsonb));
end;
$$;

create function public.media_admin_series_save(p_id uuid, p_scope text, p_title text, p_description text, p_cover uuid, p_archived boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform media.require_cap('content.edit');
  if p_cover is not null and not exists (select 1 from media.assets where id = p_cover and kind = 'image' and status = 'ready') then
    raise exception 'Choose a ready image for the series cover.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into media.series (scope, title, description, cover_asset_id, archived)
    values (coalesce(p_scope, 'any'), btrim(p_title), coalesce(p_description, ''), p_cover, coalesce(p_archived, false))
    returning id into v_id;
  else
    update media.series
       set scope = coalesce(p_scope, scope), title = btrim(p_title), description = coalesce(p_description, ''),
           cover_asset_id = p_cover, archived = coalesce(p_archived, archived), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Series not found.' using errcode = 'P0002';
    end if;
  end if;
  perform media.audit('media.series_saved', 'media_series', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

create function public.media_admin_person_save(p_id uuid, p_name text, p_archived boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform media.require_cap('content.edit');
  if p_id is null then
    select id into v_id from media.people where lower(btrim(name)) = lower(btrim(p_name));
    if v_id is null then
      insert into media.people (name) values (btrim(p_name)) returning id into v_id;
    end if;
  else
    update media.people set name = btrim(p_name), archived = coalesce(p_archived, archived) where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Person not found.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create function public.media_admin_topic_save(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform media.require_cap('content.edit');
  select id into v_id from media.topics where lower(btrim(name)) = lower(btrim(p_name));
  if v_id is null then
    insert into media.topics (name) values (btrim(p_name)) returning id into v_id;
  end if;
  return v_id;
end;
$$;

create function public.media_admin_topic_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform media.require_cap('content.publish');
  delete from media.topics where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema media from public, anon, authenticated;
revoke execute on function
  public.media_can_read_object(text, text), public.media_can_write_object(text, text), public.media_can_delete_object(text, text),
  public.media_admin_asset_begin(text, text, text, text, bigint, uuid, uuid, text), public.media_admin_asset_processing(uuid),
  public.media_admin_asset_complete(uuid, text, text, text, integer, integer, numeric, text), public.media_admin_asset_fail(uuid, text),
  public.media_admin_external_video_save(uuid, text, text, text, text, text), public.media_admin_asset_update(uuid, jsonb),
  public.media_admin_assets(text, text, text, integer, integer), public.media_admin_asset(uuid), public.media_admin_asset_remove(uuid),
  public.media_admin_asset_replace(uuid, uuid, boolean), public.media_admin_storage(), public.media_admin_cleanup_candidates(),
  public.media_admin_objects_deleted(uuid[], uuid[]), public.media_admin_settings(), public.media_admin_settings_save(jsonb),
  public.media_admin_taxonomy(), public.media_admin_series_save(uuid, text, text, text, uuid, boolean),
  public.media_admin_person_save(uuid, text, boolean), public.media_admin_topic_save(text), public.media_admin_topic_delete(uuid)
from public;

-- Storage policies run as the requesting role (visitors included).
grant execute on function public.media_can_read_object(text, text) to anon, authenticated;
grant execute on function public.media_can_write_object(text, text), public.media_can_delete_object(text, text) to authenticated;

grant execute on function
  public.media_admin_asset_begin(text, text, text, text, bigint, uuid, uuid, text), public.media_admin_asset_processing(uuid),
  public.media_admin_asset_complete(uuid, text, text, text, integer, integer, numeric, text), public.media_admin_asset_fail(uuid, text),
  public.media_admin_external_video_save(uuid, text, text, text, text, text), public.media_admin_asset_update(uuid, jsonb),
  public.media_admin_assets(text, text, text, integer, integer), public.media_admin_asset(uuid), public.media_admin_asset_remove(uuid),
  public.media_admin_asset_replace(uuid, uuid, boolean), public.media_admin_storage(), public.media_admin_cleanup_candidates(),
  public.media_admin_objects_deleted(uuid[], uuid[]), public.media_admin_settings(), public.media_admin_settings_save(jsonb),
  public.media_admin_taxonomy(), public.media_admin_series_save(uuid, text, text, text, uuid, boolean),
  public.media_admin_person_save(uuid, text, boolean), public.media_admin_topic_save(text), public.media_admin_topic_delete(uuid)
to authenticated;
