-- Phase 10 · Youth ministry and families: schema, capabilities, versioned
-- church policy, and the access rules every later function uses.
--
-- One private schema, `youth`, not exposed by the Data API and not readable
-- by anon/authenticated (RLS on, no policies). Everything goes through
-- SECURITY DEFINER functions in public (youth_*, youth_admin_*) that recheck
-- the caller on every call. Every UPDATE/DELETE has a WHERE clause.
--
-- People
--   * A child profile (youth.children) is a record managed by verified
--     guardians. It is NOT a login account and has no email. Its sensitive
--     eligibility data (birth date, notes) sits in youth.child_private and is
--     returned only to family administrators and to the guardians allowed to
--     manage the profile.
--   * Guardianship is a verified relationship (youth.guardianships) created
--     only by a family administrator reviewing a request. Household
--     membership, names, addresses, and email domains never create one.
--   * An independent youth account is an ordinary Supabase Auth account
--     (no separate password storage) linked one-to-one to an existing child
--     profile through an invitation, and only while the approved church
--     policy allows it. profiles.account_kind = 'youth' marks it; it can only
--     be set by the youth functions.
--
-- Fail closed for youth accounts everywhere else
--   Every adult feature already requires an approved *adult* account through
--   community.is_member (community, messages, prayer, care, media, gallery,
--   giving and directory functions). This migration makes the remaining
--   shared checks adult-only too: is_approved_member(), is_super_admin(),
--   has_capability(), and the events "members" audience. A youth account
--   therefore gets nothing outside the youth area unless a function
--   explicitly admits it. The only shared areas that admit active youth
--   accounts are Bible reading/journals and memory verses (owner-only
--   learning tools), through bible.is_member and memory.is_member.
--   Direct messages stay adult-only (community.can_message requires adult
--   members on both sides); no youth function sends one.
--
-- Capabilities (explicit roles only: super administrators do NOT receive
-- youth.* or family.* implicitly, as with finance, prayer, and care):
--   youth.lead          may be assigned to lead specific youth groups
--   youth.manage        youth groups, leader assignments, ministry overview
--   youth.publish       youth announcements and learning for every group
--   youth.enroll        enroll children in youth groups
--   youth.forms         permission forms, youth event settings, personnel
--   youth.logistics     view event logistics (only for events where the
--                       holder is also designated personnel)
--   youth.media_consent photo consent review and photo associations
--   youth.safeguarding  review youth discussion reports, including reports
--                       about leaders (outside that leader's own groups)
--   youth.policy        draft and approve versioned youth policies
--   family.verify       review guardian requests, verify, suspend, revoke
--                       guardianships, child profiles, account activation,
--                       adult transition
-- None of them reaches finance, roles, private journals, practice answers,
-- or confidential prayer and care.

-- ---------------------------------------------------------------------------
-- Capabilities and roles
-- ---------------------------------------------------------------------------
update public.capabilities
   set available = true, description = 'May be assigned to lead specific youth groups'
 where key = 'youth.lead';

insert into public.capabilities (key, description, available) values
  ('youth.manage', 'Manage youth groups and youth leader assignments', true),
  ('youth.publish', 'Publish youth announcements and learning for every youth group', true),
  ('youth.enroll', 'Enroll children in youth groups', true),
  ('youth.forms', 'Manage permission forms, youth event settings, and event personnel', true),
  ('youth.logistics', 'View event logistics for youth events where designated as event personnel', true),
  ('youth.media_consent', 'Review photo consent and associate photos with consent records', true),
  ('youth.safeguarding', 'Review reports about youth discussions, including reports about leaders', true),
  ('youth.policy', 'Draft and approve versioned youth and family policies', true),
  ('family.verify', 'Review guardian requests, verify guardianships, manage child profiles and youth accounts', true);

update public.roles
   set assignable = true,
       description = 'Can be assigned to lead specific youth groups. Sees only the groups they are assigned to; no finance, membership, journal, or confidential care access.'
 where key = 'youth_leader';

insert into public.roles (key, name, description, assignable, sort_order) values
  ('youth_ministry_admin', 'Youth ministry administrator',
   'Manages youth groups, leader assignments, enrollment, youth announcements and learning. No guardian verification, finance, or membership access.', true, 61),
  ('family_admin', 'Family administrator',
   'Reviews guardian requests, verifies and revokes guardianships, manages child profiles, youth account activation, and adult transitions.', true, 62),
  ('youth_forms_admin', 'Permission form administrator',
   'Manages versioned permission forms, youth event settings, and designated event personnel.', true, 63),
  ('youth_event_logistics', 'Youth event logistics',
   'Views emergency contacts and pickup notes for youth events they are designated to staff.', true, 64),
  ('youth_media_reviewer', 'Photo consent reviewer',
   'Reviews photo consent, associates photos with consent records, and resolves consent reviews.', true, 65),
  ('youth_safeguarding', 'Youth safeguarding reviewer',
   'Reviews reports about youth discussions, including reports about leaders.', true, 66),
  ('youth_policy_admin', 'Youth policy administrator',
   'Drafts and approves versioned youth and family policies.', true, 67);

insert into public.role_capabilities (role_key, capability_key) values
  ('youth_ministry_admin', 'youth.manage'),
  ('youth_ministry_admin', 'youth.publish'),
  ('youth_ministry_admin', 'youth.enroll'),
  ('family_admin', 'family.verify'),
  ('youth_forms_admin', 'youth.forms'),
  ('youth_event_logistics', 'youth.logistics'),
  ('youth_media_reviewer', 'youth.media_consent'),
  ('youth_safeguarding', 'youth.safeguarding'),
  ('youth_policy_admin', 'youth.policy');

-- ---------------------------------------------------------------------------
-- Shared checks become adult-only (fail closed for youth accounts)
-- ---------------------------------------------------------------------------
create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.membership_status = 'approved' and p.account_kind = 'adult'
  );
