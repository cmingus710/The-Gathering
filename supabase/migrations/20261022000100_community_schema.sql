-- Phase 5 · Community: schema, roles, and access rules.
--
-- Everything lives in a private `community` schema that the Data API does
-- not expose and that anon/authenticated cannot read. Members reach it only
-- through SECURITY DEFINER functions (20261022000200…000400) that check, on
-- every call: approved membership, adult account, current group membership,
-- guideline acknowledgment, community restrictions, blocks, and rate limits.
--
-- Separation of duties
--   community.manage    categories, guidelines, community settings, creating
--                       and archiving groups, appointing group leaders. Can see
--                       that hidden groups exist and who belongs to them, but
--                       NOT their discussions (only active members can).
--   community.moderate  report queue, hide/restore content, lock threads,
--                       community posting/messaging restrictions. Reads only
--                       the evidence captured in a report, never a whole
--                       private conversation. Every evidence view is logged.
--   group leaders       per-group (community.group_members.role = 'leader'),
--                       not a global role: they administer and moderate only
--                       their own groups and receive no capability at all.
--   members.manage      (existing) sets direct-message eligibility, the only
--                       trusted adult classification for messaging.
-- Church membership suspension stays with membership administrators
-- (admin_set_membership_status); community restrictions never change it.

-- ---------------------------------------------------------------------------
-- Capabilities and roles
-- ---------------------------------------------------------------------------
insert into public.capabilities (key, description, available) values
  ('community.manage', 'Manage discussion categories, community guidelines and settings, and groups (create, archive, appoint leaders)', true),
  ('community.moderate', 'Review community reports, hide or restore posts, lock discussions, and apply community restrictions', true);

insert into public.roles (key, name, description, assignable, sort_order) values
  ('community_admin', 'Community administrator',
   'Manages discussion categories, guidelines, and groups. Cannot read private group discussions or messages. No membership, finance, or role access.', true, 37),
  ('community_moderator', 'Community moderator',
   'Reviews reports and moderates community content. Sees only reported evidence. No membership, finance, or role access.', true, 38);

insert into public.role_capabilities (role_key, capability_key) values
  ('community_admin', 'community.manage'),
  ('community_moderator', 'community.moderate');

-- Group leadership is assigned per group, not through this global role.
update public.roles
   set description = 'Reserved. Group leaders are appointed per group in Administration → Community → Groups; they receive no global capability.'
 where key = 'group_leader';

-- ---------------------------------------------------------------------------
-- Schema and types
-- ---------------------------------------------------------------------------
create schema community;
revoke all on schema community from public, anon, authenticated;

create type community.content_status as enum ('visible', 'hidden', 'deleted');
create type community.group_visibility as enum ('discoverable', 'hidden');
create type community.group_status as enum ('active', 'archived');
create type community.member_role as enum ('member', 'leader');
create type community.membership_state as enum ('active', 'left', 'removed');
create type community.dm_allow as enum ('members', 'shared_groups', 'none');

