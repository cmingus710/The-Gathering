-- Phase 5 · Community: groups and group-restricted events.
--
-- Groups
--   * Discoverable groups: any approved member sees name, summary, and image,
--     and can ask to join. Hidden groups: only members and community.manage
--     holders know they exist. Description details ("about"), the roster,
--     discussions, and group events are for active members only.
--   * Membership comes only from accepted invitations, approved requests, or
--     an administrator's appointment. Never from households or interests.
--   * Leaving or removal is immediate: discussions, roster, events, event
--     images, feeds, and notifications all recheck membership on every read,
--     and group event registrations are canceled (Phase 4 reservation
--     policy: canceled as "ineligible", no email, waitlist promoted).

-- ---------------------------------------------------------------------------
-- Groups: reading
-- ---------------------------------------------------------------------------
create function community.group_card(g community.groups, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'summary', g.summary,
    'image_path', g.image_path, 'image_alt', g.image_alt,
    'visibility', g.visibility, 'accepts_requests', g.accepts_requests, 'status', g.status,
    'my_role', (select m.role from community.group_members m where m.group_id = g.id and m.profile_id = p_viewer and m.state = 'active'),
    'my_request', exists (select 1 from community.group_requests r where r.group_id = g.id and r.profile_id = p_viewer and r.status = 'pending'),
    'my_invitation', (select i.id from community.group_invitations i
                       where i.group_id = g.id and i.invitee_id = p_viewer and i.status = 'pending' and i.expires_at > now()));
$$;

create function public.community_groups()
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
    'mine', coalesce((select jsonb_agg(community.group_card(g, v_uid) order by lower(g.name))
                        from community.groups g where community.group_member(g.id, v_uid)), '[]'::jsonb),
    'discover', coalesce((select jsonb_agg(community.group_card(g, v_uid) order by lower(g.name))
                            from community.groups g
                           where g.visibility = 'discoverable' and g.status = 'active'
                             and not community.group_member(g.id, v_uid)), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', i.id, 'expires_at', i.expires_at, 'invited_by', community.display_name(i.invited_by),
                                'group', jsonb_build_object('id', g.id, 'name', g.name, 'summary', g.summary,
                                                            'image_path', g.image_path, 'image_alt', g.image_alt))
                              order by i.created_at desc)
                               from community.group_invitations i join community.groups g on g.id = i.group_id and g.status = 'active'
                              where i.invitee_id = v_uid and i.status = 'pending' and i.expires_at > now()), '[]'::jsonb));
end;
$$;

-- Group detail. Non-members of a discoverable group get only the public
-- card. Members get details, leaders, and member count. Null if the caller
-- may not know the group exists.
create function public.community_group(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  g community.groups;
  v_member boolean;
begin
  select * into g from community.groups where id = p_id;
  if not found or not community.can_see_group(g.id, v_uid) then
    return null;
  end if;
  v_member := community.group_member(g.id, v_uid);
  return community.group_card(g, v_uid) || jsonb_build_object(
    'is_member', v_member,
    'can_manage', community.can_manage_group(g.id),
    'is_admin', (select public.has_capability('community.manage')),
    'about', case when v_member then g.about end,
    'leaders', case when v_member then (
                 select coalesce(jsonb_agg(community.display_name(m.profile_id) order by m.joined_at), '[]'::jsonb)
                   from community.group_members m
                  where m.group_id = g.id and m.state = 'active' and m.role = 'leader' and community.is_member(m.profile_id)) end,
    'member_count', case when v_member or community.can_manage_group(g.id) then (
                      select count(*) from community.group_members m
                       where m.group_id = g.id and m.state = 'active' and community.is_member(m.profile_id)) end,
    'muted', exists (select 1 from community.mutes m where m.profile_id = v_uid and m.target_type = 'group' and m.target_id = g.id));
end;
$$;

-- Roster: active members see names (and whether they may message each
-- person under that person's own message settings); managers also see
-- roles and pending invitations/requests. Never contact details.
create function public.community_group_roster(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_manage boolean := community.can_manage_group(p_id);
begin
  if not (community.group_member(p_id, v_uid) or v_manage) then
    raise exception 'Only group members can see who belongs to it.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.profile_id, 'name', community.display_name(m.profile_id), 'role', m.role,
               'joined_at', m.joined_at, 'me', m.profile_id = v_uid,
               'can_message', community.can_message(v_uid, m.profile_id))
             order by (m.role = 'leader') desc, lower(community.display_name(m.profile_id)))
        from community.group_members m
       where m.group_id = p_id and m.state = 'active' and community.is_member(m.profile_id)), '[]'::jsonb),
    'requests', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', community.display_name(r.profile_id), 'message', r.message,
                                          'created_at', r.created_at) order by r.created_at)
        from community.group_requests r
       where r.group_id = p_id and r.status = 'pending' and community.is_member(r.profile_id)), '[]'::jsonb) end,
    'invitations', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', community.display_name(i.invitee_id),
                                          'expires_at', i.expires_at, 'created_at', i.created_at) order by i.created_at)
        from community.group_invitations i
       where i.group_id = p_id and i.status = 'pending' and i.expires_at > now()), '[]'::jsonb) end,
    'can_manage', v_manage,
    'is_admin', (select public.has_capability('community.manage')));