$$;

create or replace function public.is_super_admin()
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
      and p.account_kind = 'adult'
      and ur.role_key = 'super_admin'
  );
$$;

create or replace function public.has_capability(p_capability text)
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
      and p.account_kind = 'adult'
      and (
        (ur.role_key = 'super_admin'
         and p_capability not like 'finance.%'
         and p_capability not like 'prayer.%'
         and p_capability not like 'care.%'
         and p_capability not like 'youth.%'
         and p_capability not like 'family.%')
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

-- The events "members" audience means approved adult members. Youth events
-- (audience 'youth') never pass here; events.visible_to handles them.
create or replace function events.audience_allows(p_audience events.audience, p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_audience::text
    when 'public' then true
    when 'members' then exists (
      select 1 from public.profiles p where p.id = p_profile and p.membership_status = 'approved' and p.account_kind = 'adult')
    when 'group' then exists (
      select 1 from public.profiles p where p.id = p_profile and p.membership_status = 'approved' and p.account_kind = 'adult')
      and events.group_member(p_group, p_profile)
    else false
  end;
$$;

-- Roles are for adults only.
create function public.user_roles_adult_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.account_kind <> 'adult') then
    raise exception 'Roles can only be assigned to adult accounts.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger user_roles_adult_only
  before insert or update on public.user_roles
  for each row execute function public.user_roles_adult_only();

-- ---------------------------------------------------------------------------
-- Youth accounts on profiles
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_youth_accounts_not_enabled;
comment on column public.profiles.account_kind is
  'adult, or youth for an independent youth account linked to a child profile. Set only by the youth functions (Phase 10); youth accounts are refused by every adult-only check.';

-- account_kind changes, and approving a youth account, happen only inside the
-- youth functions, which set the transaction-local flag youth.context.
create function public.profiles_guard_account_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_kind is distinct from old.account_kind
     and coalesce(current_setting('youth.context', true), '') <> 'on' then
    raise exception 'Account type changes only through the youth and family process.' using errcode = '42501';
  end if;
  if new.account_kind = 'youth' and new.membership_status = 'approved' and old.membership_status <> 'approved'
     and coalesce(current_setting('youth.context', true), '') <> 'on' then
    raise exception 'Youth accounts are activated or reinstated under Youth administration.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_account_kind
  before update of account_kind, membership_status on public.profiles
  for each row execute function public.profiles_guard_account_kind();

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
create schema youth;
revoke all on schema youth from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Versioned church policy
-- ---------------------------------------------------------------------------
-- Settings are church decisions. Until a version is approved, every setting
-- takes its safe default (youth.policy_defaults): no independent youth
-- accounts, no youth RSVP, no youth discussions or group prayer, no progress
-- sharing, no public media consent, no adult transition, no automatic
-- deletion. Nothing derives an age threshold: minimum_age_years is null
-- unless the church supplies one.
create table youth.policies (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version between 1 and 100000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  -- The church's own policy wording, shown to guardians, youth, and staff.
  body text not null default '' check (char_length(body) <= 20000),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  -- Where the church approved it (e.g. "Elder board, 2026-11-02"). Required to approve.
  approval_reference text check (char_length(approval_reference) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  retired_at timestamptz,
  constraint policies_approved check ((status = 'draft') = (approved_at is null))
);
create unique index policies_one_approved_idx on youth.policies ((true)) where status = 'approved';
create index policies_created_by_idx on youth.policies (created_by);
create index policies_updated_by_idx on youth.policies (updated_by);
create index policies_approved_by_idx on youth.policies (approved_by);

create function youth.policy_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'independent_accounts', false,
    'eligibility_rule', '',
    'minimum_age_years', null,
    'guardian_authorization_required', true,
    'multiple_guardians', false,
    'birth_date_required', false,
    'youth_rsvp', false,
    'youth_discussions', false,
    'discussion_min_leaders', 2,
    'guardian_discussion_access', 'none',
    'group_prayer', false,
    'progress_sharing', 'off',
    'public_media_consent', false,
    'adult_transition', false,
    'logistics_retention_days', null);
$$;

-- Null when the settings are acceptable; otherwise a member-safe reason.
create function youth.policy_settings_problem(s jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  d jsonb := youth.policy_defaults();
begin
  if s is null or jsonb_typeof(s) <> 'object' then
    return 'Settings must be an object.';
  end if;
  for k in select jsonb_object_keys(s) loop
    if not d ? k then
      return 'Unknown setting: ' || k;
    end if;
  end loop;
  for k in select unnest(array['independent_accounts', 'guardian_authorization_required', 'multiple_guardians', 'birth_date_required',
                               'youth_rsvp', 'youth_discussions', 'group_prayer', 'public_media_consent', 'adult_transition']) loop
    if s ? k and jsonb_typeof(s -> k) <> 'boolean' then
      return k || ' must be yes or no.';
    end if;
  end loop;
  if s ? 'eligibility_rule' and (jsonb_typeof(s -> 'eligibility_rule') <> 'string' or char_length(s ->> 'eligibility_rule') > 2000) then
    return 'The eligibility rule must be text (2000 characters or fewer).';
  end if;
  if s ? 'minimum_age_years' and jsonb_typeof(s -> 'minimum_age_years') <> 'null'
     and (jsonb_typeof(s -> 'minimum_age_years') <> 'number' or (s ->> 'minimum_age_years')::numeric not between 1 and 25
          or (s ->> 'minimum_age_years')::numeric <> trunc((s ->> 'minimum_age_years')::numeric)) then
    return 'The minimum age must be a whole number of years, or left empty.';
  end if;
  if s ? 'discussion_min_leaders' and (jsonb_typeof(s -> 'discussion_min_leaders') <> 'number'
     or (s ->> 'discussion_min_leaders')::numeric not in (1, 2, 3, 4, 5)) then
    return 'Leaders required in a discussion must be 1 to 5.';
  end if;
  if s ? 'guardian_discussion_access' and coalesce(s ->> 'guardian_discussion_access', '') not in ('none', 'read') then
    return 'Guardian access to discussions must be none or read.';
  end if;
  if s ? 'progress_sharing' and coalesce(s ->> 'progress_sharing', '') not in ('off', 'youth_choice') then
    return 'Progress sharing must be off or the youth''s choice.';
  end if;
  if s ? 'logistics_retention_days' and jsonb_typeof(s -> 'logistics_retention_days') <> 'null'
     and (jsonb_typeof(s -> 'logistics_retention_days') <> 'number' or (s ->> 'logistics_retention_days')::numeric not between 7 and 3650) then
    return 'Logistics retention must be 7 to 3650 days, or left empty.';
  end if;
  -- Enabling independent accounts needs the church's written eligibility rule.
  if coalesce((s ->> 'independent_accounts')::boolean, false) and btrim(coalesce(s ->> 'eligibility_rule', '')) = '' then
    return 'Describe who is eligible for an independent youth account before allowing them.';
  end if;
  if coalesce((s ->> 'group_prayer')::boolean, false) and not coalesce((s ->> 'youth_discussions')::boolean, false) then
    return 'Group prayer needs supervised discussions to be allowed.';
  end if;
  return null;
end;
$$;

create function youth.current_policy()
returns youth.policies
language sql
stable
security definer
set search_path = ''
as $$
  select * from youth.policies where status = 'approved' limit 1;
$$;

-- One setting from the approved policy, or its safe default.
create function youth.setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.settings -> p_key from youth.policies p where p.status = 'approved' and p.settings ? p_key),
                  youth.policy_defaults() -> p_key);
