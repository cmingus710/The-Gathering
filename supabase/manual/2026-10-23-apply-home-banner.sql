-- Home redesign · Apply migration 20261023000100_home_coming_up_banner to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- It applies supabase/migrations/20261023000100_home_coming_up_banner.sql
-- verbatim and records it in the migration history under its repository
-- version. Additive only: new nullable/defaulted columns, two replaced
-- functions (events.occurrence_json, public.can_view_event_image), and three
-- new functions. It changes no existing rows.
--
-- All or nothing: one transaction. A failed run leaves nothing behind and
-- can be rerun; a rerun after success stops at the preflight check.
begin;

do $preflight$
begin
  if to_regclass('events.series') is null or to_regclass('community.groups') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the Phase 5 stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261022000500') then
    raise exception 'Nothing was changed: Phase 5 (20261022000500) is not recorded.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000100') then
    raise exception 'Nothing was changed: 20261023000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261023000100_home_coming_up_banner.sql
-- =========================================================================
-- Home redesign · "Coming up" banner images.
--
-- An event can carry a dedicated homepage banner, separate from its standard
-- cover image, with alternative text and a focal point for responsive
-- cropping. The events settings row holds a church-wide default banner that
-- the home page falls back to. The app's fallback order is:
--   1. the event's homepage banner, 2. its cover image, 3. the church-wide
--   default banner, 4. a branded background drawn in CSS (no image).
--
-- Every banner lives in the existing private "event-images" bucket and is
-- served through short-lived signed URLs:
--   * an event's banner follows the same visibility as its cover (live
--     events whose audience includes the caller, plus event managers);
--   * the church-wide default is readable by approved members (the home page
--     is members-only) and event managers.
-- Uploads stay limited to event managers by the existing bucket policies.
--
-- Banners are written only through the two functions below, never through
-- events_admin_save, so changing a banner doesn't bump the calendar sequence
-- or notify registrants. Paths must sit under the folders the app writes to
-- (home/<series>/… and home-default/…), so a banner can't be pointed at
-- another event's restricted image.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table events.series
  add column home_banner_path text check (char_length(home_banner_path) <= 300),
  add column home_banner_alt text check (char_length(home_banner_alt) <= 300),
  add column home_banner_focus_x smallint not null default 50 check (home_banner_focus_x between 0 and 100),
  add column home_banner_focus_y smallint not null default 50 check (home_banner_focus_y between 0 and 100),
  add constraint series_home_banner_alt
    check (home_banner_path is null or char_length(btrim(coalesce(home_banner_alt, ''))) > 0);

alter table events.settings
  add column home_banner_path text check (char_length(home_banner_path) <= 300),
  add column home_banner_alt text check (char_length(home_banner_alt) <= 300),
  add column home_banner_focus_x smallint not null default 50 check (home_banner_focus_x between 0 and 100),
  add column home_banner_focus_y smallint not null default 50 check (home_banner_focus_y between 0 and 100),
  add constraint settings_home_banner_alt
    check (home_banner_path is null or char_length(btrim(coalesce(home_banner_alt, ''))) > 0);

-- ---------------------------------------------------------------------------
-- One occurrence as JSON: as in 20261021000300, plus 'home_banner'.
-- ---------------------------------------------------------------------------
create or replace function events.occurrence_json(p_occurrence uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'series_id', s.id,
    'occurrence_key', o.occurrence_key,
    'starts_at', o.starts_at,
    'ends_at', o.ends_at,
    'local_date', coalesce(case when o.detached then o.override_date end, o.occurrence_key),
    'status', case when s.status = 'canceled' then 'canceled' else o.status::text end,
    'series_status', s.status,
    'title', s.title,
    'description', s.description,
    'cover_path', s.cover_path,
    'cover_alt', s.cover_alt,
    'home_banner', case when s.home_banner_path is null then null
                        else jsonb_build_object('path', s.home_banner_path, 'alt', s.home_banner_alt,
                                                'focus_x', s.home_banner_focus_x, 'focus_y', s.home_banner_focus_y) end,
    'category', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end,
    'audience', s.audience,
    'timezone', s.timezone,
    'all_day', s.all_day,
    'day_count', s.day_count,
    'location_name', case when po then o.override_location_name else s.location_name end,
    'location_address', case when po then o.override_location_address else s.location_address end,
    'online_url', case when po then o.override_online_url else s.online_url end,
    'organizer_name', s.organizer_name,
    'note', o.note,
    'cancel_reason', coalesce(case when s.status = 'canceled' then s.cancel_reason end, o.cancel_reason),
    'cancellation_instructions', s.cancellation_instructions,
    'rsvp_enabled', s.rsvp_enabled,
    'waitlist_enabled', s.waitlist_enabled,
    'rsvp_closes_at', o.starts_at - make_interval(mins => coalesce(s.rsvp_close_minutes, 0)),
    'spots_left', case when s.capacity is null then null
                       else greatest(s.capacity - (select count(*) from events.registrations x
                                                    where x.occurrence_id = o.id and x.status = 'confirmed'), 0) end,
    'recurring', s.recurrence <> 'none',
    'sequence', s.sequence + o.sequence,
    'updated_at', greatest(s.updated_at, o.updated_at),
    'my_status', r.status,
    'my_position', case when r.status = 'waitlisted' then (
                     select count(*) from events.registrations w
                      where w.occurrence_id = o.id and w.status = 'waitlisted'
                        and (w.queued_at, w.id) <= (r.queued_at, r.id)) end)
  from events.occurrences o
  join events.series s on s.id = o.series_id
  left join events.categories c on c.id = s.category_id
  left join events.registrations r on r.occurrence_id = o.id and r.profile_id = p_viewer
  cross join lateral (select o.detached and (o.override_location_name is not null or o.override_location_address is not null
                              or o.override_online_url is not null) as po) x
  where o.id = p_occurrence;
