-- Phase 6 · Prayer and care: schema, capabilities, and access rules.
--
-- Everything lives in a private `prayer` schema that the Data API does not
-- expose and that anon/authenticated cannot read. Members reach it only
-- through SECURITY DEFINER functions in public (prayer_* and care_*), which
-- recheck on every call: approved adult membership, the request's current
-- audience, current group membership, explicit prayer/care capabilities,
-- authorship, status, locks, and rate limits.
--
-- Audiences (prayer.audience)
--   church   approved adult members
--   group    current active members of one group (community.group_member)
--   team     holders of prayer.confidential (the prayer/care team)
--   private  the author only (a private draft)
-- The author always keeps access to their own request while their account is
-- approved, until they delete it. Archiving narrows a request to the author.
--
-- Capabilities (granted only by explicit roles; super administrators do NOT
-- hold them implicitly — has_capability() below excludes prayer.% and care.%,
-- as Phase 3 did for finance.%). A super administrator can assign the roles
-- (roles.manage), and every grant is audited (role.granted).
--   prayer.confidential  read and pray for team (confidential) requests
--   prayer.moderate      review prayer reports in scope; hide/restore; lock
--                        comments. Team-audience reports also need
--                        prayer.confidential. No browsing of group requests.
--   prayer.identity      look up who wrote an anonymous request, with a
--                        recorded reason (audited; never content)
--   care.coordinate      the care workspace: requests, status, follow-ups,
--                        responses to the requester, volunteer opportunities
--   care.assign          assign coordinators; read internal notes on every
--                        care request (others read notes only when assigned)
-- Group leaders, community moderators, content editors, membership and
-- finance administrators receive none of these.

-- ---------------------------------------------------------------------------
-- Capabilities and roles
-- ---------------------------------------------------------------------------
insert into public.capabilities (key, description, available) values
  ('prayer.confidential', 'Read and pray for confidential (prayer/care team) prayer requests', true),
  ('prayer.moderate', 'Review prayer reports in scope, hide or restore prayer content, and lock comments', true),
  ('prayer.identity', 'Look up the author of an anonymous prayer request, with a recorded reason', true),
  ('care.coordinate', 'Coordinate practical care requests and volunteer opportunities', true),
  ('care.assign', 'Assign care coordinators and read internal notes on every care request', true);

insert into public.roles (key, name, description, assignable, sort_order) values
  ('prayer_team', 'Prayer team member',
   'Reads and prays for confidential prayer requests. No care requests, moderation, or identity lookup.', true, 70),
  ('prayer_moderator', 'Prayer moderator',
   'Reviews reported prayer content in scope. Confidential requests also need the prayer team role.', true, 71),
  ('prayer_lead', 'Prayer and care lead',
   'Prayer team access, prayer moderation, and audited identity lookup for anonymous requests.', true, 72),
  ('care_coordinator', 'Care coordinator',
   'Coordinates practical care requests and volunteer opportunities. Reads internal notes only when assigned.', true, 73),
  ('care_lead', 'Care team lead',
   'Care coordination plus assigning coordinators and reading all internal care notes.', true, 74);

insert into public.role_capabilities (role_key, capability_key) values
  ('prayer_team', 'prayer.confidential'),
  ('prayer_moderator', 'prayer.moderate'),
  ('prayer_lead', 'prayer.confidential'),
  ('prayer_lead', 'prayer.moderate'),
  ('prayer_lead', 'prayer.identity'),
  ('care_coordinator', 'care.coordinate'),
  ('care_lead', 'care.coordinate'),
  ('care_lead', 'care.assign');