$$;

create function youth.flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when jsonb_typeof(v) = 'boolean' then v::boolean end from (select youth.setting(p_key) as v) x), false);
$$;

-- ---------------------------------------------------------------------------
-- Children and guardians
-- ---------------------------------------------------------------------------
create table youth.children (
  id uuid primary key default gen_random_uuid(),
  -- Preferred/display name only. No email, phone, or address.
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  avatar_path text check (avatar_path ~ '^avatars/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  -- Guardian-managed participation in youth activities.
  participation text not null default 'active' check (participation in ('active', 'paused')),
  status text not null default 'active' check (status in ('active', 'transitioned', 'archived')),
  -- Administrative restriction (e.g. a disputed relationship): every
  -- guardian and youth-account path is paused until a family administrator
  -- lifts it.
  restricted_at timestamptz,
  restricted_reason text check (restricted_reason in ('disputed_relationship', 'safeguarding', 'other')),
  -- The independent youth account, when one has been activated.
  account_id uuid unique references public.profiles (id) on delete set null,
  account_linked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint children_restriction check ((restricted_at is null) = (restricted_reason is null)),
  constraint children_avatar_path check (avatar_path is null or avatar_path like 'avatars/' || id::text || '/%')
);
create index children_created_by_idx on youth.children (created_by);
create index children_name_idx on youth.children (lower(display_name));

-- Sensitive eligibility data, separate from every ordinary response.
create table youth.child_private (
  child_id uuid primary key references youth.children (id) on delete cascade,
  birth_date date check (birth_date > date '1900-01-01'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index child_private_updated_by_idx on youth.child_private (updated_by);

-- A family administrator's determination under one policy version.
create table youth.eligibility (
  child_id uuid not null references youth.children (id) on delete cascade,
  policy_id uuid not null references youth.policies (id) on delete restrict,
  independent_account boolean not null,
  determined_by uuid references public.profiles (id) on delete set null,
  determined_at timestamptz not null default now(),
  primary key (child_id, policy_id)
);
create index eligibility_policy_idx on youth.eligibility (policy_id);
create index eligibility_determined_by_idx on youth.eligibility (determined_by);

-- Requests from adults. The requester only ever sees their own request's
-- status; nothing reveals whether a child record already exists.
create table youth.guardian_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('new_child', 'existing_child')),
  child_name text not null check (char_length(btrim(child_name)) between 1 and 60),
  -- Anything that helps staff recognize the child (no documents).
  details text not null default '' check (char_length(details) <= 500),
  relationship text not null check (relationship in ('parent', 'legal_guardian', 'caregiver')),
  birth_date date check (birth_date > date '1900-01-01'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  child_id uuid references youth.children (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint guardian_requests_decided check ((status in ('pending', 'withdrawn')) = (decided_at is null))
);
create index guardian_requests_requester_idx on youth.guardian_requests (requester_id, created_at desc);
create index guardian_requests_status_idx on youth.guardian_requests (status, created_at);
create index guardian_requests_child_idx on youth.guardian_requests (child_id);
create index guardian_requests_decided_by_idx on youth.guardian_requests (decided_by);

-- Per-child, per-capability guardianship. Every permission starts off; the
-- family administrator chooses each one at verification.
create table youth.guardianships (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references youth.children (id) on delete cascade,
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  relationship text not null check (relationship in ('parent', 'legal_guardian', 'caregiver')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'suspended', 'revoked', 'ended')),
  can_manage_profile boolean not null default false,
  can_register boolean not null default false,
  can_sign_forms boolean not null default false,
  can_media_consent boolean not null default false,
  can_view_progress boolean not null default false,
  can_practice boolean not null default false,
  can_manage_account boolean not null default false,
  can_receive_updates boolean not null default false,
  request_id uuid references youth.guardian_requests (id) on delete set null,
  -- Manual verification record: how staff confirmed it, never a document.
  verification_method text check (verification_method in ('in_person', 'known_to_staff', 'church_records', 'other')),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guardianships_verified check (status <> 'verified' or (verified_at is not null and verification_method is not null)),
  constraint guardianships_not_self check (verified_by is null or verified_by <> guardian_id)
);
create unique index guardianships_open_idx on youth.guardianships (child_id, guardian_id)
  where status in ('pending', 'verified', 'suspended');
create index guardianships_guardian_idx on youth.guardianships (guardian_id, status);
create index guardianships_request_idx on youth.guardianships (request_id);
create index guardianships_verified_by_idx on youth.guardianships (verified_by);

-- Family history: actions and state changes only (no names, notes, dates of
-- birth, or other values).
create table youth.family_log (
  id bigint generated always as identity primary key,
  child_id uuid references youth.children (id) on delete cascade,
  guardianship_id uuid references youth.guardianships (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)*$'),
  from_status text,
  to_status text,
  -- Field or permission names only.
  fields text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index family_log_child_idx on youth.family_log (child_id, created_at desc);
create index family_log_guardianship_idx on youth.family_log (guardianship_id);
create index family_log_actor_idx on youth.family_log (actor_id);

-- ---------------------------------------------------------------------------
-- Independent youth accounts
-- ---------------------------------------------------------------------------
create table youth.account_invitations (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references youth.children (id) on delete cascade,
  -- The youth's own login email (verified by Supabase Auth at sign-up).
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  -- SHA-256 of the one-time code; the code itself is shown once and never stored.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'redeemed', 'revoked', 'expired')),
  policy_id uuid not null references youth.policies (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  -- Verified guardian authorization (required when the policy says so).
  guardian_authorized_by uuid references public.profiles (id) on delete set null,
  guardian_authorized_at timestamptz,
  redeemed_by uuid references public.profiles (id) on delete set null,
  redeemed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0)
);
create unique index account_invitations_open_idx on youth.account_invitations (child_id) where status = 'pending';
create index account_invitations_email_idx on youth.account_invitations (email) where status = 'pending';
create index account_invitations_policy_idx on youth.account_invitations (policy_id);
create index account_invitations_created_by_idx on youth.account_invitations (created_by);
create index account_invitations_authorized_by_idx on youth.account_invitations (guardian_authorized_by);
create index account_invitations_redeemed_by_idx on youth.account_invitations (redeemed_by);

-- The record of each activation: which policy version the youth accepted
-- and which guardian authorized it.
create table youth.account_records (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references youth.children (id) on delete cascade,
  account_id uuid references public.profiles (id) on delete set null,
  invitation_id uuid references youth.account_invitations (id) on delete set null,
  policy_id uuid not null references youth.policies (id) on delete restrict,
  youth_accepted_at timestamptz not null default now(),
  guardian_authorized_by uuid references public.profiles (id) on delete set null,
  guardian_authorized_at timestamptz,
  ended_at timestamptz,
  ended_reason text check (ended_reason in ('adult_transition', 'account_deleted', 'unlinked')),
  created_at timestamptz not null default now()
);
create index account_records_child_idx on youth.account_records (child_id);
create index account_records_account_idx on youth.account_records (account_id);
create index account_records_invitation_idx on youth.account_records (invitation_id);
create index account_records_policy_idx on youth.account_records (policy_id);
create index account_records_guardian_idx on youth.account_records (guardian_authorized_by);

-- Explicit, reviewed transition to adult access.
create table youth.transitions (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references youth.children (id) on delete cascade,
  account_id uuid not null references public.profiles (id) on delete cascade,
  policy_id uuid not null references youth.policies (id) on delete restrict,
  status text not null default 'started' check (status in ('started', 'confirmed', 'completed', 'canceled')),
  eligibility_confirmed boolean not null default false,
  identity_confirmed boolean not null default false,
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  youth_confirmed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  canceled_at timestamptz
);
create unique index transitions_open_idx on youth.transitions (child_id) where status in ('started', 'confirmed');
create index transitions_account_idx on youth.transitions (account_id);
create index transitions_policy_idx on youth.transitions (policy_id);
create index transitions_started_by_idx on youth.transitions (started_by);
create index transitions_completed_by_idx on youth.transitions (completed_by);

-- Explicit progress sharing chosen by an independent youth (off by default).
create table youth.progress_sharing (
  child_id uuid primary key references youth.children (id) on delete cascade,
  share_summary boolean not null default false,
  chosen_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Youth groups, leaders, enrollment
-- ---------------------------------------------------------------------------
-- Separate from Phase 5 community groups on purpose: community groups are
-- adult-only (open rosters, join requests, invitations, and direct-message
-- entry points), and none of that may reach children.
create table youth.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint groups_archived check ((status = 'archived') = (archived_at is not null))
);
create index groups_created_by_idx on youth.groups (created_by);

create table youth.group_leaders (
  group_id uuid not null references youth.groups (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'leader' check (role in ('leader', 'helper')),
  can_publish boolean not null default false,
  can_manage_enrollment boolean not null default false,
  status text not null default 'active' check (status in ('active', 'removed')),
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles (id) on delete set null,
  removed_at timestamptz,
  primary key (group_id, profile_id)
);
create index group_leaders_profile_idx on youth.group_leaders (profile_id, status);
create index group_leaders_added_by_idx on youth.group_leaders (added_by);
create index group_leaders_removed_by_idx on youth.group_leaders (removed_by);

create table youth.enrollments (
  group_id uuid not null references youth.groups (id) on delete cascade,
  child_id uuid not null references youth.children (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'left', 'removed')),
  enrolled_by uuid references public.profiles (id) on delete set null,
  enrolled_at timestamptz not null default now(),
  ended_by uuid references public.profiles (id) on delete set null,
  ended_at timestamptz,
  primary key (group_id, child_id)
);
create index enrollments_child_idx on youth.enrollments (child_id, status);
create index enrollments_enrolled_by_idx on youth.enrollments (enrolled_by);
create index enrollments_ended_by_idx on youth.enrollments (ended_by);

-- ---------------------------------------------------------------------------
-- Communication: announcements and supervised discussions
-- ---------------------------------------------------------------------------
create table youth.announcements (
  id uuid primary key default gen_random_uuid(),
  -- null = every youth group.
  group_id uuid references youth.groups (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body text not null default '' check (char_length(body) <= 5000),
  to_youth boolean not null default true,
  to_guardians boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  publish_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notified_at timestamptz,
  constraint announcements_audience check (to_youth or to_guardians),
  constraint announcements_published check (status = 'draft' or publish_at is not null)
);
create index announcements_group_idx on youth.announcements (group_id, status, publish_at desc);
create index announcements_created_by_idx on youth.announcements (created_by);
create index announcements_published_by_idx on youth.announcements (published_by);

create table youth.discussions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references youth.groups (id) on delete cascade,
  kind text not null default 'discussion' check (kind in ('discussion', 'prayer')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  status text not null default 'open' check (status in ('open', 'locked', 'archived')),
  hidden_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_post_at timestamptz
);
create index discussions_group_idx on youth.discussions (group_id, status, last_post_at desc);
create index discussions_created_by_idx on youth.discussions (created_by);

create table youth.posts (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references youth.discussions (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) <= 4000),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'deleted')),
  client_key uuid not null,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  constraint posts_deleted_erased check (status <> 'deleted' or body = ''),
  constraint posts_body check (status = 'deleted' or char_length(btrim(body)) >= 1)
);
create unique index posts_client_key_idx on youth.posts (author_id, client_key);
create index posts_discussion_idx on youth.posts (discussion_id, created_at);
create index posts_hidden_by_idx on youth.posts (hidden_by);