end;
$$;

-- ---------------------------------------------------------------------------
-- Groups: joining, inviting, leaving
-- ---------------------------------------------------------------------------
create function community.add_member(p_group uuid, p_profile uuid, p_role community.member_role default 'member')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into community.group_members as gm (group_id, profile_id, role, state, joined_at)
  values (p_group, p_profile, p_role, 'active', now())
  on conflict (group_id, profile_id) do update
    set state = 'active', role = case when gm.state = 'active' then gm.role else excluded.role end,
        joined_at = case when gm.state = 'active' then gm.joined_at else now() end,
        ended_at = null, ended_by = null, updated_at = now();
  update community.group_requests set status = 'approved', decided_at = now(), decided_by = (select auth.uid())
   where group_id = p_group and profile_id = p_profile and status = 'pending';
  update community.group_invitations set status = 'accepted', responded_at = now()
   where group_id = p_group and invitee_id = p_profile and status = 'pending';
  perform community.ping(p_profile, 'groups');
end;
$$;

create function public.community_group_request(p_group uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  g community.groups;
  v_id uuid;
  v_leader uuid;
begin
  select * into g from community.groups where id = p_group;
  if not found or g.visibility <> 'discoverable' or g.status <> 'active' then
    raise exception 'That group wasn''t found.' using errcode = 'P0002';
  end if;
  if not g.accepts_requests then
    raise exception 'This group joins by invitation only.' using errcode = '22023';
  end if;
  if community.group_member(g.id, v_uid) then
    raise exception 'You''re already a member of this group.' using errcode = '22023';
  end if;
  if exists (select 1 from community.group_requests where group_id = g.id and profile_id = v_uid and status = 'pending') then
    return;
  end if;
  perform community.rate_limit(v_uid, 'group_request', 10, interval '1 hour');
  insert into community.group_requests (group_id, profile_id, message)
  values (g.id, v_uid, nullif(community.clean_text(coalesce(p_message, ''), 0, 500, 'Your note'), ''))
  returning id into v_id;
  for v_leader in select profile_id from community.group_members where group_id = g.id and role = 'leader' and state = 'active' loop
    perform community.notify(v_leader, 'group_request', v_uid,
      jsonb_build_object('group_id', g.id, 'request_id', v_id), 'group_request:' || g.id);
  end loop;
end;
$$;

create function public.community_group_request_withdraw(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  update community.group_requests set status = 'withdrawn', decided_at = now()
   where group_id = p_group and profile_id = v_uid and status = 'pending';
end;
$$;

create function public.community_group_decide(p_request uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  r community.group_requests;
begin
  select * into r from community.group_requests where id = p_request for update;
  if not found or not community.can_manage_group(r.group_id) then
    raise exception 'That request wasn''t found.' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'That request was already answered.' using errcode = '22023';
  end if;
  if p_approve then
    if not community.is_member(r.profile_id) then
      raise exception 'That person can''t join right now.' using errcode = '22023';
    end if;
    perform community.add_member(r.group_id, r.profile_id);
    perform community.notify(r.profile_id, 'group_request_approved', null, jsonb_build_object('group_id', r.group_id));
  else
    update community.group_requests set status = 'declined', decided_at = now(), decided_by = v_uid where id = r.id;
    perform community.notify(r.profile_id, 'group_request_declined', null, jsonb_build_object('group_id', r.group_id));
  end if;
  perform community.audit(case when p_approve then 'group.request_approved' else 'group.request_declined' end,
                          'group', r.group_id::text, jsonb_build_object('profile', r.profile_id));
end;
$$;

-- Invitee search for group managers: only directory-listed approved adults
-- (the directory's own privacy rules), at least two characters, ten results.
create function public.community_group_invite_search(p_group uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
begin
  if not community.can_manage_group(p_group) then
    raise exception 'You do not have permission to manage this group.' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by lower(x.name))
      from (select p.id, public.directory_display_name(p) as name
              from public.profiles p
             where public.directory_is_listed(p.id)
               and (p.full_name ilike v_like or p.preferred_name ilike v_like)
               and not community.group_member(p_group, p.id)
             order by lower(p.full_name)
             limit 10) x), '[]'::jsonb);
end;
$$;

-- One refusal message for every "can't invite" case, so invitations can't
-- be used to probe whether an account exists or its status.
create function public.community_group_invite(p_group uuid, p_invitee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_id uuid;
begin
  if not community.can_manage_group(p_group)
     or not exists (select 1 from community.groups where id = p_group and status = 'active') then
    raise exception 'You do not have permission to manage this group.' using errcode = '42501';
  end if;
  perform community.rate_limit(v_uid, 'group_invite', 30, interval '1 hour');
  if p_invitee is null or p_invitee = v_uid or not community.is_member(p_invitee) or community.group_member(p_group, p_invitee) then
    raise exception 'That member can''t be invited right now.' using errcode = '22023';
  end if;
  select id into v_id from community.group_invitations where group_id = p_group and invitee_id = p_invitee and status = 'pending';
  if v_id is not null then
    update community.group_invitations set expires_at = greatest(expires_at, now() + interval '14 days') where id = v_id;
    return;
  end if;
  insert into community.group_invitations (group_id, invitee_id, invited_by) values (p_group, p_invitee, v_uid)
  returning id into v_id;
  perform community.notify(p_invitee, 'group_invitation', v_uid, jsonb_build_object('group_id', p_group, 'invitation_id', v_id));
  perform community.audit('group.invited', 'group', p_group::text, jsonb_build_object('profile', p_invitee));
end;
$$;

create function public.community_group_revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i community.group_invitations;
begin
  perform community.require_member();
  select * into i from community.group_invitations where id = p_invitation for update;
  if not found or not community.can_manage_group(i.group_id) then
    raise exception 'That invitation wasn''t found.' using errcode = 'P0002';
  end if;
  if i.status <> 'pending' then
    raise exception 'That invitation is no longer open.' using errcode = '22023';
  end if;
  update community.group_invitations set status = 'revoked', responded_at = now() where id = i.id;
  perform community.audit('group.invitation_revoked', 'group', i.group_id::text, jsonb_build_object('profile', i.invitee_id));
end;
$$;

-- Accept or decline. The row lock plus status/expiry check means an
-- invitation can be used once; revoked, expired, and replayed answers fail.
create function public.community_group_respond(p_invitation uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  i community.group_invitations;
begin
  select * into i from community.group_invitations where id = p_invitation for update;
  if not found or i.invitee_id <> v_uid or i.status <> 'pending' or i.expires_at <= now()
     or not exists (select 1 from community.groups where id = i.group_id and status = 'active') then
    raise exception 'This invitation is no longer available.' using errcode = '22023';
  end if;
  if p_accept then
    perform community.add_member(i.group_id, v_uid);
  else
    update community.group_invitations set status = 'declined', responded_at = now() where id = i.id;
  end if;
  return i.group_id;
end;
$$;

create function public.community_group_leave(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  update community.group_members set state = 'left', ended_at = now(), ended_by = v_uid, updated_at = now()
   where group_id = p_group and profile_id = v_uid and state = 'active';
  if not found then
    raise exception 'You''re not a member of that group.' using errcode = '22023';
  end if;
end;
$$;

-- Leaders remove members. Changing leaders (appoint, step down, remove a
-- leader) is for community.manage holders; the last-leader trigger applies.
create function public.community_group_set_member(p_group uuid, p_profile uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  m community.group_members;
  v_admin boolean := (select public.has_capability('community.manage'));
begin
  if not community.can_manage_group(p_group) then
    raise exception 'You do not have permission to manage this group.' using errcode = '42501';
  end if;
  if p_action = 'add_leader' then
    if not v_admin then
      raise exception 'Only community administrators appoint group leaders.' using errcode = '42501';
    end if;
    if not community.is_member(p_profile) then
      raise exception 'That person can''t lead a group right now.' using errcode = '22023';
    end if;
    perform community.add_member(p_group, p_profile, 'leader');
    update community.group_members set role = 'leader', updated_at = now() where group_id = p_group and profile_id = p_profile;
    perform community.notify(p_profile, 'group_role', v_uid, jsonb_build_object('group_id', p_group, 'detail', jsonb_build_object('role', 'leader')));
    perform community.audit('group.leader_appointed', 'group', p_group::text, jsonb_build_object('profile', p_profile));
    return;
  end if;
  select * into m from community.group_members where group_id = p_group and profile_id = p_profile and state = 'active' for update;
  if not found then
    raise exception 'That person isn''t a member of this group.' using errcode = 'P0002';
  end if;
  if p_action = 'remove' then
    if m.role = 'leader' and not v_admin then
      raise exception 'Only community administrators remove group leaders.' using errcode = '42501';
    end if;
    if p_profile = v_uid then
      raise exception 'Use Leave group to leave it yourself.' using errcode = '22023';
    end if;
    update community.group_members set state = 'removed', ended_at = now(), ended_by = v_uid, updated_at = now()
     where group_id = p_group and profile_id = p_profile;
    perform community.notify(p_profile, 'group_removed', null, jsonb_build_object('group_id', p_group));
    perform community.audit('group.member_removed', 'group', p_group::text, jsonb_build_object('profile', p_profile, 'role', m.role));
  elsif p_action = 'remove_leader_role' then
    if not v_admin then
      raise exception 'Only community administrators change group leaders.' using errcode = '42501';
    end if;
    update community.group_members set role = 'member', updated_at = now() where group_id = p_group and profile_id = p_profile;
    perform community.notify(p_profile, 'group_role', v_uid, jsonb_build_object('group_id', p_group, 'detail', jsonb_build_object('role', 'member')));
    perform community.audit('group.leader_removed', 'group', p_group::text, jsonb_build_object('profile', p_profile));
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end;
$$;

-- When someone stops being an active member: drop their follows of the
-- group's discussions, cancel group-event registrations (current and future
-- occurrences; Phase 4 policy: "ineligible", no email, waitlist promoted),
-- drop their queued event email for those events, and refresh their screens.
create function community.on_group_membership_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ uuid;
begin
  if old.state = 'active' and new.state <> 'active' then
    delete from community.follows f using community.threads t
     where t.id = f.thread_id and t.group_id = new.group_id and f.profile_id = new.profile_id;
    update events.outbox e set status = 'skipped', updated_at = now()
      from events.occurrences o join events.series s on s.id = o.series_id
     where e.occurrence_id = o.id and s.group_id = new.group_id and e.profile_id = new.profile_id
       and e.status in ('pending', 'failed');
    for v_occ in
      update events.registrations r
         set status = 'canceled', canceled_at = now(), cancel_reason = 'ineligible', updated_at = now()
        from events.occurrences o join events.series s on s.id = o.series_id
       where o.id = r.occurrence_id and s.group_id = new.group_id and r.profile_id = new.profile_id
         and r.status <> 'canceled' and o.ends_at > now()
      returning r.occurrence_id
    loop
      perform events.promote(v_occ);
    end loop;
    perform community.ping(new.profile_id, 'groups');
  end if;
  return new;
end;
$$;

create trigger group_members_on_end
  after update of state on community.group_members
  for each row execute function community.on_group_membership_end();

-- ---------------------------------------------------------------------------
-- Groups: administration
-- ---------------------------------------------------------------------------
-- Create (community.manage; needs a first leader) or edit (group managers).
-- Only community.manage changes visibility. p: {id?, name, summary, about,
-- image_path, image_alt, visibility, accepts_requests, leader_id}
create function public.community_group_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_admin boolean := (select public.has_capability('community.manage'));
  g community.groups;
  v_vis community.group_visibility;
  v_leader uuid := nullif(p ->> 'leader_id', '')::uuid;
  v_requests boolean;
  v_image text := nullif(p ->> 'image_path', '');
begin
  if v_image is not null and v_image !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.webp$' then
    raise exception 'That image isn''t valid.' using errcode = '22023';
  end if;
  if v_id is null then
    if not v_admin then
      raise exception 'Only community administrators create groups.' using errcode = '42501';
    end if;
    if v_leader is null or not community.is_member(v_leader) then
      raise exception 'Choose an approved member to lead the group.' using errcode = '22023';
    end if;
    v_vis := coalesce(nullif(p ->> 'visibility', ''), 'discoverable')::community.group_visibility;
    insert into community.groups (name, summary, about, visibility, accepts_requests, created_by)
    values (community.clean_text(p ->> 'name', 2, 80, 'The group name'),
            community.clean_text(coalesce(p ->> 'summary', ''), 0, 400, 'The summary'),
            community.clean_text(coalesce(p ->> 'about', ''), 0, 5000, 'The details'),
            v_vis, v_vis = 'discoverable' and coalesce((p ->> 'accepts_requests')::boolean, true), v_uid)
    returning id into v_id;
    insert into community.group_members (group_id, profile_id, role) values (v_id, v_leader, 'leader');
    perform community.notify(v_leader, 'group_role', v_uid, jsonb_build_object('group_id', v_id, 'detail', jsonb_build_object('role', 'leader')));
    perform community.audit('group.created', 'group', v_id::text, jsonb_build_object('visibility', v_vis, 'leader', v_leader));
    return v_id;
  end if;

  select * into g from community.groups where id = v_id for update;
  if not found or not community.can_manage_group(v_id) then
    raise exception 'That group wasn''t found.' using errcode = 'P0002';
  end if;
  if g.status = 'archived' then
    raise exception 'Archived groups can''t be edited. Restore it first.' using errcode = '22023';
  end if;
  v_vis := case when v_admin and nullif(p ->> 'visibility', '') is not null then (p ->> 'visibility')::community.group_visibility else g.visibility end;
  v_requests := v_vis = 'discoverable' and coalesce((p ->> 'accepts_requests')::boolean, g.accepts_requests);
  if v_image is not null and split_part(v_image, '/', 1) <> v_id::text then
    raise exception 'That image isn''t valid.' using errcode = '22023';
  end if;
  update community.groups
     set name = community.clean_text(coalesce(p ->> 'name', g.name), 2, 80, 'The group name'),
         summary = community.clean_text(coalesce(p ->> 'summary', g.summary), 0, 400, 'The summary'),
         about = community.clean_text(coalesce(p ->> 'about', g.about), 0, 5000, 'The details'),
         image_path = case when p ? 'image_path' then v_image else g.image_path end,
         image_alt = case when p ? 'image_path' then case when v_image is null then null else nullif(btrim(p ->> 'image_alt'), '') end
                          when p ? 'image_alt' and g.image_path is not null then nullif(btrim(p ->> 'image_alt'), '')
                          else g.image_alt end,
         visibility = v_vis,
         accepts_requests = v_requests,
         updated_at = now()
   where id = v_id;
  if not v_requests then
    update community.group_requests set status = 'declined', decided_at = now(), decided_by = v_uid
     where group_id = v_id and status = 'pending';
  end if;
  perform community.audit('group.updated', 'group', v_id::text,
    jsonb_build_object('visibility_changed', v_vis is distinct from g.visibility));
  return v_id;
end;
$$;

-- Archive: discussions become read-only, open invitations and requests close,
-- members keep read access. Restore reopens it (a leader is required).
create function public.community_group_archive(p_group uuid, p_archive boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_capability('community.manage');
begin
  perform pg_advisory_xact_lock(hashtext('community.group:' || p_group::text));
  if p_archive then
    update community.groups set status = 'archived', archived_at = now(), updated_at = now() where id = p_group and status = 'active';
    if not found then
      raise exception 'That group isn''t active.' using errcode = '22023';
    end if;
    update community.group_invitations set status = 'revoked', responded_at = now() where group_id = p_group and status = 'pending';
    update community.group_requests set status = 'declined', decided_at = now(), decided_by = v_uid where group_id = p_group and status = 'pending';
  else
    if not exists (select 1 from community.group_members where group_id = p_group and role = 'leader' and state = 'active') then
      raise exception 'Appoint a leader before restoring this group.' using errcode = '22023';
    end if;
    update community.groups set status = 'active', archived_at = null, updated_at = now() where id = p_group and status = 'archived';
    if not found then
      raise exception 'That group isn''t archived.' using errcode = '22023';
    end if;
  end if;
  perform community.audit(case when p_archive then 'group.archived' else 'group.restored' end, 'group', p_group::text);
end;
$$;

create function public.community_admin_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform community.require_capability('community.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'name', g.name, 'visibility', g.visibility, 'status', g.status, 'accepts_requests', g.accepts_requests,
             'members', (select count(*) from community.group_members m where m.group_id = g.id and m.state = 'active'),
             'leaders', (select coalesce(jsonb_agg(jsonb_build_object('id', m.profile_id, 'name', community.display_name(m.profile_id),
                                                                    'approved', community.is_member(m.profile_id))), '[]'::jsonb)
                           from community.group_members m where m.group_id = g.id and m.state = 'active' and m.role = 'leader'),
             'created_at', g.created_at)
           order by g.status, lower(g.name))
      from community.groups g), '[]'::jsonb);
end;
$$;

-- Leader candidates for administrators: approved adults by name (no contact
-- details; includes members who opted out of the directory, because a
-- leader appointment is an administrative act).
create function public.community_admin_member_search(p_query text)
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
  perform community.require_capability('community.manage');
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by lower(x.name))
      from (select p.id, public.directory_display_name(p) as name from public.profiles p
             where p.membership_status = 'approved' and p.account_kind = 'adult'
               and (p.full_name ilike v_like or p.preferred_name ilike v_like)
             order by lower(p.full_name) limit 15) x), '[]'::jsonb);