$$;

-- ---------------------------------------------------------------------------
-- Image visibility: covers and banners follow their event; the church-wide
-- default banner is for approved members. Event managers see everything.
-- ---------------------------------------------------------------------------
create or replace function public.can_view_event_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.has_capability('events.manage'))
      or exists (
        select 1 from events.series s
         where (s.cover_path = p_name or s.home_banner_path = p_name)
           and events.is_live(s.status, s.publish_at)
           and events.audience_allows(s.audience, s.group_id, (select auth.uid())))
      or (exists (select 1 from events.settings st where st.home_banner_path = p_name)
          and (select public.is_approved_member()));
$$;

-- ---------------------------------------------------------------------------
-- Writers (event managers)
-- ---------------------------------------------------------------------------

-- Set, change, or remove (p_path null) an event's homepage banner. Returns the
-- previous path so the app can delete a replaced file.
create function public.events_admin_home_banner_save(p_series uuid, p_path text, p_alt text, p_focus_x integer, p_focus_y integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old events.series;
  v_path text := nullif(btrim(p_path), '');
  v_alt text := nullif(btrim(p_alt), '');
begin
  perform events.require_manager();
  select * into v_old from events.series where id = p_series for update;
  if not found then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  if v_old.status in ('canceled', 'archived') and v_path is not null then
    raise exception 'Canceled or archived events can''t be edited.' using errcode = '22023';
  end if;
  if v_path is not null and v_path is distinct from v_old.home_banner_path
     and v_path !~ ('^home/' || p_series::text || '/[A-Za-z0-9_-]{8,64}\.webp$') then
    raise exception 'That banner image isn''t valid.' using errcode = '22023';
  end if;
  if v_path is not null and v_alt is null then
    raise exception 'Describe the banner image for people using screen readers.' using errcode = '22023';
  end if;
  if p_focus_x is not null and p_focus_x not between 0 and 100 or p_focus_y is not null and p_focus_y not between 0 and 100 then
    raise exception 'Choose a focal point inside the image.' using errcode = '22023';
  end if;

  update events.series
     set home_banner_path = v_path,
         home_banner_alt = case when v_path is null then null else v_alt end,
         home_banner_focus_x = case when v_path is null then 50 else coalesce(p_focus_x, home_banner_focus_x) end,
         home_banner_focus_y = case when v_path is null then 50 else coalesce(p_focus_y, home_banner_focus_y) end
   where id = p_series;
  return jsonb_build_object('previous', v_old.home_banner_path);
end;
$$;

-- Set, change, or remove the church-wide default banner.
create function public.events_admin_default_banner_save(p_path text, p_alt text, p_focus_x integer, p_focus_y integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_path text := nullif(btrim(p_path), '');
  v_alt text := nullif(btrim(p_alt), '');
begin
  perform events.require_manager();
  select home_banner_path into v_old from events.settings where id for update;
  if v_path is not null and v_path is distinct from v_old and v_path !~ '^home-default/[A-Za-z0-9_-]{8,64}\.webp$' then
    raise exception 'That banner image isn''t valid.' using errcode = '22023';
  end if;
  if v_path is not null and v_alt is null then
    raise exception 'Describe the banner image for people using screen readers.' using errcode = '22023';
  end if;
  if p_focus_x is not null and p_focus_x not between 0 and 100 or p_focus_y is not null and p_focus_y not between 0 and 100 then
    raise exception 'Choose a focal point inside the image.' using errcode = '22023';
  end if;

  update events.settings
     set home_banner_path = v_path,
         home_banner_alt = case when v_path is null then null else v_alt end,
         home_banner_focus_x = case when v_path is null then 50 else coalesce(p_focus_x, home_banner_focus_x) end,
         home_banner_focus_y = case when v_path is null then 50 else coalesce(p_focus_y, home_banner_focus_y) end,
         updated_at = now()
   where id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.default_banner_updated', 'event_settings', 'events',
          jsonb_build_object('has_image', v_path is not null, 'replaced', v_old is not null and v_path is distinct from v_old));
  return jsonb_build_object('previous', v_old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reader: the church-wide default, for approved members and event managers.
-- ---------------------------------------------------------------------------
create function public.events_home_banner_default()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.home_banner_path is not null
                   and ((select public.is_approved_member()) or (select public.has_capability('events.manage')))
              then jsonb_build_object('path', s.home_banner_path, 'alt', s.home_banner_alt,
                                      'focus_x', s.home_banner_focus_x, 'focus_y', s.home_banner_focus_y) end
    from events.settings s;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  public.events_admin_home_banner_save(uuid, text, text, integer, integer),
  public.events_admin_default_banner_save(text, text, integer, integer),
  public.events_home_banner_default()
from public, anon;

grant execute on function
  public.events_admin_home_banner_save(uuid, text, text, integer, integer),
  public.events_admin_default_banner_save(text, text, integer, integer),
  public.events_home_banner_default()
to authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261023000100', 'home_coming_up_banner', 'home-redesign');

commit;