-- ---------------------------------------------------------------------------
-- Settings and guidelines (singleton)
-- ---------------------------------------------------------------------------
create table community.settings (
  id boolean primary key default true check (id),
  guidelines text not null default
    E'Welcome to our community space. Please:\n\n'
    '- **Be kind.** Speak to one another with grace and respect.\n'
    '- **Keep it on topic.** Use the category or group that fits your conversation.\n'
    '- **Protect privacy.** Don''t share other people''s personal details or prayer needs without permission.\n'
    '- **No selling or spam.**\n'
    '- **Report, don''t retaliate.** If something seems wrong, use *Report* and a moderator will review it.\n\n'
    'Discussions are visible to approved members (or only to a group''s members when posted in a group). '
    'Direct messages are visible only to the two people in the conversation; they are access-controlled, not end-to-end encrypted.'
    check (char_length(guidelines) between 1 and 10000),
  guidelines_version integer not null default 1 check (guidelines_version >= 1),
  -- Local hour (member's time zone, church fallback) when digests are sent.
  digest_hour smallint not null default 7 check (digest_hour between 0 and 23),
  -- 0 = Sunday … 6 = Saturday, for weekly digests.
  weekly_digest_dow smallint not null default 1 check (weekly_digest_dow between 0 and 6),
  -- Direct messages older than this are deleted by the scheduler.
  dm_retention_days integer not null default 730 check (dm_retention_days between 30 and 3650),
  -- Report evidence is cleared this many days after a report is closed.
  report_evidence_days integer not null default 180 check (report_evidence_days between 7 and 1095),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into community.settings default values;

create table community.guideline_acks (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null,
  acked_at timestamptz not null default now(),
  primary key (profile_id, version)
);

-- ---------------------------------------------------------------------------
-- Direct-message eligibility: the trusted adult classification.
-- profiles.account_kind defaults to 'adult' for every registration and has
-- never been verified, so it is not relied on alone. Messaging needs an
-- explicit, audited decision by a membership administrator. No row = not
-- eligible (fails closed).
-- ---------------------------------------------------------------------------
create table community.dm_eligibility (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  eligible boolean not null,
  basis text not null check (basis in ('adult_confirmed', 'revoked')),
  note text check (char_length(note) <= 300),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now()
);
create index dm_eligibility_decided_by_idx on community.dm_eligibility (decided_by);

-- ---------------------------------------------------------------------------
-- Community restrictions (separate from church membership status)
-- ---------------------------------------------------------------------------
create table community.restrictions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  scope text not null check (scope in ('posting', 'messaging', 'all')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references public.profiles (id) on delete set null,
  check (ends_at is null or ends_at > starts_at)
);
create index restrictions_profile_idx on community.restrictions (profile_id, lifted_at);
create index restrictions_created_by_idx on community.restrictions (created_by);
create index restrictions_lifted_by_idx on community.restrictions (lifted_by);

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
create table community.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  -- Short description shown to every approved member for a discoverable
  -- group. Never contains discussions or the roster.
  summary text not null default '' check (char_length(summary) <= 400),
  -- Longer details (meeting time, place) shown only to active members.
  about text not null default '' check (char_length(about) <= 5000),
  image_path text check (char_length(image_path) <= 300),
  image_alt text check (char_length(image_alt) <= 300),
  visibility community.group_visibility not null default 'discoverable',
  -- Discoverable groups can take join requests; otherwise invitation only.
  accepts_requests boolean not null default true,
  status community.group_status not null default 'active',
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_image_alt check (image_path is null or char_length(btrim(coalesce(image_alt, ''))) > 0),
  constraint groups_archived check ((status = 'archived') = (archived_at is not null)),
  constraint groups_hidden_no_requests check (visibility = 'discoverable' or not accepts_requests)
);
create index groups_status_idx on community.groups (status, visibility, lower(name));
create index groups_created_by_idx on community.groups (created_by);

create table community.group_members (
  group_id uuid not null references community.groups (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role community.member_role not null default 'member',
  state community.membership_state not null default 'active',
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (group_id, profile_id),
  check ((state = 'active') = (ended_at is null))
);
create index group_members_profile_idx on community.group_members (profile_id, state);
create index group_members_ended_by_idx on community.group_members (ended_by);

create table community.group_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references community.groups (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  message text check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index group_requests_one_pending on community.group_requests (group_id, profile_id) where status = 'pending';
create index group_requests_profile_idx on community.group_requests (profile_id);
create index group_requests_decided_by_idx on community.group_requests (decided_by);

-- Invitations must be accepted, expire after 14 days, can be revoked, and can
-- be answered once (row lock + status check).
create table community.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references community.groups (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at timestamptz not null default now() + interval '14 days',
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index group_invitations_one_pending on community.group_invitations (group_id, invitee_id) where status = 'pending';
create index group_invitations_invitee_idx on community.group_invitations (invitee_id, status);
create index group_invitations_invited_by_idx on community.group_invitations (invited_by);

-- ---------------------------------------------------------------------------
-- Forum
-- ---------------------------------------------------------------------------
create table community.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into community.categories (name, description, sort_order) values
  ('General Discussion', 'Anything on your heart for the church family.', 10),
  ('Sunday Conversations', 'Follow-up on Sunday''s message and worship.', 20),
  ('Fellowship', 'Get-togethers, meals, and getting to know one another.', 30),
  ('Serving', 'Opportunities to serve and volunteer.', 40);

-- A thread belongs to exactly one place: a church-wide category or a group.
-- Bodies use a limited Markdown subset rendered safely by the app (no raw
-- HTML, no images, only http(s)/mailto links).
create table community.threads (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references community.categories (id),
  group_id uuid references community.groups (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) <= 160),
  body text not null check (char_length(body) <= 10000),
  status community.content_status not null default 'visible',
  pinned boolean not null default false,
  locked boolean not null default false,
  reply_count integer not null default 0,
  -- Idempotency key from the composer: a retried submit never duplicates.
  client_key uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  last_activity_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  constraint threads_one_place check ((category_id is null) <> (group_id is null)),
  -- Author deletion erases the text; nothing removed stays in the row.
  constraint threads_deleted_erased check (status <> 'deleted' or (title = '' and body = '' and deleted_at is not null)),
  constraint threads_visible_text check (status = 'deleted' or (char_length(btrim(title)) >= 3 and char_length(btrim(body)) >= 1))
);
create index threads_category_activity_idx on community.threads (category_id, pinned desc, last_activity_at desc, id) where category_id is not null;
create index threads_group_activity_idx on community.threads (group_id, pinned desc, last_activity_at desc, id) where group_id is not null;
create index threads_activity_idx on community.threads (last_activity_at desc, id);
create index threads_author_idx on community.threads (author_id);
create unique index threads_client_key_idx on community.threads (author_id, client_key) where client_key is not null;
create index threads_hidden_by_idx on community.threads (hidden_by);

create table community.posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references community.threads (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) <= 5000),
  status community.content_status not null default 'visible',
  client_key uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  constraint posts_deleted_erased check (status <> 'deleted' or (body = '' and deleted_at is not null)),
  constraint posts_visible_text check (status = 'deleted' or char_length(btrim(body)) >= 1)
);
create index posts_thread_idx on community.posts (thread_id, created_at, id);
create index posts_author_idx on community.posts (author_id);
create unique index posts_client_key_idx on community.posts (thread_id, author_id, client_key) where client_key is not null;
create index posts_hidden_by_idx on community.posts (hidden_by);

create table community.reactions (
  target_type text not null check (target_type in ('thread', 'post')),
  target_id uuid not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('heart', 'pray', 'amen')),
  created_at timestamptz not null default now(),
  primary key (target_type, target_id, profile_id, kind)
);
create index reactions_profile_idx on community.reactions (profile_id);

