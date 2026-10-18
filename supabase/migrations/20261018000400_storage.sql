-- Phase 1 · Storage buckets and policies.
--
-- branding             public read (logo/icon appear on public pages); write
--                      requires settings.manage.
-- announcement-images  private; an image is readable only by people who can
--                      read an announcement that references it (the subquery
--                      below runs under the caller's announcement RLS), plus
--                      announcement managers. The app serves short-lived
--                      signed URLs.
--
-- Both buckets accept only PNG, JPEG, and WebP. SVG is rejected because it
-- can carry script. The app validates file signatures as well.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('announcement-images', 'announcement-images', false, 4194304, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Settings managers read branding objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'branding' and (select public.has_capability('settings.manage')));

create policy "Settings managers upload branding"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and (select public.has_capability('settings.manage')));

create policy "Settings managers update branding"
  on storage.objects for update to authenticated
  using (bucket_id = 'branding' and (select public.has_capability('settings.manage')))
  with check (bucket_id = 'branding' and (select public.has_capability('settings.manage')));

create policy "Settings managers delete branding"
  on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and (select public.has_capability('settings.manage')));

create policy "Announcement images follow announcement visibility"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'announcement-images'
    and exists (select 1 from public.announcements a where a.image_path = storage.objects.name)
  );

create policy "Announcement managers read announcement images"
  on storage.objects for select to authenticated
  using (bucket_id = 'announcement-images' and (select public.has_capability('announcements.manage')));

create policy "Announcement managers upload announcement images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'announcement-images' and (select public.has_capability('announcements.manage')));

create policy "Announcement managers update announcement images"
  on storage.objects for update to authenticated
  using (bucket_id = 'announcement-images' and (select public.has_capability('announcements.manage')))
  with check (bucket_id = 'announcement-images' and (select public.has_capability('announcements.manage')));

create policy "Announcement managers delete announcement images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'announcement-images' and (select public.has_capability('announcements.manage')));
