-- Phase 2 · Expanded member profiles, directory privacy settings, and
-- ministry interests.
--
-- Design notes
-- * Private directory details live in a separate table,
--   member_profile_details, not in profiles. Phase 1 grants table-level
--   SELECT on profiles to signed-in users (filtered by RLS to the member
--   themselves and members.view holders), and a table-level grant would
--   silently cover any new column. Keeping the new fields in their own table
--   means their read rules are written once, here.
-- * member_profile_details rows are readable only by the member and by
--   members.manage holders. Other members never read this table: the
--   directory reads it through SECURITY DEFINER functions that return only
--   the fields the member has chosen to share (next migration).
-- * Privacy defaults: listed in the directory, photo/city/interests/household
--   shown; contact email, phone, street address, and birthday hidden until
--   the member turns them on.
-- * Youth accounts are not enabled. profiles.account_kind exists so later
--   phases can add guardian-managed accounts, but a constraint keeps every
--   account an adult until that work is reviewed.

-- ---------------------------------------------------------------------------
-- Names and account kind on profiles
-- ---------------------------------------------------------------------------
create type public.account_kind as enum ('adult', 'youth');

alter table public.profiles
  add column first_name text check (char_length(first_name) <= 60),
  add column last_name text check (char_length(last_name) <= 60),
  add column account_kind public.account_kind not null default 'adult',
  add constraint profiles_youth_accounts_not_enabled check (account_kind = 'adult');

comment on column public.profiles.account_kind is
  'Only adult accounts exist. Youth (guardian-managed) accounts are reserved for a later phase and blocked by profiles_youth_accounts_not_enabled.';
comment on table public.profiles is
  'Basic member profile. Private directory details are in member_profile_details.';

-- Keep full_name in step with first/last name once a member uses them.
create function public.profiles_sync_full_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_full text;
begin
  new.first_name := nullif(btrim(new.first_name), '');
  new.last_name := nullif(btrim(new.last_name), '');
  if tg_op = 'INSERT'
     or new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name then
    v_full := btrim(concat_ws(' ', new.first_name, new.last_name));
    if v_full <> '' then
      new.full_name := left(v_full, 120);
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_full_name
  before insert or update of first_name, last_name on public.profiles
  for each row execute function public.profiles_sync_full_name();

create index profiles_directory_sort_idx on public.profiles (lower(coalesce(last_name, full_name)));

