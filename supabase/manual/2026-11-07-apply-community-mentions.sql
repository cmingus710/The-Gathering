-- Community mentions · Apply migration 20261107000100_community_mentions to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/community-mentions.md, "Before merging"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: a new table community.mentions, four save triggers on
-- community.threads / community.posts, private helpers, one new member
-- function (community_mention_search, granted to `authenticated`), a new
-- notification kind/category (constraints widened, nothing removed), and
-- create-or-replace of the shared notification functions and feed cards
-- with the mention case added. No existing rows change.
--
-- It copies supabase/migrations/20261107000100_community_mentions.sql
-- verbatim and records it under its repository version (created_by =
-- community-mentions). All or nothing: one transaction; out of order or a
-- second run stops at the preflight with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('community.threads') is null or to_regprocedure('public.community_feed(uuid, uuid, timestamptz, uuid, integer)') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261106000100') then
    raise exception 'Nothing was changed: the previous step (20261106000100) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261107000100')
     or to_regclass('community.mentions') is not null then
    raise exception 'Nothing was changed: 20261107000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261107000100_community_mentions.sql
-- =========================================================================
-- Community · @mentions in posts and comments (additive).
--
-- Markup. A mention is stored in the post or comment text as
--   @[Display name](mention:<member id>)
-- The id is what counts: the label is only the name at the time of writing
-- and is shown when the member can't be shown any more. Text that merely
-- contains "@" (an email address, "@home") is never a mention; only this
-- markup, which the composer inserts when a member is chosen, is.
--
-- Who can be mentioned (community.can_mention), checked on every save and
-- again on every read and delivery:
--   * an approved adult member listed in the directory (pending, suspended,
--     youth, and opted-out accounts never), so the directory's own privacy
--     choices decide who can be found;
--   * who can read the post: anyone such for a church-wide post, only
--     current members of the group for a group post (a mention never grants
--     access to anything);
--   * and who hasn't blocked the author, nor been blocked by them.
-- On save, markup for anyone else (a forged id, someone who left the group)
-- is turned back into plain "@Name" text in the same statement, so stored
-- markup always points at someone who could be mentioned when it was
-- saved. At most 10 different people per post or comment; no @everyone.
--
-- Records. community.mentions holds one row per (post or comment, member):
-- removed_at is set when an edit takes the mention out (and cleared if it's
-- put back), notified_at once a notice was attempted. Rows are written by
-- triggers on community.threads and community.posts, so every path that
-- saves text (create, create with photos, edit, author delete) keeps them
-- consistent in the same transaction, and a failed save leaves nothing.
--
-- Notifications (kind 'mention', new category 'mentions', "Someone
-- mentions me" in Notifications → Settings; in app on, email off, push off
-- by default):
--   * one per member per post or comment, ever: a retried submit (same
--     client key) inserts nothing, unchanged mentions in an edit are already
--     notified, and removing and re-adding someone doesn't notify again;
--   * never for the author themself, and only for visible content;
--   * the existing rules apply through community.notify: blocks, mutes,
--     preferences, quiet hours, merge keys, email and push outboxes;
--   * a reply that mentions someone doesn't also count as a reply notice for
--     them (community.notify skips reply_mine / reply_followed then);
--   * notification_visible rechecks, on every read and every email or push
--     claim, that the mention is still in the text, the post or comment is
--     visible, the member can still read the post, and hasn't blocked the
--     author; otherwise the notice disappears and queued email or push is
--     skipped;
--   * push is generic ("Someone mentioned you in Community."); email names
--     who mentioned you for church-wide posts (like reply emails) and only
--     the group for group posts; both link to /notifications/open/<id>,
--     which rechecks access and opens the post with the comment revealed.
--   * New mention notices are rate-limited per author (50 an hour) with the
--     existing community.rate_limit.
--
-- Suggestions (public.community_mention_search): server-side, for a post's
-- place (category, group, or an existing post), at most 8, name only plus
-- the photo and city a member chose to share in the directory. Never an
-- email address, phone number, or hidden field. Rate-limited.
--
-- The shared notification functions below are the current definitions
-- (20261028000900_youth_notifications, 20261025000600 for pref,
-- 20261101000100 for the panel, 20261022000300 / 20261101000200 for the
-- cards) with the mention case added.

-- ---------------------------------------------------------------------------
-- Records
-- ---------------------------------------------------------------------------
create table community.mentions (
  thread_id uuid not null references community.threads (id) on delete cascade,
  -- Null for a mention in the post itself; the comment otherwise.
  post_id uuid references community.posts (id) on delete cascade,
  target_id uuid generated always as (coalesce(post_id, thread_id)) stored,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  notified_at timestamptz,
  notification_id uuid references community.notifications (id) on delete set null,
  primary key (target_id, profile_id)
);
create index mentions_profile_idx on community.mentions (profile_id);
create index mentions_thread_idx on community.mentions (thread_id);
create index mentions_post_idx on community.mentions (post_id) where post_id is not null;
create index mentions_author_idx on community.mentions (author_id);
create index mentions_notification_idx on community.mentions (notification_id) where notification_id is not null;
alter table community.mentions enable row level security;

alter table community.notifications drop constraint notifications_kind_check;
alter table community.notifications add constraint notifications_kind_check check (kind in (
  'reply_followed', 'reply_mine', 'group_invitation', 'group_request', 'group_request_approved',
  'group_request_declined', 'group_removed', 'group_role', 'message', 'moderation', 'event',
  'prayer_comment', 'prayer_update', 'prayer_answered', 'prayer_moderation',
  'care_assigned', 'care_response', 'care_volunteer', 'care_follow_up',
  'content_new', 'gallery_new', 'gallery_outcome',
  'reading_reminder', 'reading_plan_changed',
  'memory_weekly_verse', 'memory_review_due', 'memory_practice_reminder', 'memory_challenge_milestone',
  'youth_announcement', 'youth_family', 'youth_registration', 'youth_event_reminder', 'youth_form_needed',
  'youth_consent_changed', 'youth_learning', 'youth_report',
  'mention'));
alter table community.notifications drop constraint notifications_category_check;
alter table community.notifications add constraint notifications_category_check
  check (category in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions'));

alter table community.notification_prefs drop constraint notification_prefs_category_check;
alter table community.notification_prefs add constraint notification_prefs_category_check
  check (category in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions'));

-- ---------------------------------------------------------------------------
-- Markup helpers
-- ---------------------------------------------------------------------------
-- Matches one mention: 1 = label, 2 = member id.
create function community.mention_pattern()
returns text
language sql
immutable
set search_path = ''
as $$
  select '@\[([^][\n]{1,80})\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)';
$$;

-- The text with every mention shown as "@Label" (excerpts, plain text).
create function community.mention_plain(p_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_body, ''), community.mention_pattern(), '@\1', 'g');
$$;

-- The different members mentioned in a text, in order of first mention.
create function community.mention_ids(p_body text)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x.id order by x.first), '{}')
    from (select lower(m[2])::uuid as id, min(o) as first
            from regexp_matches(coalesce(p_body, ''), community.mention_pattern(), 'g') with ordinality as r(m, o)
           group by 1) x;
$$;