-- Finance (Phase 3) and now prayer/care require an explicit role grant, even
-- for super administrators.
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
      and (
        (ur.role_key = 'super_admin'
         and p_capability not like 'finance.%'
         and p_capability not like 'prayer.%'
         and p_capability not like 'care.%')
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

-- ---------------------------------------------------------------------------
-- Schema and types
-- ---------------------------------------------------------------------------
create schema prayer;
revoke all on schema prayer from public, anon, authenticated;

create type prayer.audience as enum ('private', 'group', 'team', 'church');
create type prayer.request_status as enum ('open', 'answered', 'closed', 'archived');
create type prayer.content_status as enum ('visible', 'hidden', 'deleted');
create type prayer.care_kind as enum ('meal', 'transportation', 'visit', 'other');
create type prayer.care_status as enum ('submitted', 'in_review', 'coordinating', 'fulfilled', 'closed');
create type prayer.contact_method as enum ('app', 'phone', 'email');

-- ---------------------------------------------------------------------------
-- Settings (singleton). Retention is OFF until the church adopts a policy:
-- nothing is deleted or auto-archived by the scheduler while
-- retention_enabled is false (author deletion is always immediate).
-- ---------------------------------------------------------------------------
create table prayer.settings (
  id boolean primary key default true check (id),
  guidance text not null default
    E'- **Share only what you have permission to share.** Ask before sharing someone else''s story or needs.\n'
    '- **Choose the audience carefully.** You can narrow it at any time; widening it asks you to confirm.\n'
    '- **Confidential requests are not monitored continuously.** The prayer team reads them when they can.\n'
    '- **This is not an emergency service.** If someone is in danger, call 911 or your local emergency number.'
    check (char_length(guidance) between 1 and 4000),
  retention_enabled boolean not null default false,
  -- Closed requests are archived (author-only) this many days after closing.
  closed_archive_days integer not null default 90 check (closed_archive_days between 7 and 3650),
  -- Archived requests are deleted this many days after archiving.
  archived_delete_days integer not null default 365 check (archived_delete_days between 30 and 3650),
  -- Closed care requests (with their notes and messages) are deleted after this.
  care_delete_days integer not null default 365 check (care_delete_days between 30 and 3650),
  -- Report evidence is cleared this many days after a prayer report is closed.
  report_evidence_days integer not null default 90 check (report_evidence_days between 7 and 1095),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into prayer.settings default values;

-- ---------------------------------------------------------------------------
-- Prayer requests
-- ---------------------------------------------------------------------------
-- Bodies use the community Markdown subset (rendered safely by the app; no
-- raw HTML, images, or attachments). The author's identity is never
-- returned to readers of an anonymous request.
create table prayer.requests (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  audience prayer.audience not null default 'private',
  -- Groups are archived, never deleted by the app.
  group_id uuid references community.groups (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  anonymous boolean not null default false,
  status prayer.request_status not null default 'open',
  -- Author-controlled comments; a moderator lock is separate.
  comments_enabled boolean not null default true,
  mod_locked boolean not null default false,
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  -- Idempotency key from the composer: a retried submit never duplicates.
  client_key uuid,
  published_at timestamptz,
  audience_changed_at timestamptz,
  answered_at timestamptz,
  closed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  last_activity_at timestamptz not null default now(),
  constraint requests_group check ((audience = 'group') = (group_id is not null)),
  constraint requests_archived check ((status = 'archived') = (archived_at is not null))
);
create index requests_feed_idx on prayer.requests (last_activity_at desc, id) where status <> 'archived' and hidden_at is null;
create index requests_author_idx on prayer.requests (author_id, last_activity_at desc);
create index requests_group_idx on prayer.requests (group_id) where group_id is not null;
create index requests_hidden_by_idx on prayer.requests (hidden_by);
create unique index requests_client_key_idx on prayer.requests (author_id, client_key) where client_key is not null;

-- Dated updates by the author. posted_audience/posted_group record who could
-- read the request when the update was written: a reader sees it only if
-- they are ALSO in that audience (see prayer.sees_item), so broadening a
-- request never exposes earlier updates to the wider audience.
create table prayer.updates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references prayer.requests (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'update' check (kind in ('update', 'answered')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  posted_audience prayer.audience not null,
  posted_group uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index updates_request_idx on prayer.updates (request_id, created_at);
create index updates_author_idx on prayer.updates (author_id);

-- Encouraging comments. Same audience snapshot rule as updates. Author
-- deletion erases the text and leaves a placeholder (constraint).
create table prayer.comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references prayer.requests (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) <= 2000),
  -- Only the requester of an anonymous request can comment anonymously
  -- (shown as "The requester").
  anonymous boolean not null default false,
  posted_audience prayer.audience not null,
  posted_group uuid,
  status prayer.content_status not null default 'visible',
  client_key uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  constraint comments_deleted_erased check (status <> 'deleted' or (body = '' and deleted_at is not null)),
  constraint comments_visible_text check (status = 'deleted' or char_length(btrim(body)) >= 1)
);
create index comments_request_idx on prayer.comments (request_id, created_at, id);
create index comments_author_idx on prayer.comments (author_id);
create index comments_hidden_by_idx on prayer.comments (hidden_by);
create unique index comments_client_key_idx on prayer.comments (request_id, author_id, client_key) where client_key is not null;

-- "I'm praying": one per member per request; removable. Only aggregate
-- counts are ever returned (no names, no rankings).
create table prayer.prayers (
  request_id uuid not null references prayer.requests (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, profile_id)
);
create index prayers_profile_idx on prayer.prayers (profile_id);

create table prayer.follows (
  request_id uuid not null references prayer.requests (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, profile_id)
);
create index follows_profile_idx on prayer.follows (profile_id);

-- ---------------------------------------------------------------------------
-- Reports and moderation (prayer-specific: separate from community reports
-- so community moderators never see prayer reports or their evidence)
-- ---------------------------------------------------------------------------
create table prayer.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('request', 'comment', 'update')),
  target_id uuid not null,
  request_id uuid references prayer.requests (id) on delete set null,
  -- Audience when reported: team-audience reports need prayer.confidential.
  audience prayer.audience not null,
  reported_profile_id uuid references public.profiles (id) on delete set null,
  -- Anonymous author: the reporter's view of it; reviewers don't see who.
  reported_anonymous boolean not null default false,
  reason text not null check (reason in ('inappropriate', 'privacy', 'spam', 'harassment', 'safety', 'other')),
  details text check (char_length(details) <= 1000),
  -- Snapshot of only the reported item, taken when reported.
  evidence jsonb check (evidence is null or jsonb_typeof(evidence) = 'object'),
  evidence_cleared_at timestamptz,
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  resolution text check (char_length(resolution) <= 1000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index prayer_reports_status_idx on prayer.reports (status, created_at);
create index prayer_reports_request_idx on prayer.reports (request_id);
create index prayer_reports_target_idx on prayer.reports (target_type, target_id);
create index prayer_reports_reporter_idx on prayer.reports (reporter_id);
create index prayer_reports_reported_idx on prayer.reports (reported_profile_id);
create index prayer_reports_resolved_by_idx on prayer.reports (resolved_by);

-- Who looked at or acted on what. Never contains request, comment, or note text.
create table prayer.moderation_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  report_id uuid references prayer.reports (id) on delete set null,
  target_type text,
  target_id uuid,
  reason text check (char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index prayer_mod_log_report_idx on prayer.moderation_log (report_id);
create index prayer_mod_log_actor_idx on prayer.moderation_log (actor_id);
create index prayer_mod_log_created_idx on prayer.moderation_log (created_at desc);

-- Sensitive-content access records (identity lookups, confidential request
-- and care request views). References and reasons only.
create table prayer.access_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('identity_lookup', 'team_request_viewed', 'care_request_viewed', 'report_viewed')),
  target_type text not null,
  target_id uuid not null,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index prayer_access_log_lookup_idx on prayer.access_log (actor_id, action, target_id, created_at desc);
create index prayer_access_log_created_idx on prayer.access_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Practical care requests (always private: the requester and the care team)
-- ---------------------------------------------------------------------------
-- No medical records, diagnoses, or identity documents are collected; the
-- form says so and the fields are short.
create table prayer.care_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  kind prayer.care_kind not null,
  summary text not null check (char_length(btrim(summary)) between 3 and 120),
  details text not null default '' check (char_length(details) <= 2000),
  needed_on date,
  needed_until date,
  contact_method prayer.contact_method not null default 'app',
  contact_note text check (char_length(contact_note) <= 200),
  status prayer.care_status not null default 'submitted',
  closed_reason text check (closed_reason in ('fulfilled', 'withdrawn', 'resolved', 'declined')),
  assigned_to uuid references public.profiles (id) on delete set null,
  follow_up_on date,
  follow_up_notified_on date,
  -- Requester consent to share their first name and the logistics written
  -- by the coordinator with ACCEPTED volunteers. Checked at read time, so
  -- withdrawing consent hides those details at once.
  share_consent boolean not null default false,
  consent_at timestamptz,
  client_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint care_dates check (needed_until is null or needed_on is null or needed_until >= needed_on),
  constraint care_closed check ((status = 'closed') = (closed_at is not null))
);
create index care_requests_queue_idx on prayer.care_requests (status, created_at);
create index care_requests_requester_idx on prayer.care_requests (requester_id, created_at desc);
create index care_requests_assigned_idx on prayer.care_requests (assigned_to);
create index care_requests_follow_up_idx on prayer.care_requests (follow_up_on) where follow_up_on is not null;
create unique index care_requests_client_key_idx on prayer.care_requests (requester_id, client_key) where client_key is not null;

-- Messages between the requester and the care team (both can read them).
create table prayer.care_messages (
  id uuid primary key default gen_random_uuid(),
  care_id uuid not null references prayer.care_requests (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  from_team boolean not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index care_messages_care_idx on prayer.care_messages (care_id, created_at);
create index care_messages_author_idx on prayer.care_messages (author_id);

-- Internal notes: never shown to the requester. Readable only by the
-- assigned coordinator and care.assign holders.
create table prayer.care_notes (
  id uuid primary key default gen_random_uuid(),
  care_id uuid not null references prayer.care_requests (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index care_notes_care_idx on prayer.care_notes (care_id, created_at);
create index care_notes_author_idx on prayer.care_notes (author_id);

-- Activity history: actions and state changes only (never note/message text).
create table prayer.care_activity (
  id bigint generated always as identity primary key,
  care_id uuid not null references prayer.care_requests (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+$'),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index care_activity_care_idx on prayer.care_activity (care_id, created_at);
create index care_activity_actor_idx on prayer.care_activity (actor_id);

-- Limited, care-specific volunteer signups (not the Phase 11 system).
create table prayer.care_opportunities (
  id uuid primary key default gen_random_uuid(),
  care_id uuid not null references prayer.care_requests (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  -- Shown to everyone in the eligible audience: keep it generic.
  title text not null check (char_length(btrim(title)) between 3 and 120),
  details text not null default '' check (char_length(details) <= 600),
  starts_at timestamptz not null,
  ends_at timestamptz,
  helpers_needed smallint not null default 1 check (helpers_needed between 1 and 20),
  audience text not null default 'church' check (audience in ('church', 'group', 'team')),
  group_id uuid references community.groups (id) on delete restrict,
  -- Shown only to ACCEPTED volunteers, and only while the requester consents.
  logistics text not null default '' check (char_length(logistics) <= 1000),
  share_name boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'open', 'filled', 'completed', 'canceled')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunities_group check ((audience = 'group') = (group_id is not null)),
  constraint opportunities_times check (ends_at is null or ends_at > starts_at)
);
create index care_opportunities_status_idx on prayer.care_opportunities (status, starts_at);
create index care_opportunities_care_idx on prayer.care_opportunities (care_id);
create index care_opportunities_group_idx on prayer.care_opportunities (group_id);
create index care_opportunities_created_by_idx on prayer.care_opportunities (created_by);

create table prayer.care_signups (
  opportunity_id uuid not null references prayer.care_opportunities (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'withdrawn', 'completed')),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  primary key (opportunity_id, profile_id)
);
create index care_signups_profile_idx on prayer.care_signups (profile_id);
create index care_signups_decided_by_idx on prayer.care_signups (decided_by);

do $rls$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'prayer' loop
    execute format('alter table prayer.%I enable row level security', t);
  end loop;
end
$rls$;

-- ---------------------------------------------------------------------------
-- Access helpers (internal; not executable by clients)
-- ---------------------------------------------------------------------------

-- Approved adult account (youth participation stays off until Phase 10).
create function prayer.is_member(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select community.is_member(p_profile);
$$;

create function prayer.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not prayer.is_member(v_uid) then
    raise exception 'Only approved members can use prayer and care.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Whether a person (not necessarily the caller) holds a prayer/care
-- capability through an explicit role, while approved. Used when deciding
-- who may receive a notification or remain assigned.
create function prayer.holds(p_profile uuid, p_capability text)
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

create function prayer.require_capability(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  if not prayer.holds(v_uid, p_capability) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Whether a person is in an audience right now.
create function prayer.in_audience(p_profile uuid, p_audience prayer.audience, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select prayer.is_member(p_profile) and case p_audience
    when 'church' then true
    when 'group' then community.group_member(p_group, p_profile)
    when 'team' then prayer.holds(p_profile, 'prayer.confidential')
    else false
  end;
$$;

-- The single read rule. The author (while approved) always; anyone else
-- only when the request is not archived, not hidden by a moderator, and
-- they are in its current audience.
create function prayer.can_read(r prayer.requests, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select r.id is not null and prayer.is_member(p_profile)
     and (r.author_id = p_profile
          or (r.status <> 'archived' and r.hidden_at is null and prayer.in_audience(p_profile, r.audience, r.group_id)));
$$;

create function prayer.can_read_id(p_request uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select prayer.can_read(r, p_profile) from prayer.requests r where r.id = p_request), false);
$$;

-- An update or comment is shown to a reader of the request only if the
-- reader was also within the audience it was written for (or is the request
-- author or the item's author). Narrowing applies at once (they must still
-- be able to read the request); broadening never reveals earlier items.
create function prayer.sees_item(r prayer.requests, p_posted_audience prayer.audience, p_posted_group uuid, p_item_author uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select prayer.can_read(r, p_profile)
     and (p_profile = r.author_id or p_profile = p_item_author
          or prayer.in_audience(p_profile, p_posted_audience, p_posted_group));
$$;

-- Whether moving from one audience to another only narrows it (every new
-- reader could already read). Everything else is a broadening that needs an
-- explicit confirmation naming the new audience.
create function prayer.is_narrowing(p_old prayer.audience, p_old_group uuid, p_new prayer.audience, p_new_group uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_new = 'private'
      or p_old = 'church'
      or (p_old = p_new and p_old_group is not distinct from p_new_group);
$$;

-- Author label: never a name for an anonymous request.
create function prayer.author_label(r prayer.requests, p_viewer uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.anonymous then 'Anonymous'
              else community.display_name(r.author_id) end;
$$;

-- Generic audit entry (never content).
create function prayer.audit(p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id::text, coalesce(p_details, '{}'::jsonb));
$$;

-- Access record, at most one per actor, action, and target per hour (so a
-- refresh doesn't flood the log).
create function prayer.log_access(p_action text, p_target_type text, p_target_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_reason is null and exists (
       select 1 from prayer.access_log
        where actor_id = v_uid and action = p_action and target_id = p_target_id and created_at > now() - interval '1 hour') then
    return;
  end if;
  insert into prayer.access_log (actor_id, action, target_type, target_id, reason)
  values (v_uid, p_action, p_target_type, p_target_id, left(p_reason, 500));
end;
$$;

create function prayer.mod_log(p_action text, p_report uuid, p_target_type text, p_target_id uuid, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into prayer.moderation_log (actor_id, action, report_id, target_type, target_id, reason)
  values ((select auth.uid()), p_action, p_report, p_target_type, p_target_id, left(p_reason, 1000));
$$;

create function prayer.care_log(p_care uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into prayer.care_activity (care_id, actor_id, action, detail)
  values (p_care, (select auth.uid()), p_action, coalesce(p_detail, '{}'::jsonb));
$$;

-- Escapes LIKE wildcards in member search text.
create function prayer.like_pattern(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(btrim(coalesce(p, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- ---------------------------------------------------------------------------
-- Losing access: leaving a group, suspension, or role revocation.
-- Reads are always rechecked, so access ends at once. These triggers also
-- tidy what would otherwise linger: follows of requests the person can no
-- longer read, care assignments they can no longer hold, and their unread
-- prayer/care notifications that are no longer visible to them.
-- ---------------------------------------------------------------------------
create function prayer.reconcile_access(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_care uuid;
begin
  if p_profile is null then
    return;
  end if;
  delete from prayer.follows f
   using prayer.requests r
   where r.id = f.request_id and f.profile_id = p_profile and not prayer.can_read(r, p_profile);
  if not prayer.holds(p_profile, 'care.coordinate') then
    for v_care in
      update prayer.care_requests set assigned_to = null, updated_at = now()
       where assigned_to = p_profile and status <> 'closed'
      returning id
    loop
      insert into prayer.care_activity (care_id, actor_id, action, detail)
      values (v_care, null, 'unassigned', jsonb_build_object('why', 'access_ended'));
    end loop;
  end if;
end;
$$;

create function prayer.on_group_membership_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'active' and new.state <> 'active' then
    perform prayer.reconcile_access(new.profile_id);
  end if;
  return new;
end;
$$;

create trigger group_members_prayer_access
  after update of state on community.group_members
  for each row execute function prayer.on_group_membership_end();

create function prayer.on_profile_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.membership_status = 'approved' and new.membership_status <> 'approved' then
    perform prayer.reconcile_access(new.id);
  end if;
  return new;
end;
$$;

create trigger profiles_prayer_access
  after update of membership_status on public.profiles
  for each row execute function prayer.on_profile_status();

create function prayer.on_role_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform prayer.reconcile_access(old.user_id);
  return old;
end;
$$;

create trigger user_roles_prayer_access
  after delete on public.user_roles
  for each row execute function prayer.on_role_revoked();

revoke execute on all functions in schema prayer from public, anon, authenticated;
