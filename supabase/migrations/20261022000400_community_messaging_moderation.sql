-- Phase 5 · Community: direct messages, blocking, reports, moderation, and
-- community administration.
--
-- Direct messages
--   * One-to-one, text only, between DM-eligible accounts (approved adult +
--     an explicit, audited eligibility decision by a membership
--     administrator; unknown = no). Minors cannot exist yet (Phase 2
--     constraint), and the eligibility record is the trusted classification.
--   * Every send (starting a conversation or replying in one) rechecks both
--     people's eligibility and membership, the recipient's message setting,
--     blocks in either direction, the sender's messaging restriction, and
--     rate limits. Every refusal uses one generic message, so a block or a
--     setting is never revealed.
--   * Only the two participants can read a conversation. There is no
--     administrator browsing function; moderators see only messages a
--     participant selected in a report.
--   * Retention: a member may delete a conversation for themselves (history
--     before that point is hidden from them); once both have deleted it, the
--     messages are purged. All messages are purged after dm_retention_days
--     (default 2 years). Message text is never copied into audit logs,
--     notifications, email, or push.
-- Blocking stops direct messages both ways and hides the blocked person's
-- message notifications. It does not hide their posts in shared discussions.

-- ---------------------------------------------------------------------------
-- Eligibility (membership administrators)
-- ---------------------------------------------------------------------------
create function public.community_admin_set_dm_eligibility(p_profile uuid, p_eligible boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_capability('members.manage');
begin
  if p_profile = v_uid then
    raise exception 'You can''t change your own messaging eligibility.' using errcode = '42501';
  end if;
  if p_eligible and not community.is_member(p_profile) then
    raise exception 'Only approved adult members can be made eligible.' using errcode = '22023';
  end if;
  insert into community.dm_eligibility (profile_id, eligible, basis, note, decided_by, decided_at)
  values (p_profile, coalesce(p_eligible, false), case when p_eligible then 'adult_confirmed' else 'revoked' end,
          left(nullif(btrim(p_note), ''), 300), v_uid, now())
  on conflict (profile_id) do update
    set eligible = excluded.eligible, basis = excluded.basis, note = excluded.note,
        decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  perform community.audit(case when p_eligible then 'messaging.eligibility_granted' else 'messaging.eligibility_revoked' end,
                          'profile', p_profile::text, '{}'::jsonb);
  perform community.ping(p_profile, 'messages');
end;
$$;

create function public.community_admin_dm_eligibility(p_profile uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform community.require_capability('members.manage');
  return (select jsonb_build_object('eligible', coalesce(e.eligible, false), 'basis', e.basis, 'note', e.note,
                                    'decided_at', e.decided_at,
                                    'decided_by', case when e.decided_by is null then null else community.display_name(e.decided_by) end)
            from (select 1) one left join community.dm_eligibility e on e.profile_id = p_profile);
end;
$$;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create function community.other_member(c community.conversations, p_me uuid)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when c.member_a = p_me then c.member_b else c.member_a end;
$$;

-- Recipient search for a new conversation. Returns only people the caller
-- may message right now AND who are listed in the directory, so opted-out
-- members are never exposed and searching can't enumerate accounts.
create function public.community_dm_recipients(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
begin
  if not community.dm_eligible(v_uid) then
    return '[]'::jsonb;
  end if;
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  perform community.rate_limit(v_uid, 'dm_search', 60, interval '10 minutes');
  v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by lower(x.name))
      from (select p.id, public.directory_display_name(p) as name from public.profiles p
             where p.id <> v_uid
               and public.directory_is_listed(p.id)
               and (p.full_name ilike v_like or p.preferred_name ilike v_like)
               and community.can_message(v_uid, p.id)
             order by lower(p.full_name) limit 10) x), '[]'::jsonb);
end;
$$;

