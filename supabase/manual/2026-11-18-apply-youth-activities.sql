-- Learn & Play activities · Apply migration 20261118000100_youth_activities
-- to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "Learn & Play
-- activities"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: a new capability and role (youth.activities, "Youth activity
-- editor", assigned to nobody), five new tables in the private youth schema,
-- new youth_* / youth_admin_* functions, and two replaced functions with the
-- same signatures: public.youth_can_read_object / youth_can_write_object
-- (the youth bucket's storage checks, extended for activity artwork; the
-- avatar rules are unchanged) and public.youth_me (adds youth.activities to
-- the capability list it reports). No existing table, row, grant, or
-- storage policy is changed.
--
-- It copies supabase/migrations/20261118000100_youth_activities.sql verbatim
-- and records it under its repository version (created_by =
-- youth-activities). All or nothing: one transaction; out of order or a
-- second run stops at the preflight with "Nothing was changed".
-- It needs the youth steps (20261028000200 through 20261028001000).
begin;

do $preflight$
begin
  if to_regclass('youth.children') is null or to_regclass('youth.groups') is null
     or to_regprocedure('youth.guardian_can(uuid, uuid, text)') is null
     or to_regprocedure('public.youth_can_read_object(text)') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261028001000') then
    raise exception 'Nothing was changed: the youth steps (through 20261028001000) are not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261118000100')
     or to_regclass('youth.activities') is not null then
    raise exception 'Nothing was changed: 20261118000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261118000100_youth_activities.sql
