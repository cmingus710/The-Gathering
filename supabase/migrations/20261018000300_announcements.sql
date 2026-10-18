-- Phase 1 · Announcements.
--
-- Lifecycle: draft → scheduled/published → archived.
-- Visibility is decided by the database clock inside RLS, so a scheduled
-- announcement becomes visible at publish_at and disappears at expires_at
-- without any job, cron, or administrator action.

create type public.announcement_status as enum ('draft', 'scheduled', 'published', 'archived');
create type public.announcement_visibility as enum ('public', 'members');

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  -- Markdown subset; raw HTML is escaped when rendered.
  body text not null default '' check (char_length(body) <= 20000),
  image_path text check (char_length(image_path) <= 300),
  image_alt text check (char_length(image_alt) <= 300),
  status public.announcement_status not null default 'draft',
  visibility public.announcement_visibility not null default 'members',
  pinned boolean not null default false,
  publish_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_publish_at_required
    check (status not in ('scheduled', 'published') or publish_at is not null),
  constraint announcements_expiry_after_publish
    check (expires_at is null or publish_at is null or expires_at > publish_at),
  constraint announcements_image_alt_required
    check (image_path is null or char_length(btrim(coalesce(image_alt, ''))) > 0)
);

create index announcements_live_idx on public.announcements (status, publish_at desc)
  where status in ('scheduled', 'published');
create index announcements_updated_idx on public.announcements (updated_at desc);
create index announcements_created_by_idx on public.announcements (created_by);
create index announcements_updated_by_idx on public.announcements (updated_by);

create function public.announcements_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  -- "Publish now" without an explicit time.
  if new.status = 'published' and new.publish_at is null then
    new.publish_at := now();
  end if;
  return new;
end;
$$;

create trigger announcements_before_write
  before insert or update on public.announcements
  for each row execute function public.announcements_before_write();

create function public.announcements_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_details jsonb;
begin
  -- Record state transitions and which fields changed, never the content itself.
  if tg_op = 'INSERT' then
    v_details := jsonb_build_object('status', new.status, 'visibility', new.visibility);
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'announcement.created', 'announcement', new.id::text, v_details);
  else
    select jsonb_build_object(
             'fields', coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb),
             'status_from', old.status,
             'status_to', new.status)
      into v_details
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'updated_by');

    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values ((select auth.uid()),
            case when old.status is distinct from new.status then 'announcement.status_changed' else 'announcement.updated' end,
            'announcement', new.id::text, v_details);
  end if;
  return new;
end;
$$;

create trigger announcements_audit
  after insert or update on public.announcements
  for each row execute function public.announcements_audit();

alter table public.announcements enable row level security;

create policy "Live announcements are visible to their audience"
  on public.announcements for select to anon, authenticated
  using (
    status in ('scheduled', 'published')
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
    and (visibility = 'public' or (select public.is_approved_member()))
  );

create policy "Announcement managers read all announcements"
  on public.announcements for select to authenticated
  using ((select public.has_capability('announcements.manage')));

create policy "Announcement managers create announcements"
  on public.announcements for insert to authenticated
  with check ((select public.has_capability('announcements.manage')));

create policy "Announcement managers update announcements"
  on public.announcements for update to authenticated
  using ((select public.has_capability('announcements.manage')))
  with check ((select public.has_capability('announcements.manage')));

-- No delete policy: announcements are archived, never deleted, from the app.

revoke all on public.announcements from anon, authenticated;
grant select on public.announcements to anon, authenticated;
grant insert (title, body, image_path, image_alt, status, visibility, pinned, publish_at, expires_at)
  on public.announcements to authenticated;
grant update (title, body, image_path, image_alt, status, visibility, pinned, publish_at, expires_at)
  on public.announcements to authenticated;

revoke execute on function public.announcements_before_write() from public, anon, authenticated;
revoke execute on function public.announcements_audit() from public, anon, authenticated;