-- Opens (or finds) the conversation with someone the caller may message.
-- Used from the recipient search and from a shared group's roster.
create function public.community_dm_start(p_recipient uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_a uuid := least(v_uid, p_recipient);
  v_b uuid := greatest(v_uid, p_recipient);
  v_id uuid;
begin
  if not community.can_message(v_uid, p_recipient) then
    raise exception 'This member isn''t available for direct messages.' using errcode = '22023';
  end if;
  select id into v_id from community.conversations where member_a = v_a and member_b = v_b;
  if v_id is null then
    perform community.rate_limit(v_uid, 'dm_start', 10, interval '1 hour');
    insert into community.conversations (member_a, member_b, created_by) values (v_a, v_b, v_uid)
    on conflict (member_a, member_b) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from community.conversations where member_a = v_a and member_b = v_b;
    end if;
  end if;
  insert into community.conversation_state (conversation_id, profile_id) values (v_id, v_a), (v_id, v_b)
  on conflict do nothing;
  return v_id;
end;
$$;

create function public.community_dm_send(p_conversation uuid, p_body text, p_client_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  c community.conversations;
  v_other uuid;
  v_id uuid;
  v_at timestamptz;
  v_body text;
begin
  if p_client_key is null then
    raise exception 'Missing message key.' using errcode = '22023';
  end if;
  select * into c from community.conversations where id = p_conversation for update;
  if not found or v_uid not in (c.member_a, c.member_b) then
    raise exception 'That conversation wasn''t found.' using errcode = 'P0002';
  end if;
  -- A retried send returns the original message instead of a duplicate.
  select id, created_at into v_id, v_at from community.messages
   where conversation_id = c.id and sender_id = v_uid and client_key = p_client_key;
  if found then
    return jsonb_build_object('id', v_id, 'created_at', v_at, 'duplicate', true);
  end if;
  v_other := community.other_member(c, v_uid);
  if not community.can_message(v_uid, v_other) then
    raise exception 'This member isn''t available for direct messages.' using errcode = '22023';
  end if;
  v_body := community.clean_text(p_body, 1, 4000, 'Your message');
  perform community.rate_limit(v_uid, 'dm_send', 60, interval '10 minutes');
  insert into community.messages (conversation_id, sender_id, body, client_key) values (c.id, v_uid, v_body, p_client_key)
  returning id, created_at into v_id, v_at;
  update community.conversations set last_message_at = v_at where id = c.id;
  insert into community.conversation_state (conversation_id, profile_id, last_read_at) values (c.id, v_uid, v_at)
  on conflict (conversation_id, profile_id) do update set last_read_at = excluded.last_read_at;
  insert into community.conversation_state (conversation_id, profile_id) values (c.id, v_other) on conflict do nothing;
  -- Generic notification only (no text); suppressed if muted or blocked.
  perform community.notify(v_other, 'message', v_uid, jsonb_build_object('conversation_id', c.id), 'conversation:' || c.id);
  perform community.ping(v_other, 'message');
  perform community.ping(v_uid, 'message');
  return jsonb_build_object('id', v_id, 'created_at', v_at, 'duplicate', false);
end;
$$;

create function public.community_dm_conversations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  return jsonb_build_object(
    'eligible', community.dm_eligible(v_uid),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'other_id', community.other_member(c, v_uid),
               'other_name', community.display_name(community.other_member(c, v_uid)),
               'last_message_at', x.last_at,
               'last_from_me', x.last_sender = v_uid,
               'unread', (select count(*) from community.messages m
                           where m.conversation_id = c.id and m.sender_id is distinct from v_uid
                             and m.created_at > greatest(s.last_read_at, s.cleared_at)
                             and not exists (select 1 from community.blocks b where b.blocker_id = v_uid and b.blocked_id = m.sender_id)),
               'blocked', exists (select 1 from community.blocks b where b.blocker_id = v_uid and b.blocked_id = community.other_member(c, v_uid)),
               'muted', exists (select 1 from community.mutes mu where mu.profile_id = v_uid and mu.target_type = 'conversation' and mu.target_id = c.id))
             order by x.last_at desc nulls last)
        from community.conversations c
        join community.conversation_state s on s.conversation_id = c.id and s.profile_id = v_uid
        cross join lateral (select max(m.created_at) as last_at,
                                   (array_agg(m.sender_id order by m.created_at desc))[1] as last_sender
                              from community.messages m
                             where m.conversation_id = c.id and m.created_at > s.cleared_at) x
       where v_uid in (c.member_a, c.member_b) and x.last_at is not null), '[]'::jsonb));
end;
$$;

-- A page of messages, newest first (p_before_* pages back in time). Message
-- bodies are returned only here, only to the two participants.
create function public.community_dm_messages(p_conversation uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  c community.conversations;
  s community.conversation_state;
  v_other uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_items jsonb;
begin
  select * into c from community.conversations where id = p_conversation;
  if not found or v_uid not in (c.member_a, c.member_b) then
    return null;
  end if;
  select * into s from community.conversation_state where conversation_id = c.id and profile_id = v_uid;
  v_other := community.other_member(c, v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'mine', m.sender_id = v_uid, 'created_at', m.created_at)
                            order by m.created_at, m.id), '[]'::jsonb)
    into v_items
    from (select * from community.messages m
           where m.conversation_id = c.id
             and m.created_at > coalesce(s.cleared_at, '-infinity')
             and (p_before_at is null or (m.created_at, m.id) < (p_before_at, p_before_id))
           order by m.created_at desc, m.id desc
           limit v_limit) m;
  return jsonb_build_object(
    'id', c.id,
    'other_id', v_other,
    'other_name', community.display_name(v_other),
    'messages', v_items,
    'has_more', jsonb_array_length(v_items) = v_limit,
    'can_send', community.can_message(v_uid, v_other),
    'blocked', exists (select 1 from community.blocks b where b.blocker_id = v_uid and b.blocked_id = v_other),
    'muted', exists (select 1 from community.mutes mu where mu.profile_id = v_uid and mu.target_type = 'conversation' and mu.target_id = c.id),
    'last_read_at', s.last_read_at);