create table community.follows (
  thread_id uuid not null references community.threads (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, profile_id)
);
create index follows_profile_idx on community.follows (profile_id);

-- Mutes stop new notifications for a thread, group, or conversation.
create table community.mutes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('thread', 'group', 'conversation')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, target_type, target_id)
);

-- ---------------------------------------------------------------------------
-- Direct messages (one-to-one, text only)
-- ---------------------------------------------------------------------------
create table community.conversations (
  id uuid primary key default gen_random_uuid(),
  -- member_a < member_b, so each pair has one conversation.
  member_a uuid not null references public.profiles (id) on delete cascade,
  member_b uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (member_a, member_b),
  check (member_a < member_b)
);
create index conversations_b_idx on community.conversations (member_b);
create index conversations_created_by_idx on community.conversations (created_by);

create table community.conversation_state (
  conversation_id uuid not null references community.conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default '-infinity',
  -- "Delete conversation" for this member: earlier messages are hidden from
  -- them, and purged once both members have cleared them.
  cleared_at timestamptz not null default '-infinity',
  primary key (conversation_id, profile_id)
);
create index conversation_state_profile_idx on community.conversation_state (profile_id);

create table community.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references community.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  -- Idempotency key from the sending form: a retried send never duplicates.
  client_key uuid not null,
  created_at timestamptz not null default now()
);
create unique index messages_client_key_idx on community.messages (conversation_id, sender_id, client_key);
create index messages_conversation_idx on community.messages (conversation_id, created_at desc, id);
create index messages_sender_idx on community.messages (sender_id);
create index messages_created_idx on community.messages (created_at);

