-- Phase 2 · Households (connected adults) and in-app invitations.
--
-- Design notes
-- * A household links adults who have each explicitly agreed to it: the
--   creator, plus anyone who accepts an invitation. Nothing is inferred from
--   names, addresses, or email.
-- * Invitations are in-app only. They are sent to a chosen directory-listed
--   member (never to an email address, so nothing reveals whether an email
--   belongs to a member), expire after 14 days, can be revoked, and can be
--   answered once. No email is sent.
-- * Belonging to a household never grants access to another account and
--   never reveals hidden profile details. The directory shows a household
--   only with each adult's consent (directory_member()).
-- * Household membership does not establish guardianship. guardianships is
--   reserved for guardian-managed youth accounts in a later phase; it has no
--   client access and nothing writes to it yet.
-- * All writes go through SECURITY DEFINER functions; clients have no
--   direct INSERT/UPDATE/DELETE on these tables.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  display_name text check (char_length(display_name) between 1 and 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index households_created_by_idx on public.households (created_by);

-- Adults only (see profiles_youth_accounts_not_enabled). One household per adult.
create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, profile_id)
);

create type public.household_invitation_status as enum ('pending', 'accepted', 'declined', 'revoked', 'expired');

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  status public.household_invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (invited_by is distinct from invitee_id)
);

-- At most one open invitation per person per household.
create unique index household_invitations_one_pending_idx
  on public.household_invitations (household_id, invitee_id) where status = 'pending';
create index household_invitations_invitee_idx on public.household_invitations (invitee_id, status);
create index household_invitations_invited_by_idx on public.household_invitations (invited_by);

-- Reserved for guardian-managed youth accounts (later phase). Not enabled:
-- no policies, no grants, no functions. Household membership alone never
-- creates a row here.
create table public.guardianships (
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  dependent_id uuid not null references public.profiles (id) on delete cascade,
  established_by uuid references public.profiles (id) on delete set null,
  established_at timestamptz not null default now(),
  primary key (guardian_id, dependent_id),
  check (guardian_id <> dependent_id)
);

create index guardianships_dependent_idx on public.guardianships (dependent_id);
create index guardianships_established_by_idx on public.guardianships (established_by);

comment on table public.guardianships is
  'Reserved for guardian-managed youth accounts in a later phase. Not enabled. Household membership does not establish guardianship.';

create trigger households_touch_updated_at
  before update on public.households
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.my_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id from public.household_members where profile_id = (select auth.uid());
$$;

create function public.require_approved_adult()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and membership_status = 'approved' and account_kind = 'adult'
  ) then
    raise exception 'Only approved members can manage households.' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- Lazily marks overdue invitations as expired (no scheduled job needed;
-- every read and response also checks expires_at directly).
create function public.expire_household_invitations()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.household_invitations
     set status = 'expired'
   where status = 'pending' and expires_at <= now();
$$;

-- ---------------------------------------------------------------------------
-- Household operations
-- ---------------------------------------------------------------------------
create function public.household_create(p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_approved_adult();
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('the-gathering:household:' || v_actor::text));
  if exists (select 1 from public.household_members where profile_id = v_actor) then
    raise exception 'You are already in a household.' using errcode = 'P0001';
  end if;

  insert into public.households (display_name, created_by)
  values (nullif(btrim(p_display_name), ''), v_actor)
  returning id into v_id;
  insert into public.household_members (household_id, profile_id) values (v_id, v_actor);
  return v_id;
end;
$$;

