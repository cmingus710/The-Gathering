-- Phase 1 · Identity, membership status, and the capability framework.
--
-- Design notes
-- * Membership status (pending / approved / suspended) is separate from
--   administrative capabilities. Capabilities come only from roles.
-- * Everything is deny-by-default: RLS is enabled on every table, and table
--   privileges are narrowed so clients can only touch the columns they need.
-- * Privileged changes (status, roles, bootstrap) go through SECURITY DEFINER
--   functions that re-check capabilities inside the database and write an
--   audit entry. Members cannot change their own status or roles.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.membership_status as enum ('pending', 'approved', 'suspended');

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user, created automatically on registration)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '' check (char_length(full_name) <= 120),
  preferred_name text check (char_length(preferred_name) <= 60),
  phone text check (char_length(phone) <= 40),
  membership_status public.membership_status not null default 'pending',
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Basic member profile. Directory and household fields arrive in Phase 2.';
comment on column public.profiles.membership_status is 'Changed only through admin_set_membership_status() or bootstrap_super_admin().';

create index profiles_membership_status_idx on public.profiles (membership_status, created_at desc);
create index profiles_email_lower_idx on public.profiles (lower(email));
create index profiles_status_changed_by_idx on public.profiles (status_changed_by);

-- ---------------------------------------------------------------------------
-- Capability framework
-- ---------------------------------------------------------------------------
create table public.capabilities (
  key text primary key check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  description text not null,
  -- false = reserved for a later phase; never granted to anyone but super admins.
  available boolean not null default true
);

create table public.roles (
  key text primary key check (key ~ '^[a-z_]+$'),
  name text not null,
  description text not null,
  -- Only assignable roles are offered in the admin UI and accepted by admin_grant_role().
  assignable boolean not null default false,
  sort_order integer not null default 0
);

create table public.role_capabilities (
  role_key text not null references public.roles (key) on delete cascade,
  capability_key text not null references public.capabilities (key) on delete cascade,
  primary key (role_key, capability_key)
);

create index role_capabilities_capability_idx on public.role_capabilities (capability_key);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_key text not null references public.roles (key) on delete restrict,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_key)
);

create index user_roles_role_idx on public.user_roles (role_key);
create index user_roles_granted_by_idx on public.user_roles (granted_by);

insert into public.capabilities (key, description, available) values
  ('members.view', 'View the member list and member account details', true),
  ('members.manage', 'Approve, suspend, and reinstate members', true),
  ('roles.manage', 'Assign and remove administrative roles', true),
  ('settings.manage', 'Edit church settings and branding', true),
  ('announcements.manage', 'Create, edit, publish, and archive announcements', true),
  ('audit.view', 'View the administrative audit log', true),
  -- Reserved for later phases. Defined now so roles can reference them.
  ('finance.view', 'View contribution records (Phase 3)', false),
  ('finance.manage', 'Manage contributions and giving settings (Phase 3)', false),
  ('groups.lead', 'Lead and manage assigned groups (Phase 5)', false),
  ('youth.lead', 'Lead youth ministry spaces (Phase 10)', false);

insert into public.roles (key, name, description, assignable, sort_order) values
  ('super_admin', 'Super administrator', 'Full access to every administrative capability, including role assignment.', true, 10),
  ('membership_admin', 'Membership administrator', 'Reviews registrations and approves, suspends, or reinstates members.', true, 20),
  ('content_editor', 'Content editor', 'Creates and publishes announcements. No membership or financial access.', true, 30),
  ('finance_admin', 'Finance administrator', 'Manages giving and contributions. Available in Phase 3.', false, 40),
  ('group_leader', 'Group leader', 'Leads community groups. Available in Phase 5.', false, 50),
  ('youth_leader', 'Youth leader', 'Leads youth ministry spaces. Available in Phase 10.', false, 60);

-- super_admin is handled implicitly in has_capability(); it needs no rows here.
insert into public.role_capabilities (role_key, capability_key) values
  ('membership_admin', 'members.view'),
  ('membership_admin', 'members.manage'),
  ('content_editor', 'announcements.manage'),
  ('finance_admin', 'finance.view'),
  ('finance_admin', 'finance.manage'),
  ('group_leader', 'groups.lead'),
  ('youth_leader', 'youth.lead');

