-- Phase 5 · Community: notification center, delivery (email, digests, quiet
-- hours, web push), the scheduled job, and Realtime authorization.
--
-- Rules (also in docs/notifications.md):
--   * A notification row holds references (thread, group, conversation…) and
--     flags, never content. Titles and wording are computed when read, after
--     the reader's CURRENT access is rechecked, so deleted, hidden, or newly
--     restricted content never leaks through the list, counts, or titles.
--   * Unread notifications about the same thing are merged (count + time),
--     which bounds how many rows any burst of activity can create.
--   * Email and push are separate delivery records with unique dedupe keys,
--     claimed under row locks (for update skip locked) by the signed job.
--     The claim rechecks access again and renders only generic text: direct
--     message emails and pushes never contain message text or the sender.
--   * Quiet hours delay email and push (member's time zone, church fallback).
--   * Event notifications keep their own transactional email (events.outbox)
--     and also appear in the in-app list. Giving never appears here.

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------
create function community.kind_category(p_kind text)
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
    else 'moderation'
  end;
$$;

-- Effective preference for one category (stored row or default).
create function community.pref(p_profile uuid, p_category text)
returns table (in_app boolean, email text, push boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.in_app, true) or p_category = 'moderation',
         coalesce(p.email, case p_category when 'forum' then 'off' when 'events' then 'off' else 'immediate' end),
         coalesce(p.push, false)
    from (select 1) one
    left join community.notification_prefs p on p.profile_id = p_profile and p.category = p_category;
$$;

-- ---------------------------------------------------------------------------
-- Creating notifications
-- ---------------------------------------------------------------------------
-- p_refs keys: thread_id, post_id, group_id, conversation_id, invitation_id,
-- request_id, occurrence_id, detail. Returns the notification id, or null
-- when suppressed (recipient not eligible, self, blocked actor, muted, or
-- every channel off for this category).
create function community.notify(p_profile uuid, p_kind text, p_actor uuid, p_refs jsonb, p_merge_key text default null)
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
                                         invitation_id, request_id, occurrence_id, detail, merge_key)
    values (p_profile, p_kind, v_category, p_actor, v_thread, nullif(p_refs ->> 'post_id', '')::uuid, v_group, v_conv,
            nullif(p_refs ->> 'invitation_id', '')::uuid, nullif(p_refs ->> 'request_id', '')::uuid,
            nullif(p_refs ->> 'occurrence_id', '')::uuid, coalesce(p_refs -> 'detail', '{}'::jsonb), p_merge_key)
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
-- Reading notifications: access is rechecked every time.
-- ---------------------------------------------------------------------------
create function community.notification_visible(n community.notifications)
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
       else true
     end;
$$;

-- Wording and link, computed from current data. For a group the reader can
-- no longer see (e.g. after removal from a hidden group), the name is
-- withheld. Direct messages never include text or the sender's name.
create function community.notification_json(n community.notifications)
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
    'reason', case when n.kind = 'moderation' then n.detail ->> 'reason' end,
    'group_name', v_group_name);
end;
$$;