create table community.dm_prefs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  allow community.dm_allow not null default 'members',
  updated_at timestamptz not null default now()
);

create table community.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on community.blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- Reports and moderation
-- ---------------------------------------------------------------------------
create table community.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('thread', 'post', 'message')),
  -- The reported item(s). For messages: the specific messages the reporter
  -- selected (never the whole conversation).
  target_ids uuid[] not null check (cardinality(target_ids) between 1 and 20),
  thread_id uuid references community.threads (id) on delete set null,
  group_id uuid references community.groups (id) on delete set null,
  conversation_id uuid references community.conversations (id) on delete set null,
  reported_profile_id uuid references public.profiles (id) on delete set null,
  -- Leaders can't review reports about a leader of their own group.
  involves_group_leader boolean not null default false,
  reason text not null check (reason in ('harassment', 'spam', 'inappropriate', 'safety', 'privacy', 'other')),
  details text check (char_length(details) <= 1000),
  -- Snapshot of only the selected items, taken when reported, so moderators
  -- see what was reported even if it is later edited or deleted. Cleared
  -- report_evidence_days after the report is closed.
  evidence jsonb check (evidence is null or jsonb_typeof(evidence) = 'array'),
  evidence_cleared_at timestamptz,
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  resolution text check (char_length(resolution) <= 1000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_status_idx on community.reports (status, created_at);
create index reports_group_idx on community.reports (group_id, status);
create index reports_reporter_idx on community.reports (reporter_id);
create index reports_reported_idx on community.reports (reported_profile_id);
create index reports_thread_idx on community.reports (thread_id);
create index reports_conversation_idx on community.reports (conversation_id);
create index reports_resolved_by_idx on community.reports (resolved_by);

-- Who looked at or acted on what. Never contains content.
create table community.moderation_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  report_id uuid references community.reports (id) on delete set null,
  target_type text,
  target_id uuid,
  reason text check (char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index moderation_log_report_idx on community.moderation_log (report_id);
create index moderation_log_actor_idx on community.moderation_log (actor_id);
create index moderation_log_created_idx on community.moderation_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table community.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'reply_followed', 'reply_mine', 'group_invitation', 'group_request', 'group_request_approved',
    'group_request_declined', 'group_removed', 'group_role', 'message', 'moderation', 'event')),
  category text not null check (category in ('forum', 'groups', 'messages', 'moderation', 'events')),
  actor_id uuid references public.profiles (id) on delete set null,
  -- References only; titles and wording are computed when read, after the
  -- reader's current access is rechecked.
  thread_id uuid references community.threads (id) on delete cascade,
  post_id uuid references community.posts (id) on delete cascade,
  group_id uuid references community.groups (id) on delete cascade,
  conversation_id uuid references community.conversations (id) on delete cascade,
  invitation_id uuid references community.group_invitations (id) on delete cascade,
  request_id uuid references community.group_requests (id) on delete cascade,
  occurrence_id uuid references events.occurrences (id) on delete cascade,
  -- Flags only (e.g. event change kind, moderation action); never content.
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  -- Unread notifications for the same thing are merged (count + latest time).
  merge_key text check (char_length(merge_key) <= 200),
  count integer not null default 1 check (count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz
);
create unique index notifications_merge_idx on community.notifications (profile_id, merge_key) where read_at is null and merge_key is not null;
create index notifications_profile_idx on community.notifications (profile_id, updated_at desc, id);
create index notifications_unread_idx on community.notifications (profile_id) where read_at is null;
create index notifications_actor_idx on community.notifications (actor_id);
create index notifications_thread_idx on community.notifications (thread_id);
create index notifications_post_idx on community.notifications (post_id);
create index notifications_group_idx on community.notifications (group_id);
create index notifications_conversation_idx on community.notifications (conversation_id);
create index notifications_invitation_idx on community.notifications (invitation_id);
create index notifications_request_idx on community.notifications (request_id);
create index notifications_occurrence_idx on community.notifications (occurrence_id);

