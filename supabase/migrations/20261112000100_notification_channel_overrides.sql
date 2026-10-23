-- Church settings → Notifications: church-wide push and email switches per
-- notification type, each with a persistent "All" override.
--
-- Scope (what "a notification type" means here)
--   * Push: every member notification category (community.notification_prefs
--     categories) that push can carry.
--   * Email: the same categories except 'events' (event updates are never
--     emailed as notifications; event registration emails are transactional),
--     plus the membership approval alert that Church settings already
--     controls. Its existing on/off switch (membership.alert_settings.enabled)
--     is that type's individual email setting.
--   Not covered, and unchanged: in-app notifications, sign-in/auth email,
--   event registration email, and giving receipts (transactional).
--
-- Effective setting for a type on a channel
--   all_types = true   → allowed, for every type now and any added later.
--   all_types = false  → allowed unless the type is in disabled_types.
--   Both overrides start off, and disabled_types starts empty, so nothing
--   about delivery changes when this ships. Turning All on never rewrites
--   disabled_types, so turning it off restores the earlier selections exactly.
--
-- The church setting only ever narrows: delivery still needs the member's own
-- preference for that category (community.pref), their mutes and blocks,
-- quiet hours, current access to the content (notification_visible), and for
-- push a registered device subscription. Recipient lists are untouched; for
-- membership approval alerts "All" only stands in for the on/off switch,
-- and the configured recipients still receive them. Provider configuration
-- (Resend, VAPID) is checked by the app as before; nothing here turns a
-- provider on. Dedupe keys are unchanged, so nothing is sent twice.
--
-- Enforced at both ends: when a notification is queued (community.notify,
-- membership.enqueue_approval_alert) and again when it is claimed for sending
-- (community.email_items, community.op_push_claim, membership.op_alert_claim),
-- so a type switched off stops anything already queued.
--
-- Additive only: one new table (no API grants, RLS on), helper functions, two
-- settings functions for settings.manage holders (audited like the membership
-- alert settings). The replaced functions keep their bodies and grants; only
-- their preference lookups change (community.pref → community.delivery_pref,
-- alert_settings.enabled → membership.alerts_on()).

create table community.channel_policy (
  channel text primary key check (channel in ('push', 'email')),
  all_types boolean not null default false,
  -- Individual selections: types switched off while all_types is false.
  disabled_types text[] not null default '{}'
    check (cardinality(disabled_types) <= 64 and array_position(disabled_types, null) is null),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into community.channel_policy (channel) values ('push'), ('email');
alter table community.channel_policy enable row level security;
revoke all on community.channel_policy from public, anon, authenticated, service_role;

-- Types each channel supports (for validation and the settings page). The
-- override itself doesn't depend on this list: a category added later is
-- allowed whenever All is on, and by default otherwise.
create function community.channel_types(p_channel text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_channel
    when 'push' then array['forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery',
                           'reading', 'memory', 'youth', 'mentions', 'group_mentions']
    when 'email' then array['forum', 'groups', 'messages', 'moderation', 'prayer', 'care', 'teaching', 'gallery',
                            'reading', 'memory', 'youth', 'mentions', 'group_mentions', 'membership_approval']
  end;
$$;

-- Whether the church allows this type on this channel (see header).
create function community.channel_allows(p_channel text, p_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.all_types or not (p_type = any (c.disabled_types))
                     from community.channel_policy c where c.channel = p_channel), true);
$$;

-- The member's preference narrowed by the church's channel settings. Used by
-- delivery; settings pages keep showing (and saving) the member's own choice
-- from community.pref, so it is preserved whatever the church setting is.
create function community.delivery_pref(p_profile uuid, p_category text)
returns table (in_app boolean, email text, push boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select x.in_app,
         case when community.channel_allows('email', p_category) then x.email else 'off' end,
         x.push and community.channel_allows('push', p_category)
    from community.pref(p_profile, p_category) x;
$$;

-- Membership approval alerts: their own switch, or Email "All".
create function membership.alerts_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from membership.alert_settings), false)
      or coalesce((select all_types from community.channel_policy where channel = 'email'), false);
$$;