-- Whether p_author may mention p_target in a post whose place is p_group
-- (null: church-wide). Listed in the directory (approved adult, not opted
-- out), can read the post, and no block either way.
create function community.can_mention(p_author uuid, p_target uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_target is not null
     and community.is_member(p_target)
     and public.directory_is_listed(p_target)
     and (p_group is null or community.group_member(p_group, p_target))
     and (p_author is null or not community.blocked_either(p_author, p_target));
$$;

create function community.mention_active(p_thread uuid, p_post uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from community.mentions m
                  where m.target_id = coalesce(p_post, p_thread) and m.profile_id = p_profile and m.removed_at is null);
$$;

-- The mentions in one post (p_post null) or comment, for rendering: the
-- member's current name while they're an approved member (else null, and
-- the text's own label is shown), and whether their directory entry may be
-- linked (every reader is an approved member, so this is the same answer
-- for all of them). Nothing else about the member.
create function community.mentions_json(p_thread uuid, p_post uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.profile_id,
           'name', case when community.is_member(m.profile_id) then community.display_name(m.profile_id) end,
           'listed', public.directory_is_listed(m.profile_id)) order by m.created_at, m.profile_id), '[]'::jsonb)
    from community.mentions m
   where m.target_id = coalesce(p_post, p_thread) and m.removed_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Saving: validate and record (triggers)
-- ---------------------------------------------------------------------------
-- Before a save: at most 10 people, and markup for anyone who can't be
-- mentioned here becomes plain "@Label" text.
create function community.mentions_clean(p_body text, p_author uuid, p_group uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_body text := p_body;
  v_id uuid;
begin
  if p_body is null or position('](mention:' in p_body) = 0 then
    return p_body;
  end if;
  if cardinality(community.mention_ids(p_body)) > 10 then
    raise exception 'You can mention up to 10 people in one post or comment.' using errcode = '22023';
  end if;
  foreach v_id in array community.mention_ids(p_body) loop
    if not community.can_mention(p_author, v_id, p_group) then
      v_body := regexp_replace(v_body,
        '@\[([^][\n]{1,80})\]\(mention:' || v_id::text || '\)', '@\1', 'gi');
    end if;
  end loop;
  return v_body;
end;
$$;

-- After a save: record added mentions, mark removed ones, and notify
-- people newly mentioned in visible content (once per post or comment).
create function community.mentions_sync(p_thread uuid, p_post uuid, p_author uuid, p_body text, p_group uuid, p_publish boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_post, p_thread);
  v_ids uuid[];
  v_profile uuid;
  v_n uuid;
begin
  select coalesce(array_agg(x), '{}') into v_ids
    from unnest(community.mention_ids(p_body)) x
   where community.can_mention(p_author, x, p_group);

  update community.mentions set removed_at = now()
   where target_id = v_target and removed_at is null and not (profile_id = any (v_ids));
  insert into community.mentions (thread_id, post_id, profile_id, author_id)
  select p_thread, p_post, x, p_author from unnest(v_ids) x
  on conflict (target_id, profile_id) do update set removed_at = null
   where community.mentions.removed_at is not null;

  if not p_publish then
    return;
  end if;
  for v_profile in
    select m.profile_id from community.mentions m
     where m.target_id = v_target and m.removed_at is null and m.notified_at is null
       and m.profile_id is distinct from p_author
     order by m.created_at, m.profile_id
     for update
  loop
    perform community.rate_limit(p_author, 'mention', 50, interval '1 hour');
    v_n := community.notify(v_profile, 'mention', p_author,
                            jsonb_build_object('thread_id', p_thread, 'post_id', p_post), 'mention:' || v_target);
    update community.mentions set notified_at = now(), notification_id = v_n
     where target_id = v_target and profile_id = v_profile;
  end loop;
end;
$$;

create function community.threads_mentions_clean()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;
  new.body := community.mentions_clean(new.body, new.author_id, new.group_id);
  return new;
end;
$$;

create function community.posts_mentions_clean()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;
  new.body := community.mentions_clean(new.body, new.author_id,
                                       (select t.group_id from community.threads t where t.id = new.thread_id));
  return new;
end;
$$;

create function community.threads_mentions_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return null;
  end if;
  perform community.mentions_sync(new.id, null, new.author_id, new.body, new.group_id, new.status = 'visible');
  return null;
end;
$$;

create function community.posts_mentions_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t community.threads;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return null;
  end if;
  select * into t from community.threads where id = new.thread_id;
  perform community.mentions_sync(new.thread_id, new.id, new.author_id, new.body, t.group_id,
                                  new.status = 'visible' and t.status = 'visible');
  return null;
end;
$$;

create trigger threads_mentions_clean before insert or update of body on community.threads
  for each row execute function community.threads_mentions_clean();
create trigger posts_mentions_clean before insert or update of body on community.posts
  for each row execute function community.posts_mentions_clean();
create trigger threads_mentions_sync after insert or update of body on community.threads
  for each row execute function community.threads_mentions_sync();
create trigger posts_mentions_sync after insert or update of body on community.posts
  for each row execute function community.posts_mentions_sync();

-- ---------------------------------------------------------------------------
-- Suggestions
-- ---------------------------------------------------------------------------
-- Members the caller may mention in one place: an existing post (p_thread,
-- for comments and edits), or a new post's category or group. Matches the
-- start of any word of a name first, then anywhere in it; at most 8. Only
-- the directory name, the photo path when the member shares their photo
-- (storage rules decide who may load it), and the city/state when shared,
-- to tell people with the same name apart. Never the caller.
create function public.community_mention_search(p_query text, p_thread uuid default null, p_category uuid default null, p_group uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_q text := left(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 60);
  v_group uuid;
  v_like text;
  v_word text;
begin
  if p_thread is not null then
    if not community.can_read_thread(p_thread, v_uid) then
      return '[]'::jsonb;
    end if;
    select group_id into v_group from community.threads where id = p_thread;
  elsif p_group is not null then
    if not community.group_member(p_group, v_uid) then
      return '[]'::jsonb;
    end if;
    v_group := p_group;
  elsif p_category is null or not exists (select 1 from community.categories where id = p_category and active) then
    return '[]'::jsonb;
  end if;
  if char_length(v_q) < 1 then
    return '[]'::jsonb;
  end if;
  perform community.rate_limit(v_uid, 'mention_search', 300, interval '10 minutes');
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_word := v_like || '%';
  v_like := '%' || v_like || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'photo_path', x.photo_path, 'detail', x.detail)
                     order by x.rank, lower(x.name), x.id)
      from (select p.id, public.directory_display_name(p) as name,
                   case when d.show_photo then d.photo_path end as photo_path,
                   case when d.show_city_state or d.show_street_address
                        then nullif(concat_ws(', ', nullif(btrim(d.city), ''), nullif(btrim(d.state_region), '')), '') end as detail,
                   case when public.directory_display_name(p) ilike v_word
                          or public.directory_display_name(p) ilike '% ' || v_word
                          or p.full_name ilike v_word or p.full_name ilike '% ' || v_word then 0 else 1 end as rank
              from public.profiles p
              join public.member_profile_details d on d.profile_id = p.id
             where p.id <> v_uid
               and p.membership_status = 'approved' and p.account_kind = 'adult' and d.directory_listed
               and (p.full_name ilike v_like or p.preferred_name ilike v_like)
               and (v_group is null or community.group_member(v_group, p.id))
               and not community.blocked_either(v_uid, p.id)
             order by 5, lower(public.directory_display_name(p)), p.id
             limit 8) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Notification functions (current definitions plus mentions) and cards