create function public.community_notifications(p_before timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_items jsonb;
begin
  select coalesce(jsonb_agg(community.notification_json(x) order by x.updated_at desc, x.id), '[]'::jsonb)
    into v_items
    from (select n.* from community.notifications n
           where n.profile_id = v_uid
             and (p_before is null or n.updated_at < p_before)
             and community.notification_visible(n)
           order by n.updated_at desc, n.id
           limit v_limit) x;
  return jsonb_build_object('items', v_items, 'has_more', jsonb_array_length(v_items) = v_limit);
end;
$$;

-- Badge counts: visible unread notifications and conversations with unread
-- messages (both capped at 99).
create function public.community_unread_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not community.is_member(v_uid) then
    return jsonb_build_object('notifications', 0, 'messages', 0);
  end if;
  return jsonb_build_object(
    'notifications', (select count(*) from (
        select 1 from community.notifications n
         where n.profile_id = v_uid and n.read_at is null and n.kind <> 'message' and community.notification_visible(n)
         limit 99) x),
    'messages', (select count(*) from (
        select 1 from community.conversations c
          join community.conversation_state s on s.conversation_id = c.id and s.profile_id = v_uid
         where v_uid in (c.member_a, c.member_b)
           and exists (select 1 from community.messages m
                        where m.conversation_id = c.id and m.sender_id is distinct from v_uid
                          and m.created_at > greatest(s.last_read_at, s.cleared_at)
                          and not exists (select 1 from community.blocks b where b.blocker_id = v_uid and b.blocked_id = m.sender_id))
         limit 99) y));
end;
$$;

create function public.community_notification_read(p_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  update community.notifications set read_at = now()
   where profile_id = v_uid and read_at is null and (p_id is null or id = p_id);
  perform community.ping(v_uid, 'read');
end;
$$;

-- Click-through: marks the notification read and returns where to go, or
-- null when the content is no longer available to the reader.
create function public.community_notification_open(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  n community.notifications;
begin
  select * into n from community.notifications where id = p_id and profile_id = v_uid;
  if not found then
    return null;
  end if;
  update community.notifications set read_at = coalesce(read_at, now()) where id = n.id;
  perform community.ping(v_uid, 'read');
  if not community.notification_visible(n) then
    return null;
  end if;
  return community.notification_json(n) ->> 'url';
end;
$$;

-- ---------------------------------------------------------------------------
-- Preferences, quiet hours, mutes, push devices
-- ---------------------------------------------------------------------------
create function public.community_my_settings()
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
                from unnest(array['forum', 'groups', 'messages', 'moderation', 'events']) c
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

create function public.community_set_pref(p_category text, p_in_app boolean, p_email text, p_push boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if p_category not in ('forum', 'groups', 'messages', 'moderation', 'events') then
    raise exception 'Unknown notification category.' using errcode = '22023';
  end if;
  if p_email not in ('off', 'immediate', 'daily', 'weekly')
     or (p_category = 'messages' and p_email not in ('off', 'immediate'))
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

create function public.community_set_quiet_hours(p_enabled boolean, p_start time, p_end time, p_timezone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_tz text := nullif(btrim(coalesce(p_timezone, '')), '');
begin
  if v_tz is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception 'Choose a valid time zone.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_start = p_end then
    raise exception 'Quiet hours need different start and end times.' using errcode = '22023';
  end if;
  insert into community.member_settings (profile_id, timezone, quiet_enabled, quiet_start, quiet_end)
  values (v_uid, v_tz, coalesce(p_enabled, false), p_start, p_end)
  on conflict (profile_id) do update
    set timezone = excluded.timezone, quiet_enabled = excluded.quiet_enabled,
        quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now();
end;
$$;

create function public.community_set_mute(p_type text, p_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if p_type not in ('thread', 'group', 'conversation') or p_id is null then
    raise exception 'That can''t be muted.' using errcode = '22023';
  end if;
  if p_muted then
    if (p_type = 'thread' and not community.can_read_thread(p_id, v_uid))
       or (p_type = 'group' and not community.group_member(p_id, v_uid))
       or (p_type = 'conversation' and not exists (select 1 from community.conversations c
                                                   where c.id = p_id and v_uid in (c.member_a, c.member_b))) then
      raise exception 'That wasn''t found.' using errcode = 'P0002';
    end if;
    insert into community.mutes (profile_id, target_type, target_id) values (v_uid, p_type, p_id)
    on conflict do nothing;
  else
    delete from community.mutes where profile_id = v_uid and target_type = p_type and target_id = p_id;
  end if;
end;
$$;

create function public.community_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_id uuid;
begin
  perform community.rate_limit(v_uid, 'push_subscribe', 10, interval '1 hour');
  if (select count(*) from community.push_subscriptions where profile_id = v_uid) >= 10
     and not exists (select 1 from community.push_subscriptions where endpoint = p_endpoint and profile_id = v_uid) then
    raise exception 'You can turn on notifications for up to 10 devices. Remove one first.' using errcode = '22023';
  end if;
  -- An endpoint belongs to one browser; re-subscribing moves it to the
  -- account signed in there now.
  insert into community.push_subscriptions (profile_id, endpoint, p256dh, auth, label)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(nullif(btrim(p_label), ''), 80))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
        label = excluded.label, failure_count = 0, created_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create function public.community_push_unsubscribe(p_id uuid default null, p_endpoint text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in to manage notifications.' using errcode = '42501';
  end if;
  delete from community.push_subscriptions
   where profile_id = v_uid and (id = p_id or endpoint = p_endpoint);
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery: email and push claims (signed job only)
-- ---------------------------------------------------------------------------
-- What one notification may say outside the app. Church-wide discussion
-- titles are included; group discussions name only the group; direct
-- messages say only that there is a new message.
create function community.notification_email_item(n community.notifications)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j jsonb := community.notification_json(n);
  v_group text;
begin
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

create function community.email_items(e community.email_outbox)
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
                           and n.category not in ('messages', 'events')
                           and (select x.email from community.pref(n.profile_id, n.category) x)
                               in ('daily', case when e.digest_weekly then 'weekly' else 'daily' end)
                 end
           order by n.updated_at desc
           limit 25) n;
$$;

create function community.op_email_claim(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((v ->> 'limit')::integer, 10), 1), 50);
  r community.email_outbox;
  v_items jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  for r in
    select e.* from community.email_outbox e
     where e.next_attempt_at <= now() and e.send_after <= now()
       and (e.status = 'pending' or (e.status = 'failed' and e.attempts < 5)
            or (e.status = 'sending' and e.updated_at < now() - interval '10 minutes'))
     order by e.created_at
     limit v_limit
     for update skip locked
  loop
    v_items := case when community.is_member(r.profile_id) then community.email_items(r) else '[]'::jsonb end;
    if jsonb_array_length(v_items) = 0 then
      update community.email_outbox set status = 'skipped', attempts = attempts + 1, updated_at = now() where id = r.id;
      continue;
    end if;
    update community.email_outbox set status = 'sending', attempts = attempts + 1, updated_at = now() where id = r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'dedupe_key', r.dedupe_key, 'weekly', r.digest_weekly,
      'to', (select email from public.profiles where id = r.profile_id),
      'first_name', (select coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.first_name), ''),
                                     nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''))
                       from public.profiles p where p.id = r.profile_id),
      'items', v_items));
  end loop;
  return v_out;