end;
$$;

-- Marks the conversation read up to now (and its message notification).
create function public.community_dm_mark_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if not exists (select 1 from community.conversations c where c.id = p_conversation and v_uid in (c.member_a, c.member_b)) then
    raise exception 'That conversation wasn''t found.' using errcode = 'P0002';
  end if;
  insert into community.conversation_state (conversation_id, profile_id, last_read_at) values (p_conversation, v_uid, now())
  on conflict (conversation_id, profile_id) do update set last_read_at = now();
  update community.notifications set read_at = now()
   where profile_id = v_uid and conversation_id = p_conversation and read_at is null;
  perform community.ping(v_uid, 'read');
end;
$$;

-- "Delete conversation" for the caller only.
create function public.community_dm_clear(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  update community.conversation_state set cleared_at = now(), last_read_at = now()
   where conversation_id = p_conversation and profile_id = v_uid;
  if not found then
    raise exception 'That conversation wasn''t found.' using errcode = 'P0002';
  end if;
  update community.notifications set read_at = now()
   where profile_id = v_uid and conversation_id = p_conversation and read_at is null;
end;
$$;

create function public.community_block(p_profile uuid, p_block boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if p_profile is null or p_profile = v_uid or not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'That member wasn''t found.' using errcode = 'P0002';
  end if;
  if p_block then
    perform community.rate_limit(v_uid, 'block', 30, interval '1 hour');
    insert into community.blocks (blocker_id, blocked_id) values (v_uid, p_profile) on conflict do nothing;
    -- Their unread message notifications to the blocker disappear.
    update community.notifications set read_at = now()
     where profile_id = v_uid and actor_id = p_profile and kind = 'message' and read_at is null;
  else
    delete from community.blocks where blocker_id = v_uid and blocked_id = p_profile;
  end if;
  perform community.ping(v_uid, 'messages');
end;
$$;

create function public.community_blocked()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.blocked_id, 'name', community.display_name(b.blocked_id),
                                                       'since', b.created_at) order by b.created_at desc)
                     from community.blocks b where b.blocker_id = v_uid), '[]'::jsonb);
end;
$$;