-- =========================================================================
-- Youth & Families · Learn & Play: the activity foundation.
--
-- What this adds
--   * youth.activities: one stable id per activity, its lifecycle state
--     (draft → preview → published → archived), an availability window, and
--     the id of the version members currently see.
--   * youth.activity_versions: the content (title, description, type,
--     difficulty, suggested ages, Bible story, Scripture references, lesson
--     connection, cover, source and permission notes, and a data-only
--     configuration reserved for the activity players). A published version
--     is immutable; editing a published activity makes a new draft version.
--   * youth.activity_assets: artwork uploaded in the editor, with its text
--     description and where it came from (original, licensed, public domain,
--     used with permission) plus the editor's rights confirmation.
--   * youth.activity_groups: optional group assignment (no groups = every
--     active child; otherwise only children enrolled in one of them).
--   * youth.activity_progress: private progress, always on a child profile
--     and on the exact version it was made against. Never on an adult's
--     profile, journal, or memory history.
--
-- Access
--   * New capability youth.activities (role "Youth activity editor"): create,
--     edit, preview, publish, archive, upload artwork. Explicit role only:
--     public.has_capability never gives youth.* to super administrators.
--     It opens no child records, rosters, or progress.
--   * A "player" is a child profile someone may play for:
--       - an active independent youth account plays for its own child;
--       - a verified guardian holding the *practice* permission plays for a
--         child profile that has no independent account. (Once a child has
--         their own account, their progress is theirs; guardians see only
--         the summary the youth chooses to share, as for memory practice.)
--     The child must be active, unrestricted, and participating.
--   * A member sees an activity only when it is published, inside its
--     availability window, and open to at least one of their players (its
--     groups, if any, include one of that child's active enrollments).
--   * Progress is returned only to the child's own youth account and to
--     guardians who may currently play for that child, checked on every call.
--     Guardians with *see learning progress* get counts only (for an
--     independent youth, only when the youth shares). Leaders and staff get
--     no individual progress, answers, or artwork.
--   * No public profiles, rankings, messaging, notifications, or sharing.
--
-- Versions and progress
--   Progress rows point at a version and are never moved. When a new version
--   is published, earlier progress stays attached (read-only) to the version
--   it was made on, the version itself is kept (on delete restrict), and the
--   child starts the new version fresh. Saves name the version and the
--   revision they were based on, so a save from a stale page (an older
--   version, or another tab or device) is refused rather than overwriting.
--
-- Storage
--   Artwork lives in the existing private `youth` bucket (WebP only, 1 MB)
--   under activities/<activity id>/<asset id>.webp, re-encoded on the server.
--   The storage policies' read and write checks are extended: staff with
--   youth.activities read and write activity artwork; members read only the
--   cover of a published version of an activity open to them.

-- ---------------------------------------------------------------------------
-- Capability and role
-- ---------------------------------------------------------------------------
insert into public.capabilities (key, description, available) values
  ('youth.activities', 'Create, edit, preview, publish, and archive Learn & Play activities and their artwork', true);

insert into public.roles (key, name, description, assignable, sort_order) values
  ('youth_activity_editor', 'Youth activity editor',
   'Creates, previews, publishes, and archives Learn & Play activities and uploads their artwork. No child records, rosters, progress, or guardian access.', true, 68);

insert into public.role_capabilities (role_key, capability_key) values
  ('youth_activity_editor', 'youth.activities');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table youth.activities (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft', 'preview', 'published', 'archived')),
  -- The version members see while the activity is published (kept when archived).
  published_version_id uuid,
  available_from timestamptz,
  available_until timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  first_published_at timestamptz,
  archived_at timestamptz,
  constraint activities_window check (available_until is null or available_from is null or available_until > available_from),
  constraint activities_published check (status <> 'published' or published_version_id is not null),
  constraint activities_archived check ((status = 'archived') = (archived_at is not null))
);
create index activities_status_idx on youth.activities (status);
create index activities_created_by_idx on youth.activities (created_by);
create index activities_updated_by_idx on youth.activities (updated_by);
create index activities_published_version_idx on youth.activities (published_version_id);

create table youth.activity_assets (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references youth.activities (id) on delete cascade,
  path text not null unique check (path ~ '^activities/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  status text not null default 'pending' check (status in ('pending', 'active', 'removed')),
  width integer check (width between 1 and 4096),
  height integer check (height between 1 and 4096),
  bytes integer check (bytes between 1 and 1048576),
  -- The text description for this artwork (a version can override it).
  alt text not null default '' check (char_length(alt) <= 300),
  source_kind text not null check (source_kind in ('original', 'licensed', 'public_domain', 'permission')),
  -- Who made it / where it came from, and the license or permission terms.
  source_credit text not null default '' check (char_length(source_credit) <= 300),
  license text not null default '' check (char_length(license) <= 300),
  source_url text check (source_url is null or (source_url ~ '^https://[^\s<>"]+$' and char_length(source_url) <= 500)),
  rights_confirmed_by uuid references public.profiles (id) on delete set null,
  rights_confirmed_at timestamptz not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint activity_assets_path check (path like 'activities/' || activity_id::text || '/' || id::text || '.webp'),
  constraint activity_assets_ready check (status = 'pending' or (width is not null and height is not null and bytes is not null)),
  constraint activity_assets_source check (source_kind = 'original' or char_length(btrim(source_credit)) > 0)
);
create index activity_assets_activity_idx on youth.activity_assets (activity_id, status);
create index activity_assets_uploaded_by_idx on youth.activity_assets (uploaded_by);
create index activity_assets_rights_by_idx on youth.activity_assets (rights_confirmed_by);

create table youth.activity_versions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references youth.activities (id) on delete cascade,
  version integer not null check (version >= 1),
  state text not null default 'draft' check (state in ('draft', 'preview', 'published', 'retired')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  -- Card text (plain), and the longer description (Markdown subset, rendered with raw HTML escaped).
  summary text not null default '' check (char_length(summary) <= 300),
  description text not null default '' check (char_length(description) <= 8000),
  kind text not null check (kind in ('story', 'quiz', 'matching', 'puzzle', 'drawing', 'word_game')),
  difficulty text not null check (difficulty in ('beginner', 'growing', 'challenge')),
  -- Suggested ages only: shown as guidance, never used to refuse anyone.
  age_min smallint check (age_min between 2 and 18),
  age_max smallint check (age_max between 2 and 18),
  bible_story text not null default '' check (char_length(bible_story) <= 160),
  scripture_refs text[] not null default '{}' check (cardinality(scripture_refs) <= 10),
  lesson_title text not null default '' check (char_length(lesson_title) <= 160),
  -- Any date in the week of the lesson this connects to ("This Week's Lesson").
  lesson_week date,
  cover_asset_id uuid references youth.activity_assets (id) on delete restrict,
  cover_alt text not null default '' check (char_length(cover_alt) <= 300),
  cover_decorative boolean not null default false,
  -- Where the written content came from, and permission to use it.
  content_source text not null default 'original' check (content_source in ('original', 'adapted', 'licensed', 'public_domain', 'permission')),
  content_credit text not null default '' check (char_length(content_credit) <= 500),
  -- Data only, for the activity players shipped with the app (never code).
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 65536),
  change_note text not null default '' check (char_length(change_note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  retired_at timestamptz,
  unique (activity_id, version),
  constraint activity_versions_ages check (age_max is null or age_min is null or age_max >= age_min),
  constraint activity_versions_published check ((state in ('published', 'retired')) = (published_at is not null)),
  constraint activity_versions_credit check (content_source = 'original' or char_length(btrim(content_credit)) > 0)
);
create unique index activity_versions_one_draft_idx on youth.activity_versions (activity_id) where state in ('draft', 'preview');
create unique index activity_versions_one_published_idx on youth.activity_versions (activity_id) where state = 'published';
create index activity_versions_cover_idx on youth.activity_versions (cover_asset_id);
create index activity_versions_created_by_idx on youth.activity_versions (created_by);
create index activity_versions_updated_by_idx on youth.activity_versions (updated_by);
create index activity_versions_published_by_idx on youth.activity_versions (published_by);
create index activity_versions_week_idx on youth.activity_versions (lesson_week) where state = 'published';

alter table youth.activities
  add constraint activities_published_version_fk foreign key (published_version_id)
  references youth.activity_versions (id) on delete restrict;

create table youth.activity_groups (
  activity_id uuid not null references youth.activities (id) on delete cascade,
  group_id uuid not null references youth.groups (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (activity_id, group_id)
);
create index activity_groups_group_idx on youth.activity_groups (group_id);
create index activity_groups_added_by_idx on youth.activity_groups (added_by);

create table youth.activity_progress (
  id uuid primary key default gen_random_uuid(),
  -- Always a child profile: never an adult's profile.
  child_id uuid not null references youth.children (id) on delete cascade,
  activity_id uuid not null references youth.activities (id) on delete cascade,
  -- The exact content version; never moved to a later one.
  version_id uuid not null references youth.activity_versions (id) on delete restrict,
  status text not null default 'started' check (status in ('started', 'completed')),
  -- The child's private answers and work, as data for the activity player.
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 32768),
  -- Bumped on every save; a save must name the revision it was based on.
  revision integer not null default 1 check (revision >= 1),
  -- Who was at the device: the youth account or the guardian playing with the child.
  last_operator_id uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (child_id, version_id),
  constraint activity_progress_completed check ((status = 'completed') = (completed_at is not null))
);
create index activity_progress_child_idx on youth.activity_progress (child_id, activity_id);
create index activity_progress_activity_idx on youth.activity_progress (activity_id);
create index activity_progress_version_idx on youth.activity_progress (version_id);
create index activity_progress_operator_idx on youth.activity_progress (last_operator_id);

alter table youth.activities enable row level security;
alter table youth.activity_assets enable row level security;
alter table youth.activity_versions enable row level security;
alter table youth.activity_groups enable row level security;
alter table youth.activity_progress enable row level security;
revoke all on youth.activities, youth.activity_assets, youth.activity_versions, youth.activity_groups, youth.activity_progress
  from public, anon, authenticated;

create trigger activities_touch_updated_at before update on youth.activities
  for each row execute function public.touch_updated_at();
create trigger activity_versions_touch_updated_at before update on youth.activity_versions
  for each row execute function public.touch_updated_at();

-- A published (or retired) version never changes, except to retire it.
create function youth.guard_activity_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state in ('published', 'retired') then
    if tg_op = 'DELETE' then
      raise exception 'A published activity version is kept.' using errcode = '22023';
    end if;
    -- Allowed: retiring a published version, and a deleted editor's id
    -- being cleared (on delete set null). Nothing else.
    if (new.state = old.state or (old.state = 'published' and new.state = 'retired'))
       and (to_jsonb(new) - array['state', 'retired_at', 'updated_at', 'created_by', 'updated_by', 'published_by'])
           = (to_jsonb(old) - array['state', 'retired_at', 'updated_at', 'created_by', 'updated_by', 'published_by'])
       and (new.created_by is not distinct from old.created_by or new.created_by is null)
       and (new.updated_by is not distinct from old.updated_by or new.updated_by is null)
       and (new.published_by is not distinct from old.published_by or new.published_by is null)
       and (new.state <> old.state or new.retired_at is not distinct from old.retired_at) then
      return new;
    end if;
    raise exception 'A published activity version can''t be changed. Edit the activity to make a new version.' using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger activity_versions_immutable
  before update or delete on youth.activity_versions
  for each row execute function youth.guard_activity_version();

-- ---------------------------------------------------------------------------
-- Content checks
-- ---------------------------------------------------------------------------
-- Problems with a data-only JSON value (activity configuration or a child's
-- saved work): plain values, bounded depth, simple keys, and no strings that
-- look like markup, script URLs, or event handlers. Null when acceptable.
create function youth.activity_json_problem(p jsonb, p_depth integer default 0)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  r text;
begin
  if p_depth > 6 then
    return 'nested too deeply';
  end if;
  case jsonb_typeof(p)
    when 'object' then
      for k, v in select * from jsonb_each(p) loop
        if k !~ '^[a-z][a-z0-9_]{0,39}$' then
          return 'has an unsupported field name';
        end if;
        r := youth.activity_json_problem(v, p_depth + 1);
        if r is not null then return r; end if;
      end loop;
    when 'array' then
      if jsonb_array_length(p) > 500 then
        return 'has too many items';
      end if;
      for v in select * from jsonb_array_elements(p) loop
        r := youth.activity_json_problem(v, p_depth + 1);
        if r is not null then return r; end if;
      end loop;
    when 'string' then
      if char_length(p #>> '{}') > 4000 then
        return 'has text that is too long';
      end if;
      if (p #>> '{}') ~* '(<\s*/?\s*[a-z!?]|javascript\s*:|vbscript\s*:|data\s*:\s*text/html|\son[a-z]+\s*=)' then
        return 'can''t contain markup or scripts';
      end if;
    else
      null;
  end case;
  return null;
end;
$$;

-- Plain text: no control characters other than newlines and tabs.
create function youth.clean_text(p text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), p_max);
$$;

-- The description is a Markdown subset (rendered with raw HTML escaped); as
-- a second line of defence, refuse HTML tags outright.
create function youth.markup_free(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p, '') !~* '<\s*/?\s*[a-z!?][^>]*>|javascript\s*:|vbscript\s*:';
$$;

-- ---------------------------------------------------------------------------
-- Who may play, and what is open to them
-- ---------------------------------------------------------------------------
-- The child profiles this person may play for: their own (independent youth
-- account), or children without an independent account for whom they are a
-- verified guardian with the practice permission. Always active,
-- unrestricted, participating children.
create function youth.activity_players(p_profile uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from youth.children c
   where p_profile is not null and c.id = youth.account_child(p_profile) and c.participation = 'active'
  union
  select c.id from youth.guardianships g join youth.children c on c.id = g.child_id
   where p_profile is not null and g.guardian_id = p_profile and g.status = 'verified'
     and c.account_id is null and c.participation = 'active'
     and youth.guardian_can(c.id, p_profile, 'practice');
$$;

create function youth.activity_plays_for(p_child uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_child is not null and exists (select 1 from youth.activity_players(p_profile) x where x = p_child);
$$;

-- Published, inside its window, not archived.
create function youth.activity_live(a youth.activities)
returns boolean
language sql
stable
set search_path = ''
as $$
  select a.status = 'published' and a.published_version_id is not null
     and (a.available_from is null or a.available_from <= now())
     and (a.available_until is null or a.available_until > now());
$$;

-- The activity is live and open to this child (its groups, if any, include
-- one of the child's active enrollments).
create function youth.activity_open_to_child(p_activity uuid, p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from youth.activities a
     where a.id = p_activity and youth.activity_live(a) and youth.child_active(p_child)
       and (not exists (select 1 from youth.activity_groups ag where ag.activity_id = a.id)
            or exists (select 1 from youth.activity_groups ag
                        where ag.activity_id = a.id and youth.enrolled(ag.group_id, p_child))));
$$;

create function youth.activity_open_for(p_activity uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from youth.activity_players(p_profile) x where youth.activity_open_to_child(p_activity, x));
$$;

create function youth.church_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select s.timezone from public.church_settings s limit 1), 'America/Chicago'))::date;
$$;

-- What a member sees of one version (no source notes, editors, or groups).
create function youth.activity_card(v youth.activity_versions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.activity_id, 'version_id', v.id, 'version', v.version,
    'title', v.title, 'summary', v.summary, 'kind', v.kind, 'difficulty', v.difficulty,
    'age_min', v.age_min, 'age_max', v.age_max,
    'bible_story', v.bible_story, 'scripture_refs', to_jsonb(v.scripture_refs),
    'lesson_title', v.lesson_title, 'lesson_week', v.lesson_week,
    'this_week', v.lesson_week is not null and date_trunc('week', v.lesson_week) = date_trunc('week', youth.church_today()),
    'cover_path', (select x.path from youth.activity_assets x where x.id = v.cover_asset_id and x.status = 'active'),
    'cover_alt', case when v.cover_decorative then '' else v.cover_alt end,
    'cover_decorative', v.cover_decorative);
$$;

create function youth.activity_detail(v youth.activity_versions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select youth.activity_card(v) || jsonb_build_object('description', v.description, 'config', v.config);
$$;

create function youth.progress_json(p youth.activity_progress, p_full boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'child_id', p.child_id, 'activity_id', p.activity_id, 'version_id', p.version_id,
    'version', (select v.version from youth.activity_versions v where v.id = p.version_id),
    'status', p.status, 'revision', p.revision, 'started_at', p.started_at, 'updated_at', p.updated_at, 'completed_at', p.completed_at)
    || case when p_full then jsonb_build_object('data', p.data) else '{}'::jsonb end;
$$;

-- ---------------------------------------------------------------------------
-- Member functions
-- ---------------------------------------------------------------------------
-- The Learn & Play home: who the viewer may play for, the activities open to
-- at least one of them (with each player's status), and this week's lesson.
create function public.youth_activities_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_youth uuid;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  v_youth := youth.account_child(v_uid);
  v_role := case when v_youth is not null then 'youth' when youth.is_adult(v_uid) then 'adult' end;
  if v_role is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'role', v_role,
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'display_name', c.display_name) order by lower(c.display_name))
                          from youth.children c where c.id in (select youth.activity_players(v_uid))), '[]'::jsonb),
    -- Children this guardian is verified for but can't play for here (no practice permission, paused, or own account).
    'other_children', case when v_role = 'adult' then (
        select count(*) from youth.guardianships g
         where g.guardian_id = v_uid and g.status = 'verified' and youth.child_active(g.child_id)
           and g.child_id not in (select youth.activity_players(v_uid))) else 0 end,
    'activities', coalesce((
        select jsonb_agg(youth.activity_card(v) || jsonb_build_object(
                 'players', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from youth.activity_players(v_uid) x
                              where youth.activity_open_to_child(a.id, x)),
                 'progress', (select coalesce(jsonb_agg(jsonb_build_object('child_id', p.child_id, 'status', p.status)), '[]'::jsonb)
                                from youth.activity_progress p
                               where p.activity_id = a.id and p.version_id = a.published_version_id
                                 and p.child_id in (select youth.activity_players(v_uid))))
               order by v.title)
          from youth.activities a join youth.activity_versions v on v.id = a.published_version_id
         where youth.activity_open_for(a.id, v_uid)), '[]'::jsonb),
    -- Current learning assignments for the groups of the children in view.
    'lesson', coalesce((
        select jsonb_agg(youth.learning_json(l, v_uid) || jsonb_build_object('group', gr.name) order by l.created_at desc)
          from youth.learning l join youth.groups gr on gr.id = l.group_id
         where gr.status = 'active' and youth.learning_current(l)
           and exists (select 1 from youth.enrollments e
                        where e.group_id = l.group_id and e.status = 'active'
                          and (e.child_id = v_youth
                               or (v_role = 'adult' and (youth.guardian_can(e.child_id, v_uid, 'practice')
                                                         or youth.guardian_can(e.child_id, v_uid, 'receive_updates')))))), '[]'::jsonb));