-- ---------------------------------------------------------------------------
create or replace function community.kind_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('reply_followed', 'reply_mine') then 'forum'
    when p_kind like 'group_%' then 'groups'
    when p_kind = 'message' then 'messages'
    when p_kind = 'event' then 'events'
    when p_kind in ('prayer_comment', 'prayer_update', 'prayer_answered') then 'prayer'
    when p_kind like 'care_%' then 'care'
    when p_kind = 'content_new' then 'teaching'
    when p_kind like 'gallery_%' then 'gallery'
    when p_kind like 'reading_%' then 'reading'
    when p_kind like 'memory_%' then 'memory'
    when p_kind like 'youth_%' then 'youth'
    when p_kind = 'mention' then 'mentions'
    else 'moderation'
  end;
$$;

create or replace function community.pref(p_profile uuid, p_category text)
returns table (in_app boolean, email text, push boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.in_app, true) or p_category = 'moderation',
         coalesce(p.email, case p_category when 'forum' then 'off' when 'events' then 'off' when 'prayer' then 'off' when 'teaching' then 'off' when 'gallery' then 'off' when 'mentions' then 'off' else 'immediate' end),
         coalesce(p.push, false)
    from (select 1) one
    left join community.notification_prefs p on p.profile_id = p_profile and p.category = p_category;
$$;