create function public.community_set_dm_allow(p_allow text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if p_allow not in ('members', 'shared_groups', 'none') then
    raise exception 'Choose who can message you.' using errcode = '22023';
  end if;
  insert into community.dm_prefs (profile_id, allow) values (v_uid, p_allow::community.dm_allow)
  on conflict (profile_id) do update set allow = excluded.allow, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
-- p_type thread|post: p_ids = [that id]. p_type message: p_ids = the specific
-- messages selected (1–20) from one conversation the reporter is in. Only
-- those items are copied into the evidence snapshot.
create function public.community_report(p_type text, p_ids uuid[], p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_thread uuid;
  v_group uuid;
  v_conv uuid;
  v_author uuid;
  v_evidence jsonb;
  v_leader boolean := false;
  v_id uuid;
  v_leader_id uuid;
begin
  if p_reason not in ('harassment', 'spam', 'inappropriate', 'safety', 'privacy', 'other') then
    raise exception 'Choose a reason.' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 20 then
    raise exception 'Choose what to report.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'report', 10, interval '1 hour');

  if p_type = 'thread' then
    select t.id, t.group_id, t.author_id,
           jsonb_build_array(jsonb_build_object('type', 'thread', 'id', t.id, 'title', t.title, 'body', t.body,
                                                'author', community.display_name(t.author_id), 'author_id', t.author_id,
                                                'created_at', t.created_at, 'edited_at', t.edited_at))
      into v_thread, v_group, v_author, v_evidence
      from community.threads t where t.id = p_ids[1] and t.status = 'visible';
  elsif p_type = 'post' then
    select t.id, t.group_id, p.author_id,
           jsonb_build_array(jsonb_build_object('type', 'post', 'id', p.id, 'body', p.body, 'thread_title', t.title,
                                                'author', community.display_name(p.author_id), 'author_id', p.author_id,
                                                'created_at', p.created_at, 'edited_at', p.edited_at))
      into v_thread, v_group, v_author, v_evidence
      from community.posts p join community.threads t on t.id = p.thread_id
     where p.id = p_ids[1] and p.status = 'visible';
  elsif p_type = 'message' then
    select min(m.conversation_id::text)::uuid into v_conv from community.messages m where m.id = any (p_ids);
    if v_conv is null
       or (select count(distinct m.conversation_id) from community.messages m where m.id = any (p_ids)) <> 1
       or (select count(*) from community.messages m where m.id = any (p_ids)) <> cardinality(p_ids)
       or not exists (select 1 from community.conversations c where c.id = v_conv and v_uid in (c.member_a, c.member_b)) then
      raise exception 'Those messages weren''t found.' using errcode = 'P0002';
    end if;
    select community.other_member(c, v_uid) into v_author from community.conversations c where c.id = v_conv;
    select jsonb_agg(jsonb_build_object('type', 'message', 'id', m.id, 'body', m.body,
                                        'from', case when m.sender_id = v_uid then 'reporter' else 'reported' end,
                                        'created_at', m.created_at) order by m.created_at)
      into v_evidence from community.messages m where m.id = any (p_ids)
       and m.created_at > (select cleared_at from community.conversation_state where conversation_id = v_conv and profile_id = v_uid);
    if v_evidence is null then
      raise exception 'Those messages weren''t found.' using errcode = 'P0002';
    end if;
  else
    raise exception 'That can''t be reported.' using errcode = '22023';
  end if;

  if p_type in ('thread', 'post') and (v_thread is null or not community.can_read_thread(v_thread, v_uid)) then
    raise exception 'That wasn''t found.' using errcode = 'P0002';
  end if;
  if v_author = v_uid then
    raise exception 'You can delete or edit your own posts instead of reporting them.' using errcode = '22023';
  end if;
  if v_group is not null then
    v_leader := exists (select 1 from community.group_members m
                         where m.group_id = v_group and m.profile_id = v_author and m.role = 'leader' and m.state = 'active');
  end if;
  -- One open report per reporter per item.
  select id into v_id from community.reports
   where reporter_id = v_uid and target_type = p_type and target_ids = p_ids and status in ('open', 'reviewing');
  if v_id is not null then
    return v_id;
  end if;
  insert into community.reports (reporter_id, target_type, target_ids, thread_id, group_id, conversation_id,
                                 reported_profile_id, involves_group_leader, reason, details, evidence)
  values (v_uid, p_type, p_ids, v_thread, v_group, v_conv, v_author, v_leader, p_reason,
          nullif(community.clean_text(coalesce(p_details, ''), 0, 1000, 'The details'), ''), v_evidence)
  returning id into v_id;
  -- Group leaders hear about reports in their group (not about themselves
  -- or a fellow leader); moderators work from the queue.
  if v_group is not null and not v_leader then
    for v_leader_id in select profile_id from community.group_members
                        where group_id = v_group and role = 'leader' and state = 'active' and profile_id <> v_uid loop
      perform community.notify(v_leader_id, 'moderation', null,
        jsonb_build_object('group_id', v_group, 'detail', jsonb_build_object('action', 'report_received')), 'reports:' || v_group);
    end loop;
  end if;
  return v_id;
end;
$$;

-- Who may review a report: community moderators always; a group's leaders
-- for reports about their group's discussions, except reports about a
-- group leader (those go to moderators outside the group).
create function community.can_review(r community.reports)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.has_capability('community.moderate'))
      or (r.target_type in ('thread', 'post') and r.group_id is not null and not r.involves_group_leader
          and r.reporter_id is distinct from (select auth.uid())
          and community.group_leader(r.group_id, (select auth.uid())));
$$;

-- Queue: no evidence in the list, only what is needed to triage.
create function public.community_mod_reports(p_status text default 'open', p_group uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if not (select public.has_capability('community.moderate')) and (p_group is null or not community.group_leader(p_group, v_uid)) then
    raise exception 'You do not have permission to review reports.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'target_type', r.target_type, 'reason', r.reason, 'status', r.status,
             'items', cardinality(r.target_ids), 'created_at', r.created_at,
             'place', case when r.conversation_id is not null then 'Direct message'
                           when r.group_id is not null then (select 'Group: ' || g.name from community.groups g where g.id = r.group_id)
                           else 'Church-wide discussion' end,
             'involves_group_leader', r.involves_group_leader,
             'reported', community.display_name(r.reported_profile_id))
           order by r.created_at)
      from community.reports r
     where (p_group is null or r.group_id = p_group)
       and case when p_status = 'closed' then r.status in ('actioned', 'dismissed') else r.status in ('open', 'reviewing') end
       and community.can_review(r)), '[]'::jsonb);