create table youth.reports (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references youth.discussions (id) on delete cascade,
  post_id uuid references youth.posts (id) on delete cascade,
  reporter_id uuid references public.profiles (id) on delete set null,
  -- The person whose content was reported (never shown to the reporter).
  subject_id uuid references public.profiles (id) on delete set null,
  -- Reports about a leader's content are reviewed outside that leader's scope.
  about_leader boolean not null default false,
  reason text not null check (reason in ('unsafe', 'bullying', 'inappropriate', 'private_contact', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  -- Snapshot of the reported item for reviewers (cleared after resolution
  -- per docs/youth-retention.md).
  evidence jsonb,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status_idx on youth.reports (status, created_at);
create index reports_discussion_idx on youth.reports (discussion_id);
create index reports_post_idx on youth.reports (post_id);
create index reports_reporter_idx on youth.reports (reporter_id);
create index reports_subject_idx on youth.reports (subject_id);
create index reports_resolved_by_idx on youth.reports (resolved_by);

create table youth.moderation_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+$'),
  discussion_id uuid references youth.discussions (id) on delete cascade,
  post_id uuid references youth.posts (id) on delete set null,
  report_id uuid references youth.reports (id) on delete set null,
  created_at timestamptz not null default now()
);
create index moderation_log_discussion_idx on youth.moderation_log (discussion_id, created_at desc);
create index moderation_log_actor_idx on youth.moderation_log (actor_id);
create index moderation_log_post_idx on youth.moderation_log (post_id);
create index moderation_log_report_idx on youth.moderation_log (report_id);

-- ---------------------------------------------------------------------------
-- Events: youth settings, permission forms, registrations, logistics
-- ---------------------------------------------------------------------------
create table youth.event_settings (
  series_id uuid primary key references events.series (id) on delete cascade,
  group_id uuid not null references youth.groups (id) on delete restrict,
  -- Independent youth may register themselves (also needs the policy).
  youth_rsvp boolean not null default false,
  collect_emergency_contact boolean not null default false,
  collect_pickup boolean not null default false,
  collect_accommodation boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index event_settings_group_idx on youth.event_settings (group_id);
create index event_settings_updated_by_idx on youth.event_settings (updated_by);

-- Designated event personnel (the only people who see logistics).
create table youth.event_personnel (
  series_id uuid not null references events.series (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (series_id, profile_id)
);
create index event_personnel_profile_idx on youth.event_personnel (profile_id);
create index event_personnel_granted_by_idx on youth.event_personnel (granted_by);

create table youth.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  kind text not null default 'event_permission' check (kind in ('event_permission')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index forms_created_by_idx on youth.forms (created_by);

-- Versioned form text. A published version never changes; a material
-- change publishes a new version and earlier consent no longer satisfies it.
create table youth.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references youth.forms (id) on delete cascade,
  version integer not null check (version between 1 and 10000),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  -- The sentence a guardian agrees to.
  statement text not null check (char_length(btrim(statement)) between 1 and 1000),
  -- false only for wording fixes that don't change what is agreed; earlier
  -- consent then still counts. Defaults to material (renewal required).
  material boolean not null default true,
  change_summary text not null default '' check (char_length(change_summary) <= 500),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid references public.profiles (id) on delete set null,
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (form_id, version),
  constraint form_versions_published check ((status = 'published') = (published_at is not null))
);
create index form_versions_created_by_idx on youth.form_versions (created_by);
create index form_versions_published_by_idx on youth.form_versions (published_by);

create table youth.event_forms (
  series_id uuid not null references events.series (id) on delete cascade,
  form_id uuid not null references youth.forms (id) on delete restrict,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (series_id, form_id)
);
create index event_forms_form_idx on youth.event_forms (form_id);
create index event_forms_added_by_idx on youth.event_forms (added_by);

-- One record per decision. Withdrawal is recorded, never deleted. No IP
-- addresses, user agents, or device fingerprints are stored. A checkbox in
-- the app is a recorded agreement by a verified guardian, not a verified
-- legal signature.
create table youth.consents (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references youth.form_versions (id) on delete restrict,
  form_id uuid not null references youth.forms (id) on delete restrict,
  series_id uuid not null references events.series (id) on delete cascade,
  child_id uuid not null references youth.children (id) on delete cascade,
  guardian_id uuid references public.profiles (id) on delete set null,
  guardianship_id uuid references youth.guardianships (id) on delete set null,
  decision text not null check (decision in ('granted', 'declined')),
  policy_id uuid references youth.policies (id) on delete restrict,
  decided_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles (id) on delete set null
);
create index consents_lookup_idx on youth.consents (series_id, child_id, form_id, decided_at desc);
create index consents_version_idx on youth.consents (form_version_id);
create index consents_form_idx on youth.consents (form_id);
create index consents_child_idx on youth.consents (child_id);
create index consents_guardian_idx on youth.consents (guardian_id);
create index consents_guardianship_idx on youth.consents (guardianship_id);
create index consents_policy_idx on youth.consents (policy_id);
create index consents_withdrawn_by_idx on youth.consents (withdrawn_by);

create table youth.registrations (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references events.occurrences (id) on delete cascade,
  child_id uuid not null references youth.children (id) on delete cascade,
  status text not null check (status in ('confirmed', 'waitlisted', 'canceled')),
  source text not null check (source in ('guardian', 'youth', 'staff')),
  registered_by uuid references public.profiles (id) on delete set null,
  queued_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text check (cancel_reason in ('guardian', 'youth', 'staff', 'consent_withdrawn', 'ineligible')),
  updated_at timestamptz not null default now(),
  unique (occurrence_id, child_id),
  constraint registrations_canceled check ((status = 'canceled') = (canceled_at is not null))
);
create index registrations_child_idx on youth.registrations (child_id, status);
create index registrations_queue_idx on youth.registrations (occurrence_id, status, queued_at, id);
create index registrations_registered_by_idx on youth.registrations (registered_by);

-- Sensitive, event-specific logistics, kept apart from descriptions and
-- rosters. Never in calendar feeds, QR codes, exports, notifications, or the
-- audit log. Not medical records and not pickup authorization.
create table youth.logistics (
  series_id uuid not null references events.series (id) on delete cascade,
  child_id uuid not null references youth.children (id) on delete cascade,
  emergency_name text check (char_length(emergency_name) <= 120),
  emergency_phone text check (char_length(emergency_phone) <= 40),
  pickup_note text check (char_length(pickup_note) <= 500),
  accommodation_note text check (char_length(accommodation_note) <= 500),
  submitted_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (series_id, child_id)
);
create index logistics_child_idx on youth.logistics (child_id);
create index logistics_submitted_by_idx on youth.logistics (submitted_by);

-- Who opened sensitive records (references and counts only, never values).
create table youth.access_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('logistics_view', 'child_private_view', 'report_evidence_view')),
  series_id uuid references events.series (id) on delete set null,
  child_id uuid references youth.children (id) on delete set null,
  report_id uuid references youth.reports (id) on delete set null,
  item_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index access_log_created_idx on youth.access_log (created_at desc);
create index access_log_actor_idx on youth.access_log (actor_id);
create index access_log_series_idx on youth.access_log (series_id);
create index access_log_child_idx on youth.access_log (child_id);
create index access_log_report_idx on youth.access_log (report_id);

-- ---------------------------------------------------------------------------
-- Learning: assignments and guardian-led practice for child profiles
-- ---------------------------------------------------------------------------
create table youth.learning (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references youth.groups (id) on delete cascade,
  kind text not null check (kind in ('memory_collection', 'reading_plan', 'resource')),
  memory_collection_id uuid references memory.collections (id) on delete cascade,
  bible_plan_id uuid references bible.plans (id) on delete cascade,
  media_item_id uuid references media.items (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 300),
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('active', 'archived')),
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint learning_ref check (
    (kind = 'memory_collection') = (memory_collection_id is not null)
    and (kind = 'reading_plan') = (bible_plan_id is not null)
    and (kind = 'resource') = (media_item_id is not null)),
  constraint learning_window check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index learning_group_idx on youth.learning (group_id, status);
create index learning_memory_idx on youth.learning (memory_collection_id);
create index learning_plan_idx on youth.learning (bible_plan_id);
create index learning_media_idx on youth.learning (media_item_id);
create index learning_assigned_by_idx on youth.learning (assigned_by);

-- A child profile's own practice (recorded by a guardian practicing with
-- them). Never mixed with the guardian's own memory.cards. Copied into the
-- youth's memory history if the child later activates an independent account.
create table youth.practice_cards (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references youth.children (id) on delete cascade,
  passage_id uuid not null references memory.passages (id) on delete restrict,
  item_id uuid references memory.items (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'removed')),
  step smallint not null default 0 check (step between 0 and 7),
  due_on date,
  last_scheduled_on date,
  best_step smallint not null default 0 check (best_step between 0 and 7),
  sessions integer not null default 0 check (sessions >= 0),
  last_practiced_at timestamptz,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, passage_id)
);
create index practice_cards_passage_idx on youth.practice_cards (passage_id);
create index practice_cards_item_idx on youth.practice_cards (item_id);
create index practice_cards_added_by_idx on youth.practice_cards (added_by);