create or replace function community.notify(p_profile uuid, p_kind text, p_actor uuid, p_refs jsonb, p_merge_key text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text := community.kind_category(p_kind);
  v_pref record;
  v_id uuid;
  v_count integer;
  v_thread uuid := nullif(p_refs ->> 'thread_id', '')::uuid;
  v_group uuid := nullif(p_refs ->> 'group_id', '')::uuid;
  v_conv uuid := nullif(p_refs ->> 'conversation_id', '')::uuid;
  v_send_after timestamptz;
begin
  if p_profile is null or p_profile = p_actor or not community.is_member(p_profile) then
    return null;
  end if;
  if v_category <> 'moderation' then
    if p_actor is not null and exists (select 1 from community.blocks where blocker_id = p_profile and blocked_id = p_actor) then
      return null;
    end if;
    if exists (select 1 from community.mutes m
                where m.profile_id = p_profile
                  and ((m.target_type = 'thread' and m.target_id = v_thread)
                       or (m.target_type = 'group' and m.target_id = coalesce(v_group, (select group_id from community.threads where id = v_thread)))
                       or (m.target_type = 'conversation' and m.target_id = v_conv))) then
      return null;
    end if;
  end if;
  -- A reply that mentions someone already told them through the mention
  -- notice; don't also count it as a reply for them.
  if p_kind in ('reply_mine', 'reply_followed') and exists (
       select 1 from community.mentions m
        where m.post_id = nullif(p_refs ->> 'post_id', '')::uuid and m.profile_id = p_profile
          and m.notification_id is not null) then
    return null;
  end if;
  select * into v_pref from community.pref(p_profile, v_category);
  if not v_pref.in_app and v_pref.email = 'off' and not v_pref.push then
    return null;
  end if;

  if p_merge_key is not null then
    update community.notifications
       set count = count + 1, updated_at = now(), actor_id = p_actor,
           post_id = coalesce(nullif(p_refs ->> 'post_id', '')::uuid, post_id),
           detail = coalesce(p_refs -> 'detail', detail)
     where profile_id = p_profile and merge_key = p_merge_key and read_at is null
    returning id, count into v_id, v_count;
  end if;
  if v_id is null then
    insert into community.notifications (profile_id, kind, category, actor_id, thread_id, post_id, group_id, conversation_id,
                                         invitation_id, request_id, occurrence_id, prayer_request_id, care_request_id,
                                         care_opportunity_id, media_item_id, media_album_id, bible_enrollment_id, bible_plan_id,
                                         memory_item_id, memory_challenge_id, youth_child_id, youth_announcement_id,
                                         youth_request_id, youth_learning_id, youth_report_id, youth_series_id, detail, merge_key)
    values (p_profile, p_kind, v_category, p_actor, v_thread, nullif(p_refs ->> 'post_id', '')::uuid, v_group, v_conv,
            nullif(p_refs ->> 'invitation_id', '')::uuid, nullif(p_refs ->> 'request_id', '')::uuid,
            nullif(p_refs ->> 'occurrence_id', '')::uuid, nullif(p_refs ->> 'prayer_request_id', '')::uuid,
            nullif(p_refs ->> 'care_request_id', '')::uuid, nullif(p_refs ->> 'care_opportunity_id', '')::uuid,
            nullif(p_refs ->> 'media_item_id', '')::uuid, nullif(p_refs ->> 'media_album_id', '')::uuid,
            nullif(p_refs ->> 'bible_enrollment_id', '')::uuid, nullif(p_refs ->> 'bible_plan_id', '')::uuid,
            nullif(p_refs ->> 'memory_item_id', '')::uuid, nullif(p_refs ->> 'memory_challenge_id', '')::uuid,
            nullif(p_refs ->> 'youth_child_id', '')::uuid, nullif(p_refs ->> 'youth_announcement_id', '')::uuid,
            nullif(p_refs ->> 'youth_request_id', '')::uuid, nullif(p_refs ->> 'youth_learning_id', '')::uuid,
            nullif(p_refs ->> 'youth_report_id', '')::uuid, nullif(p_refs ->> 'series_id', '')::uuid,
            coalesce(p_refs -> 'detail', '{}'::jsonb), p_merge_key)
    returning id, count into v_id, v_count;
  end if;

  v_send_after := community.after_quiet(p_profile, now());
  -- One email per unread notification (merged activity doesn't re-email).
  if v_pref.email = 'immediate' and v_category <> 'events' then
    insert into community.email_outbox (dedupe_key, kind, profile_id, notification_id, send_after)
    values ('n:' || v_id, 'immediate', p_profile, v_id, v_send_after)
    on conflict (dedupe_key) do nothing;
  end if;
  if v_pref.push and exists (select 1 from community.push_subscriptions where profile_id = p_profile) then
    insert into community.push_outbox (dedupe_key, profile_id, notification_id, send_after)
    values ('n:' || v_id || ':' || v_count, p_profile, v_id, v_send_after)
    on conflict (dedupe_key) do nothing;
  end if;
  perform community.ping(p_profile, 'notification');
  return v_id;
end;
$$;

create or replace function community.notification_visible(n community.notifications)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select community.is_member(n.profile_id)
     and (select x.in_app from community.pref(n.profile_id, n.category) x)
     and case n.kind
       when 'reply_followed' then community.can_read_thread(n.thread_id, n.profile_id)
            and exists (select 1 from community.threads t where t.id = n.thread_id and t.status <> 'hidden')
       when 'reply_mine' then community.can_read_thread(n.thread_id, n.profile_id)
            and exists (select 1 from community.threads t where t.id = n.thread_id and t.status <> 'hidden')
       when 'group_invitation' then exists (
            select 1 from community.group_invitations i
              join community.groups g on g.id = i.group_id and g.status = 'active'
             where i.id = n.invitation_id and i.invitee_id = n.profile_id and i.status = 'pending' and i.expires_at > now())
       when 'group_request' then community.group_leader(n.group_id, n.profile_id)
            and exists (select 1 from community.group_requests r where r.id = n.request_id and r.status = 'pending')
       when 'group_request_approved' then community.group_member(n.group_id, n.profile_id)
       when 'group_role' then community.group_member(n.group_id, n.profile_id)
       when 'group_request_declined' then true
       when 'group_removed' then true
       when 'message' then exists (
            select 1 from community.conversations c
             where c.id = n.conversation_id and n.profile_id in (c.member_a, c.member_b))
            and not exists (select 1 from community.blocks b where b.blocker_id = n.profile_id and b.blocked_id = n.actor_id)
       when 'event' then exists (
            select 1 from events.occurrences o where o.id = n.occurrence_id and events.visible_to(o.series_id, n.profile_id))
       when 'prayer_comment' then exists (
            select 1 from prayer.requests r
             where r.id = n.prayer_request_id and r.status <> 'archived' and r.hidden_at is null and prayer.can_read(r, n.profile_id))
       when 'prayer_update' then exists (
            select 1 from prayer.requests r
             where r.id = n.prayer_request_id and r.status <> 'archived' and r.hidden_at is null and prayer.can_read(r, n.profile_id))
       when 'prayer_answered' then exists (
            select 1 from prayer.requests r
             where r.id = n.prayer_request_id and r.status <> 'archived' and r.hidden_at is null and prayer.can_read(r, n.profile_id))
       when 'prayer_moderation' then exists (
            select 1 from prayer.requests r where r.id = n.prayer_request_id and prayer.can_read(r, n.profile_id))
       when 'care_assigned' then exists (
            select 1 from prayer.care_requests c
             where c.id = n.care_request_id and c.status <> 'closed' and c.assigned_to = n.profile_id)
            and prayer.holds(n.profile_id, 'care.coordinate')
       when 'care_follow_up' then exists (
            select 1 from prayer.care_requests c
             where c.id = n.care_request_id and c.status <> 'closed' and c.assigned_to = n.profile_id)
            and prayer.holds(n.profile_id, 'care.coordinate')
       when 'care_response' then exists (
            select 1 from prayer.care_requests c
             where c.id = n.care_request_id
               and (c.requester_id = n.profile_id
                    or (c.assigned_to = n.profile_id and prayer.holds(n.profile_id, 'care.coordinate'))))
       when 'care_volunteer' then exists (
            select 1 from prayer.care_signups s
              join prayer.care_opportunities o on o.id = s.opportunity_id
             where s.opportunity_id = n.care_opportunity_id and s.profile_id = n.profile_id
               and s.status in ('accepted', 'completed') and o.status in ('open', 'filled', 'completed'))
       when 'content_new' then media.item_visible_id(n.media_item_id, n.profile_id)
       when 'gallery_new' then exists (
            select 1 from media.albums a where a.id = n.media_album_id and media.album_visible(a, n.profile_id))
       when 'gallery_outcome' then exists (
            select 1 from media.albums a where a.id = n.media_album_id and media.can_contribute(a, n.profile_id))
       -- Reading reminders: the enrollment is still active with reminders on,
       -- and the member can still see the plan.
       when 'reading_reminder' then exists (
            select 1 from bible.enrollments e join bible.plans p on p.id = e.plan_id
             where e.id = n.bible_enrollment_id and e.profile_id = n.profile_id and e.status = 'active'
               and e.reminders and not e.reminders_paused and bible.plan_visible(p, n.profile_id))
       when 'reading_plan_changed' then exists (
            select 1 from bible.enrollments e join bible.plans p on p.id = e.plan_id
             where e.plan_id = n.bible_plan_id and e.profile_id = n.profile_id and e.status = 'active'
               and bible.plan_visible(p, n.profile_id))
       -- Memory verses: the member still wants this kind of reminder, and
       -- what it points to is still theirs to see.
       when 'memory_weekly_verse' then (select s.remind_weekly from memory.settings_of(n.profile_id) s)
            and exists (select 1 from memory.items i join memory.collections c on c.id = i.collection_id
                         where i.id = n.memory_item_id and i.retired_at is null and memory.collection_visible(c, n.profile_id))
       when 'memory_review_due' then (select s.remind_review and not s.paused from memory.settings_of(n.profile_id) s)
       when 'memory_practice_reminder' then (select s.remind_practice and not s.paused from memory.settings_of(n.profile_id) s)
       when 'memory_challenge_milestone' then exists (
            select 1 from memory.challenge_participants cp join memory.challenges ch on ch.id = cp.challenge_id
             where cp.challenge_id = n.memory_challenge_id and cp.profile_id = n.profile_id and cp.left_at is null
               and cp.sharing and community.group_member(ch.group_id, n.profile_id))
       -- Youth & Families: the recipient must still be a verified guardian
       -- with the matching permission (or a reviewer still in scope), and
       -- what it points to must still apply.
       when 'youth_announcement' then exists (
            select 1 from youth.announcements a where a.id = n.youth_announcement_id and youth.announcement_visible(a, n.profile_id))
       when 'youth_family' then n.youth_child_id is null or youth.guardian_can(n.youth_child_id, n.profile_id)
       when 'youth_registration' then youth.guardian_can(n.youth_child_id, n.profile_id, 'register')
            or youth.guardian_can(n.youth_child_id, n.profile_id, 'receive_updates')
       when 'youth_event_reminder' then (youth.guardian_can(n.youth_child_id, n.profile_id, 'register')
                                         or youth.guardian_can(n.youth_child_id, n.profile_id, 'receive_updates'))
            and exists (select 1 from youth.registrations r where r.occurrence_id = n.occurrence_id and r.child_id = n.youth_child_id
                           and r.status = 'confirmed')
       when 'youth_form_needed' then youth.guardian_can(n.youth_child_id, n.profile_id, 'sign_forms')
            and exists (select 1 from youth.event_forms ef where ef.series_id = n.youth_series_id
                           and youth.consent_state(ef.series_id, n.youth_child_id, ef.form_id) <> 'granted')
            and exists (select 1 from youth.registrations r join events.occurrences o on o.id = r.occurrence_id
                         where o.series_id = n.youth_series_id and r.child_id = n.youth_child_id and r.status <> 'canceled' and o.ends_at > now())
       when 'youth_consent_changed' then youth.guardian_can(n.youth_child_id, n.profile_id)
       when 'youth_learning' then exists (
            select 1 from youth.learning l where l.id = n.youth_learning_id and l.status = 'active'
               and (youth.guardian_in_group(l.group_id, n.profile_id, 'practice') or youth.guardian_in_group(l.group_id, n.profile_id, 'receive_updates')))
       when 'youth_report' then exists (
            select 1 from youth.reports r where r.id = n.youth_report_id and r.status = 'open' and youth.can_review(r, n.profile_id))
       -- Mentions: still mentioned there (not edited out), the post or
       -- comment is visible, the member can still read the post, and
       -- hasn't blocked the author.
       when 'mention' then community.mention_active(n.thread_id, n.post_id, n.profile_id)
            and community.can_read_thread(n.thread_id, n.profile_id)
            and exists (select 1 from community.threads t where t.id = n.thread_id and t.status = 'visible')
            and (n.post_id is null or exists (select 1 from community.posts p where p.id = n.post_id and p.status = 'visible'))
            and not exists (select 1 from community.blocks b where b.blocker_id = n.profile_id and b.blocked_id = n.actor_id)
       else true
     end;
$$;

create or replace function community.notification_json(n community.notifications)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_url text := '/notifications';
  v_thread record;
  v_group_name text;
  v_actor text := case when n.actor_id is null then null else community.display_name(n.actor_id) end;
  v_others text := case when n.count > 1 then ' and others' else '' end;
  v_place text;
  v_prayer text;
  v_media record;
  v_album text;
  v_plan text;
  v_memory text;
  v_child text;
  v_event text;
begin
  if n.group_id is not null and community.can_see_group(n.group_id, n.profile_id) then
    select name into v_group_name from community.groups where id = n.group_id;
  end if;
  if n.thread_id is not null then
    select t.title, t.status, t.group_id, g.name as group_name
      into v_thread
      from community.threads t left join community.groups g on g.id = t.group_id
     where t.id = n.thread_id;
    v_place := case when v_thread.status = 'deleted' then 'a discussion'
                    else '“' || v_thread.title || '”' end;
    v_url := '/community/t/' || n.thread_id;
  end if;
  -- In the app only, and only after notification_visible: the reader can
  -- open this request now, so its title may be shown here.
  if n.prayer_request_id is not null then
    select '“' || r.title || '”' into v_prayer from prayer.requests r
     where r.id = n.prayer_request_id and prayer.can_read(r, n.profile_id);
    v_url := '/prayer/' || n.prayer_request_id;
  end if;
  -- Teaching and gallery: titles only after the visibility recheck.
  if n.media_item_id is not null then
    select i.id, i.kind, i.title into v_media from media.items i
     where i.id = n.media_item_id and media.item_visible(i, n.profile_id);
  end if;
  if n.media_album_id is not null then
    select a.title into v_album from media.albums a
     where a.id = n.media_album_id and (media.album_visible(a, n.profile_id) or media.can_contribute(a, n.profile_id));
  end if;
  -- Reading: the plan title only after the visibility recheck.
  if n.bible_plan_id is not null or n.bible_enrollment_id is not null then
    select p.title into v_plan from bible.plans p
     where p.id = coalesce(n.bible_plan_id, (select e.plan_id from bible.enrollments e where e.id = n.bible_enrollment_id))
       and bible.plan_visible(p, n.profile_id);
  end if;
  -- Memory: a verse reference or challenge title only after the recheck.
  if n.memory_item_id is not null then
    select p.label into v_memory from memory.items i join memory.passages p on p.id = i.passage_id
      join memory.collections c on c.id = i.collection_id
     where i.id = n.memory_item_id and memory.collection_visible(c, n.profile_id);
  elsif n.memory_challenge_id is not null then
    select ch.title into v_memory from memory.challenges ch
     where ch.id = n.memory_challenge_id and community.group_member(ch.group_id, n.profile_id);
  end if;
  -- Youth: the child's preferred name and the event title only after the
  -- recheck above (in the app; email and push stay generic).
  if n.youth_child_id is not null then
    select c.display_name into v_child from youth.children c where c.id = n.youth_child_id;
  end if;
  if n.category = 'youth' and (n.occurrence_id is not null or n.youth_series_id is not null) then
    select s.title into v_event from events.series s
     where s.id = coalesce(n.youth_series_id, (select o.series_id from events.occurrences o where o.id = n.occurrence_id));
  end if;
  case n.kind
    when 'reply_followed' then
      v_title := case when n.count > 1 then n.count || ' new replies in ' else coalesce(v_actor, 'Someone') || ' replied in ' end || v_place;
    when 'reply_mine' then
      v_title := case when n.count > 1 then n.count || ' new replies to your discussion ' else coalesce(v_actor, 'Someone') || ' replied to your discussion ' end || v_place;
    when 'group_invitation' then
      v_title := 'You''re invited to join ' || coalesce(v_group_name, 'a group');
      v_url := '/groups/invitations';
    when 'group_request' then
      v_title := case when n.count > 1 then n.count || ' new requests to join ' else coalesce(v_actor, 'Someone') || v_others || ' asked to join ' end
                 || coalesce(v_group_name, 'your group');
      v_url := '/groups/' || n.group_id || '/manage';
    when 'group_request_approved' then
      v_title := 'Welcome! Your request to join ' || coalesce(v_group_name, 'the group') || ' was approved';
      v_url := '/groups/' || n.group_id;
    when 'group_request_declined' then
      v_title := 'Your request to join ' || coalesce(v_group_name, 'a group') || ' wasn''t approved';
      v_url := '/groups';
    when 'group_removed' then
      v_title := 'You''re no longer a member of ' || coalesce(v_group_name, 'a group');
      v_url := '/groups';
    when 'group_role' then
      v_title := case when n.detail ->> 'role' = 'leader' then 'You''re now a leader of ' else 'Your role changed in ' end
                 || coalesce(v_group_name, 'a group');
      v_url := '/groups/' || n.group_id;
    when 'message' then
      v_title := case when n.count > 1 then 'You have ' || n.count || ' new messages' else 'You have a new message' end;
      v_url := '/messages/' || n.conversation_id;
    when 'event' then
      v_title := coalesce((select case n.detail ->> 'change'
                                    when 'promoted' then 'A place opened up and you''re registered: '
                                    when 'changed' then 'Event updated: '
                                    else 'Event canceled: ' end || s.title
                             from events.occurrences o join events.series s on s.id = o.series_id
                            where o.id = n.occurrence_id), 'An event changed');
      v_url := '/events/' || n.occurrence_id;
    when 'prayer_comment' then
      v_title := case when n.count > 1 then n.count || ' new comments on ' else 'A new comment on ' end
                 || case when n.detail ->> 'mine' = 'true' then 'your prayer request ' else 'a prayer request you follow: ' end
                 || coalesce(v_prayer, '');
    when 'prayer_update' then
      v_title := 'An update on a prayer request you follow: ' || coalesce(v_prayer, '');
    when 'prayer_answered' then
      v_title := 'A prayer was answered: ' || coalesce(v_prayer, '');
    when 'prayer_moderation' then
      v_title := case n.detail ->> 'action'
                   when 'hidden' then 'A moderator hid ' || case when n.detail ->> 'target' = 'comment' then 'your comment on ' else 'your prayer request ' end
                   when 'restored' then 'A moderator restored ' || case when n.detail ->> 'target' = 'comment' then 'your comment on ' else 'your prayer request ' end
                   when 'locked' then 'A moderator turned off comments on your prayer request '
                   when 'unlocked' then 'A moderator turned comments back on for your prayer request '
                   else 'A moderator update about ' end || coalesce(v_prayer, 'a prayer request');
    when 'care_assigned' then
      v_title := 'You were assigned a care request';
      v_url := '/prayer/team/care/' || n.care_request_id;
    when 'care_follow_up' then
      v_title := 'A care request you coordinate is due for follow-up';
      v_url := '/prayer/team/care/' || n.care_request_id;
    when 'care_response' then
      if n.detail ->> 'to' = 'team' then
        v_title := case when n.count > 1 then n.count || ' new replies on a care request you coordinate' else 'New reply on a care request you coordinate' end;
        v_url := '/prayer/team/care/' || n.care_request_id;
      else
        v_title := case when n.detail ? 'status' then 'Your care request was updated' else 'The care team responded to your request' end;
        v_url := '/prayer/care/' || n.care_request_id;
      end if;
    when 'care_volunteer' then
      v_title := 'You''re confirmed to help: ' || coalesce((select '“' || o.title || '”' from prayer.care_opportunities o where o.id = n.care_opportunity_id), 'a care opportunity');
      v_url := '/prayer/serve/' || n.care_opportunity_id;
    when 'content_new' then
      v_title := case n.detail ->> 'kind'
                   when 'devotional' then 'New devotional: '
                   when 'lesson' then 'New Sunday lesson: '
                   when 'episode' then 'New podcast episode: '
                   when 'assignment' then 'New reading assignment: '
                   when 'playlist' then 'New playlist: '
                   else 'New in the teaching library: ' end || coalesce('“' || v_media.title || '”', '');
      v_url := case n.detail ->> 'kind'
                 when 'devotional' then '/devotionals/'
                 when 'lesson' then '/lessons/'
                 when 'episode' then '/podcasts/episodes/'
                 when 'assignment' then '/reading/assignments/'
                 when 'playlist' then '/music/'
                 else '/media/items/' end || n.media_item_id;
    when 'gallery_new' then
      v_title := 'New photos in ' || coalesce('“' || v_album || '”', 'an album');
      v_url := '/gallery/' || n.media_album_id;
    when 'gallery_outcome' then
      v_title := case when n.count > 1 then 'Updates about ' || n.count || ' photos you shared' else
                   case n.detail ->> 'action'
                     when 'approve' then 'Your photo was approved'
                     when 'reject' then 'Your photo wasn''t approved'
                     when 'hide' then 'A moderator hid your photo'
                     when 'unhide' then 'Your photo is visible again'
                     when 'remove' then 'A moderator removed your photo'
                     else 'An update about your photo' end end
                 || coalesce(' in “' || v_album || '”', '');
      v_url := '/gallery/mine';
    when 'reading_reminder' then
      v_title := 'Today''s reading is ready' || coalesce(': “' || v_plan || '”', '');
      v_url := '/bible/today';
    when 'reading_plan_changed' then
      v_title := 'Upcoming readings changed in ' || coalesce('“' || v_plan || '”', 'a reading plan you follow');
      v_url := coalesce('/bible/plans/' || coalesce(n.bible_plan_id, (select e.plan_id from bible.enrollments e where e.id = n.bible_enrollment_id)), '/bible');
    when 'memory_weekly_verse' then
      v_title := case when n.count > 1 or (n.detail ->> 'count')::integer > 1 then 'New memory verses are ready' else 'A new memory verse is ready' end
                 || coalesce(': ' || v_memory, '');
      v_url := '/memory/assignment';
    when 'memory_review_due' then
      v_title := 'Some of your memory verses are ready to review';
      v_url := '/memory/review';
    when 'memory_practice_reminder' then
      v_title := 'A few minutes with your memory verses?';
      v_url := '/memory';
    when 'memory_challenge_milestone' then
      v_title := 'Your group reached ' || coalesce(n.detail ->> 'percent', 'a milestone') || '% of its goal'
                 || coalesce(' in “' || v_memory || '”', '');
      v_url := '/memory/challenges/' || n.memory_challenge_id;
    when 'youth_announcement' then
      v_title := 'Youth announcement: ' || coalesce((select '“' || a.title || '”' from youth.announcements a where a.id = n.youth_announcement_id), '');
      v_url := '/youth/announcements';
    when 'youth_family' then
      v_title := case n.detail ->> 'event'
                   when 'account_activated' then coalesce(v_child, 'Your child') || ' activated their own youth account'
                   else 'Your Youth & Families request was reviewed' end;
      v_url := case when n.youth_child_id is not null then '/youth/family/children/' || n.youth_child_id else '/youth/family' end;
    when 'youth_registration' then
      v_title := case n.detail ->> 'change'
                   when 'promoted' then 'A place opened up and ' || coalesce(v_child, 'your child') || ' is registered'
                   when 'event_canceled' then 'Canceled for ' || coalesce(v_child, 'your child')
                   else 'Registration update for ' || coalesce(v_child, 'your child') end || coalesce(': ' || v_event, '');
      v_url := '/youth/family/children/' || n.youth_child_id || coalesce('/events/' || n.occurrence_id, '');
    when 'youth_event_reminder' then
      v_title := 'Coming up for ' || coalesce(v_child, 'your child') || coalesce(': ' || v_event, '');
      v_url := '/youth/family/children/' || n.youth_child_id || coalesce('/events/' || n.occurrence_id, '');
    when 'youth_form_needed' then
      v_title := 'A permission form needs your review for ' || coalesce(v_child, 'your child') || coalesce(': ' || v_event, '');
      v_url := '/youth/family/children/' || n.youth_child_id;
    when 'youth_consent_changed' then
      v_title := 'A permission or photo consent decision changed for ' || coalesce(v_child, 'your child');
      v_url := '/youth/family/children/' || n.youth_child_id;
    when 'youth_learning' then
      v_title := 'New learning was assigned to ' || coalesce((select g.name from youth.learning l join youth.groups g on g.id = l.group_id
                                                              where l.id = n.youth_learning_id), 'a youth group');
      v_url := '/youth/family';
    when 'mention' then
      v_title := coalesce(v_actor, 'Someone') || ' mentioned you in '
                 || case when n.post_id is not null then 'a comment in ' else '' end
                 || coalesce(v_thread.group_name, 'Community');
    when 'youth_report' then
      v_title := 'A youth discussion report needs review';
      v_url := '/youth/lead/reports';
    else
      v_title := case n.detail ->> 'action'
                   when 'hidden' then 'A moderator removed something you posted'
                   when 'restored' then 'A moderator restored something you posted'
                   when 'restricted' then 'Your community participation has been limited'
                   when 'restriction_lifted' then 'Your community participation has been restored'
                   when 'locked' then 'A discussion you started was locked'
                   when 'report_received' then case when n.count > 1 then n.count || ' new reports' else 'A new report' end
                                               || ' about a post in ' || coalesce(v_group_name, 'your group')
                   else 'A moderator update about your community activity' end;
      v_url := case when n.detail ->> 'action' in ('restricted', 'restriction_lifted') then '/community/guidelines'
                    when n.detail ->> 'action' = 'report_received' then '/groups/' || n.group_id || '/manage/reports'
                    when n.thread_id is not null then v_url else '/notifications' end;
  end case;
  return jsonb_build_object(
    'id', n.id, 'kind', n.kind, 'category', n.category, 'title', v_title, 'url', v_url,
    'count', n.count, 'created_at', n.updated_at, 'read', n.read_at is not null,
    'reason', case when n.kind in ('moderation', 'prayer_moderation') then n.detail ->> 'reason' end,
    'group_name', v_group_name);
end;
$$;

create or replace function community.notification_email_item(n community.notifications)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j jsonb;
  v_group text;
begin
  -- Prayer and care: never a title, body, care detail, or name.
  if n.category in ('prayer', 'care') or n.kind = 'prayer_moderation' then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind
                 when 'prayer_comment' then 'New activity on a prayer request'
                 when 'prayer_update' then 'An update on a prayer request you follow'
                 when 'prayer_answered' then 'An update on a prayer request you follow'
                 when 'prayer_moderation' then 'A moderator update about your prayer activity'
                 when 'care_assigned' then 'You have a new care assignment'
                 when 'care_follow_up' then 'A care follow-up is due'
                 when 'care_volunteer' then 'You''re confirmed as a care volunteer'
                 else 'An update about a care request' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Teaching and gallery: generic outside the app (content may be limited
  -- to members or a group, and album titles can be personal).
  if n.category in ('teaching', 'gallery') then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind
                 when 'content_new' then case n.detail ->> 'kind'
                                           when 'devotional' then 'A new devotional is available'
                                           when 'lesson' then 'A new Sunday lesson is available'
                                           when 'episode' then 'A new podcast episode is available'
                                           when 'assignment' then 'A new reading assignment is available'
                                           when 'playlist' then 'A new playlist is available'
                                           else 'Something new is in the teaching library' end
                 when 'gallery_new' then 'New photos were added to an album'
                 else 'An update about photos you shared' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Reading: generic outside the app (never a plan title, passage, or
  -- anything from the member's journal).
  if n.category = 'reading' then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind when 'reading_reminder' then 'Your Bible reading for today is ready'
                           else 'A reading plan you follow was updated' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Memory: generic outside the app (never a verse, a count of verses,
  -- accuracy, or practice history).
  if n.category = 'memory' then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind when 'memory_weekly_verse' then 'A new memory verse is ready'
                           when 'memory_review_due' then 'You have memory verses ready to review'
                           when 'memory_practice_reminder' then 'A reminder to practice your memory verses'
                           else 'Your group memory challenge reached a milestone' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Youth & Families: always generic outside the app (never a child's
  -- name, an event, a group, contact details, or form text).
  if n.category = 'youth' then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind when 'youth_report' then 'A youth discussion report needs review'
                           else 'There''s an update in Youth & Families' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Mentions: church-wide ones name who mentioned you (like replies);
  -- group ones name only the group.
  if n.kind = 'mention' then
    select g.name into v_group from community.threads t join community.groups g on g.id = t.group_id where t.id = n.thread_id;
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case when v_group is not null then 'You were mentioned in a ' || v_group || ' group discussion'
                    else community.notification_json(n) ->> 'title' end,
      'url', '/notifications/open/' || n.id);
  end if;
  j := community.notification_json(n);
  if n.thread_id is not null then
    select g.name into v_group from community.threads t join community.groups g on g.id = t.group_id where t.id = n.thread_id;
    if v_group is not null then
      j := jsonb_set(j, '{title}', to_jsonb(
        case when n.count > 1 then n.count || ' new replies' else 'A new reply' end
        || ' in a ' || v_group || ' group discussion'));
    end if;
  end if;
  return jsonb_build_object('kind', n.kind, 'category', n.category, 'title', j ->> 'title', 'url', j ->> 'url');
end;
$$;

create or replace function community.op_push_claim(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((v ->> 'limit')::integer, 20), 1), 50);
  r record;
  n community.notifications;
  v_out jsonb := '[]'::jsonb;
  v_subs jsonb;
begin
  for r in
    select p.* from community.push_outbox p
     where p.next_attempt_at <= now() and p.send_after <= now()
       and (p.status = 'pending' or (p.status = 'failed' and p.attempts < 3)
            or (p.status = 'sending' and p.updated_at < now() - interval '10 minutes'))
     order by p.created_at
     limit v_limit
     for update skip locked
  loop
    select * into n from community.notifications where id = r.notification_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      into v_subs from community.push_subscriptions s where s.profile_id = r.profile_id;
    if n.id is null or n.read_at is not null or not community.notification_visible(n)
       or not (select x.push from community.pref(n.profile_id, n.category) x)
       or jsonb_array_length(v_subs) = 0 then
      update community.push_outbox set status = 'skipped', attempts = attempts + 1, updated_at = now() where id = r.id;
      continue;
    end if;
    update community.push_outbox set status = 'sending', attempts = attempts + 1, updated_at = now() where id = r.id;
    -- Generic text only: never titles, names, or message content.
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'dedupe_key', r.dedupe_key, 'subscriptions', v_subs,
      'body', case n.category
                when 'messages' then 'You have a new message.'
                when 'forum' then 'There''s new activity in a discussion.'
                when 'groups' then 'There''s an update about your groups.'
                when 'events' then 'There''s an update about an event.'
                when 'prayer' then 'There''s new activity on a prayer request.'
                when 'care' then 'There''s an update about care.'
                when 'teaching' then 'There''s something new in the teaching library.'
                when 'gallery' then 'There''s an update in the photo gallery.'
                when 'reading' then 'There''s an update about your Bible reading.'
                when 'memory' then 'There''s an update about your memory verses.'
                when 'youth' then 'There''s an update in Youth & Families.'
                when 'mentions' then 'Someone mentioned you in Community.'
                else 'You have a new notification.' end,
      'url', '/notifications/open/' || n.id));
  end loop;
  return v_out;