-- Per category: in-app on/off (moderation is always on), email mode, push.
-- Missing rows use community.default_pref().
create table community.notification_prefs (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('forum', 'groups', 'messages', 'moderation', 'events')),
  in_app boolean not null default true,
  email text not null default 'off' check (email in ('off', 'immediate', 'daily', 'weekly')),
  push boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (profile_id, category),
  -- Message emails are never digested (they carry no content anyway).
  check (category <> 'messages' or email in ('off', 'immediate'))
);

create table community.member_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  -- IANA time zone; null = the church's time zone.
  timezone text check (char_length(timezone) <= 64),
  quiet_enabled boolean not null default false,
  quiet_start time not null default '21:00',
  quiet_end time not null default '07:00',
  last_digest_at timestamptz,
  updated_at timestamptz not null default now(),
  check (quiet_start <> quiet_end)
);

-- Email delivery records. Rendered at send time, after access is rechecked.
create table community.email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  kind text not null check (kind in ('immediate', 'digest')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  notification_id uuid references community.notifications (id) on delete set null,
  -- Digests: the window of notifications they summarize, and whether this
  -- one also includes weekly-digest categories.
  digest_weekly boolean not null default false,
  period_start timestamptz,
  period_end timestamptz,
  send_after timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'suppressed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 300),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index community_email_due_idx on community.email_outbox (status, next_attempt_at, send_after);
create index community_email_profile_idx on community.email_outbox (profile_id);
create index community_email_notification_idx on community.email_outbox (notification_id);

-- Web push: one row per browser/device. Keys are only ever read by the
-- signed job (server side).
create table community.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  label text check (char_length(label) <= 80),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);
create index push_subscriptions_profile_idx on community.push_subscriptions (profile_id);

create table community.push_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  notification_id uuid references community.notifications (id) on delete cascade,
  send_after timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index community_push_due_idx on community.push_outbox (status, next_attempt_at, send_after);
create index community_push_profile_idx on community.push_outbox (profile_id);
create index community_push_notification_idx on community.push_outbox (notification_id);

-- Server-side rate limits (sliding window by counting recent actions).
create table community.rate_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on community.rate_events (profile_id, action, created_at desc);
create index rate_events_created_idx on community.rate_events (created_at);

do $rls$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'community' loop
    execute format('alter table community.%I enable row level security', t);
  end loop;
end
$rls$;

-- ---------------------------------------------------------------------------
-- Access helpers (internal; not executable by clients)
-- ---------------------------------------------------------------------------

-- Approved adult account.
create function community.is_member(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_profile and p.membership_status = 'approved' and p.account_kind = 'adult');
$$;

create function community.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not community.is_member(v_uid) then
    raise exception 'Only approved members can use the community.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function community.require_capability(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.has_capability(p_capability)) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

create function community.restricted(p_profile uuid, p_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from community.restrictions r
     where r.profile_id = p_profile
       and r.lifted_at is null
       and r.starts_at <= now()
       and (r.ends_at is null or r.ends_at > now())
       and (r.scope = p_scope or r.scope = 'all'));