create table youth.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references youth.children (id) on delete cascade,
  -- The guardian running the practice (progress belongs to the child).
  operator_id uuid not null references public.profiles (id) on delete cascade,
  card_id uuid not null references youth.practice_cards (id) on delete cascade,
  passage_id uuid not null references memory.passages (id) on delete restrict,
  activity memory.activity not null,
  difficulty memory.difficulty not null,
  segment smallint not null default 0 check (segment between 0 and 200),
  short_segments boolean not null default true,
  token_from integer not null check (token_from >= 0),
  token_to integer not null check (token_to >= token_from),
  setup jsonb not null default '{}'::jsonb check (jsonb_typeof(setup) = 'object'),
  hints integer not null default 0 check (hints between 0 and 1000),
  revealed boolean not null default false,
  status text not null default 'open' check (status in ('open', 'submitted', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  submitted_at timestamptz
);
create index practice_sessions_child_idx on youth.practice_sessions (child_id, created_at desc);
create index practice_sessions_operator_idx on youth.practice_sessions (operator_id);
create index practice_sessions_card_idx on youth.practice_sessions (card_id);
create index practice_sessions_passage_idx on youth.practice_sessions (passage_id);

create table youth.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid unique references youth.practice_sessions (id) on delete set null,
  card_id uuid not null references youth.practice_cards (id) on delete cascade,
  child_id uuid not null references youth.children (id) on delete cascade,
  operator_id uuid references public.profiles (id) on delete set null,
  passage_id uuid not null references memory.passages (id) on delete restrict,
  activity memory.activity not null,
  difficulty memory.difficulty not null,
  segment smallint not null default 0,
  accuracy numeric(4, 3) check (accuracy between 0 and 1),
  hints integer not null default 0 check (hints >= 0),
  confidence text check (confidence in ('not_yet', 'partly', 'mostly', 'fully')),
  quality memory.quality not null,
  step_before smallint not null,
  step_after smallint not null,
  local_date date not null,
  created_at timestamptz not null default now()
);
create index practice_attempts_child_idx on youth.practice_attempts (child_id, local_date);
create index practice_attempts_card_idx on youth.practice_attempts (card_id);
create index practice_attempts_operator_idx on youth.practice_attempts (operator_id);
create index practice_attempts_passage_idx on youth.practice_attempts (passage_id);