end;
$$;

-- One activity. p_child is the explicitly chosen player (guardians) or null
-- (an independent youth plays for themselves). Anything the viewer may not
-- open reads as "not found", including a child they may not play for.
create function public.youth_activity(p_id uuid, p_child uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a youth.activities;
  v youth.activity_versions;
  v_child uuid := p_child;
  v_youth uuid := youth.account_child(v_uid);
  p youth.activity_progress;
begin
  select * into a from youth.activities where id = p_id;
  if a.id is null or not youth.activity_open_for(a.id, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if v_youth is not null then
    -- A youth account only ever plays for itself.
    if v_child is not null and v_child <> v_youth then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
    v_child := v_youth;
  end if;
  if v_child is not null and not (youth.activity_plays_for(v_child, v_uid) and youth.activity_open_to_child(a.id, v_child)) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into v from youth.activity_versions where id = a.published_version_id;
  if v_child is not null then
    select * into p from youth.activity_progress where child_id = v_child and version_id = v.id;
  end if;
  return youth.activity_detail(v) || jsonb_build_object(
    'role', case when v_youth is not null then 'youth' else 'adult' end,
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'display_name', c.display_name) order by lower(c.display_name))
                          from youth.children c
                         where c.id in (select youth.activity_players(v_uid)) and youth.activity_open_to_child(a.id, c.id)), '[]'::jsonb),
    'child', case when v_child is not null then (select jsonb_build_object('id', c.id, 'display_name', c.display_name) from youth.children c where c.id = v_child) end,
    'progress', case when p.id is not null then youth.progress_json(p, true) end,
    -- Progress on earlier versions stays where it was made (status only).
    'earlier', case when v_child is not null then coalesce((
        select jsonb_agg(youth.progress_json(x, false) order by x.started_at desc)
          from youth.activity_progress x where x.child_id = v_child and x.activity_id = a.id and x.version_id <> v.id), '[]'::jsonb) end);