$$;

create function community.has_acked(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from community.guideline_acks a
     where a.profile_id = p_profile and a.version = (select guidelines_version from community.settings));
$$;

-- Server-side rate limit. Raises when the caller has done p_action p_max
-- times within p_window; otherwise records this attempt.
create function community.rate_limit(p_profile uuid, p_action text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from (
        select 1 from community.rate_events
         where profile_id = p_profile and action = p_action and created_at > now() - p_window
         limit p_max) x) >= p_max then
    raise exception 'You''re doing that too often. Please wait a few minutes and try again.' using errcode = '22023';
  end if;
  insert into community.rate_events (profile_id, action) values (p_profile, p_action);
end;
$$;

-- Posting: approved adult, current guidelines acknowledged, no restriction.
create function community.require_poster()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if not community.has_acked(v_uid) then
    raise exception 'Please read and accept the community guidelines first.' using errcode = '22023';
  end if;
  if community.restricted(v_uid, 'posting') then
    raise exception 'Your community posting is paused by a moderator. You can still read discussions.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function community.group_member(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from community.group_members m
      join public.profiles p on p.id = m.profile_id
     where m.group_id = p_group and m.profile_id = p_profile and m.state = 'active'
       and p.membership_status = 'approved' and p.account_kind = 'adult');
$$;

create function community.group_leader(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from community.group_members m
      join community.groups g on g.id = m.group_id and g.status = 'active'
      join public.profiles p on p.id = m.profile_id
     where m.group_id = p_group and m.profile_id = p_profile and m.state = 'active' and m.role = 'leader'
       and p.membership_status = 'approved' and p.account_kind = 'adult');
$$;

-- Whether the caller (auth.uid()) can administer a group: its active
-- leaders, or community.manage holders. Never derived from households or
-- ministry interests.
create function community.can_manage_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select community.group_leader(p_group, (select auth.uid()))
      or ((select public.has_capability('community.manage')) and exists (select 1 from community.groups where id = p_group));
$$;

-- Whether a person may know a group exists (name, summary, image).
create function community.can_see_group(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select community.is_member(p_profile) and exists (
    select 1 from community.groups g
     where g.id = p_group
       and ((g.visibility = 'discoverable' and g.status = 'active')
            or community.group_member(g.id, p_profile)
            or (p_profile = (select auth.uid()) and (select public.has_capability('community.manage')))));
$$;

-- Whether a person may read a thread's place (category or group). Church-wide
-- discussions: approved adult members. Group discussions: active members
-- of that group only.
create function community.can_read_thread(p_thread uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select community.is_member(p_profile) and exists (
    select 1 from community.threads t
     where t.id = p_thread
       and (t.group_id is null or community.group_member(t.group_id, p_profile)));
$$;

-- Content moderation scope for the caller: community moderators everywhere;
-- leaders in their own group's discussions.
create function community.can_moderate_thread(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from community.threads t
     where t.id = p_thread
       and ((select public.has_capability('community.moderate'))
            or (t.group_id is not null and community.group_leader(t.group_id, (select auth.uid())))));
$$;

-- Direct-message eligibility: approved adult with an explicit, audited
-- eligibility decision, and not restricted from messaging. Unknown = no.
create function community.dm_eligible(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select community.is_member(p_profile)
     and exists (select 1 from community.dm_eligibility e where e.profile_id = p_profile and e.eligible)
     and not community.restricted(p_profile, 'messaging');
$$;

create function community.blocked_either(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from community.blocks
                  where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a));
$$;

create function community.share_group(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from community.group_members a
      join community.group_members b on b.group_id = a.group_id and b.profile_id = p_b and b.state = 'active'
      join community.groups g on g.id = a.group_id and g.status = 'active'
     where a.profile_id = p_a and a.state = 'active');
$$;

-- Whether p_sender may send p_recipient a direct message right now. Checked
-- on every send (new and existing conversations). Callers get one generic
-- refusal for every "no", so a block is never revealed.
create function community.can_message(p_sender uuid, p_recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_sender is not null and p_recipient is not null and p_sender <> p_recipient
     and community.dm_eligible(p_sender)
     and community.dm_eligible(p_recipient)
     and not community.blocked_either(p_sender, p_recipient)
     and case coalesce((select allow from community.dm_prefs where profile_id = p_recipient), 'members')
           when 'members' then true
           when 'shared_groups' then community.share_group(p_sender, p_recipient)
           else false
         end;
$$;

create function community.display_name(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.directory_display_name(p) from public.profiles p where p.id = p_profile), 'Former member');
$$;

-- Time zone for a member's quiet hours and digests (church fallback).
create function community.member_tz(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.timezone from community.member_settings s
      where s.profile_id = p_profile
        and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = s.timezone)),
    (select timezone from public.church_settings),
    'America/Chicago');