end;
$$;

create function community.op_email_result(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := v ->> 'status';
begin
  if v_status not in ('sent', 'failed', 'suppressed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  update community.email_outbox
     set status = v_status,
         last_error = left(v ->> 'error', 300),
         provider_message_id = left(v ->> 'provider_id', 200),
         sent_at = case when v_status = 'sent' then now() end,
         next_attempt_at = case when v_status = 'failed' then now() + make_interval(mins => 10 * attempts) else next_attempt_at end,
         updated_at = now()
   where id = (v ->> 'id')::uuid and status = 'sending';
  if found and v_status = 'sent' then
    update community.member_settings set last_digest_at = now()
     where profile_id = (select profile_id from community.email_outbox where id = (v ->> 'id')::uuid and kind = 'digest');
  end if;
  return jsonb_build_object('ok', found);
end;
$$;

create function community.op_push_claim(v jsonb)
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
                else 'You have a new community notification.' end,
      'url', '/notifications/open/' || n.id));
  end loop;
  return v_out;
end;
$$;

-- v: { id, status: sent|failed, gone: [subscription ids], ok: [subscription ids] }
create function community.op_push_result(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := v ->> 'status';
begin
  if v_status not in ('sent', 'failed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  delete from community.push_subscriptions
   where id in (select x::uuid from jsonb_array_elements_text(coalesce(v -> 'gone', '[]'::jsonb)) x);
  update community.push_subscriptions set last_success_at = now(), failure_count = 0
   where id in (select x::uuid from jsonb_array_elements_text(coalesce(v -> 'ok', '[]'::jsonb)) x);
  update community.push_subscriptions set failure_count = failure_count + 1
   where id in (select x::uuid from jsonb_array_elements_text(coalesce(v -> 'failed', '[]'::jsonb)) x);
  -- Endpoints that keep failing are removed (expired subscriptions).
  delete from community.push_subscriptions where failure_count >= 5;
  update community.push_outbox
     set status = v_status, last_error = left(v ->> 'error', 300),
         next_attempt_at = case when v_status = 'failed' then now() + make_interval(mins => 5 * attempts) else next_attempt_at end,
         updated_at = now()
   where id = (v ->> 'id')::uuid and status = 'sending';
  return jsonb_build_object('ok', found);
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler tick: digests, invitation expiry, retention. Runs under an
-- advisory lock (shared with nothing else), so overlapping callers never
-- double-queue; digest dedupe keys make it idempotent anyway.
-- ---------------------------------------------------------------------------
create function community.tick()
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
begin
  if not pg_try_advisory_xact_lock(hashtext('community.tick')) then
    return jsonb_build_object('skipped', true);
  end if;
  select * into st from community.settings;

  update community.group_invitations set status = 'expired' where status = 'pending' and expires_at <= now();

  -- Digests: one per member per local day, at or after the digest hour.
  for r in
    select p.id as profile_id, community.member_tz(p.id) as tz,
           bool_or(x.email = 'daily') as daily, bool_or(x.email = 'weekly') as weekly
      from public.profiles p
      cross join unnest(array['forum', 'groups', 'moderation']) c
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
  return jsonb_build_object('digests', v_digests, 'pending', v_pending,
    'push_pending', (select count(*) from community.push_outbox
                      where (status = 'pending' or (status = 'failed' and attempts < 3))
                        and next_attempt_at <= now() and send_after <= now()));
end;
$$;

-- Whether the scheduler has community delivery work (used by the database
-- scheduler to decide whether to wake the designated deployment).
create function community.has_due_work()
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
                    and next_attempt_at <= now() and send_after <= now());
$$;

-- Signed job entry point. Same secret and scheme as events_job (one
-- scheduler, one secret: EVENTS_JOB_SECRET / events.secrets('job')).
create function public.community_job(p_op text, p_payload text, p_ts bigint, p_sig text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v jsonb;
begin
  select value into v_key from events.secrets where name = 'job';
  if v_key is null then
    raise exception 'Community jobs are not configured.' using errcode = '42501';
  end if;
  if p_ts is null or abs(extract(epoch from now()) - p_ts) > 300 then
    raise exception 'Request expired.' using errcode = '42501';
  end if;
  if p_sig is null
     or p_sig <> encode(extensions.hmac('community.' || coalesce(p_op, '') || '.' || p_ts::text || '.' || coalesce(p_payload, ''), v_key, 'sha256'), 'hex') then
    raise exception 'Invalid signature.' using errcode = '42501';
  end if;
  v := coalesce(nullif(p_payload, ''), '{}')::jsonb;
  return case p_op
    when 'tick' then community.tick()
    when 'email_claim' then community.op_email_claim(v)
    when 'email_result' then community.op_email_result(v)
    when 'push_claim' then community.op_push_claim(v)
    when 'push_result' then community.op_push_result(v)
    else null
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Event notifications in the in-app list (their email stays in events.outbox)
-- ---------------------------------------------------------------------------
create function community.on_event_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('promoted', 'changed', 'occurrence_canceled', 'event_canceled') then
    perform community.notify(new.profile_id, 'event', null,
      jsonb_build_object('occurrence_id', new.occurrence_id,
                         'detail', jsonb_build_object('change', case when new.kind like '%canceled' then 'canceled' else new.kind end)),
      'event:' || new.occurrence_id || ':' || new.kind);
  end if;
  return new;
end;
$$;

create trigger community_event_notifications
  after insert on events.outbox
  for each row execute function community.on_event_outbox();

-- ---------------------------------------------------------------------------
-- Realtime: members may receive broadcasts only on their own private topic
-- (member:<their id>), only while approved. No insert policy, so clients can
-- never broadcast; only the database (community.ping) sends, and only
-- content-free "refresh" signals.
-- ---------------------------------------------------------------------------
create policy "Members receive their own community signals"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'member:' || (select auth.uid())::text
    and (select public.is_approved_member())
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema community from public, anon, authenticated;

revoke execute on function
  public.community_notifications(timestamptz, integer), public.community_unread_counts(),
  public.community_notification_read(uuid), public.community_notification_open(uuid), public.community_my_settings(),
  public.community_set_pref(text, boolean, text, boolean), public.community_set_quiet_hours(boolean, time, time, text),
  public.community_set_mute(text, uuid, boolean), public.community_push_subscribe(text, text, text, text),
  public.community_push_unsubscribe(uuid, text), public.community_job(text, text, bigint, text)
from public;

grant execute on function
  public.community_notifications(timestamptz, integer), public.community_unread_counts(),
  public.community_notification_read(uuid), public.community_notification_open(uuid), public.community_my_settings(),
  public.community_set_pref(text, boolean, text, boolean), public.community_set_quiet_hours(boolean, time, time, text),
  public.community_set_mute(text, uuid, boolean), public.community_push_subscribe(text, text, text, text),
  public.community_push_unsubscribe(uuid, text)
to authenticated;

-- The signed job is called by the app server with the publishable key.
grant execute on function public.community_job(text, text, bigint, text) to anon, authenticated;