end;
$$;

-- Save the chosen child's progress on the current version.
-- p: {data: object, completed: boolean, revision: integer (0 for a first save)}
-- Returns the saved progress (status only), or {conflict: 'version' | 'revision'}.
create function public.youth_activity_progress_save(p_activity uuid, p_child uuid, p_version uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_youth uuid := youth.account_child(v_uid);
  v_child uuid := coalesce(p_child, v_youth);
  a youth.activities;
  r youth.activity_progress;
  v_data jsonb := coalesce(p -> 'data', '{}'::jsonb);
  v_done boolean := coalesce((p ->> 'completed')::boolean, false);
  v_rev integer := coalesce((p ->> 'revision')::integer, 0);
  v_problem text;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  -- An independent youth saves only for themselves; anyone else must name the child.
  if v_child is null or (v_youth is not null and v_child <> v_youth)
     or not youth.activity_plays_for(v_child, v_uid) or not youth.activity_open_to_child(p_activity, v_child) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform community.rate_limit(v_uid, 'youth_activity_save', 300, interval '10 minutes');
  select * into a from youth.activities where id = p_activity for share;
  -- A page loaded before a new version was published: nothing is written,
  -- and the earlier progress stays on the version it was made on.
  if a.published_version_id is distinct from p_version then
    return jsonb_build_object('conflict', 'version');
  end if;
  if jsonb_typeof(v_data) <> 'object' or pg_column_size(v_data) > 32768 then
    raise exception 'That progress is too large to save.' using errcode = '22023';
  end if;
  v_problem := youth.activity_json_problem(v_data);
  if v_problem is not null then
    raise exception 'That progress couldn''t be saved: it %.', v_problem using errcode = '22023';
  end if;

  select * into r from youth.activity_progress where child_id = v_child and version_id = p_version for update;
  if r.id is null then
    if v_rev <> 0 then
      return jsonb_build_object('conflict', 'revision');
    end if;
    insert into youth.activity_progress (child_id, activity_id, version_id, status, data, last_operator_id, completed_at)
    values (v_child, p_activity, p_version, case when v_done then 'completed' else 'started' end, v_data, v_uid,
            case when v_done then now() end)
    on conflict (child_id, version_id) do nothing
    returning * into r;
    if r.id is null then
      return jsonb_build_object('conflict', 'revision');
    end if;
  else
    -- Saved meanwhile from another tab or device: don't overwrite it.
    if r.revision <> v_rev then
      return jsonb_build_object('conflict', 'revision');
    end if;
    update youth.activity_progress
       set data = v_data, status = case when v_done then 'completed' else 'started' end,
           completed_at = case when v_done then coalesce(r.completed_at, now()) end,
           revision = r.revision + 1, last_operator_id = v_uid, updated_at = now()
     where id = r.id
    returning * into r;
  end if;
  return youth.progress_json(r, false);
end;
$$;

-- Counts only, for a guardian allowed to see learning progress. For an
-- independent youth, only what they chose to share (policy permitting).
create function public.youth_activity_progress_summary(p_child uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  c youth.children;
begin
  if not youth.guardian_can(p_child, v_uid, 'view_progress') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into c from youth.children where id = p_child;
  if c.account_id is not null and (youth.setting('progress_sharing') #>> '{}' <> 'youth_choice'
       or not coalesce((select s.share_summary from youth.progress_sharing s where s.child_id = c.id), false)) then
    return jsonb_build_object('shared', false);
  end if;
  return jsonb_build_object('shared', true,
    'started', (select count(distinct p.activity_id) from youth.activity_progress p where p.child_id = c.id),
    'completed', (select count(distinct p.activity_id) from youth.activity_progress p where p.child_id = c.id and p.status = 'completed'),
    'completed_28', (select count(*) from youth.activity_progress p where p.child_id = c.id and p.completed_at > now() - interval '28 days'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration (youth.activities)
-- ---------------------------------------------------------------------------
create function youth.asset_json(x youth.activity_assets)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', x.id, 'path', x.path, 'status', x.status, 'width', x.width, 'height', x.height, 'bytes', x.bytes,
    'alt', x.alt, 'source_kind', x.source_kind, 'source_credit', x.source_credit, 'license', x.license, 'source_url', x.source_url,
    'rights_confirmed_at', x.rights_confirmed_at, 'rights_confirmed_by', community.display_name(x.rights_confirmed_by),
    'created_at', x.created_at);
$$;

create function youth.version_json(v youth.activity_versions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select youth.activity_detail(v) || jsonb_build_object(
    'state', v.state, 'cover_asset_id', v.cover_asset_id, 'cover_alt', v.cover_alt,
    'content_source', v.content_source, 'content_credit', v.content_credit, 'change_note', v.change_note,
    'created_at', v.created_at, 'updated_at', v.updated_at, 'updated_by', community.display_name(v.updated_by),
    'published_at', v.published_at, 'published_by', community.display_name(v.published_by), 'retired_at', v.retired_at);
$$;

create function public.youth_admin_activities(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'status', a.status, 'available_from', a.available_from, 'available_until', a.available_until,
             'live', youth.activity_live(a), 'updated_at', a.updated_at,
             'title', coalesce(d.title, pv.title), 'kind', coalesce(d.kind, pv.kind), 'difficulty', coalesce(d.difficulty, pv.difficulty),
             'published_version', pv.version, 'draft_version', d.version, 'draft_state', d.state,
             'groups', (select count(*) from youth.activity_groups g where g.activity_id = a.id))
           order by a.updated_at desc)
      from youth.activities a
      left join youth.activity_versions pv on pv.id = a.published_version_id
      left join youth.activity_versions d on d.activity_id = a.id and d.state in ('draft', 'preview')
     where p_status is null or a.status = p_status), '[]'::jsonb);
end;
$$;

create function public.youth_admin_activity(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  a youth.activities;
begin
  select * into a from youth.activities where id = p_id;
  if a.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', a.id, 'status', a.status, 'available_from', a.available_from, 'available_until', a.available_until,
    'live', youth.activity_live(a), 'first_published_at', a.first_published_at, 'archived_at', a.archived_at,
    'published', (select youth.version_json(v) from youth.activity_versions v where v.id = a.published_version_id),
    'draft', (select youth.version_json(v) from youth.activity_versions v where v.activity_id = a.id and v.state in ('draft', 'preview')),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'state', v.state, 'title', v.title,
                                                            'change_note', v.change_note, 'published_at', v.published_at,
                                                            'published_by', community.display_name(v.published_by)) order by v.version desc)
                           from youth.activity_versions v where v.activity_id = a.id), '[]'::jsonb),
    -- locked: part of a published (or earlier published) version, so it's kept.
    'assets', coalesce((select jsonb_agg(youth.asset_json(x) || jsonb_build_object('locked', exists (
                                  select 1 from youth.activity_versions v where v.cover_asset_id = x.id and v.state in ('published', 'retired')))
                                order by x.created_at desc)
                         from youth.activity_assets x where x.activity_id = a.id and x.status = 'active'), '[]'::jsonb),
    'group_ids', coalesce((select jsonb_agg(g.group_id) from youth.activity_groups g where g.activity_id = a.id), '[]'::jsonb),
    -- Group names only: no rosters.
    'group_options', public.youth_admin_activity_groups(),
    -- Aggregate counts only (never who): how many children have progress on
    -- the published version, so editors know a new version starts fresh.
    'progress_on_published', (select count(*) from youth.activity_progress p where p.version_id = a.published_version_id));