end;
$$;

-- Group images: private bucket, readable by people who may see the group.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-images', 'group-images', false, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.can_view_group_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from community.groups g
                  where g.image_path = p_name and community.can_see_group(g.id, (select auth.uid())));
$$;

create function public.can_manage_group_image(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  if p_name !~ '^[0-9a-f-]{36}/' then
    return false;
  end if;
  v_group := split_part(p_name, '/', 1)::uuid;
  return community.can_manage_group(v_group);
end;
$$;

create policy "Group images follow group visibility"
  on storage.objects for select to authenticated
  using (bucket_id = 'group-images' and (select public.can_view_group_image(storage.objects.name)));

create policy "Group managers upload group images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'group-images' and (select public.can_manage_group_image(storage.objects.name)));

create policy "Group managers delete group images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'group-images' and (select public.can_manage_group_image(storage.objects.name)));

-- ---------------------------------------------------------------------------
-- Phase 4 integration: group-restricted events
-- ---------------------------------------------------------------------------
-- Real group membership replaces the Phase 4 placeholder. Every events path
-- already goes through events.visible_to / audience_allows: lists, details,
-- RSVP, waitlist promotion, images, ICS, both feeds, and email rechecks.
create or replace function events.group_member(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_group is not null and community.group_member(p_group, p_profile);
$$;
revoke execute on function events.group_member(uuid, uuid) from public, anon, authenticated;

alter table events.series drop constraint series_groups_unavailable;
alter table events.series
  add constraint series_group_audience check ((audience = 'group') = (group_id is not null)),
  add constraint series_group_fk foreign key (group_id) references community.groups (id);
create index series_group_idx on events.series (group_id);

-- Which groups an event coordinator may target: discoverable active groups,
-- plus hidden groups they administer (community.manage) or lead.
create function events.can_target_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from community.groups g
                  where g.id = p_group and g.status = 'active'
                    and (g.visibility = 'discoverable'
                         or (select public.has_capability('community.manage'))
                         or community.group_leader(g.id, (select auth.uid()))));
$$;

create function public.events_admin_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'visibility', g.visibility) order by lower(g.name))
      from community.groups g where events.can_target_group(g.id)), '[]'::jsonb);