end;
$$;

create or replace function public.community_my_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  s community.member_settings;
begin
  select * into s from community.member_settings where profile_id = v_uid;
  return jsonb_build_object(
    'prefs', (select jsonb_object_agg(c, jsonb_build_object('in_app', x.in_app, 'email', x.email, 'push', x.push))
                from unnest(array['forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions']) c
                cross join lateral community.pref(v_uid, c) x),
    'timezone', s.timezone,
    'effective_timezone', community.member_tz(v_uid),
    'quiet_enabled', coalesce(s.quiet_enabled, false),
    'quiet_start', to_char(coalesce(s.quiet_start, '21:00'::time), 'HH24:MI'),
    'quiet_end', to_char(coalesce(s.quiet_end, '07:00'::time), 'HH24:MI'),
    'dm_allow', coalesce((select allow from community.dm_prefs where profile_id = v_uid), 'members'),
    'dm_eligible', community.dm_eligible(v_uid),
    'guidelines_acked', community.has_acked(v_uid),
    'posting_restricted', community.restricted(v_uid, 'posting'),
    'messaging_restricted', community.restricted(v_uid, 'messaging'),
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'created_at', created_at,
                                                                  'last_success_at', last_success_at) order by created_at)
                                from community.push_subscriptions where profile_id = v_uid), '[]'::jsonb),
    'mutes', coalesce((select jsonb_agg(jsonb_build_object('type', m.target_type, 'id', m.target_id,
                         'label', case m.target_type
                                    when 'thread' then (select case when t.status = 'visible' and community.can_read_thread(t.id, v_uid) then t.title end
                                                          from community.threads t where t.id = m.target_id)
                                    when 'group' then (select g.name from community.groups g
                                                        where g.id = m.target_id and community.can_see_group(g.id, v_uid))
                                    else 'A conversation' end) order by m.created_at)
                         from community.mutes m where m.profile_id = v_uid), '[]'::jsonb));