create function public.household_rename(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_approved_adult();
  v_household uuid;
begin
  select household_id into v_household from public.household_members where profile_id = v_actor;
  if v_household is null then
    raise exception 'You are not in a household.' using errcode = 'P0002';
  end if;
  update public.households set display_name = nullif(btrim(p_display_name), '') where id = v_household;
end;
$$;

create function public.household_invite(p_invitee uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_approved_adult();
  v_household uuid;
  v_id uuid;
begin
  select household_id into v_household from public.household_members where profile_id = v_actor;
  if v_household is null then
    raise exception 'Create a household before inviting someone.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('the-gathering:household-invite:' || v_household::text));

  -- Only members who appear in the directory can be invited. The same message
  -- covers unknown, hidden, pending, and suspended accounts.
  if p_invitee is null or p_invitee = v_actor or not public.directory_is_listed(p_invitee) then
    raise exception 'That member can''t be invited.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.household_members where household_id = v_household and profile_id = p_invitee) then
    raise exception 'That member is already in your household.' using errcode = 'P0001';
  end if;

  perform public.expire_household_invitations();

  select id into v_id from public.household_invitations
   where household_id = v_household and invitee_id = p_invitee and status = 'pending';
  if v_id is not null then
    return v_id;
  end if;

  if (select count(*) from public.household_invitations where household_id = v_household and status = 'pending') >= 10 then
    raise exception 'Your household has too many open invitations. Revoke one before sending another.' using errcode = 'P0001';
  end if;

  insert into public.household_invitations (household_id, invited_by, invitee_id)
  values (v_household, v_actor, p_invitee)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.household_revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_approved_adult();
begin
  update public.household_invitations
     set status = 'revoked', responded_at = now()
   where id = p_invitation
     and status = 'pending'
     and household_id = (select household_id from public.household_members where profile_id = v_actor);
  if not found then
    raise exception 'That invitation is no longer open.' using errcode = 'P0002';
  end if;
end;
$$;

-- Accept or decline. Each invitation can be answered once, only by its
-- invitee, only before it expires.
create function public.household_respond(p_invitation uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_approved_adult();
  v_inv public.household_invitations;
begin
  perform pg_advisory_xact_lock(hashtext('the-gathering:household:' || v_actor::text));

  select * into v_inv from public.household_invitations where id = p_invitation for update;
  -- Not found, someone else's, or already answered: one message, so ids
  -- can't be probed.
  if not found or v_inv.invitee_id <> v_actor or v_inv.status <> 'pending' then
    raise exception 'This invitation is no longer available.' using errcode = 'P0002';
  end if;
  if v_inv.expires_at <= now() then
    update public.household_invitations set status = 'expired' where id = v_inv.id;
    -- Returned rather than raised, so the expiry is committed.
    return 'expired';
  end if;

  if coalesce(p_accept, false) then
    if exists (select 1 from public.household_members where profile_id = v_actor) then
      raise exception 'Leave your current household before joining another.' using errcode = 'P0001';
    end if;
    insert into public.household_members (household_id, profile_id) values (v_inv.household_id, v_actor);
    update public.household_invitations set status = 'accepted', responded_at = now() where id = v_inv.id;
    return 'accepted';
  end if;
  update public.household_invitations set status = 'declined', responded_at = now() where id = v_inv.id;
  return 'declined';
end;
$$;

create function public.household_leave()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_household uuid;
begin
  -- Leaving is allowed in any membership state: it only removes a connection.
  if v_actor is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('the-gathering:household:' || v_actor::text));

  delete from public.household_members where profile_id = v_actor returning household_id into v_household;
  if v_household is null then
    raise exception 'You are not in a household.' using errcode = 'P0002';
  end if;
  -- The last adult to leave closes the household (and its open invitations).
  if not exists (select 1 from public.household_members where household_id = v_household) then
    delete from public.households where id = v_household;
  end if;
end;
$$;

-- The caller's household with the names of its adults and open invitations.
create function public.my_household()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_approved_adult();
  v_household uuid;
begin
  select household_id into v_household from public.household_members where profile_id = v_actor;
  if v_household is null then
    return null;
  end if;

  return (
    select jsonb_build_object(
      'id', h.id,
      'display_name', h.display_name,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.id,
                 'display_name', public.directory_display_name(p),
                 'is_me', p.id = v_actor,
                 'listed', public.directory_is_listed(p.id))
               order by p.id <> v_actor, lower(p.full_name))
        from public.household_members hm
        join public.profiles p on p.id = hm.profile_id
        where hm.household_id = h.id
          and (p.id = v_actor or p.membership_status = 'approved')
      ), '[]'::jsonb),
      'invitations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', i.id,
                 'invitee_id', i.invitee_id,
                 'invitee_name', public.directory_display_name(p),
                 'expires_at', i.expires_at)
               order by i.created_at)
        from public.household_invitations i
        join public.profiles p on p.id = i.invitee_id
        where i.household_id = h.id and i.status = 'pending' and i.expires_at > now()
      ), '[]'::jsonb)
    )
    from public.households h
    where h.id = v_household
  );
end;
$$;

-- Open invitations addressed to the caller.
create function public.my_household_invitations()
returns table (id uuid, household_name text, invited_by_name text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_approved_adult();
begin
  return query
    select i.id, h.display_name, coalesce(public.directory_display_name(ip), 'A member'), i.expires_at
    from public.household_invitations i
    join public.households h on h.id = i.household_id
    left join public.profiles ip on ip.id = i.invited_by
    where i.invitee_id = v_actor and i.status = 'pending' and i.expires_at > now()
    order by i.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (reads only; writes go through the functions above)
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
alter table public.guardianships enable row level security;

create policy "Members read their own household"
  on public.households for select to authenticated
  using (
    id = (select public.my_household_id())
    or exists (
      select 1 from public.household_invitations i
      where i.household_id = households.id and i.invitee_id = (select auth.uid())
        and i.status = 'pending' and i.expires_at > now()
    )
  );

create policy "Members read their own household's members"
  on public.household_members for select to authenticated
  using (household_id = (select public.my_household_id()));

create policy "Members read invitations they sent or received"
  on public.household_invitations for select to authenticated
  using (invitee_id = (select auth.uid()) or household_id = (select public.my_household_id()));

-- guardianships: no policies, no client access.

revoke all on public.households, public.household_members, public.household_invitations, public.guardianships
  from public, anon, authenticated;
grant select on public.households, public.household_members, public.household_invitations to authenticated;

-- my_household_id() is used inside RLS policies, so signed-in users need it;
-- it only ever returns the caller's own household.
revoke execute on function public.my_household_id() from public, anon, service_role;
grant execute on function public.my_household_id() to authenticated;

revoke execute on function
  public.require_approved_adult(),
  public.expire_household_invitations()
from public, anon, authenticated, service_role;

revoke execute on function
  public.household_create(text),
  public.household_rename(text),
  public.household_invite(uuid),
  public.household_revoke_invitation(uuid),
  public.household_respond(uuid, boolean),
  public.household_leave(),
  public.my_household(),
  public.my_household_invitations()
from public, anon, service_role;
grant execute on function
  public.household_create(text),
  public.household_rename(text),
  public.household_invite(uuid),
  public.household_revoke_invitation(uuid),
  public.household_respond(uuid, boolean),
  public.household_leave(),
  public.my_household(),
  public.my_household_invitations()
to authenticated;
