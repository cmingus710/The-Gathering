-- Phase 7 · Step 6 of 6: apply migration 20261025000600_media_notifications to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Teaching and gallery notifications on the existing queues, preferences, quiet hours, and scheduler (community.tick runs media.tick).
--
-- It copies supabase/migrations/20261025000600_media_notifications.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-7).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000500') then
    raise exception 'Nothing was changed: the previous step (20261025000500) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000600') then
    raise exception 'Nothing was changed: 20261025000600 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261025000600_media_notifications.sql
-- =========================================================================
-- Phase 7 · Teaching and gallery notifications, on the Phase 5/6
-- notification system (same table, preferences, quiet hours, digests,
-- outboxes, signed job, Realtime signal) and the single database-owned
-- scheduler (pg_cron → events.call_worker → community.tick → media.tick).
--
-- New categories:
--   teaching  a devotional, Sunday lesson, church podcast episode, reading
--             assignment, or playlist went live with "notify" switched on
--   gallery   new approved photos in an album (batched: at most one notice
--             per album every 6 hours, merged while unread) and moderation
--             outcomes for your own photos (merged per album and outcome)
-- Both default to in-app only (email off); members can choose email or a
-- digest, and mute individual content kinds (media_prefs_save).
--
-- Rules:
--   * Rows hold references only (media_item_id, media_album_id), deleted
--     with the item or album.
--   * notification_visible rechecks the content/album read rule on every
--     read, email claim, and push claim, so narrowing an audience, removal
--     from a group, unpublishing, or suspension hides queued notices.
--   * Email and push are generic ("A new Sunday lesson is available"): no
--     titles, album names, captions, or names leave the app.
--   * Imports from external podcast feeds never notify.
--   * Each item notifies at most once (notified_at, set under the tick's
--     advisory lock) and merge keys collapse retries, so preview
--     deployments and retried scheduler runs can't send duplicates.

-- ---------------------------------------------------------------------------
-- Columns and checks
-- ---------------------------------------------------------------------------
alter table community.notifications
  add column media_item_id uuid references media.items (id) on delete cascade,
  add column media_album_id uuid references media.albums (id) on delete cascade;
create index notifications_media_item_idx on community.notifications (media_item_id);
create index notifications_media_album_idx on community.notifications (media_album_id);

alter table community.notifications drop constraint notifications_kind_check;
alter table community.notifications add constraint notifications_kind_check check (kind in (
  'reply_followed', 'reply_mine', 'group_invitation', 'group_request', 'group_request_approved',
  'group_request_declined', 'group_removed', 'group_role', 'message', 'moderation', 'event',
  'prayer_comment', 'prayer_update', 'prayer_answered', 'prayer_moderation',
  'care_assigned', 'care_response', 'care_volunteer', 'care_follow_up',
  'content_new', 'gallery_new', 'gallery_outcome'));