$$;

-- The earliest time at or after p_at that falls outside the member's quiet
-- hours (quiet_start inclusive, quiet_end exclusive; may wrap midnight).
create function community.after_quiet(p_profile uuid, p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s community.member_settings;
  v_tz text := community.member_tz(p_profile);
  v_local timestamp;
  v_t time;
  v_end timestamp;
begin
  select * into s from community.member_settings where profile_id = p_profile;
  if not found or not s.quiet_enabled then
    return p_at;
  end if;
  v_local := p_at at time zone v_tz;
  v_t := v_local::time;
  if s.quiet_start < s.quiet_end then
    if v_t >= s.quiet_start and v_t < s.quiet_end then
      v_end := v_local::date + s.quiet_end;
    else
      return p_at;
    end if;
  else
    if v_t >= s.quiet_start then
      v_end := v_local::date + 1 + s.quiet_end;
    elsif v_t < s.quiet_end then
      v_end := v_local::date + s.quiet_end;
    else
      return p_at;
    end if;
  end if;
  return v_end at time zone v_tz;
end;
$$;

-- Realtime: a content-free "something changed" signal on the member's own
-- private channel (member:<id>). Clients then refetch through the normal,
-- access-checked functions. Never carries message text, titles, or names.
-- A Realtime failure never blocks the change itself.
create function community.ping(p_profile uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile is null then
    return;
  end if;
  begin
    perform realtime.send(jsonb_build_object('kind', p_kind), 'refresh', 'member:' || p_profile::text, true);
  exception when others then
    null;
  end;
end;
$$;

-- Generic audit entry (never content).
create function community.audit(p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

create function community.mod_log(p_action text, p_report uuid, p_target_type text, p_target_id uuid, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into community.moderation_log (actor_id, action, report_id, target_type, target_id, reason)
  values ((select auth.uid()), p_action, p_report, p_target_type, p_target_id, left(p_reason, 1000));
$$;

-- ---------------------------------------------------------------------------
-- Last-leader protection: an active group always keeps at least one active
-- leader, unless it is archived in the same change.
-- ---------------------------------------------------------------------------
create function community.guard_last_leader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid := new.group_id;
begin
  perform pg_advisory_xact_lock(hashtext('community.group:' || v_group::text));
  if exists (select 1 from community.groups where id = v_group and status = 'active')
     and old.role = 'leader' and old.state = 'active'
     and (new.role <> 'leader' or new.state <> 'active')
     and not exists (select 1 from community.group_members
                      where group_id = v_group and role = 'leader' and state = 'active'
                        and profile_id <> old.profile_id) then
    raise exception 'A group needs at least one leader. Appoint another leader first, or archive the group.' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Updates only: rows are never deleted by the app (leaving or removal is a
-- state change); a cascade from a deleted account is allowed through.
create trigger group_members_last_leader
  before update on community.group_members
  for each row execute function community.guard_last_leader();

revoke execute on all functions in schema community from public, anon, authenticated;