end;
$$;

create or replace function public.community_set_pref(p_category text, p_in_app boolean, p_email text, p_push boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if p_category not in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions') then
    raise exception 'Unknown notification category.' using errcode = '22023';
  end if;
  if p_email not in ('off', 'immediate', 'daily', 'weekly')
     or (p_category in ('messages', 'care', 'reading', 'memory', 'youth', 'mentions') and p_email not in ('off', 'immediate'))
     or (p_category = 'events' and p_email <> 'off') then
    raise exception 'Choose a valid email option.' using errcode = '22023';
  end if;
  insert into community.notification_prefs (profile_id, category, in_app, email, push)
  values (v_uid, p_category, coalesce(p_in_app, true) or p_category = 'moderation', p_email, coalesce(p_push, false))
  on conflict (profile_id, category) do update
    set in_app = excluded.in_app, email = excluded.email, push = excluded.push, updated_at = now();
  -- Queued email for a category that is now off is dropped.
  if p_email = 'off' then
    update community.email_outbox e set status = 'skipped', updated_at = now()
     where e.profile_id = v_uid and e.status in ('pending', 'failed') and e.kind = 'immediate'
       and exists (select 1 from community.notifications n where n.id = e.notification_id and n.category = p_category);
  end if;
end;
$$;

create or replace function public.community_notification_panel(
  p_categories text[] default null,
  p_unread boolean default false,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 15), 1), 30);
  v_items jsonb;
  v_more boolean;