-- ---------------------------------------------------------------------------
-- Settings (settings.manage; the page checks too)
-- ---------------------------------------------------------------------------
create function public.notification_channels_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.has_capability('settings.manage') then
    raise exception 'You do not have permission to manage notification settings.' using errcode = '42501';
  end if;
  return (select jsonb_object_agg(c.channel, jsonb_build_object(
            'all', c.all_types,
            'types', to_jsonb(community.channel_types(c.channel)),
            'disabled', to_jsonb(c.disabled_types),
            'updated_at', c.updated_at))
            from community.channel_policy c)
         || jsonb_build_object('membership_alerts_enabled', coalesce((select enabled from membership.alert_settings), false));
end;
$$;

-- p_disabled null keeps the stored individual selections (the page sends
-- null while All is on, because its individual switches are disabled).
create function public.notification_channel_set(p_channel text, p_all boolean, p_disabled text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old community.channel_policy;
  v_new community.channel_policy;
  v_bad text;
begin
  if v_uid is null or not public.has_capability('settings.manage') then
    raise exception 'You do not have permission to manage notification settings.' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('push', 'email') then
    raise exception 'Unknown notification channel.' using errcode = '22023';
  end if;
  if p_all is null then
    raise exception 'Choose whether all notification types are on.' using errcode = '22023';
  end if;
  if p_disabled is not null then
    select t into v_bad from unnest(p_disabled) t
     where t is null or not (t = any (community.channel_types(p_channel))) or t = 'membership_approval' limit 1;
    if found then
      raise exception 'Unknown notification type for this channel.' using errcode = '22023';
    end if;
  end if;

  select * into v_old from community.channel_policy where channel = p_channel for update;
  update community.channel_policy
     set all_types = p_all,
         disabled_types = case when p_disabled is null then disabled_types
                               else coalesce((select array_agg(distinct t order by t) from unnest(p_disabled) t), '{}') end,
         updated_at = now(), updated_by = v_uid
   where channel = p_channel
  returning * into v_new;

  if v_new.all_types is distinct from v_old.all_types or v_new.disabled_types is distinct from v_old.disabled_types then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (v_uid, 'notifications.channel_changed', 'settings', 'notifications_' || p_channel,
            jsonb_build_object('channel', p_channel, 'all', v_new.all_types, 'disabled', to_jsonb(v_new.disabled_types),
                               'previous_all', v_old.all_types, 'previous_disabled', to_jsonb(v_old.disabled_types)));
  end if;
  return jsonb_build_object('all', v_new.all_types, 'disabled', to_jsonb(v_new.disabled_types));
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery: the same functions with the church setting applied.
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
  -- A reply that mentions someone (by name or through their group) already
  -- told them through the mention notice; don't also count it as a reply.
  if p_kind in ('reply_mine', 'reply_followed') and exists (
       select 1 from community.mention_deliveries d
        where d.target_id = nullif(p_refs ->> 'post_id', '')::uuid and d.profile_id = p_profile
          and d.notification_id is not null) then
    return null;
  end if;
  -- Likewise a prayer comment that mentions them (delivered in this same
  -- transaction, so now() matches).
  if p_kind = 'prayer_comment' and exists (
       select 1 from community.mention_deliveries d
        where d.source = 'prayer' and d.context_id = nullif(p_refs ->> 'prayer_request_id', '')::uuid
          and d.profile_id = p_profile and d.created_at = now() and d.notification_id is not null) then
    return null;
  end if;
  select * into v_pref from community.delivery_pref(p_profile, v_category);
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
                           and (select x.email from community.delivery_pref(n.profile_id, n.category) x) = 'immediate'
                      else n.updated_at >= e.period_start and n.updated_at < e.period_end
                           and n.category not in ('messages', 'events', 'care')
                           and (select x.email from community.delivery_pref(n.profile_id, n.category) x)
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
       or not (select x.push from community.delivery_pref(n.profile_id, n.category) x)
       or jsonb_array_length(v_subs) = 0 then
      update community.push_outbox set status = 'skipped', attempts = attempts + 1, updated_at = now() where id = r.id;
      continue;
    end if;
    update community.push_outbox set status = 'sending', attempts = attempts + 1, updated_at = now() where id = r.id;
    -- Generic text only: never titles, names, or message content.
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'dedupe_key', r.dedupe_key, 'subscriptions', v_subs,
      'body', case when n.kind = 'prayer_mention' then 'You were mentioned in a prayer request.'
                   when n.kind = 'prayer_group_mention' then 'Your group was mentioned in a prayer request.'
                   when n.kind = 'group_mention' then 'Your group was mentioned in Community.'
                   else case n.category
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
                else 'You have a new notification.' end end,
      'url', '/notifications/open/' || n.id));
  end loop;
  return v_out;
