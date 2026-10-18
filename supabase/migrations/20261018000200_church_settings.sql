-- Phase 1 · Church settings (single row).
--
-- Contact details, address, gathering times, and social links start empty:
-- nothing is invented. The app shows empty states until an administrator
-- configures them. logo_path / icon_path are null while the approved bundled
-- artwork is in use; they hold storage paths in the "branding" bucket after an
-- authorized replacement.

create table public.church_settings (
  id boolean primary key default true check (id),
  church_name text not null default 'The Gathering' check (char_length(btrim(church_name)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  logo_path text check (char_length(logo_path) <= 300),
  icon_path text check (char_length(icon_path) <= 300),
  contact_email text check (char_length(contact_email) <= 254),
  contact_phone text check (char_length(contact_phone) <= 40),
  address_line1 text check (char_length(address_line1) <= 120),
  address_line2 text check (char_length(address_line2) <= 120),
  city text check (char_length(city) <= 80),
  region text check (char_length(region) <= 80),
  postal_code text check (char_length(postal_code) <= 20),
  country text check (char_length(country) <= 80),
  timezone text not null default 'America/Chicago',
  -- [{ "label": text, "day": "sunday"…"saturday", "time": "HH:MM", "location": text|null }]
  gathering_times jsonb not null default '[]'::jsonb
    check (jsonb_typeof(gathering_times) = 'array' and jsonb_array_length(gathering_times) <= 12),
  -- { "website": url, "facebook": url, "instagram": url, "youtube": url }
  social_links jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.church_settings is 'Single-row church configuration. The colour palette is fixed in shared design tokens, not stored here.';

insert into public.church_settings (id) values (true);

create function public.church_settings_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Rejects unknown time zone names (raises invalid_parameter_value).
  perform now() at time zone new.timezone;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger church_settings_before_update
  before update on public.church_settings
  for each row execute function public.church_settings_before_update();

create function public.church_settings_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'updated_by');

  if cardinality(v_changed) > 0 then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'settings.updated', 'church_settings', null,
            jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return new;
end;
$$;

create trigger church_settings_audit
  after update on public.church_settings
  for each row execute function public.church_settings_audit();

alter table public.church_settings enable row level security;

-- Public information shown on the welcome page.
create policy "Anyone reads church settings"
  on public.church_settings for select to anon, authenticated
  using (true);

create policy "Settings managers update church settings"
  on public.church_settings for update to authenticated
  using ((select public.has_capability('settings.manage')))
  with check ((select public.has_capability('settings.manage')));

revoke all on public.church_settings from anon, authenticated;
grant select on public.church_settings to anon, authenticated;
grant update (
  church_name, description, logo_path, icon_path, contact_email, contact_phone,
  address_line1, address_line2, city, region, postal_code, country, timezone,
  gathering_times, social_links
) on public.church_settings to authenticated;

revoke execute on function public.church_settings_before_update() from public, anon, authenticated;
revoke execute on function public.church_settings_audit() from public, anon, authenticated;
