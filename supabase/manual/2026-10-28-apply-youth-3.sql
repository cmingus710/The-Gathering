-- Phase 10 · Step 3 of 9: apply migration 20261028000300_youth_access to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Access helpers, youth event visibility, guards on events and registrations, learning-tool membership for active youth, the private youth bucket and its policies.
--
-- It copies supabase/migrations/20261028000300_youth_access.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-10).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('youth.children') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000200') then
    raise exception 'Nothing was changed: the previous step (20261028000200) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000300') then
    raise exception 'Nothing was changed: 20261028000300 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261028000300_youth_access.sql
-- =========================================================================
-- Phase 10 · Youth ministry and families: access helpers, the adult-only
-- shared checks' youth counterparts, youth event visibility, the learning
-- tools' membership checks, and the private youth bucket. (Split from the
-- schema migration so each operator script stays under the SQL editor's
-- size limit.)
--
-- Every helper here is internal (no client EXECUTE); public functions in the
-- following migrations call them and recheck the caller on every call.

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
-- Someone else's role capability (for assignment, notification, and
-- reviewer checks). Adults only; never implicit for super administrators.
create function youth.holds(p_profile uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      join public.role_capabilities rc on rc.role_key = ur.role_key and rc.capability_key = p_capability
      join public.capabilities c on c.key = rc.capability_key and c.available
     where p.id = p_profile and p.membership_status = 'approved' and p.account_kind = 'adult');
$$;