alter table community.notifications drop constraint notifications_category_check;
alter table community.notifications add constraint notifications_category_check
  check (category in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery'));

alter table community.notification_prefs drop constraint notification_prefs_category_check;
alter table community.notification_prefs add constraint notification_prefs_category_check
  check (category in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery'));

-- ---------------------------------------------------------------------------
-- Notification functions (Phase 6 versions plus the two new categories)
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
         coalesce(p.email, case p_category when 'forum' then 'off' when 'events' then 'off' when 'prayer' then 'off' when 'teaching' then 'off' when 'gallery' then 'off' else 'immediate' end),
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
                                         care_opportunity_id, media_item_id, media_album_id, detail, merge_key)
    values (p_profile, p_kind, v_category, p_actor, v_thread, nullif(p_refs ->> 'post_id', '')::uuid, v_group, v_conv,
            nullif(p_refs ->> 'invitation_id', '')::uuid, nullif(p_refs ->> 'request_id', '')::uuid,
            nullif(p_refs ->> 'occurrence_id', '')::uuid, nullif(p_refs ->> 'prayer_request_id', '')::uuid,
            nullif(p_refs ->> 'care_request_id', '')::uuid, nullif(p_refs ->> 'care_opportunity_id', '')::uuid,
            nullif(p_refs ->> 'media_item_id', '')::uuid, nullif(p_refs ->> 'media_album_id', '')::uuid,
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
                from unnest(array['forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery']) c
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
  if p_category not in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery') then
    raise exception 'Unknown notification category.' using errcode = '22023';
  end if;
  if p_email not in ('off', 'immediate', 'daily', 'weekly')
     or (p_category in ('messages', 'care') and p_email not in ('off', 'immediate'))
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

create or replace function community.tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st community.settings;
  v_digests integer := 0;
  v_n integer;
  r record;
  v_local timestamp;
  v_weekly boolean;
  v_pending integer;
  v_prayer jsonb;
  v_media jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('community.tick')) then
    return jsonb_build_object('skipped', true);
  end if;
  select * into st from community.settings;

  update community.group_invitations set status = 'expired' where status = 'pending' and expires_at <= now();

  -- Prayer/care reminders first, so their email is due in this same run.
  v_prayer := prayer.tick();
  -- Teaching and gallery notices (Phase 7), queued before digests.
  v_media := media.tick();

  -- Digests: one per member per local day, at or after the digest hour.
  for r in
    select p.id as profile_id, community.member_tz(p.id) as tz,
           bool_or(x.email = 'daily') as daily, bool_or(x.email = 'weekly') as weekly
      from public.profiles p
      cross join unnest(array['forum', 'groups', 'moderation', 'prayer', 'teaching', 'gallery']) c
      cross join lateral community.pref(p.id, c) x
     where p.membership_status = 'approved' and p.account_kind = 'adult'
       and exists (select 1 from community.notification_prefs np
                    where np.profile_id = p.id and np.email in ('daily', 'weekly'))
     group by p.id
  loop
    continue when not (r.daily or r.weekly);
    v_local := now() at time zone r.tz;
    continue when extract(hour from v_local) < st.digest_hour;
    v_weekly := r.weekly and extract(dow from v_local) = st.weekly_digest_dow;
    continue when not r.daily and not v_weekly;
    insert into community.email_outbox (dedupe_key, kind, profile_id, digest_weekly, period_start, period_end, send_after)
    values ('digest:' || r.profile_id || ':' || v_local::date, 'digest', r.profile_id, v_weekly,
            now() - case when v_weekly then interval '7 days' else interval '1 day' end, now(),
            community.after_quiet(r.profile_id, now()))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    v_digests := v_digests + v_n;
  end loop;

  -- Retention.
  delete from community.rate_events where created_at < now() - interval '2 days';
  delete from community.messages where created_at < now() - make_interval(days => st.dm_retention_days);
  delete from community.messages m
   using community.conversations c
   where c.id = m.conversation_id
     and m.created_at <= (select min(s.cleared_at) from community.conversation_state s where s.conversation_id = c.id)
     and (select count(*) from community.conversation_state s where s.conversation_id = c.id) = 2;
  update community.reports
     set evidence = null, evidence_cleared_at = now()
   where evidence is not null and status in ('actioned', 'dismissed')
     and resolved_at < now() - make_interval(days => st.report_evidence_days);
  delete from community.notifications where read_at is not null and read_at < now() - interval '180 days';
  delete from community.email_outbox where status in ('sent', 'skipped', 'suppressed') and updated_at < now() - interval '60 days';
  delete from community.push_outbox where status in ('sent', 'skipped') and updated_at < now() - interval '14 days';

  select count(*) into v_pending from community.email_outbox
   where (status = 'pending' or (status = 'failed' and attempts < 5)) and next_attempt_at <= now() and send_after <= now();
  return jsonb_build_object('digests', v_digests, 'pending', v_pending, 'prayer', v_prayer, 'media', v_media,
    'push_pending', (select count(*) from community.push_outbox
                      where (status = 'pending' or (status = 'failed' and attempts < 3))
                        and next_attempt_at <= now() and send_after <= now()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled work: new-content and gallery notices, and housekeeping.
-- Runs inside community.tick() under its advisory lock.
-- ---------------------------------------------------------------------------
create function media.tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i record;
  a record;
  v_items integer := 0;
  v_albums integer := 0;
  v_sent integer := 0;
  v_mute text;
begin
  -- Content that went live (publishing now or at its scheduled time) with
  -- notify on. Content live for more than 3 days without a notice (for
  -- example notify switched on later) is marked and never announced late.
  update media.items set notified_at = now()
   where notify and notified_at is null and media.is_live(status, publish_at, expires_at)
     and publish_at < now() - interval '3 days';
  for i in
    select * from media.items
     where notify and notified_at is null and kind <> 'book'
       and media.is_live(status, publish_at, expires_at)
     order by publish_at
     limit 20
     for update skip locked
  loop
    update media.items set notified_at = now() where id = i.id;
    v_items := v_items + 1;
    v_mute := i.kind::text;
    v_sent := v_sent + (
      select count(community.notify(p.id, 'content_new', null,
                                    jsonb_build_object('media_item_id', i.id, 'detail', jsonb_build_object('kind', i.kind)),
                                    'content_new:' || i.id))
        from public.profiles p
       where p.membership_status = 'approved' and p.account_kind = 'adult'
         and media.item_visible_id(i.id, p.id)
         and not exists (select 1 from media.member_prefs mp where mp.profile_id = p.id and v_mute = any (mp.muted_kinds)));
  end loop;

  -- New photos, batched per album: at most once every 6 hours, after
  -- approvals have settled for 10 minutes.
  for a in
    select al.* from media.albums al
     where al.status = 'published'
       and (al.last_notified_at is null or al.last_notified_at < now() - interval '6 hours')
       and exists (select 1 from media.photos ph
                    where ph.album_id = al.id and ph.status = 'approved'
                      and ph.approved_at > coalesce(al.last_notified_at, '-infinity'))
       and not exists (select 1 from media.photos ph
                        where ph.album_id = al.id and ph.status = 'approved'
                          and ph.approved_at > now() - interval '10 minutes')
     limit 20
     for update skip locked
  loop
    update media.albums set last_notified_at = now() where id = a.id;
    v_albums := v_albums + 1;
    v_sent := v_sent + (
      select count(community.notify(p.id, 'gallery_new', null, jsonb_build_object('media_album_id', a.id), 'gallery_new:' || a.id))
        from public.profiles p
       where p.membership_status = 'approved' and p.account_kind = 'adult'
         and exists (select 1 from media.albums x where x.id = a.id and media.album_visible(x, p.id))
         and not exists (select 1 from media.member_prefs mp where mp.profile_id = p.id and 'gallery' = any (mp.muted_kinds)));
  end loop;

  delete from media.public_hits where created_at < now() - interval '1 day';
  -- Leases left by an interrupted refresh expire on their own; nothing to do.
  return jsonb_build_object('items', v_items, 'albums', v_albums, 'notices', v_sent, 'feeds_due', media.has_due_feeds());
end;
$$;

-- Moderation outcomes for the uploader (merged per album and outcome).
create or replace function media.after_review(ph media.photos, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if ph.uploader_id is null or p_action not in ('approve', 'reject', 'hide', 'unhide', 'remove') then
    return;
  end if;
  perform community.notify(ph.uploader_id, 'gallery_outcome', null,
    jsonb_build_object('media_album_id', ph.album_id, 'detail', jsonb_build_object('action', p_action)),
    'gallery_outcome:' || ph.album_id || ':' || p_action);
end;
$$;

-- The scheduler wakes the app when email or push is due, and now also when
-- an external podcast feed is due for its scheduled refresh.
create or replace function community.has_due_work()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from community.email_outbox
                  where (status = 'pending' or (status = 'failed' and attempts < 5)
                         or (status = 'sending' and updated_at < now() - interval '10 minutes'))
                    and next_attempt_at <= now() and send_after <= now())
      or exists (select 1 from community.push_outbox
                  where (status = 'pending' or (status = 'failed' and attempts < 3)
                         or (status = 'sending' and updated_at < now() - interval '10 minutes'))
                    and next_attempt_at <= now() and send_after <= now())
      or media.has_due_feeds();
$$;

revoke execute on all functions in schema community from public, anon, authenticated;
revoke execute on all functions in schema media from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261025000600', 'media_notifications', 'phase-7');

commit;