grant update (first_name, last_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Private profile details and directory privacy
-- ---------------------------------------------------------------------------
create table public.member_profile_details (
  profile_id uuid primary key references public.profiles (id) on delete cascade,

  -- Directory contact email. Separate from the sign-in email: changing it
  -- never changes how the member signs in.
  contact_email text check (
    contact_email is null
    or (char_length(contact_email) <= 254 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  street_address text check (char_length(street_address) <= 120),
  city text check (char_length(city) <= 80),
  state_region text check (char_length(state_region) <= 40),
  postal_code text check (char_length(postal_code) <= 20),
  bio text check (char_length(bio) <= 500),
  -- Month and day only. No birth year is collected.
  birthday_month smallint check (birthday_month between 1 and 12),
  birthday_day smallint check (birthday_day between 1 and 31),

  -- Object name in the private profile-photos bucket. It must be inside the
  -- member's own folder, so nobody can point their profile at another
  -- member's image.
  photo_path text check (photo_path is null or photo_path ~ ('^' || profile_id::text || '/[A-Za-z0-9_-]{8,64}\.webp$')),
  photo_updated_at timestamptz,

  -- Directory privacy (member-controlled).
  directory_listed boolean not null default true,
  show_photo boolean not null default true,
  show_contact_email boolean not null default false,
  show_phone boolean not null default false,
  show_street_address boolean not null default false,
  show_city_state boolean not null default true,
  show_birthday boolean not null default false,
  show_ministry_interests boolean not null default true,
  show_household boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint member_profile_details_birthday_complete check ((birthday_month is null) = (birthday_day is null)),
  constraint member_profile_details_birthday_valid check (
    birthday_month is null
    or birthday_day <= case when birthday_month = 2 then 29 when birthday_month in (4, 6, 9, 11) then 30 else 31 end
  )
);

comment on table public.member_profile_details is
  'Private directory details and privacy choices. Readable only by the member and members.manage holders; the directory reads it through directory_* functions that drop hidden fields.';

create function public.member_profile_details_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- Empty strings are stored as null so "hidden" and "blank" never differ.
  new.contact_email := nullif(lower(btrim(new.contact_email)), '');
  new.street_address := nullif(btrim(new.street_address), '');
  new.city := nullif(btrim(new.city), '');
  new.state_region := nullif(btrim(new.state_region), '');
  new.postal_code := nullif(btrim(new.postal_code), '');
  new.bio := nullif(btrim(new.bio), '');
  if new.photo_path is distinct from old.photo_path then
    new.photo_updated_at := case when new.photo_path is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger member_profile_details_before_update
  before update on public.member_profile_details
  for each row execute function public.member_profile_details_before_update();

-- Every profile gets a details row with the privacy defaults.
create function public.handle_new_profile_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.member_profile_details (profile_id) values (new.id) on conflict (profile_id) do nothing;
  return new;
end;
$$;

create trigger profiles_create_details
  after insert on public.profiles
  for each row execute function public.handle_new_profile_details();

insert into public.member_profile_details (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- Ministry interests (catalog managed by membership administrators)
-- ---------------------------------------------------------------------------
create table public.ministry_interests (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ministry_interests_label_key on public.ministry_interests (lower(btrim(label)));

create table public.member_ministry_interests (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  interest_id uuid not null references public.ministry_interests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, interest_id)
);

create index member_ministry_interests_interest_idx on public.member_ministry_interests (interest_id);

create function public.ministry_interests_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.label := btrim(new.label);
  new.updated_at := now();
  return new;
end;
$$;

create trigger ministry_interests_before_write
  before insert or update on public.ministry_interests
  for each row execute function public.ministry_interests_before_write();

-- Catalog changes are audited by field name (labels are not personal data,
-- but the audit stays consistent with the rest of the log).
create function public.ministry_interests_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'ministry_interest.created', 'ministry_interest', new.id::text, '{}'::jsonb);
    return new;
  end if;

  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at');

  if cardinality(v_changed) > 0 then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'ministry_interest.updated', 'ministry_interest', new.id::text,
            jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return new;
end;
$$;

create trigger ministry_interests_audit
  after insert or update on public.ministry_interests
  for each row execute function public.ministry_interests_audit();

-- ---------------------------------------------------------------------------
-- Administrative profile correction (members.manage), audited by field name
-- ---------------------------------------------------------------------------
-- Privacy choices are deliberately not editable here: they belong to the
-- member. Membership status and roles keep their own functions.
create function public.admin_update_member_profile(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_phone text,
  p_contact_email text,
  p_street_address text,
  p_city text,
  p_state_region text,
  p_postal_code text,
  p_bio text,
  p_birthday_month integer,
  p_birthday_day integer,
  p_remove_photo boolean default false
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  p public.profiles;
  d public.member_profile_details;
  v_changed text[] := '{}';
begin
  if v_actor is null or not public.has_capability('members.manage') then
    raise exception 'You do not have permission to edit member profiles.' using errcode = '42501';
  end if;

  select * into p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  select * into d from public.member_profile_details where profile_id = p_user_id for update;

  if p_user_id <> v_actor
     and exists (select 1 from public.user_roles where user_id = p_user_id and role_key = 'super_admin')
     and not public.is_super_admin() then
    raise exception 'Only a super administrator can edit the profile of a super administrator.' using errcode = '42501';
  end if;

  p_first_name := nullif(btrim(p_first_name), '');
  p_last_name := nullif(btrim(p_last_name), '');
  p_preferred_name := nullif(btrim(p_preferred_name), '');
  p_phone := nullif(btrim(p_phone), '');
  p_contact_email := nullif(lower(btrim(p_contact_email)), '');
  p_street_address := nullif(btrim(p_street_address), '');
  p_city := nullif(btrim(p_city), '');
  p_state_region := nullif(btrim(p_state_region), '');
  p_postal_code := nullif(btrim(p_postal_code), '');
  p_bio := nullif(btrim(p_bio), '');

  if p_first_name is distinct from p.first_name then v_changed := array_append(v_changed, 'first_name'); end if;
  if p_last_name is distinct from p.last_name then v_changed := array_append(v_changed, 'last_name'); end if;
  if p_preferred_name is distinct from p.preferred_name then v_changed := array_append(v_changed, 'preferred_name'); end if;
  if p_phone is distinct from p.phone then v_changed := array_append(v_changed, 'phone'); end if;
  if p_contact_email is distinct from d.contact_email then v_changed := array_append(v_changed, 'contact_email'); end if;
  if p_street_address is distinct from d.street_address then v_changed := array_append(v_changed, 'street_address'); end if;
  if p_city is distinct from d.city then v_changed := array_append(v_changed, 'city'); end if;
  if p_state_region is distinct from d.state_region then v_changed := array_append(v_changed, 'state_region'); end if;
  if p_postal_code is distinct from d.postal_code then v_changed := array_append(v_changed, 'postal_code'); end if;
  if p_bio is distinct from d.bio then v_changed := array_append(v_changed, 'bio'); end if;
  if p_birthday_month is distinct from d.birthday_month or p_birthday_day is distinct from d.birthday_day then
    v_changed := array_append(v_changed, 'birthday');
  end if;
  if coalesce(p_remove_photo, false) and d.photo_path is not null then
    v_changed := array_append(v_changed, 'photo');
  end if;

  if cardinality(v_changed) = 0 then
    return v_changed;
  end if;

  update public.profiles
     set first_name = p_first_name,
         last_name = p_last_name,
         preferred_name = p_preferred_name,
         phone = p_phone
   where id = p_user_id;

  update public.member_profile_details
     set contact_email = p_contact_email,
         street_address = p_street_address,
         city = p_city,
         state_region = p_state_region,
         postal_code = p_postal_code,
         bio = p_bio,
         birthday_month = p_birthday_month,
         birthday_day = p_birthday_day,
         photo_path = case when coalesce(p_remove_photo, false) then null else photo_path end
   where profile_id = p_user_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_actor, 'profile.admin_updated', 'profile', p_user_id::text,
          jsonb_build_object('fields', to_jsonb(v_changed)));

  return v_changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.member_profile_details enable row level security;
alter table public.ministry_interests enable row level security;
alter table public.member_ministry_interests enable row level security;

create policy "Members read their own profile details"
  on public.member_profile_details for select to authenticated
  using (profile_id = (select auth.uid()));

create policy "Membership managers read profile details"
  on public.member_profile_details for select to authenticated
  using ((select public.has_capability('members.manage')));

-- Column privileges below limit what this can change.
create policy "Approved members update their own profile details"
  on public.member_profile_details for update to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_approved_member()))
  with check (profile_id = (select auth.uid()) and (select public.is_approved_member()));

create policy "Approved members read active ministry interests"
  on public.ministry_interests for select to authenticated
  using ((active and (select public.is_approved_member())) or (select public.has_capability('members.manage')));

create policy "Membership managers add ministry interests"
  on public.ministry_interests for insert to authenticated
  with check ((select public.has_capability('members.manage')));

create policy "Membership managers update ministry interests"
  on public.ministry_interests for update to authenticated
  using ((select public.has_capability('members.manage')))
  with check ((select public.has_capability('members.manage')));

create policy "Members read their own ministry interests"
  on public.member_ministry_interests for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.has_capability('members.manage')));