create function youth.is_adult(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and community.is_member(p_profile);
$$;

create function youth.require_adult()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not youth.is_adult(v_uid) then
    raise exception 'Only approved adult members can do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function youth.require_cap(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  if not public.has_capability(p_capability) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- The child profile linked to an active independent youth account.
create function youth.account_child(p_profile uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
    from youth.children c
    join public.profiles p on p.id = c.account_id
   where c.account_id = p_profile and c.status = 'active' and c.restricted_at is null
     and p.account_kind = 'youth' and p.membership_status = 'approved';
$$;

create function youth.is_active_youth(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and youth.account_child(p_profile) is not null;
$$;

create function youth.require_youth()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not youth.is_active_youth(v_uid) then
    raise exception 'This youth account isn''t active.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function youth.child_active(p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from youth.children c where c.id = p_child and c.status = 'active' and c.restricted_at is null);
$$;

-- A verified guardian of an active, unrestricted child, holding a specific
-- permission (or any permission when p_permission is null).
create function youth.guardian_can(p_child uuid, p_profile uuid, p_permission text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select youth.is_adult(p_profile) and youth.child_active(p_child) and exists (
    select 1 from youth.guardianships g
     where g.child_id = p_child and g.guardian_id = p_profile and g.status = 'verified'
       and (p_permission is null or case p_permission
             when 'manage_profile' then g.can_manage_profile
             when 'register' then g.can_register
             when 'sign_forms' then g.can_sign_forms
             when 'media_consent' then g.can_media_consent
             when 'view_progress' then g.can_view_progress
             when 'practice' then g.can_practice
             when 'manage_account' then g.can_manage_account
             when 'receive_updates' then g.can_receive_updates
             else false
           end));
$$;

create function youth.guardianship_of(p_child uuid, p_profile uuid)
returns youth.guardianships
language sql
stable
security definer
set search_path = ''
as $$
  select * from youth.guardianships g
   where g.child_id = p_child and g.guardian_id = p_profile and g.status = 'verified' limit 1;
$$;

-- An effective leader: an active assignment in an active group, an approved
-- adult, and still holding youth.lead through a role.
create function youth.is_leader(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from youth.group_leaders l join youth.groups g on g.id = l.group_id
     where l.group_id = p_group and l.profile_id = p_profile and l.status = 'active' and g.status = 'active')
     and youth.holds(p_profile, 'youth.lead');
$$;

create function youth.leader_may(p_group uuid, p_profile uuid, p_what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select youth.is_leader(p_group, p_profile) and exists (
    select 1 from youth.group_leaders l
     where l.group_id = p_group and l.profile_id = p_profile and l.status = 'active'
       and case p_what when 'publish' then l.can_publish when 'enroll' then l.can_manage_enrollment else false end);
$$;

create function youth.enrolled(p_group uuid, p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from youth.enrollments e join youth.groups g on g.id = e.group_id
     where e.group_id = p_group and e.child_id = p_child and e.status = 'active' and g.status = 'active');
$$;

-- An active youth account enrolled in the group.
create function youth.youth_in_group(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select youth.enrolled(p_group, youth.account_child(p_profile));
$$;

-- A leader of any group the child is actively enrolled in.
create function youth.leads_child(p_child uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from youth.enrollments e
     where e.child_id = p_child and e.status = 'active' and youth.is_leader(e.group_id, p_profile));
$$;

-- A verified guardian (with the permission) of a child enrolled in the group.
create function youth.guardian_in_group(p_group uuid, p_profile uuid, p_permission text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from youth.enrollments e join youth.guardianships g on g.child_id = e.child_id
     where e.group_id = p_group and e.status = 'active' and g.guardian_id = p_profile and g.status = 'verified'
       and youth.guardian_can(e.child_id, p_profile, p_permission));
$$;

create function youth.audit(p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id::text, coalesce(p_details, '{}'::jsonb));
$$;

create function youth.family_event(p_child uuid, p_guardianship uuid, p_action text, p_from text default null,
                                   p_to text default null, p_fields text[] default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into youth.family_log (child_id, guardianship_id, actor_id, action, from_status, to_status, fields)
  values (p_child, p_guardianship, (select auth.uid()), p_action, p_from, p_to, coalesce(p_fields, '{}'));
$$;

-- Youth event visibility: leaders of the event's group, designated
-- personnel, active youth accounts enrolled in it, and verified guardians
-- (allowed to register) of children enrolled in it.
create function youth.event_visible(p_series uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and exists (
    select 1 from youth.event_settings es join youth.groups g on g.id = es.group_id
     where es.series_id = p_series and g.status = 'active'
       and (youth.is_leader(es.group_id, p_profile)
            or (youth.is_adult(p_profile) and exists (select 1 from youth.event_personnel ep where ep.series_id = p_series and ep.profile_id = p_profile))
            or youth.youth_in_group(es.group_id, p_profile)
            or youth.guardian_in_group(es.group_id, p_profile, 'register')));
$$;

create or replace function events.visible_to(p_series uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from events.series s
     where s.id = p_series
       and events.is_live(s.status, s.publish_at)
       and case when s.audience::text = 'youth' then youth.event_visible(s.id, p_profile)
                else events.audience_allows(s.audience, s.group_id, p_profile) end);
$$;

-- Youth events take registrations per child (youth.registrations), never as
-- adult member RSVPs.
create function youth.block_adult_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'canceled' and exists (
       select 1 from events.occurrences o join events.series s on s.id = o.series_id
        where o.id = new.occurrence_id and s.audience::text = 'youth') then
    raise exception 'Youth events take registrations for each child under Youth & Families.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger registrations_youth_block
  before insert or update of status on events.registrations
  for each row execute function youth.block_adult_registration();

-- The youth audience is set and cleared only through Youth administration,
-- so the general event editor can't silently widen a youth event.
create function youth.guard_series_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.audience::text = 'youth') is distinct from (new.audience::text = 'youth')
     and coalesce(current_setting('youth.context', true), '') <> 'on' then
    raise exception 'A youth event''s audience is changed under Youth administration.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger series_youth_audience
  before update of audience on events.series
  for each row execute function youth.guard_series_audience();

create function youth.guard_series_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.audience::text = 'youth' and coalesce(current_setting('youth.context', true), '') <> 'on' then
    raise exception 'Youth events are set up under Youth administration.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger series_youth_insert
  before insert on events.series
  for each row execute function youth.guard_series_insert();

-- Learning tools admit active youth accounts (owner-only data).
create or replace function bible.is_member(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and (community.is_member(p_profile) or youth.is_active_youth(p_profile));
$$;

create or replace function memory.is_member(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and (community.is_member(p_profile) or youth.is_active_youth(p_profile));
$$;

-- ---------------------------------------------------------------------------
-- Private storage for child avatars
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('youth', 'youth', false, 1048576, array['image/webp'])
on conflict (id) do nothing;

create function youth.avatar_child(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p_name ~ '^avatars/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' then split_part(p_name, '/', 2)::uuid end;
$$;

-- Read: anyone who may see the child (a verified guardian, a leader of one
-- of the child's groups, the youth account itself, a family administrator),
-- and only the child's current avatar.
create function public.youth_can_read_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from youth.children c
     where c.id = youth.avatar_child(p_name) and c.avatar_path = p_name
       and (youth.guardian_can(c.id, (select auth.uid()))
            or youth.leads_child(c.id, (select auth.uid()))
            or (c.account_id = (select auth.uid()) and youth.is_active_youth((select auth.uid())))
            or public.has_capability('family.verify')));
$$;

-- Write: guardians allowed to manage the profile, and family administrators.
create function public.youth_can_write_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select youth.avatar_child(p_name) is not null
     and (youth.guardian_can(youth.avatar_child(p_name), (select auth.uid()), 'manage_profile')
          or (public.has_capability('family.verify') and exists (select 1 from youth.children c where c.id = youth.avatar_child(p_name))));
$$;

create policy "youth avatars read" on storage.objects for select to authenticated
  using (bucket_id = 'youth' and public.youth_can_read_object(name));
create policy "youth avatars insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'youth' and public.youth_can_write_object(name));
create policy "youth avatars delete" on storage.objects for delete to authenticated
  using (bucket_id = 'youth' and public.youth_can_write_object(name));

revoke execute on all functions in schema youth from public, anon, authenticated;
revoke execute on function public.youth_can_read_object(text), public.youth_can_write_object(text) from public, anon;
grant execute on function public.youth_can_read_object(text), public.youth_can_write_object(text) to authenticated;
revoke execute on function public.user_roles_adult_only(), public.profiles_guard_account_kind()
  from public, anon, authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261028000300', 'youth_access', 'phase-10');

commit;