-- ---------------------------------------------------------------------------
-- Photo and video consent (extends Phase 7 gallery moderation)
-- ---------------------------------------------------------------------------
create table youth.media_consents (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references youth.children (id) on delete cascade,
  -- member_gallery: approved members/group galleries in the app.
  -- public_use: websites, social media, banners. Separate, off unless the
  -- policy allows recording it, and never implied by member_gallery.
  scope text not null check (scope in ('member_gallery', 'public_use')),
  -- null = general; otherwise a restriction for one event.
  series_id uuid references events.series (id) on delete cascade,
  decision text not null check (decision in ('granted', 'declined')),
  guardian_id uuid references public.profiles (id) on delete set null,
  guardianship_id uuid references youth.guardianships (id) on delete set null,
  policy_id uuid references youth.policies (id) on delete restrict,
  decided_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles (id) on delete set null
);
create index media_consents_child_idx on youth.media_consents (child_id, scope, series_id, decided_at desc);
create index media_consents_series_idx on youth.media_consents (series_id);
create index media_consents_guardian_idx on youth.media_consents (guardian_id);
create index media_consents_guardianship_idx on youth.media_consents (guardianship_id);
create index media_consents_policy_idx on youth.media_consents (policy_id);
create index media_consents_withdrawn_by_idx on youth.media_consents (withdrawn_by);