create policy "Approved members add their own ministry interests"
  on public.member_ministry_interests for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (select public.is_approved_member())
    and exists (select 1 from public.ministry_interests mi where mi.id = interest_id and mi.active)
  );

create policy "Members remove their own ministry interests"
  on public.member_ministry_interests for delete to authenticated
  using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privileges (explicit; hosted defaults are broader)
-- ---------------------------------------------------------------------------
revoke all on public.member_profile_details, public.ministry_interests, public.member_ministry_interests
  from public, anon, authenticated;

grant select on public.member_profile_details to authenticated;
grant update (
  contact_email, street_address, city, state_region, postal_code, bio,
  birthday_month, birthday_day, photo_path,
  directory_listed, show_photo, show_contact_email, show_phone, show_street_address,
  show_city_state, show_birthday, show_ministry_interests, show_household
) on public.member_profile_details to authenticated;

grant select, insert on public.ministry_interests to authenticated;
grant update (label, active, sort_order) on public.ministry_interests to authenticated;

grant select, insert, delete on public.member_ministry_interests to authenticated;

revoke execute on function
  public.profiles_sync_full_name(),
  public.member_profile_details_before_update(),
  public.handle_new_profile_details(),
  public.ministry_interests_before_write(),
  public.ministry_interests_audit()
from public, anon, authenticated, service_role;

revoke execute on function
  public.admin_update_member_profile(uuid, text, text, text, text, text, text, text, text, text, text, integer, integer, boolean)
from public, anon, service_role;
grant execute on function
  public.admin_update_member_profile(uuid, text, text, text, text, text, text, text, text, text, text, integer, integer, boolean)
to authenticated;