end;
$$;

-- events_admin_save, now accepting group_id (Phase 4 ignored it).
create or replace function public.events_admin_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_fields jsonb := p - array['id', 'status', 'publish_at', 'sequence', 'created_by', 'updated_by', 'created_at',
                              'updated_at', 'canceled_at', 'cancel_reason'];
  x events.series;
  old events.series;
  v_new events.series;
  v_result jsonb;
  v_occ uuid;
begin
  perform events.require_manager();
  if not v_fields ? 'audience' then
    v_fields := v_fields || jsonb_build_object('audience', coalesce((select audience from events.series where id = v_id), 'members'),
                                               'group_id', (select group_id from events.series where id = v_id));
  end if;
  if coalesce(v_fields ->> 'audience', '') <> 'group' then
    v_fields := jsonb_set(v_fields, '{group_id}', 'null'::jsonb);
  elsif nullif(v_fields ->> 'group_id', '') is null or not events.can_target_group((v_fields ->> 'group_id')::uuid) then
    raise exception 'Choose a group for a group event.' using errcode = '22023';
  end if;
  if v_id is null then
    x := jsonb_populate_record(null::events.series, v_fields);
    insert into events.series (title, description, cover_path, cover_alt, category_id, audience, group_id, timezone, all_day,
                               start_date, start_time, duration_minutes, day_count, location_name, location_address,
                               online_url, organizer_name, rsvp_enabled, capacity, waitlist_enabled, rsvp_close_minutes,
                               cancellation_instructions, reminder_minutes, recurrence, interval_count, weekdays,
                               monthly_mode, month_ordinal, until_date, occurrence_limit)
    values (x.title, coalesce(x.description, ''), x.cover_path, x.cover_alt, x.category_id, coalesce(x.audience, 'members'), x.group_id,
            x.timezone, coalesce(x.all_day, false), x.start_date, x.start_time, x.duration_minutes, x.day_count,
            x.location_name, x.location_address, x.online_url, x.organizer_name, coalesce(x.rsvp_enabled, false),
            x.capacity, coalesce(x.waitlist_enabled, false), x.rsvp_close_minutes, x.cancellation_instructions,
            coalesce(x.reminder_minutes, (select default_reminder_minutes from events.settings)),
            coalesce(x.recurrence, 'none'), coalesce(x.interval_count, 1), x.weekdays, x.monthly_mode, x.month_ordinal,
            x.until_date, x.occurrence_limit)
    returning id into v_id;
    v_result := events.sync_occurrences(v_id, false);
    return v_result || jsonb_build_object('id', v_id);
  end if;

  select * into old from events.series where id = v_id for update;
  if not found then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  if old.status in ('canceled', 'archived') then
    raise exception 'Canceled or archived events can''t be edited.' using errcode = '22023';
  end if;
  x := jsonb_populate_record(old, v_fields);
  update events.series
     set title = x.title, description = coalesce(x.description, ''), cover_path = x.cover_path, cover_alt = x.cover_alt,
         category_id = x.category_id, audience = x.audience, group_id = x.group_id, timezone = x.timezone, all_day = x.all_day,
         start_date = x.start_date, start_time = x.start_time, duration_minutes = x.duration_minutes, day_count = x.day_count,
         location_name = x.location_name, location_address = x.location_address, online_url = x.online_url,
         organizer_name = x.organizer_name, rsvp_enabled = x.rsvp_enabled, capacity = x.capacity,
         waitlist_enabled = x.waitlist_enabled, rsvp_close_minutes = x.rsvp_close_minutes,
         cancellation_instructions = x.cancellation_instructions, reminder_minutes = x.reminder_minutes,
         recurrence = x.recurrence, interval_count = x.interval_count, weekdays = x.weekdays, monthly_mode = x.monthly_mode,
         month_ordinal = x.month_ordinal, until_date = x.until_date, occurrence_limit = x.occurrence_limit,
         sequence = sequence + case when old.status = 'published' then 1 else 0 end
   where id = v_id
  returning * into v_new;

  v_result := events.sync_occurrences(
    v_id,
    old.status = 'published',
    (old.location_name, old.location_address, old.online_url) is distinct from (v_new.location_name, v_new.location_address, v_new.online_url));

  if old.status = 'published' and (old.audience, old.group_id) is distinct from (v_new.audience, v_new.group_id) then
    v_result := v_result || jsonb_build_object('removed_ineligible', events.recheck_series(v_id));
  end if;
  if old.status = 'published' and v_new.rsvp_enabled
     and (v_new.capacity is null or old.capacity is null or v_new.capacity > old.capacity or not old.rsvp_enabled) then
    for v_occ in select id from events.occurrences where series_id = v_id and ends_at > now() loop
      perform events.promote(v_occ);
    end loop;
  end if;
  return v_result || jsonb_build_object('id', v_id);