-- ---------------------------------------------------------------------------
-- Audit log (written only by trusted functions/triggers)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type text,
  target_id text,
  -- Field names and state transitions only: never passwords, tokens, or message bodies.
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- One-time operational flags (e.g. initial super admin appointment).
create table public.system_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------
create function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.membership_status = 'approved'
  );
$$;

create function public.is_super_admin()
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
    where p.id = (select auth.uid())
      and p.membership_status = 'approved'
      and ur.role_key = 'super_admin'
  );
$$;

-- Deny by default: only approved members holding a role that grants the
-- capability (or super admins) pass. Pending/suspended accounts never pass.
create function public.has_capability(p_capability text)
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
    where p.id = (select auth.uid())
      and p.membership_status = 'approved'
      and (
        ur.role_key = 'super_admin'
        or exists (
          select 1
          from public.role_capabilities rc
          join public.capabilities c on c.key = rc.capability_key
          where rc.role_key = ur.role_key
            and rc.capability_key = p_capability
            and c.available
        )
      )
  );
$$;

-- Capabilities of the signed-in user, for UI decisions (server re-checks every action).
create function public.my_capabilities()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.key
  from public.capabilities c
  where c.available and public.has_capability(c.key)
  order by c.key;
$$;

create function public.active_super_admin_count(p_excluding uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.role_key = 'super_admin'
    and p.membership_status = 'approved'
    and (p_excluding is null or p.id <> p_excluding);
$$;

-- ---------------------------------------------------------------------------
-- Triggers: profile creation, email sync, timestamps, last-super-admin guard
-- ---------------------------------------------------------------------------
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the display name is taken from sign-up metadata. Any other metadata
  -- (e.g. a forged "role" or "membership_status") is ignored.
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 120)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_change();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create function public.guard_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  -- Serialize concurrent changes so two admins cannot remove each other at once.
  perform pg_advisory_xact_lock(hashtext('the-gathering:last-super-admin'));

  if tg_table_name = 'user_roles' then
    if old.role_key <> 'super_admin' then
      return old;
    end if;
    v_user := old.user_id;
    if not exists (select 1 from public.profiles where id = v_user and membership_status = 'approved') then
      return old;
    end if;
  else
    -- profiles: an approved super admin being deleted or leaving the approved state.
    if old.membership_status <> 'approved'
       or (tg_op = 'UPDATE' and new.membership_status = 'approved') then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    v_user := old.id;
    if not exists (select 1 from public.user_roles where user_id = v_user and role_key = 'super_admin') then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
  end if;

  if public.active_super_admin_count(v_user) = 0 then
    raise exception 'The last active super administrator cannot be removed or suspended. Appoint another super administrator first.'
      using errcode = 'P0001', hint = 'last_super_admin';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger user_roles_guard_last_super_admin
  before delete on public.user_roles
  for each row execute function public.guard_last_super_admin();

create trigger profiles_guard_last_super_admin
  before update of membership_status on public.profiles
  for each row execute function public.guard_last_super_admin();

create trigger profiles_guard_last_super_admin_delete
  before delete on public.profiles
  for each row execute function public.guard_last_super_admin();

-- ---------------------------------------------------------------------------
-- Privileged operations
-- ---------------------------------------------------------------------------
create function public.admin_set_membership_status(p_user_id uuid, p_status public.membership_status)
returns public.membership_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.membership_status;
begin
  if v_actor is null or not public.has_capability('members.manage') then
    raise exception 'You do not have permission to change membership status.' using errcode = '42501';
  end if;
  if p_user_id = v_actor then
    raise exception 'You cannot change your own membership status.' using errcode = '42501';
  end if;

  select membership_status into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;

  -- Only super admins may change the status of another super admin.
  if exists (select 1 from public.user_roles where user_id = p_user_id and role_key = 'super_admin')
     and not public.is_super_admin() then
    raise exception 'Only a super administrator can change the status of a super administrator.' using errcode = '42501';
  end if;

  if v_old = p_status then
    return v_old;
  end if;

  update public.profiles
     set membership_status = p_status,
         status_changed_at = now(),
         status_changed_by = v_actor
   where id = p_user_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_actor, 'membership.status_changed', 'profile', p_user_id::text,
          jsonb_build_object('from', v_old, 'to', p_status));

  return p_status;
end;
$$;