end;
$$;

-- Validates and normalizes editable content; raises on problems.
create function youth.activity_content(p_activity uuid, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_refs text[];
  v_ref text;
  v_cover uuid := nullif(p ->> 'cover_asset_id', '')::uuid;
  v_config jsonb := coalesce(p -> 'config', '{}'::jsonb);
  v_problem text;
  v_out jsonb;
begin
  v_out := jsonb_build_object(
    'title', youth.clean_text(p ->> 'title', 120),
    'summary', youth.clean_text(p ->> 'summary', 300),
    'description', left(regexp_replace(coalesce(p ->> 'description', ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), 8000),
    'kind', p ->> 'kind', 'difficulty', p ->> 'difficulty',
    'age_min', nullif(p ->> 'age_min', '')::smallint, 'age_max', nullif(p ->> 'age_max', '')::smallint,
    'bible_story', youth.clean_text(p ->> 'bible_story', 160),
    'lesson_title', youth.clean_text(p ->> 'lesson_title', 160),
    'lesson_week', nullif(p ->> 'lesson_week', '')::date,
    'cover_asset_id', v_cover,
    'cover_alt', youth.clean_text(p ->> 'cover_alt', 300),
    'cover_decorative', coalesce((p ->> 'cover_decorative')::boolean, false),
    'content_source', coalesce(nullif(p ->> 'content_source', ''), 'original'),
    'content_credit', youth.clean_text(p ->> 'content_credit', 500),
    'change_note', youth.clean_text(p ->> 'change_note', 300),
    'config', v_config);
  if char_length(v_out ->> 'title') = 0 then
    raise exception 'Give the activity a title.' using errcode = '22023';
  end if;
  if coalesce(v_out ->> 'kind', '') not in ('story', 'quiz', 'matching', 'puzzle', 'drawing', 'word_game') then
    raise exception 'Choose an activity type.' using errcode = '22023';
  end if;
  if coalesce(v_out ->> 'difficulty', '') not in ('beginner', 'growing', 'challenge') then
    raise exception 'Choose a difficulty.' using errcode = '22023';
  end if;
  if (v_out ->> 'age_min')::int not between 2 and 18 or (v_out ->> 'age_max')::int not between 2 and 18
     or (v_out ->> 'age_max')::int < (v_out ->> 'age_min')::int then
    raise exception 'Suggested ages must be between 2 and 18, youngest first.' using errcode = '22023';
  end if;
  if v_out ->> 'content_source' not in ('original', 'adapted', 'licensed', 'public_domain', 'permission') then
    raise exception 'Choose where the content came from.' using errcode = '22023';
  end if;
  if v_out ->> 'content_source' <> 'original' and char_length(v_out ->> 'content_credit') = 0 then
    raise exception 'Say where the content came from and the permission or license for it.' using errcode = '22023';
  end if;
  if not youth.markup_free(v_out ->> 'title') or not youth.markup_free(v_out ->> 'summary') or not youth.markup_free(v_out ->> 'description')
     or not youth.markup_free(v_out ->> 'bible_story') or not youth.markup_free(v_out ->> 'lesson_title') or not youth.markup_free(v_out ->> 'cover_alt') then
    raise exception 'Activity text can''t contain HTML or scripts. Use Markdown formatting (like **bold**) instead.' using errcode = '22023';
  end if;
  -- Scripture references: short plain strings.
  select coalesce(array_agg(x), '{}') into v_refs
    from (select youth.clean_text(e, 60) x from jsonb_array_elements_text(coalesce(p -> 'scripture_refs', '[]'::jsonb)) e) s
   where x <> '';
  if cardinality(v_refs) > 10 then
    raise exception 'Add up to 10 Scripture references.' using errcode = '22023';
  end if;
  foreach v_ref in array v_refs loop
    if not youth.markup_free(v_ref) then
      raise exception 'Scripture references can''t contain HTML.' using errcode = '22023';
    end if;
  end loop;
  v_out := v_out || jsonb_build_object('scripture_refs', to_jsonb(v_refs));
  if v_cover is not null and not exists (select 1 from youth.activity_assets x where x.id = v_cover and x.activity_id = p_activity and x.status = 'active') then
    raise exception 'Choose artwork uploaded for this activity.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_config) <> 'object' or pg_column_size(v_config) > 65536 then
    raise exception 'The activity settings are too large.' using errcode = '22023';
  end if;
  v_problem := youth.activity_json_problem(v_config);
  if v_problem is not null then
    raise exception 'The activity settings %.', v_problem using errcode = '22023';
  end if;
  return v_out;
end;
$$;

-- Create an activity (p_id null) or save its draft. Editing a published
-- activity makes a new draft version; the published one is untouched.
-- p: content fields (see youth.activity_content) plus available_from/until.
create function public.youth_admin_activity_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  a youth.activities;
  d youth.activity_versions;
  c jsonb;
  v_from timestamptz := nullif(p ->> 'available_from', '')::timestamptz;
  v_until timestamptz := nullif(p ->> 'available_until', '')::timestamptz;
begin
  perform community.rate_limit(v_uid, 'youth_activity_admin', 300, interval '10 minutes');
  if v_until is not null and v_from is not null and v_until <= v_from then
    raise exception 'The end of the availability window must be after its start.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into youth.activities (created_by, updated_by, available_from, available_until)
    values (v_uid, v_uid, v_from, v_until) returning * into a;
    c := youth.activity_content(a.id, p);
    insert into youth.activity_versions (activity_id, version, title, summary, description, kind, difficulty, age_min, age_max,
                                         bible_story, scripture_refs, lesson_title, lesson_week, cover_asset_id, cover_alt,
                                         cover_decorative, content_source, content_credit, config, change_note, created_by, updated_by)
    select a.id, 1, c ->> 'title', c ->> 'summary', c ->> 'description', c ->> 'kind', c ->> 'difficulty',
           (c ->> 'age_min')::smallint, (c ->> 'age_max')::smallint, c ->> 'bible_story',
           array(select jsonb_array_elements_text(c -> 'scripture_refs')), c ->> 'lesson_title', (c ->> 'lesson_week')::date,
           null, c ->> 'cover_alt', (c ->> 'cover_decorative')::boolean, c ->> 'content_source', c ->> 'content_credit',
           c -> 'config', c ->> 'change_note', v_uid, v_uid
    returning * into d;
    perform youth.audit('youth.activity_created', 'youth_activity', a.id, '{}'::jsonb);
    return jsonb_build_object('id', a.id, 'version_id', d.id, 'version', d.version);
  end if;

  select * into a from youth.activities where id = p_id for update;
  if a.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if a.status = 'archived' then
    raise exception 'Restore this activity before editing it.' using errcode = '22023';
  end if;
  c := youth.activity_content(a.id, p);
  select * into d from youth.activity_versions where activity_id = a.id and state in ('draft', 'preview') for update;
  if d.id is null then
    insert into youth.activity_versions (activity_id, version, title, kind, difficulty, created_by, updated_by)
    values (a.id, (select max(version) + 1 from youth.activity_versions where activity_id = a.id),
            c ->> 'title', c ->> 'kind', c ->> 'difficulty', v_uid, v_uid)
    returning * into d;
  end if;
  -- Any edit returns a version that was ready for preview to draft.
  update youth.activity_versions
     set state = 'draft', title = c ->> 'title', summary = c ->> 'summary', description = c ->> 'description',
         kind = c ->> 'kind', difficulty = c ->> 'difficulty', age_min = (c ->> 'age_min')::smallint, age_max = (c ->> 'age_max')::smallint,
         bible_story = c ->> 'bible_story', scripture_refs = array(select jsonb_array_elements_text(c -> 'scripture_refs')),
         lesson_title = c ->> 'lesson_title', lesson_week = (c ->> 'lesson_week')::date,
         cover_asset_id = (c ->> 'cover_asset_id')::uuid, cover_alt = c ->> 'cover_alt', cover_decorative = (c ->> 'cover_decorative')::boolean,
         content_source = c ->> 'content_source', content_credit = c ->> 'content_credit', config = c -> 'config',
         change_note = c ->> 'change_note', updated_by = v_uid
   where id = d.id
  returning * into d;
  update youth.activities
     set available_from = v_from, available_until = v_until, updated_by = v_uid,
         status = case when status = 'preview' then 'draft' else status end
   where id = a.id;
  return jsonb_build_object('id', a.id, 'version_id', d.id, 'version', d.version);
end;
$$;

-- Lifecycle: ready (draft → preview), unready (preview → draft), publish,
-- archive, restore, discard_draft. Publishing and archiving need the
-- confirmation phrase.
create function public.youth_admin_activity_status(p_id uuid, p_action text, p_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  a youth.activities;
  d youth.activity_versions;
  x youth.activity_assets;
begin
  select * into a from youth.activities where id = p_id for update;
  if a.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into d from youth.activity_versions where activity_id = a.id and state in ('draft', 'preview') for update;

  if p_action in ('ready', 'unready') then
    if d.id is null or a.status = 'archived' then
      raise exception 'There is no draft to change.' using errcode = '22023';
    end if;
    update youth.activity_versions set state = case when p_action = 'ready' then 'preview' else 'draft' end, updated_by = v_uid where id = d.id;
    if a.status in ('draft', 'preview') then
      update youth.activities set status = case when p_action = 'ready' then 'preview' else 'draft' end, updated_by = v_uid where id = a.id;
    end if;

  elsif p_action = 'publish' then
    if coalesce(p_confirm, '') <> 'publish' then
      raise exception 'Type "publish" to confirm.' using errcode = '22023';
    end if;
    if d.id is null or a.status = 'archived' then
      raise exception 'There is no draft to publish.' using errcode = '22023';
    end if;
    if d.cover_asset_id is not null then
      select * into x from youth.activity_assets where id = d.cover_asset_id;
      if x.status <> 'active' then
        raise exception 'The cover artwork was removed. Choose another before publishing.' using errcode = '22023';
      end if;
      if not d.cover_decorative and char_length(btrim(coalesce(nullif(d.cover_alt, ''), x.alt))) = 0 then
        raise exception 'Describe the cover artwork for people who can''t see it, or mark it decorative.' using errcode = '22023';
      end if;
    end if;
    update youth.activity_versions set state = 'retired', retired_at = now() where activity_id = a.id and state = 'published';
    update youth.activity_versions
       set state = 'published', published_by = v_uid, published_at = now(),
           cover_alt = case when cover_decorative then '' else coalesce(nullif(btrim(cover_alt), ''),
                         (select y.alt from youth.activity_assets y where y.id = cover_asset_id), '') end
     where id = d.id;
    update youth.activities
       set status = 'published', published_version_id = d.id, updated_by = v_uid, first_published_at = coalesce(first_published_at, now())
     where id = a.id;
    perform youth.audit('youth.activity_published', 'youth_activity', a.id, jsonb_build_object('version', d.version));

  elsif p_action = 'archive' then
    if coalesce(p_confirm, '') <> 'archive' then
      raise exception 'Type "archive" to confirm.' using errcode = '22023';
    end if;
    if a.status = 'archived' then
      return jsonb_build_object('status', a.status);
    end if;
    update youth.activities set status = 'archived', archived_at = now(), updated_by = v_uid where id = a.id;
    perform youth.audit('youth.activity_archived', 'youth_activity', a.id, '{}'::jsonb);

  elsif p_action = 'restore' then
    if a.status <> 'archived' then
      raise exception 'This activity isn''t archived.' using errcode = '22023';
    end if;
    -- Back to where it was: published if a version was published, else draft.
    -- Members see it again only if it was published.
    update youth.activities
       set status = case when published_version_id is not null then 'published'
                         when d.state = 'preview' then 'preview' else 'draft' end,
           archived_at = null, updated_by = v_uid
     where id = a.id;
    perform youth.audit('youth.activity_restored', 'youth_activity', a.id, '{}'::jsonb);

  elsif p_action = 'discard_draft' then
    if d.id is null or a.published_version_id is null then
      raise exception 'Only an unpublished change to a published activity can be discarded.' using errcode = '22023';
    end if;
    delete from youth.activity_versions where id = d.id;

  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  select * into a from youth.activities where id = p_id;
  return jsonb_build_object('status', a.status, 'published_version_id', a.published_version_id);
end;
$$;

create function public.youth_admin_activity_groups_set(p_id uuid, p_groups uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
begin
  if not exists (select 1 from youth.activities where id = p_id) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(coalesce(p_groups, '{}')) g where not exists (select 1 from youth.groups x where x.id = g and x.status = 'active')) then
    raise exception 'Choose active youth groups.' using errcode = '22023';
  end if;
  delete from youth.activity_groups where activity_id = p_id and not (group_id = any (coalesce(p_groups, '{}')));
  insert into youth.activity_groups (activity_id, group_id, added_by)
  select p_id, g, v_uid from unnest(coalesce(p_groups, '{}')) g
  on conflict do nothing;
  update youth.activities set updated_by = v_uid where id = p_id;
  perform youth.audit('youth.activity_groups_set', 'youth_activity', p_id, jsonb_build_object('groups', cardinality(coalesce(p_groups, '{}'))));
end;
$$;

-- Active youth group names for assignment (no rosters).
create function public.youth_admin_activity_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                     from youth.groups g where g.status = 'active'), '[]'::jsonb);
end;
$$;

-- Artwork: begin (record the details and reserve a path), the app uploads
-- the re-encoded WebP with the editor's own session (storage policy checks
-- the pending record), then finish. p: {alt, source_kind, source_credit,
-- license, source_url, rights_confirmed}
create function public.youth_admin_activity_asset_begin(p_activity uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  v_id uuid := gen_random_uuid();
  x youth.activity_assets;
begin
  perform community.rate_limit(v_uid, 'youth_activity_asset', 60, interval '10 minutes');
  if not exists (select 1 from youth.activities where id = p_activity and status <> 'archived') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if not coalesce((p ->> 'rights_confirmed')::boolean, false) then
    raise exception 'Confirm the church may use this artwork (original, licensed, public domain, or used with permission).' using errcode = '22023';
  end if;
  if coalesce(p ->> 'source_kind', '') not in ('original', 'licensed', 'public_domain', 'permission') then
    raise exception 'Choose where the artwork came from.' using errcode = '22023';
  end if;
  if p ->> 'source_kind' <> 'original' and char_length(youth.clean_text(p ->> 'source_credit', 300)) = 0 then
    raise exception 'Name the artist or source for artwork that isn''t original.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p ->> 'source_url', '')), '') is not null and btrim(p ->> 'source_url') !~ '^https://[^\s<>"]+$' then
    raise exception 'The source link must start with https://.' using errcode = '22023';
  end if;
  if not youth.markup_free(p ->> 'alt') or not youth.markup_free(p ->> 'source_credit') or not youth.markup_free(p ->> 'license') then
    raise exception 'Artwork details can''t contain HTML.' using errcode = '22023';
  end if;
  insert into youth.activity_assets (id, activity_id, path, alt, source_kind, source_credit, license, source_url,
                                     rights_confirmed_by, rights_confirmed_at, uploaded_by)
  values (v_id, p_activity, 'activities/' || p_activity || '/' || v_id || '.webp', youth.clean_text(p ->> 'alt', 300),
          p ->> 'source_kind', youth.clean_text(p ->> 'source_credit', 300), youth.clean_text(p ->> 'license', 300),
          nullif(btrim(coalesce(p ->> 'source_url', '')), ''), v_uid, now(), v_uid)
  returning * into x;
  return jsonb_build_object('id', x.id, 'path', x.path);
end;
$$;

create function public.youth_admin_activity_asset_finish(p_asset uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  x youth.activity_assets;
begin
  select * into x from youth.activity_assets where id = p_asset and status = 'pending' for update;
  if x.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  -- The uploaded object must exist (the storage policy allowed only this path).
  if not exists (select 1 from storage.objects o where o.bucket_id = 'youth' and o.name = x.path) then
    raise exception 'The artwork didn''t finish uploading. Try again.' using errcode = '22023';
  end if;
  update youth.activity_assets
     set status = 'active', width = (p ->> 'width')::integer, height = (p ->> 'height')::integer, bytes = (p ->> 'bytes')::integer
   where id = x.id
  returning * into x;
  perform youth.audit('youth.activity_artwork_added', 'youth_activity', x.activity_id, jsonb_build_object('source_kind', x.source_kind));
  return youth.asset_json(x);
end;
$$;

-- Drop a reservation whose upload failed (nothing was stored).
create function public.youth_admin_activity_asset_cancel(p_asset uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
begin
  delete from youth.activity_assets where id = p_asset and status = 'pending';
end;
$$;

-- p: {alt, source_credit, license, source_url} (source kind and rights are fixed at upload).
create function public.youth_admin_activity_asset_update(p_asset uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  x youth.activity_assets;
begin
  select * into x from youth.activity_assets where id = p_asset and status = 'active' for update;
  if x.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if not youth.markup_free(p ->> 'alt') or not youth.markup_free(p ->> 'source_credit') or not youth.markup_free(p ->> 'license') then
    raise exception 'Artwork details can''t contain HTML.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p ->> 'source_url', '')), '') is not null and btrim(p ->> 'source_url') !~ '^https://[^\s<>"]+$' then
    raise exception 'The source link must start with https://.' using errcode = '22023';
  end if;
  update youth.activity_assets
     set alt = youth.clean_text(p ->> 'alt', 300),
         source_credit = case when x.source_kind = 'original' then youth.clean_text(p ->> 'source_credit', 300)
                              else coalesce(nullif(youth.clean_text(p ->> 'source_credit', 300), ''), x.source_credit) end,
         license = youth.clean_text(p ->> 'license', 300),
         source_url = nullif(btrim(coalesce(p ->> 'source_url', '')), '')
   where id = x.id
  returning * into x;
  return youth.asset_json(x);
end;
$$;

-- Remove artwork that no version uses. Returns the storage path so the app
-- can delete the object (the storage policy rechecks the capability).
create function public.youth_admin_activity_asset_remove(p_asset uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  x youth.activity_assets;
begin
  select * into x from youth.activity_assets where id = p_asset and status = 'active' for update;
  if x.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from youth.activity_versions v where v.cover_asset_id = x.id and v.state in ('published', 'retired')) then
    raise exception 'This artwork is part of a published version, so it''s kept.' using errcode = '22023';
  end if;
  update youth.activity_versions set cover_asset_id = null, updated_by = v_uid where cover_asset_id = x.id and state in ('draft', 'preview');
  update youth.activity_assets set status = 'removed' where id = x.id;
  return jsonb_build_object('path', x.path);
end;
$$;

-- What members would see, for the draft (or the published version): the
-- same card and detail shape, with no progress and no players.
create function public.youth_admin_activity_preview(p_id uuid, p_version uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  v youth.activity_versions;
begin
  select * into v from youth.activity_versions
   where activity_id = p_id and (case when p_version is null then state in ('draft', 'preview') else id = p_version end);
  if v.id is null then
    select x.* into v from youth.activity_versions x join youth.activities a on a.published_version_id = x.id where a.id = p_id;
  end if;
  if v.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return youth.activity_detail(v) || jsonb_build_object('state', v.state, 'cover_alt', coalesce(nullif(v.cover_alt, ''),
    (select x.alt from youth.activity_assets x where x.id = v.cover_asset_id), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: activity artwork in the private youth bucket
-- ---------------------------------------------------------------------------
create function youth.activity_object_readable(p_name text, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from youth.activity_assets x
     where x.path = p_name
       and ((public.has_capability('youth.activities') and x.status in ('pending', 'active'))
            or (x.status = 'active' and exists (
                  select 1 from youth.activities a join youth.activity_versions v on v.id = a.published_version_id
                   where a.id = x.activity_id and v.cover_asset_id = x.id and youth.activity_open_for(a.id, p_profile)))));
$$;

create or replace function public.youth_can_read_object(p_name text)
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
            or public.has_capability('family.verify')))
  or (p_name like 'activities/%' and youth.activity_object_readable(p_name, (select auth.uid())));
$$;

-- Write (insert and delete): avatars as before; activity artwork only by
-- youth.activities holders and only at a path reserved by
-- youth_admin_activity_asset_begin.
create or replace function public.youth_can_write_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (youth.avatar_child(p_name) is not null
          and (youth.guardian_can(youth.avatar_child(p_name), (select auth.uid()), 'manage_profile')
               or (public.has_capability('family.verify') and exists (select 1 from youth.children c where c.id = youth.avatar_child(p_name)))))
      or (p_name ~ '^activities/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
          and public.has_capability('youth.activities')
          and exists (select 1 from youth.activity_assets x where x.path = p_name and x.status in ('pending', 'removed')));
$$;

-- ---------------------------------------------------------------------------
-- youth_me: include the new capability (otherwise unchanged)
-- ---------------------------------------------------------------------------
create or replace function public.youth_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_child uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  if youth.is_active_youth(v_uid) then
    v_child := youth.account_child(v_uid);
    return jsonb_build_object('kind', 'youth', 'child_id', v_child,
      'display_name', (select c.display_name from youth.children c where c.id = v_child),
      'groups', (select count(*) from youth.enrollments e where e.child_id = v_child and e.status = 'active'));
  end if;
  if not youth.is_adult(v_uid) then
    return jsonb_build_object('kind', case when exists (select 1 from public.profiles where id = v_uid and account_kind = 'youth')
                                           then 'youth_inactive' else 'none' end);
  end if;
  return jsonb_build_object(
    'kind', 'adult',
    'guardian_of', (select count(*) from youth.guardianships g where g.guardian_id = v_uid and g.status = 'verified'
                     and youth.child_active(g.child_id)),
    'paused_guardianships', (select count(*) from youth.guardianships g join youth.children c on c.id = g.child_id
                              where g.guardian_id = v_uid and (g.status = 'suspended' or (g.status = 'verified' and c.restricted_at is not null))),
    'pending_requests', (select count(*) from youth.guardian_requests r where r.requester_id = v_uid and r.status = 'pending'),
    'leads', (select count(*) from youth.group_leaders l where l.profile_id = v_uid and l.status = 'active' and youth.is_leader(l.group_id, v_uid)),
    'personnel', (select count(*) from youth.event_personnel p where p.profile_id = v_uid),
    'caps', (select coalesce(jsonb_agg(c order by c), '[]'::jsonb) from unnest(array['youth.manage', 'youth.publish', 'youth.enroll', 'youth.forms',
                     'youth.logistics', 'youth.media_consent', 'youth.safeguarding', 'youth.policy', 'family.verify', 'youth.activities']) c
              where public.has_capability(c)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: internal helpers closed; public entry points for signed-in people
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema youth from public, anon, authenticated, service_role;

revoke execute on function
  public.youth_activities_home(), public.youth_activity(uuid, uuid), public.youth_activity_progress_save(uuid, uuid, uuid, jsonb),
  public.youth_activity_progress_summary(uuid), public.youth_admin_activities(text), public.youth_admin_activity(uuid),
  public.youth_admin_activity_save(uuid, jsonb), public.youth_admin_activity_status(uuid, text, text),
  public.youth_admin_activity_groups_set(uuid, uuid[]), public.youth_admin_activity_groups(), public.youth_admin_activity_asset_begin(uuid, jsonb),
  public.youth_admin_activity_asset_finish(uuid, jsonb), public.youth_admin_activity_asset_cancel(uuid),
  public.youth_admin_activity_asset_update(uuid, jsonb), public.youth_admin_activity_asset_remove(uuid),
  public.youth_admin_activity_preview(uuid, uuid), public.youth_can_read_object(text), public.youth_can_write_object(text),
  public.youth_me()
  from public, anon, service_role;

grant execute on function
  public.youth_activities_home(), public.youth_activity(uuid, uuid), public.youth_activity_progress_save(uuid, uuid, uuid, jsonb),
  public.youth_activity_progress_summary(uuid), public.youth_admin_activities(text), public.youth_admin_activity(uuid),
  public.youth_admin_activity_save(uuid, jsonb), public.youth_admin_activity_status(uuid, text, text),
  public.youth_admin_activity_groups_set(uuid, uuid[]), public.youth_admin_activity_groups(), public.youth_admin_activity_asset_begin(uuid, jsonb),
  public.youth_admin_activity_asset_finish(uuid, jsonb), public.youth_admin_activity_asset_cancel(uuid),
  public.youth_admin_activity_asset_update(uuid, jsonb), public.youth_admin_activity_asset_remove(uuid),
  public.youth_admin_activity_preview(uuid, uuid), public.youth_can_read_object(text), public.youth_can_write_object(text),
  public.youth_me()
  to authenticated;

-- Expected afterwards: the tables exist and are closed to clients, the role
-- carries only youth.activities, and super administrators don't get it.
do $check$
begin
  if to_regclass('youth.activity_progress') is null or to_regclass('youth.activity_versions') is null then
    raise exception 'Nothing was changed: the activity tables were not created. Send this message to the developer.';
  end if;
  if has_table_privilege('authenticated', 'youth.activity_progress', 'select')
     or has_function_privilege('anon', 'public.youth_activities_home()', 'execute') then
    raise exception 'Nothing was changed: activity data would be reachable directly. Send this message to the developer.';
  end if;
  if (select array_agg(capability_key) from public.role_capabilities where role_key = 'youth_activity_editor') <> array['youth.activities'] then
    raise exception 'Nothing was changed: the Youth activity editor role is not as expected. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261118000100', 'youth_activities', 'youth-activities');

commit;
