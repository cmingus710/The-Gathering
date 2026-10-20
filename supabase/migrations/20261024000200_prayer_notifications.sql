-- Phase 6 · Prayer and care notifications, on the Phase 5 notification
-- system (same table, preferences, quiet hours, outboxes, signed job,
-- Realtime signal, and the single database-owned scheduler).
--
-- New categories: prayer (comments, updates, answered prayers on requests
-- you wrote or follow) and care (assignments, coordinator responses,
-- accepted volunteer assignments, follow-up reminders). Prayer moderation
-- notices join the always-on moderation category.
--
-- Rules added here:
--   * Rows hold references only (prayer_request_id, care_request_id,
--     care_opportunity_id). They are deleted with the request, so deleting a
--     request removes queued notices too.
--   * notification_visible rechecks the prayer read rule (current audience,
--     group membership, team capability, archive, hide) or the care role on
--     every read, every email claim, and every push claim.
--   * Email and push for prayer and care are GENERIC: no request titles,
--     bodies, care details, names, or anonymous identities ever leave the
--     app. Links go to /notifications/open/<id>, which rechecks access.
--   * The actor is never stored for prayer/care notices, so a notification
--     can't reveal who commented (anonymous requesters included).
--   * Care follow-up reminders are queued by prayer.tick(), which runs inside
--     community.tick() under its advisory lock: the existing pg_cron job and
--     designated deployment stay the only scheduler, and the per-request
--     "notified on" date makes reminders idempotent across retries.

-- ---------------------------------------------------------------------------
-- Columns and checks
-- ---------------------------------------------------------------------------
alter table community.notifications
  add column prayer_request_id uuid references prayer.requests (id) on delete cascade,
  add column care_request_id uuid references prayer.care_requests (id) on delete cascade,
  add column care_opportunity_id uuid references prayer.care_opportunities (id) on delete cascade;
create index notifications_prayer_request_idx on community.notifications (prayer_request_id);
create index notifications_care_request_idx on community.notifications (care_request_id);
create index notifications_care_opportunity_idx on community.notifications (care_opportunity_id);

alter table community.notifications drop constraint notifications_kind_check;
alter table community.notifications add constraint notifications_kind_check check (kind in (
  'reply_followed', 'reply_mine', 'group_invitation', 'group_request', 'group_request_approved',
  'group_request_declined', 'group_removed', 'group_role', 'message', 'moderation', 'event',
  'prayer_comment', 'prayer_update', 'prayer_answered', 'prayer_moderation',
  'care_assigned', 'care_response', 'care_volunteer', 'care_follow_up'));
alter table community.notifications drop constraint notifications_category_check;
alter table community.notifications add constraint notifications_category_check
  check (category in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care'));

alter table community.notification_prefs drop constraint notification_prefs_category_check;
alter table community.notification_prefs add constraint notification_prefs_category_check
  check (category in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care'));
-- Care email is immediate or off (never digested).
alter table community.notification_prefs add constraint notification_prefs_care_email
  check (category <> 'care' or email in ('off', 'immediate'));

-- ---------------------------------------------------------------------------
-- Preferences
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
    else 'moderation'
  end;
$$;

-- Defaults: prayer is in-app only (email off); care emails right away.
create or replace function community.pref(p_profile uuid, p_category text)
returns table (in_app boolean, email text, push boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.in_app, true) or p_category = 'moderation',
         coalesce(p.email, case p_category when 'forum' then 'off' when 'events' then 'off' when 'prayer' then 'off' else 'immediate' end),
         coalesce(p.push, false)
    from (select 1) one
    left join community.notification_prefs p on p.profile_id = p_profile and p.category = p_category;
$$;

-- ---------------------------------------------------------------------------
-- Creating notifications (adds the prayer/care references)
-- ---------------------------------------------------------------------------
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
                                         care_opportunity_id, detail, merge_key)
    values (p_profile, p_kind, v_category, p_actor, v_thread, nullif(p_refs ->> 'post_id', '')::uuid, v_group, v_conv,
            nullif(p_refs ->> 'invitation_id', '')::uuid, nullif(p_refs ->> 'request_id', '')::uuid,
            nullif(p_refs ->> 'occurrence_id', '')::uuid, nullif(p_refs ->> 'prayer_request_id', '')::uuid,
            nullif(p_refs ->> 'care_request_id', '')::uuid, nullif(p_refs ->> 'care_opportunity_id', '')::uuid,
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

-- ---------------------------------------------------------------------------
-- Visibility and wording (access rechecked every time)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Outside the app: generic wording for prayer and care
-- ---------------------------------------------------------------------------
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

-- Care email is never digested (immediate or off), like messages.
create or replace function community.email_items(e community.email_outbox)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(community.notification_email_item(n) order by n.updated_at desc), '[]'::jsonb)
    from (select n.*
            from community.notifications n
           where n.profile_id = e.profile_id
             and n.read_at is null
             and community.notification_visible(n)
             and case when e.kind = 'immediate'
                      then n.id = e.notification_id
                           and (select x.email from community.pref(n.profile_id, n.category) x) = 'immediate'
                      else n.updated_at >= e.period_start and n.updated_at < e.period_end
                           and n.category not in ('messages', 'events', 'care')
                           and (select x.email from community.pref(n.profile_id, n.category) x)
                               in ('daily', case when e.digest_weekly then 'weekly' else 'daily' end)
                 end
           order by n.updated_at desc
           limit 25) n;
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
                else 'You have a new notification.' end,
      'url', '/notifications/open/' || n.id));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member settings: the two new categories