create function public.admin_grant_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not public.has_capability('roles.manage') then
    raise exception 'You do not have permission to assign roles.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles where key = p_role and assignable) then
    raise exception 'That role cannot be assigned.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and membership_status = 'approved') then
    raise exception 'Roles can only be assigned to approved members.' using errcode = '22023';
  end if;

  insert into public.user_roles (user_id, role_key, granted_by)
  values (p_user_id, p_role, v_actor)
  on conflict (user_id, role_key) do nothing;

  if found then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (v_actor, 'role.granted', 'profile', p_user_id::text, jsonb_build_object('role', p_role));
  end if;
end;
$$;

create function public.admin_revoke_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not public.has_capability('roles.manage') then
    raise exception 'You do not have permission to remove roles.' using errcode = '42501';
  end if;

  delete from public.user_roles where user_id = p_user_id and role_key = p_role;

  if found then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (v_actor, 'role.revoked', 'profile', p_user_id::text, jsonb_build_object('role', p_role));
  end if;
end;
$$;

-- One-time appointment of the first super administrator. Callable only with
-- the service role (server-side script or the Supabase SQL editor), and only
-- until the first appointment has been recorded.
create function public.bootstrap_super_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform pg_advisory_xact_lock(hashtext('the-gathering:bootstrap-super-admin'));

  if exists (select 1 from public.system_state where key = 'initial_super_admin')
     or exists (select 1 from public.user_roles where role_key = 'super_admin') then
    raise exception 'The initial super administrator has already been appointed. Manage roles from the admin area.'
      using errcode = '42501';
  end if;

  select p.id into v_user
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.email) = lower(btrim(p_email))
    and u.email_confirmed_at is not null;

  if v_user is null then
    raise exception 'No verified account exists for that email. Register and verify the email address first.'
      using errcode = 'P0002';
  end if;

  update public.profiles
     set membership_status = 'approved', status_changed_at = now()
   where id = v_user;

  insert into public.user_roles (user_id, role_key) values (v_user, 'super_admin');

  insert into public.system_state (key, value)
  values ('initial_super_admin', jsonb_build_object('user_id', v_user, 'appointed_at', now()));

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (null, 'bootstrap.super_admin_appointed', 'profile', v_user::text, '{}'::jsonb);

  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.capabilities enable row level security;
alter table public.roles enable row level security;
alter table public.role_capabilities enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;
alter table public.system_state enable row level security;

create policy "Members read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Member viewers read all profiles"
  on public.profiles for select to authenticated
  using ((select public.has_capability('members.view')));

-- Column privileges below restrict which fields this can touch.
create policy "Members update their own basic profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Signed-in users read the capability catalog"
  on public.capabilities for select to authenticated using (true);

create policy "Signed-in users read the role catalog"
  on public.roles for select to authenticated using (true);

create policy "Signed-in users read role capabilities"
  on public.role_capabilities for select to authenticated using (true);

create policy "Users read their own roles"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Member viewers and role managers read all roles"
  on public.user_roles for select to authenticated
  using ((select public.has_capability('members.view')) or (select public.has_capability('roles.manage')));

create policy "Audit viewers read the audit log"
  on public.audit_log for select to authenticated
  using ((select public.has_capability('audit.view')));

-- system_state has no policies: no client access at all.

-- ---------------------------------------------------------------------------
-- Privileges (narrower than Supabase defaults)
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.capabilities, public.roles, public.role_capabilities,
  public.user_roles, public.audit_log, public.system_state from anon, authenticated;

grant select on public.profiles, public.capabilities, public.roles, public.role_capabilities,
  public.user_roles, public.audit_log to authenticated;
grant update (full_name, preferred_name, phone) on public.profiles to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.bootstrap_super_admin(text) from authenticated;
revoke execute on function public.handle_new_auth_user() from authenticated;
revoke execute on function public.handle_auth_user_email_change() from authenticated;
revoke execute on function public.guard_last_super_admin() from authenticated;
grant execute on function public.bootstrap_super_admin(text) to service_role;
grant execute on function
  public.is_approved_member(),
  public.is_super_admin(),
  public.has_capability(text),
  public.my_capabilities(),
  public.active_super_admin_count(uuid),
  public.admin_set_membership_status(uuid, public.membership_status),
  public.admin_grant_role(uuid, text),
  public.admin_revoke_role(uuid, text)
to authenticated;
-- Anonymous visitors need these only inside RLS policy evaluation.
grant execute on function public.is_approved_member(), public.has_capability(text) to anon;
