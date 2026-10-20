-- Phase 2 · Profile photos (private bucket).
--
-- * profile-photos is private. The app re-encodes every upload on the server
--   (square WebP, metadata stripped) and stores only that copy, so no
--   original image or its EXIF data is kept.
-- * Objects live at "<member id>/<random>.webp". Members can add and remove
--   objects only in their own folder, and only while approved.
-- * A photo can be read (and signed) by its owner, by membership managers,
--   and by approved members only while it is the owner's current photo, the
--   owner is listed in the directory, and the owner shares their photo.
--   Hiding or removing the photo stops new signed URLs at once; URLs issued
--   earlier expire on their own (the app uses 5-minute URLs).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 1048576, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create function public.can_view_profile_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_profile_details d
    where d.photo_path = p_name
      and (
        d.profile_id = (select auth.uid())
        or public.has_capability('members.manage')
        or (d.show_photo and public.is_approved_member() and public.directory_is_listed(d.profile_id))
      )
  );
$$;

revoke execute on function public.can_view_profile_photo(text) from public, anon, service_role;
grant execute on function public.can_view_profile_photo(text) to authenticated;

create policy "Members read their own profile photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Shared profile photos are readable by approved members"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and (select public.can_view_profile_photo(name)));

create policy "Approved members upload their own profile photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_approved_member())
  );

-- No update policy: a replacement is always a new object, so an old signed
-- URL can never start serving a different image.

create policy "Members delete their own profile photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Membership managers read profile photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and (select public.has_capability('members.manage')));

create policy "Membership managers delete profile photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (select public.has_capability('members.manage')));