end;
$$;

-- Event detail, now naming the group for its members (only ever returned
-- after the visibility check, so a former member gets "not found").
create or replace function public.events_occurrence(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_series uuid;
begin
  select series_id into v_series from events.occurrences where id = p_id;
  if v_series is null or not events.visible_to(v_series, v_uid) then
    return null;
  end if;
  return events.occurrence_json(p_id, v_uid) || jsonb_build_object(
    'group', (select jsonb_build_object('id', g.id, 'name', g.name)
                from events.series s join community.groups g on g.id = s.group_id
               where s.id = v_series and s.audience = 'group'),
    'more', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'status', o.status)
                       order by o.starts_at)
        from (select * from events.occurrences
               where series_id = v_series and id <> p_id and ends_at > now()
               order by starts_at limit 8) o), '[]'::jsonb));
end;
$$;

-- Upcoming events of one group, for its members.
create function public.community_group_events(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if not community.group_member(p_group, v_uid) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(events.occurrence_json(x.id, v_uid) order by x.starts_at)
      from (select o.id, o.starts_at from events.occurrences o join events.series s on s.id = o.series_id
             where s.group_id = p_group and s.audience = 'group' and o.ends_at > now()
               and events.visible_to(s.id, v_uid)
             order by o.starts_at limit 10) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema community from public, anon, authenticated;
revoke execute on all functions in schema events from public, anon, authenticated;

revoke execute on function
  public.community_groups(), public.community_group(uuid), public.community_group_roster(uuid),
  public.community_group_request(uuid, text), public.community_group_request_withdraw(uuid), public.community_group_decide(uuid, boolean),
  public.community_group_invite_search(uuid, text), public.community_group_invite(uuid, uuid), public.community_group_revoke_invitation(uuid),
  public.community_group_respond(uuid, boolean), public.community_group_leave(uuid), public.community_group_set_member(uuid, uuid, text),
  public.community_group_save(jsonb), public.community_group_archive(uuid, boolean), public.community_admin_groups(),
  public.community_admin_member_search(text), public.can_view_group_image(text), public.can_manage_group_image(text),
  public.events_admin_groups(), public.community_group_events(uuid)
from public;

grant execute on function
  public.community_groups(), public.community_group(uuid), public.community_group_roster(uuid),
  public.community_group_request(uuid, text), public.community_group_request_withdraw(uuid), public.community_group_decide(uuid, boolean),
  public.community_group_invite_search(uuid, text), public.community_group_invite(uuid, uuid), public.community_group_revoke_invitation(uuid),
  public.community_group_respond(uuid, boolean), public.community_group_leave(uuid), public.community_group_set_member(uuid, uuid, text),
  public.community_group_save(jsonb), public.community_group_archive(uuid, boolean), public.community_admin_groups(),
  public.community_admin_member_search(text), public.can_view_group_image(text), public.can_manage_group_image(text),
  public.events_admin_groups(), public.community_group_events(uuid)
to authenticated;

-- events_occurrence keeps its Phase 4 grants (visitors see public events).
grant execute on function public.events_occurrence(uuid) to anon, authenticated;
grant execute on function public.events_admin_save(jsonb) to authenticated;