end;
$$;

-- One report with its evidence. Every view is logged in moderation_log.
create function public.community_mod_report(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  r community.reports;
begin
  select * into r from community.reports where id = p_id;
  if not found or not community.can_review(r) then
    raise exception 'That report wasn''t found.' using errcode = 'P0002';
  end if;
  perform community.mod_log('report.viewed', r.id, r.target_type, r.target_ids[1]);
  if r.status = 'open' then
    update community.reports set status = 'reviewing', updated_at = now() where id = r.id;
  end if;
  return jsonb_build_object(
    'id', r.id, 'target_type', r.target_type, 'target_ids', to_jsonb(r.target_ids), 'reason', r.reason, 'details', r.details,
    'status', case when r.status = 'open' then 'reviewing' else r.status end,
    'resolution', r.resolution, 'resolved_at', r.resolved_at,
    'resolved_by', case when r.resolved_by is null then null else community.display_name(r.resolved_by) end,
    'created_at', r.created_at,
    'reporter', community.display_name(r.reporter_id),
    'reported', community.display_name(r.reported_profile_id),
    'reported_id', r.reported_profile_id,
    'thread_id', r.thread_id, 'group_id', r.group_id,
    'group_name', (select name from community.groups where id = r.group_id),
    'is_message', r.conversation_id is not null,
    'involves_group_leader', r.involves_group_leader,
    'evidence', r.evidence,
    'evidence_cleared_at', r.evidence_cleared_at,
    -- Current state of each reported item (not its text).
    'current', case when r.target_type = 'thread' then (select jsonb_build_object('status', t.status, 'locked', t.locked, 'pinned', t.pinned)
                                                         from community.threads t where t.id = r.target_ids[1])
                    when r.target_type = 'post' then (select jsonb_build_object('status', p.status) from community.posts p where p.id = r.target_ids[1]) end,
    'can_restrict', (select public.has_capability('community.moderate')),
    'active_restriction', (select jsonb_build_object('id', x.id, 'scope', x.scope, 'ends_at', x.ends_at)
                             from community.restrictions x
                            where x.profile_id = r.reported_profile_id and x.lifted_at is null
                              and (x.ends_at is null or x.ends_at > now())
                            order by x.created_at desc limit 1),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'actor', community.display_name(l.actor_id),
                                                         'reason', l.reason, 'at', l.created_at) order by l.created_at)
                       from community.moderation_log l where l.report_id = r.id), '[]'::jsonb));
end;
$$;

