-- Phase 2 · Member directory (secure projection).
--
-- Members never read other members' profiles or details tables directly.
-- The directory is served only by these SECURITY DEFINER functions, which:
--   * require the caller to be an approved member at the time of the call;
--   * return only approved, adult, directory-listed profiles;
--   * return a field only when its owner has chosen to share it, so hidden
--     values never leave the database (they come back as null);
--   * search only names and, when shared, city — never hidden fields;
--   * never return roles, membership status, sign-in email, or privacy flags.
-- Membership administrators use the admin pages, not the directory, so a
-- member who opts out stays visible to them there.

create function public.directory_display_name(p public.profiles)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.full_name), ''), 'Member');
$$;

-- Whether a profile appears in the directory at all.
create function public.directory_is_listed(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.member_profile_details d on d.profile_id = p.id
    where p.id = p_profile_id
      and p.membership_status = 'approved'
      and p.account_kind = 'adult'
      and d.directory_listed
  );
$$;

create function public.directory_search(p_query text default null, p_limit integer default 24, p_offset integer default 0)
returns table (
  id uuid,
  display_name text,
  full_name text,
  photo_path text,
  city text,
  state_region text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pattern text;
begin
  if not public.is_approved_member() then
    raise exception 'Only approved members can view the directory.' using errcode = '42501';
  end if;

  p_limit := least(greatest(coalesce(p_limit, 24), 1), 50);
  p_offset := least(greatest(coalesce(p_offset, 0), 0), 100000);
  if nullif(btrim(p_query), '') is not null then
    v_pattern := '%' || replace(replace(replace(left(btrim(p_query), 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
    select
      p.id,
      public.directory_display_name(p),
      nullif(btrim(p.full_name), ''),
      case when d.show_photo then d.photo_path end,
      case when d.show_city_state or d.show_street_address then d.city end,
      case when d.show_city_state or d.show_street_address then d.state_region end,
      count(*) over ()
    from public.profiles p
    join public.member_profile_details d on d.profile_id = p.id
    where p.membership_status = 'approved'
      and p.account_kind = 'adult'
      and d.directory_listed
      and (
        v_pattern is null
        or p.full_name ilike v_pattern
        or p.preferred_name ilike v_pattern
        or ((d.show_city_state or d.show_street_address) and d.city ilike v_pattern)
      )
    order by lower(coalesce(p.last_name, p.full_name)), lower(p.full_name), p.id
    limit p_limit offset p_offset;
end;
$$;

create function public.directory_member(p_id uuid)
returns table (
  id uuid,
  display_name text,
  full_name text,
  photo_path text,
  contact_email text,
  phone text,
  street_address text,
  postal_code text,
  city text,
  state_region text,
  birthday_month smallint,
  birthday_day smallint,
  bio text,
  ministry_interests text[],
  household_name text,
  household_members jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_approved_member() then
    raise exception 'Only approved members can view the directory.' using errcode = '42501';
  end if;

  return query
    select
      p.id,
      public.directory_display_name(p),
      nullif(btrim(p.full_name), ''),
      case when d.show_photo then d.photo_path end,
      case when d.show_contact_email then d.contact_email end,
      case when d.show_phone then p.phone end,
      case when d.show_street_address then d.street_address end,
      case when d.show_street_address then d.postal_code end,
      case when d.show_city_state or d.show_street_address then d.city end,
      case when d.show_city_state or d.show_street_address then d.state_region end,
      case when d.show_birthday then d.birthday_month end,
      case when d.show_birthday then d.birthday_day end,
      d.bio,
      case when d.show_ministry_interests then (
        select coalesce(array_agg(mi.label order by mi.sort_order, lower(mi.label)), '{}')
        from public.member_ministry_interests mmi
        join public.ministry_interests mi on mi.id = mmi.interest_id
        where mmi.profile_id = p.id and mi.active
      ) end,
      hh.household_name,
      hh.household_members
    from public.profiles p
    join public.member_profile_details d on d.profile_id = p.id
    -- Household: shown only when this member shares it, and listing only the
    -- other adults who are themselves listed and share their household.
    left join lateral (
      select
        h.display_name as household_name,
        jsonb_agg(jsonb_build_object('id', op.id, 'display_name', public.directory_display_name(op))
                  order by lower(op.full_name)) as household_members
      from public.household_members me
      join public.households h on h.id = me.household_id
      join public.household_members other on other.household_id = me.household_id and other.profile_id <> me.profile_id
      join public.profiles op on op.id = other.profile_id
      join public.member_profile_details od on od.profile_id = op.id
      where me.profile_id = p.id
        and d.show_household
        and op.membership_status = 'approved'
        and op.account_kind = 'adult'
        and od.directory_listed
        and od.show_household
      group by h.display_name
    ) hh on true
    where p.id = p_id
      and p.membership_status = 'approved'
      and p.account_kind = 'adult'
      and d.directory_listed;
end;
$$;

-- The function bodies above reference households, which the next migration
-- creates. PL/pgSQL resolves tables at call time, so this is safe as long as
-- both migrations are applied (they are applied together).

-- Internal helpers: called only from the SECURITY DEFINER functions here and
-- in later migrations, never directly by clients.
revoke execute on function
  public.directory_display_name(public.profiles),
  public.directory_is_listed(uuid)
from public, anon, authenticated, service_role;

revoke execute on function
  public.directory_search(text, integer, integer),
  public.directory_member(uuid)
from public, anon, service_role;
grant execute on function
  public.directory_search(text, integer, integer),
  public.directory_member(uuid)
to authenticated;