begin
  if p_categories is not null and not (p_categories <@ array['forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care',
                                                             'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions']) then
    raise exception 'Unknown notification category.' using errcode = '22023';
  end if;
  if p_before_id is not null and p_before is null then
    raise exception 'A page cursor needs its time.' using errcode = '22023';
  end if;
  -- One extra row tells whether there's another page.
  select coalesce(jsonb_agg(community.notification_json(x) order by x.updated_at desc, x.id desc), '[]'::jsonb)
    into v_items
    from (select n.* from community.notifications n
           where n.profile_id = v_uid
             and n.dismissed_at is null
             and (p_before is null
                  or (p_before_id is null and n.updated_at < p_before)
                  or (p_before_id is not null and (n.updated_at, n.id) < (p_before, p_before_id)))
             and (p_categories is null or n.category = any (p_categories))
             and (not coalesce(p_unread, false) or (n.read_at is null and n.kind <> 'message'))
             and community.notification_visible(n)
           order by n.updated_at desc, n.id desc
           limit v_limit + 1) x;
  v_more := jsonb_array_length(v_items) > v_limit;
  if v_more then
    v_items := v_items - v_limit;
  end if;
  return jsonb_build_object(
    'items', v_items,
    'has_more', v_more,
    'timezone', community.member_tz(v_uid),
    'has_read', exists (select 1 from community.notifications n
                         where n.profile_id = v_uid and n.read_at is not null and n.dismissed_at is null
                           and community.notification_visible(n)));