end;
$$;

create or replace function membership.enqueue_approval_alert(p_profile uuid, p_source text, p_test boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.profiles;
  v_alert uuid;
  v_count integer := 0;
begin
  select * into pr from public.profiles where id = p_profile;
  if pr.id is null or pr.membership_status <> 'pending' or pr.account_kind <> 'adult' then
    return null;
  end if;
  if exists (select 1 from youth.account_invitations x
              where lower(x.email) = lower(pr.email) and x.status = 'pending' and x.expires_at > now()) then
    return null;
  end if;

  insert into membership.approval_alerts (profile_id, source, test, applicant_name, applicant_email)
  values (p_profile, p_source, p_test,
          left(coalesce(nullif(btrim(pr.preferred_name), ''), nullif(btrim(pr.full_name), ''), ''), 120),
          pr.email)
  on conflict (profile_id) do nothing
  returning id into v_alert;
  if v_alert is null then
    return null;
  end if;

  if membership.alerts_on() then
    insert into membership.alert_deliveries (alert_id, recipient_email)
    select v_alert, r.email from membership.alert_recipients r;
    get diagnostics v_count = row_count;
    update membership.approval_alerts set recipients = v_count where id = v_alert;
  end if;
  return v_alert;
end;
$$;

create or replace function membership.op_alert_claim(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((v ->> 'limit')::integer, 10), 1), 50);
  v_test boolean := coalesce((v ->> 'test')::boolean, false);
  v_enabled boolean := membership.alerts_on();
  r record;
  v_reason text;
  v_out jsonb := '[]'::jsonb;
begin
  -- A send that never reported back (crash or timeout) counts as a failed
  -- attempt; the idempotency key makes its retry safe.
  update membership.alert_deliveries d
     set status = 'failed', last_error = 'No result reported (timed out)', next_attempt_at = now(), updated_at = now()
    from membership.approval_alerts a
   where a.id = d.alert_id and a.test = v_test
     and d.status = 'sending' and d.updated_at < now() - interval '10 minutes';

  for r in
    select d.id, d.recipient_email, a.profile_id, a.applicant_name, a.applicant_email, a.eligible_at
      from membership.alert_deliveries d
      join membership.approval_alerts a on a.id = d.alert_id
     where a.test = v_test
       and d.next_attempt_at <= now()
       and (d.status = 'pending' or (d.status = 'failed' and d.attempts < 5))
       -- Test alerts are only sent by previews right after verification; old ones are dropped.
       and (not v_test or d.created_at > now() - interval '1 day')
     order by d.created_at
     limit v_limit
     for update of d skip locked
  loop
    v_reason := case
      when not exists (select 1 from public.profiles p where p.id = r.profile_id and p.membership_status = 'pending')
        then 'No longer awaiting approval'
      when not coalesce(v_enabled, false) then 'Alerts were turned off'
      when not exists (select 1 from membership.alert_recipients x where x.email = r.recipient_email)
        then 'Recipient was removed'
    end;
    if v_reason is not null then
      update membership.alert_deliveries set status = 'skipped', last_error = v_reason, updated_at = now() where id = r.id;
      continue;
    end if;
    update membership.alert_deliveries set status = 'sending', attempts = attempts + 1, updated_at = now() where id = r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'to', r.recipient_email, 'profile_id', r.profile_id,
      'name', r.applicant_name, 'email', r.applicant_email, 'eligible_at', r.eligible_at));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  community.channel_types(text), community.channel_allows(text, text), community.delivery_pref(uuid, text), membership.alerts_on()
from public, anon, authenticated, service_role;
revoke execute on function
  public.notification_channels_admin(), public.notification_channel_set(text, boolean, text[])
from public, anon, service_role;
grant execute on function
  public.notification_channels_admin(), public.notification_channel_set(text, boolean, text[])
to authenticated;