-- Manual association of a photo with a child (no facial recognition).
create table youth.photo_subjects (
  photo_id uuid not null references media.photos (id) on delete cascade,
  child_id uuid not null references youth.children (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (photo_id, child_id)
);
create index photo_subjects_child_idx on youth.photo_subjects (child_id);
create index photo_subjects_added_by_idx on youth.photo_subjects (added_by);

create table youth.photo_reviews (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references media.photos (id) on delete cascade,
  child_id uuid references youth.children (id) on delete set null,
  reason text not null check (reason in ('consent_withdrawn', 'consent_declined', 'consent_unknown', 'consent_conflict', 'guardian_changed')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  outcome text check (outcome in ('kept_hidden', 'restored', 'removed', 'association_removed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  constraint photo_reviews_resolved check ((status = 'resolved') = (resolved_at is not null and outcome is not null))
);
create unique index photo_reviews_open_idx on youth.photo_reviews (photo_id, child_id) where status = 'open';
create index photo_reviews_status_idx on youth.photo_reviews (status, created_at);
create index photo_reviews_child_idx on youth.photo_reviews (child_id);
create index photo_reviews_resolved_by_idx on youth.photo_reviews (resolved_by);

-- Known copies and public reuse (so a withdrawal can be followed up).
create table youth.media_reuse (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references media.photos (id) on delete cascade,
  kind text not null check (kind in ('derivative', 'public_reuse')),
  location text not null check (char_length(btrim(location)) between 1 and 300),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  removed_at timestamptz
);
create index media_reuse_photo_idx on youth.media_reuse (photo_id);
create index media_reuse_recorded_by_idx on youth.media_reuse (recorded_by);

-- Row-level security on, no policies: only the functions read these tables.
alter table youth.policies enable row level security;
alter table youth.children enable row level security;
alter table youth.child_private enable row level security;
alter table youth.eligibility enable row level security;
alter table youth.guardian_requests enable row level security;
alter table youth.guardianships enable row level security;
alter table youth.family_log enable row level security;
alter table youth.account_invitations enable row level security;
alter table youth.account_records enable row level security;
alter table youth.transitions enable row level security;
alter table youth.progress_sharing enable row level security;
alter table youth.groups enable row level security;
alter table youth.group_leaders enable row level security;
alter table youth.enrollments enable row level security;
alter table youth.announcements enable row level security;
alter table youth.discussions enable row level security;
alter table youth.posts enable row level security;
alter table youth.reports enable row level security;
alter table youth.moderation_log enable row level security;
alter table youth.event_settings enable row level security;
alter table youth.event_personnel enable row level security;
alter table youth.forms enable row level security;
alter table youth.form_versions enable row level security;
alter table youth.event_forms enable row level security;
alter table youth.consents enable row level security;
alter table youth.registrations enable row level security;
alter table youth.logistics enable row level security;
alter table youth.access_log enable row level security;
alter table youth.learning enable row level security;
alter table youth.practice_cards enable row level security;
alter table youth.practice_sessions enable row level security;
alter table youth.practice_attempts enable row level security;
alter table youth.media_consents enable row level security;
alter table youth.photo_subjects enable row level security;
alter table youth.photo_reviews enable row level security;
alter table youth.media_reuse enable row level security;

create trigger children_touch_updated_at before update on youth.children
  for each row execute function public.touch_updated_at();
create trigger guardianships_touch_updated_at before update on youth.guardianships
  for each row execute function public.touch_updated_at();
create trigger groups_touch_updated_at before update on youth.groups
  for each row execute function public.touch_updated_at();
create trigger announcements_touch_updated_at before update on youth.announcements
  for each row execute function public.touch_updated_at();
create trigger discussions_touch_updated_at before update on youth.discussions
  for each row execute function public.touch_updated_at();
create trigger forms_touch_updated_at before update on youth.forms
  for each row execute function public.touch_updated_at();
create trigger policies_touch_updated_at before update on youth.policies
  for each row execute function public.touch_updated_at();

revoke all on all tables in schema youth from public, anon, authenticated;