end;
$$;

create or replace function community.thread_card(t community.threads, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'title', case when t.status = 'visible' then t.title end,
    'excerpt', case when t.status = 'visible' then left(regexp_replace(community.mention_plain(t.body), '\s+', ' ', 'g'), 180) end,
    'status', t.status,
    'author', case when t.status = 'visible' and t.author_id is not null then community.display_name(t.author_id) end,
    'mine', t.author_id = p_viewer,
    'category', case when t.category_id is null then null
                     else (select jsonb_build_object('id', c.id, 'name', c.name) from community.categories c where c.id = t.category_id) end,
    'group', case when t.group_id is null then null
                  else (select jsonb_build_object('id', g.id, 'name', g.name) from community.groups g where g.id = t.group_id) end,
    'pinned', t.pinned, 'locked', t.locked,
    'reply_count', t.reply_count,
    'created_at', t.created_at, 'last_activity_at', t.last_activity_at,
    'following', exists (select 1 from community.follows f where f.thread_id = t.id and f.profile_id = p_viewer));
$$;

create or replace function community.feed_card(t community.threads, p_viewer uuid, p_mod boolean, p_can_post boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select community.thread_card(t, p_viewer) || jsonb_build_object(
    'title', case when t.status = 'visible' or (t.status = 'hidden' and p_mod) then t.title end,
    'body', case when t.status = 'visible' or (t.status = 'hidden' and p_mod) then t.body end,
    'author', case when t.status <> 'deleted' and t.author_id is not null then community.display_name(t.author_id) end,
    'edited_at', t.edited_at,
    'audience', case when t.group_id is null then 'church' else 'group' end,
    'group_archived', coalesce((select g.status::text = 'archived' from community.groups g where g.id = t.group_id), false),
    'reactions', case when t.status = 'visible' then community.reactions_json('thread', t.id, p_viewer) end,
    'comment_count', (select count(*) from community.posts p
                       where p.thread_id = t.id and (p.status = 'visible' or (p.status = 'hidden' and p_mod))),
    'attachments', coalesce((select jsonb_agg(community.attachment_json(a) order by a.sort_order, a.created_at)
                               from community.attachments a
                              where a.thread_id = t.id and a.target_type = 'thread' and a.status = 'attached'
                                and community.attachment_visible(a)), '[]'::jsonb),
    'mentions', case when t.status = 'visible' or (t.status = 'hidden' and p_mod) then community.mentions_json(t.id, null) end,
    'can_moderate', p_mod,
    'can_reply', p_can_post and t.status = 'visible' and not t.locked
                 and coalesce((select g.status::text = 'active' from community.groups g where g.id = t.group_id), true),
    'muted', exists (select 1 from community.mutes m where m.profile_id = p_viewer and m.target_type = 'thread' and m.target_id = t.id));
$$;

create or replace function community.comment_json(p community.posts, p_viewer uuid, p_mod boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select community.post_json(p, p_viewer, p_mod) || jsonb_build_object(
    'mentions', case when p.status = 'visible' or (p.status = 'hidden' and p_mod) then community.mentions_json(p.thread_id, p.id) end,
    'attachments', coalesce((select jsonb_agg(community.attachment_json(a) order by a.sort_order, a.created_at)
                               from community.attachments a
                              where a.post_id = p.id and a.target_type = 'post' and a.status = 'attached'
                                and community.attachment_visible(a)), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema community from public, anon, authenticated, service_role;

revoke execute on function public.community_mention_search(text, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.community_mention_search(text, uuid, uuid, uuid) to authenticated;

-- =========================================================================
-- Checks (any failure rolls everything back)
-- =========================================================================
do $check$
begin
  if not has_function_privilege('authenticated', 'public.community_mention_search(text, uuid, uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.community_mention_search(text, uuid, uuid, uuid)', 'execute') then
    raise exception 'Nothing was changed: the suggestion function has the wrong grants. Send this message to the developer.';
  end if;
  if has_function_privilege('authenticated', 'community.mentions_sync(uuid, uuid, uuid, text, uuid, boolean)', 'execute') then
    raise exception 'Nothing was changed: a private helper would be callable through the API. Send this message to the developer.';
  end if;
  if (select count(*) from pg_trigger where tgname in ('threads_mentions_clean', 'posts_mentions_clean', 'threads_mentions_sync', 'posts_mentions_sync')) <> 4 then
    raise exception 'Nothing was changed: the save triggers are missing. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261107000100', 'community_mentions', 'community-mentions');

commit;