-- ---------------------------------------------------------------------------
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
                from unnest(array['forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care']) c
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
  if p_category not in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care') then
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

-- ---------------------------------------------------------------------------
-- Prayer/care scheduled work: follow-up reminders and (only when the church
-- has enabled it) retention. Called by community.tick() under its lock.
-- ---------------------------------------------------------------------------
create function prayer.tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st prayer.settings;
  v_today date := (now() at time zone coalesce((select timezone from public.church_settings), 'America/Chicago'))::date;
  c record;
  v_reminders integer := 0;
  v_archived integer := 0;
  v_deleted integer := 0;
  v_care_deleted integer := 0;
begin
  select * into st from prayer.settings;

  -- Follow-up reminders: once per follow-up date, to the assigned coordinator.
  for c in
    select * from prayer.care_requests
     where follow_up_on is not null and follow_up_on <= v_today
       and follow_up_notified_on is distinct from follow_up_on
       and status in ('submitted', 'in_review', 'coordinating')
       and assigned_to is not null
     for update skip locked
  loop
    update prayer.care_requests set follow_up_notified_on = c.follow_up_on where id = c.id;
    if prayer.holds(c.assigned_to, 'care.coordinate') then
      perform community.notify(c.assigned_to, 'care_follow_up', null,
        jsonb_build_object('care_request_id', c.id), 'care_follow_up:' || c.id || ':' || c.follow_up_on);
      v_reminders := v_reminders + 1;
    end if;
  end loop;

  -- Retention runs only after the church adopts a policy (see
  -- docs/prayer-retention.md). Archiving never broadens visibility.
  if st.retention_enabled then
    update prayer.requests set status = 'archived', archived_at = now()
     where status = 'closed' and closed_at < now() - make_interval(days => st.closed_archive_days);
    get diagnostics v_archived = row_count;
    delete from prayer.requests where status = 'archived' and archived_at < now() - make_interval(days => st.archived_delete_days);
    get diagnostics v_deleted = row_count;
    delete from prayer.care_requests where status = 'closed' and closed_at < now() - make_interval(days => st.care_delete_days);
    get diagnostics v_care_deleted = row_count;
    update prayer.reports set evidence = null, evidence_cleared_at = now()
     where evidence is not null and status in ('actioned', 'dismissed')
       and resolved_at < now() - make_interval(days => st.report_evidence_days);
  end if;
  return jsonb_build_object('reminders', v_reminders, 'archived', v_archived, 'deleted', v_deleted, 'care_deleted', v_care_deleted);
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
begin
  if not pg_try_advisory_xact_lock(hashtext('community.tick')) then
    return jsonb_build_object('skipped', true);
  end if;
  select * into st from community.settings;

  update community.group_invitations set status = 'expired' where status = 'pending' and expires_at <= now();

  -- Prayer/care reminders first, so their email is due in this same run.
  v_prayer := prayer.tick();

  -- Digests: one per member per local day, at or after the digest hour.
  for r in
    select p.id as profile_id, community.member_tz(p.id) as tz,
           bool_or(x.email = 'daily') as daily, bool_or(x.email = 'weekly') as weekly
      from public.profiles p
      cross join unnest(array['forum', 'groups', 'moderation', 'prayer']) c
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
  return jsonb_build_object('digests', v_digests, 'pending', v_pending, 'prayer', v_prayer,
    'push_pending', (select count(*) from community.push_outbox
                      where (status = 'pending' or (status = 'failed' and attempts < 3))
                        and next_attempt_at <= now() and send_after <= now()));
end;
$$;

-- Removes a prayer request's queued and unread notices for people who can
-- no longer read it (after narrowing, hiding, or archiving). Delivery
-- rechecks access anyway; this keeps queues and lists clean.
create function prayer.purge_notices(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update community.email_outbox e set status = 'skipped', updated_at = now()
    from community.notifications n
   where n.id = e.notification_id and n.prayer_request_id = p_request
     and e.status in ('pending', 'failed') and not community.notification_visible(n);
  update community.push_outbox p set status = 'skipped', updated_at = now()
    from community.notifications n
   where n.id = p.notification_id and n.prayer_request_id = p_request
     and p.status in ('pending', 'failed') and not community.notification_visible(n);
  delete from community.notifications n
   where n.prayer_request_id = p_request and n.read_at is null and not community.notification_visible(n);
end;
$$;

revoke execute on all functions in schema community from public, anon, authenticated;
revoke execute on all functions in schema prayer from public, anon, authenticated;