create function public.community_mod_resolve(p_id uuid, p_status text, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r community.reports;
begin
  perform community.require_member();
  select * into r from community.reports where id = p_id for update;
  if not found or not community.can_review(r) then
    raise exception 'That report wasn''t found.' using errcode = 'P0002';
  end if;
  if p_status not in ('actioned', 'dismissed', 'open') then
    raise exception 'Choose an outcome.' using errcode = '22023';
  end if;
  if p_status <> 'open' and char_length(btrim(coalesce(p_resolution, ''))) < 3 then
    raise exception 'Record what was decided.' using errcode = '22023';
  end if;
  update community.reports
     set status = p_status,
         resolution = case when p_status = 'open' then resolution else left(btrim(p_resolution), 1000) end,
         resolved_by = case when p_status = 'open' then null else (select auth.uid()) end,
         resolved_at = case when p_status = 'open' then null else now() end,
         updated_at = now()
   where id = r.id;
  perform community.mod_log(case p_status when 'open' then 'report.reopened' else 'report.' || p_status end,
                            r.id, r.target_type, r.target_ids[1], p_resolution);
  perform community.audit('community.report_' || case p_status when 'open' then 'reopened' else p_status end,
                          'community_report', r.id::text, '{}'::jsonb);
end;
$$;

-- Content actions on a thread: pin, unpin, lock, unlock, hide, restore.
-- Community moderators everywhere; group leaders in their own group, except
-- hiding a fellow leader's thread (that needs a moderator).
create function public.community_mod_thread(p_thread uuid, p_action text, p_reason text default null, p_report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  t community.threads;
  v_is_mod boolean := (select public.has_capability('community.moderate'));
begin
  select * into t from community.threads where id = p_thread for update;
  if not found or not community.can_moderate_thread(t.id) then
    raise exception 'You do not have permission to moderate this discussion.' using errcode = '42501';
  end if;
  if p_action in ('hide', 'restore') then
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Give a reason.' using errcode = '22023';
    end if;
    if not v_is_mod and t.group_id is not null and t.author_id is not null and community.group_leader(t.group_id, t.author_id) then
      raise exception 'A community moderator must review content posted by a group leader.' using errcode = '42501';
    end if;
  end if;
  case p_action
    when 'pin' then update community.threads set pinned = true where id = t.id and status = 'visible';
    when 'unpin' then update community.threads set pinned = false where id = t.id;
    when 'lock' then update community.threads set locked = true where id = t.id;
    when 'unlock' then update community.threads set locked = false where id = t.id;
    when 'hide' then
      if t.status <> 'visible' then
        raise exception 'Only visible discussions can be hidden.' using errcode = '22023';
      end if;
      update community.threads set status = 'hidden', hidden_at = now(), hidden_by = v_uid, pinned = false where id = t.id;
      perform community.notify(t.author_id, 'moderation', null,
        jsonb_build_object('detail', jsonb_build_object('action', 'hidden', 'reason', left(p_reason, 300))));
    when 'restore' then
      if t.status <> 'hidden' then
        raise exception 'Only hidden discussions can be restored.' using errcode = '22023';
      end if;
      update community.threads set status = 'visible', hidden_at = null, hidden_by = null where id = t.id;
      perform community.notify(t.author_id, 'moderation', null,
        jsonb_build_object('thread_id', t.id, 'detail', jsonb_build_object('action', 'restored')));
    else
      raise exception 'Unknown action.' using errcode = '22023';
  end case;
  if p_action = 'lock' and t.author_id is not null then
    perform community.notify(t.author_id, 'moderation', null,
      jsonb_build_object('thread_id', t.id, 'detail', jsonb_build_object('action', 'locked', 'reason', left(p_reason, 300))));
  end if;
  perform community.mod_log('thread.' || p_action, p_report, 'thread', t.id, p_reason);
  perform community.audit('community.thread_' || p_action, 'community_thread', t.id::text,
                          jsonb_build_object('report', p_report));
end;
$$;

create function public.community_mod_post(p_post uuid, p_action text, p_reason text, p_report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  p community.posts;
  t community.threads;
begin
  select * into p from community.posts where id = p_post for update;
  if not found or not community.can_moderate_thread(p.thread_id) then
    raise exception 'You do not have permission to moderate this reply.' using errcode = '42501';
  end if;
  select * into t from community.threads where id = p.thread_id;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason.' using errcode = '22023';
  end if;
  if not (select public.has_capability('community.moderate')) and p.author_id is not null
     and community.group_leader(t.group_id, p.author_id) then
    raise exception 'A community moderator must review content posted by a group leader.' using errcode = '42501';
  end if;
  if p_action = 'hide' and p.status = 'visible' then
    update community.posts set status = 'hidden', hidden_at = now(), hidden_by = v_uid where id = p.id;
    perform community.notify(p.author_id, 'moderation', null,
      jsonb_build_object('thread_id', t.id, 'detail', jsonb_build_object('action', 'hidden', 'reason', left(p_reason, 300))));
  elsif p_action = 'restore' and p.status = 'hidden' then
    update community.posts set status = 'visible', hidden_at = null, hidden_by = null where id = p.id;
    perform community.notify(p.author_id, 'moderation', null,
      jsonb_build_object('thread_id', t.id, 'detail', jsonb_build_object('action', 'restored')));
  else
    raise exception 'That action doesn''t apply to this reply.' using errcode = '22023';
  end if;
  perform community.mod_log('post.' || p_action, p_report, 'post', p.id, p_reason);
  perform community.audit('community.post_' || p_action, 'community_post', p.id::text, jsonb_build_object('report', p_report));
end;
$$;

-- Community restriction (moderators only). Separate from church membership:
-- the member keeps their status, directory listing, giving, and events.
create function public.community_mod_restrict(p_profile uuid, p_scope text, p_days integer, p_reason text, p_report uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_capability('community.moderate');
  v_id uuid;
begin
  if p_profile = v_uid then
    raise exception 'You can''t restrict yourself.' using errcode = '42501';
  end if;
  if p_scope not in ('posting', 'messaging', 'all') then
    raise exception 'Choose what to restrict.' using errcode = '22023';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then
    raise exception 'Choose 1 to 365 days, or no end date.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'That member wasn''t found.' using errcode = 'P0002';
  end if;
  insert into community.restrictions (profile_id, scope, reason, ends_at, created_by)
  values (p_profile, p_scope, left(btrim(p_reason), 500),
          case when p_days is null then null else now() + make_interval(days => p_days) end, v_uid)
  returning id into v_id;
  perform community.notify(p_profile, 'moderation', null,
    jsonb_build_object('detail', jsonb_build_object('action', 'restricted', 'reason', left(p_reason, 300))));
  perform community.mod_log('member.restricted', p_report, 'profile', p_profile, p_reason);
  perform community.audit('community.restricted', 'profile', p_profile::text,
                          jsonb_build_object('scope', p_scope, 'days', p_days, 'report', p_report));
  return v_id;
end;
$$;

create function public.community_mod_lift_restriction(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_capability('community.moderate');
  r community.restrictions;
begin
  update community.restrictions set lifted_at = now(), lifted_by = v_uid
   where id = p_id and lifted_at is null
  returning * into r;
  if r.id is null then
    raise exception 'That restriction isn''t active.' using errcode = '22023';
  end if;
  perform community.notify(r.profile_id, 'moderation', null,
    jsonb_build_object('detail', jsonb_build_object('action', 'restriction_lifted')));
  perform community.mod_log('member.restriction_lifted', null, 'profile', r.profile_id, p_reason);
  perform community.audit('community.restriction_lifted', 'profile', r.profile_id::text, '{}'::jsonb);
end;
$$;

create function public.community_mod_restrictions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform community.require_capability('community.moderate');
  return coalesce((select jsonb_agg(jsonb_build_object(
                     'id', r.id, 'profile_id', r.profile_id, 'name', community.display_name(r.profile_id), 'scope', r.scope,
                     'reason', r.reason, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
                     'by', community.display_name(r.created_by)) order by r.created_at desc)
                     from community.restrictions r
                    where r.lifted_at is null and (r.ends_at is null or r.ends_at > now())), '[]'::jsonb);
end;
$$;

-- Moderation log (no content).
create function public.community_mod_log(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform community.require_capability('community.moderate');
  return coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'actor', community.display_name(l.actor_id),
                                                       'report_id', l.report_id, 'target_type', l.target_type,
                                                       'reason', l.reason, 'at', l.created_at) order by l.created_at desc)
                     from (select * from community.moderation_log order by created_at desc
                            limit least(greatest(coalesce(p_limit, 100), 1), 500)) l), '[]'::jsonb);
end;
$$;

-- Moderator target search for restrictions: approved members by name.
create function public.community_mod_member_search(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
begin
  perform community.require_capability('community.moderate');
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by lower(x.name))
                     from (select p.id, public.directory_display_name(p) as name from public.profiles p
                            where p.membership_status = 'approved'
                              and (p.full_name ilike v_like or p.preferred_name ilike v_like)
                            order by lower(p.full_name) limit 15) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Community administration (community.manage)
-- ---------------------------------------------------------------------------
create function public.community_admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform community.require_capability('community.manage');
  return (select jsonb_build_object('guidelines', s.guidelines, 'guidelines_version', s.guidelines_version,
                                    'digest_hour', s.digest_hour, 'weekly_digest_dow', s.weekly_digest_dow,
                                    'dm_retention_days', s.dm_retention_days, 'report_evidence_days', s.report_evidence_days,
                                    'acknowledged', (select count(*) from community.guideline_acks a where a.version = s.guidelines_version),
                                    'categories', coalesce((select jsonb_agg(jsonb_build_object(
                                                     'id', c.id, 'name', c.name, 'description', c.description, 'active', c.active,
                                                     'sort_order', c.sort_order,
                                                     'threads', (select count(*) from community.threads t where t.category_id = c.id))
                                                   order by c.sort_order, c.name) from community.categories c), '[]'::jsonb))
            from community.settings s);
end;
$$;

-- p_require_reack: bump the version so everyone accepts the new text before
-- posting again (for substantive changes; typo fixes can skip it).
create function public.community_admin_save_guidelines(p_text text, p_require_reack boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_capability('community.manage');
begin
  update community.settings
     set guidelines = community.clean_text(p_text, 20, 10000, 'The guidelines'),
         guidelines_version = guidelines_version + case when p_require_reack then 1 else 0 end,
         updated_at = now(), updated_by = v_uid
   where id;
  perform community.audit('community.guidelines_updated', 'community_settings', 'guidelines',
                          jsonb_build_object('new_version', p_require_reack));
end;
$$;

create function public.community_admin_save_settings(p_digest_hour integer, p_weekly_dow integer, p_dm_retention_days integer, p_report_evidence_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_capability('community.manage');
begin
  update community.settings
     set digest_hour = p_digest_hour, weekly_digest_dow = p_weekly_dow,
         dm_retention_days = p_dm_retention_days, report_evidence_days = p_report_evidence_days,
         updated_at = now(), updated_by = v_uid
   where id;
  perform community.audit('community.settings_updated', 'community_settings', 'settings', '{}'::jsonb);
end;
$$;

create function public.community_admin_category_save(p_id uuid, p_name text, p_description text, p_active boolean, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  perform community.require_capability('community.manage');
  if v_id is null then
    insert into community.categories (name, description, active, sort_order)
    values (community.clean_text(p_name, 1, 60, 'The name'), community.clean_text(coalesce(p_description, ''), 0, 300, 'The description'),
            coalesce(p_active, true), coalesce(p_sort, (select coalesce(max(sort_order), 0) + 10 from community.categories)))
    returning id into v_id;
  else
    update community.categories
       set name = community.clean_text(p_name, 1, 60, 'The name'),
           description = community.clean_text(coalesce(p_description, ''), 0, 300, 'The description'),
           active = coalesce(p_active, active), sort_order = coalesce(p_sort, sort_order), updated_at = now()
     where id = v_id;
    if not found then
      raise exception 'That category wasn''t found.' using errcode = 'P0002';
    end if;
  end if;
  perform community.audit('community.category_saved', 'community_category', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

-- Move a category up or down one place (renumbers 10, 20, 30…).
create function public.community_admin_category_move(p_id uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_pos integer;
  v_swap integer;
begin
  perform community.require_capability('community.manage');
  select array_agg(id order by sort_order, name) into v_ids from community.categories;
  v_pos := array_position(v_ids, p_id);
  if v_pos is null then
    raise exception 'That category wasn''t found.' using errcode = 'P0002';
  end if;
  v_swap := v_pos + sign(coalesce(p_direction, 0))::integer;
  if v_swap >= 1 and v_swap <= cardinality(v_ids) and v_swap <> v_pos then
    v_ids[v_pos] := v_ids[v_swap];
    v_ids[v_swap] := p_id;
  end if;
  update community.categories c set sort_order = x.ord * 10, updated_at = now()
    from unnest(v_ids) with ordinality as x(id, ord)
   where c.id = x.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema community from public, anon, authenticated;

revoke execute on function
  public.community_admin_set_dm_eligibility(uuid, boolean, text), public.community_admin_dm_eligibility(uuid),
  public.community_dm_recipients(text), public.community_dm_start(uuid), public.community_dm_send(uuid, text, uuid),
  public.community_dm_conversations(), public.community_dm_messages(uuid, timestamptz, uuid, integer),
  public.community_dm_mark_read(uuid), public.community_dm_clear(uuid), public.community_block(uuid, boolean),
  public.community_blocked(), public.community_set_dm_allow(text), public.community_report(text, uuid[], text, text),
  public.community_mod_reports(text, uuid), public.community_mod_report(uuid), public.community_mod_resolve(uuid, text, text),
  public.community_mod_thread(uuid, text, text, uuid), public.community_mod_post(uuid, text, text, uuid),
  public.community_mod_restrict(uuid, text, integer, text, uuid), public.community_mod_lift_restriction(uuid, text),
  public.community_mod_restrictions(), public.community_mod_log(integer), public.community_mod_member_search(text),
  public.community_admin_settings(), public.community_admin_save_guidelines(text, boolean),
  public.community_admin_save_settings(integer, integer, integer, integer),
  public.community_admin_category_save(uuid, text, text, boolean, integer), public.community_admin_category_move(uuid, integer)
from public;

grant execute on function
  public.community_admin_set_dm_eligibility(uuid, boolean, text), public.community_admin_dm_eligibility(uuid),
  public.community_dm_recipients(text), public.community_dm_start(uuid), public.community_dm_send(uuid, text, uuid),
  public.community_dm_conversations(), public.community_dm_messages(uuid, timestamptz, uuid, integer),
  public.community_dm_mark_read(uuid), public.community_dm_clear(uuid), public.community_block(uuid, boolean),
  public.community_blocked(), public.community_set_dm_allow(text), public.community_report(text, uuid[], text, text),
  public.community_mod_reports(text, uuid), public.community_mod_report(uuid), public.community_mod_resolve(uuid, text, text),
  public.community_mod_thread(uuid, text, text, uuid), public.community_mod_post(uuid, text, text, uuid),
  public.community_mod_restrict(uuid, text, integer, text, uuid), public.community_mod_lift_restriction(uuid, text),
  public.community_mod_restrictions(), public.community_mod_log(integer), public.community_mod_member_search(text),
  public.community_admin_settings(), public.community_admin_save_guidelines(text, boolean),
  public.community_admin_save_settings(integer, integer, integer, integer),
  public.community_admin_category_save(uuid, text, text, boolean, integer), public.community_admin_category_move(uuid, integer)
to authenticated;
