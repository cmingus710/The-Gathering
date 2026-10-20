-- Phase 6 · Step 4 of 4: apply migration 20261024000400_prayer_care to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Practical care, the care team workspace, and volunteer signups.
--
-- It copies supabase/migrations/20261024000400_prayer_care.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-6).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('community.notifications') is null or to_regclass('events.series') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the Phase 5 stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000300') then
    raise exception 'Nothing was changed: the previous step (20261024000300) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000400') then
    raise exception 'Nothing was changed: 20261024000400 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261024000400_prayer_care.sql
-- =========================================================================
-- Phase 6 · Practical care: "Request help", the care team workspace, and
-- limited care-specific volunteer signups.
--
-- Who sees what
--   requester         their own requests: details, status, the coordinator's
--                     name, messages with the team, and whether help is being
--                     organized. Never internal notes or the activity log.
--   care.coordinate   the queue and request details (incl. the requester's
--                     phone or email only when they chose that contact
--                     method), messages, activity; can act on unassigned
--                     requests and ones assigned to them.
--   assigned coord.   + internal notes on their requests.
--   care.assign       + assigning coordinators and all internal notes.
--   volunteers        opportunities in their audience: generic task, time,
--                     helpers needed. Logistics and the requester's first name
--                     only once ACCEPTED and only while the requester consents.
-- Prayer team members, prayer moderators, group leaders, and administrators
-- without these capabilities see nothing here.
--
-- Care requests are never published as prayer requests or opportunities
-- automatically; an opportunity is created and previewed by a coordinator,
-- and publishing identifying details needs the requester's consent.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Whether the caller may act on a care request (coordinators: unassigned or
-- assigned to them; care.assign: any).
create function prayer.can_act_on_care(c prayer.care_requests, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.id is not null and prayer.holds(p_viewer, 'care.coordinate')
     and (c.assigned_to is null or c.assigned_to = p_viewer or prayer.holds(p_viewer, 'care.assign'));
$$;

create function prayer.can_read_notes(c prayer.care_requests, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select prayer.holds(p_viewer, 'care.assign')
      or (c.assigned_to = p_viewer and prayer.holds(p_viewer, 'care.coordinate'));
$$;

create function prayer.first_name(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.first_name), ''),
                                   nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), 'Member')
                     from public.profiles p where p.id = p_profile), 'Former member');
$$;

create function prayer.opportunity_eligible(o prayer.care_opportunities, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select prayer.is_member(p_viewer) and case o.audience
    when 'church' then true
    when 'group' then community.group_member(o.group_id, p_viewer)
    else prayer.holds(p_viewer, 'care.coordinate')
  end;
$$;

create function prayer.opportunity_card(o prayer.care_opportunities, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'title', o.title, 'details', o.details, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
    'helpers_needed', o.helpers_needed, 'status', o.status, 'audience', o.audience,
    'group_name', case when o.group_id is null then null else (select g.name from community.groups g where g.id = o.group_id) end,
    'accepted_count', (select count(*) from prayer.care_signups s where s.opportunity_id = o.id and s.status in ('accepted', 'completed')),
    'my_status', (select s.status from prayer.care_signups s where s.opportunity_id = o.id and s.profile_id = p_viewer));
$$;

-- What accepted volunteers see beyond the card (only while consent holds).
create function prayer.opportunity_private(o prayer.care_opportunities)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'consent', c.share_consent,
    'logistics', case when c.share_consent and o.logistics <> '' then o.logistics end,
    'requester_first_name', case when c.share_consent and o.share_name then prayer.first_name(c.requester_id) end,
    'coordinator', case when o.created_by is null then null else community.display_name(o.created_by) end)
    from prayer.care_requests c where c.id = o.care_id;
$$;

-- ---------------------------------------------------------------------------
-- Requester
-- ---------------------------------------------------------------------------
create function public.care_request_create(
  p_kind text, p_summary text, p_details text, p_needed_on date, p_needed_until date,
  p_contact_method text, p_contact_note text, p_consent boolean, p_client_key uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_id uuid;
begin
  if coalesce(p_kind, '') not in ('meal', 'transportation', 'visit', 'other') then
    raise exception 'Choose the kind of help you need.' using errcode = '22023';
  end if;
  if coalesce(p_contact_method, '') not in ('app', 'phone', 'email') then
    raise exception 'Choose how the care team should contact you.' using errcode = '22023';
  end if;
  if p_needed_on is not null and p_needed_until is not null and p_needed_until < p_needed_on then
    raise exception 'The end date must be on or after the start date.' using errcode = '22023';
  end if;
  if p_contact_method = 'phone' and nullif(btrim((select phone from public.profiles where id = v_uid)), '') is null then
    raise exception 'Add a phone number to your profile first, or choose another way to be contacted.' using errcode = '22023';
  end if;
  if p_client_key is not null then
    select id into v_id from prayer.care_requests where requester_id = v_uid and client_key = p_client_key;
    if found then
      return v_id;
    end if;
  end if;
  perform community.rate_limit(v_uid, 'care_request', 5, interval '1 day');
  insert into prayer.care_requests (requester_id, kind, summary, details, needed_on, needed_until, contact_method,
                                    contact_note, share_consent, consent_at, client_key)
  values (v_uid, p_kind::prayer.care_kind, community.clean_text(p_summary, 3, 120, 'The summary'),
          community.clean_text(coalesce(p_details, ''), 0, 2000, 'The details'), p_needed_on, p_needed_until,
          p_contact_method::prayer.contact_method, nullif(community.clean_text(coalesce(p_contact_note, ''), 0, 200, 'The contact note'), ''),
          coalesce(p_consent, false), case when p_consent then now() end, p_client_key)
  returning id into v_id;
  perform prayer.care_log(v_id, 'submitted');
  return v_id;
end;
$$;

create function public.care_my_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
                     'id', c.id, 'kind', c.kind, 'summary', c.summary, 'status', c.status, 'needed_on', c.needed_on,
                     'created_at', c.created_at, 'updated_at', c.updated_at,
                     'has_coordinator', c.assigned_to is not null) order by c.status = 'closed', c.created_at desc)
                     from prayer.care_requests c where c.requester_id = v_uid), '[]'::jsonb);
end;
$$;

create function prayer.care_messages_json(p_care uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'body', m.body, 'from_team', m.from_team,
           'author', case when m.from_team then coalesce(community.display_name(m.author_id), 'Care team')
                          else prayer.first_name(m.author_id) end,
           'mine', m.author_id = p_viewer, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
    from prayer.care_messages m where m.care_id = p_care;
$$;

create function public.care_request(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  c prayer.care_requests;
begin
  select * into c from prayer.care_requests where id = p_id and requester_id = v_uid;
  if not found then
    raise exception 'That care request wasn''t found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'summary', c.summary, 'details', c.details,
    'needed_on', c.needed_on, 'needed_until', c.needed_until,
    'contact_method', c.contact_method, 'contact_note', c.contact_note,
    'status', c.status, 'closed_reason', c.closed_reason,
    'coordinator', case when c.assigned_to is null then null else community.display_name(c.assigned_to) end,
    'share_consent', c.share_consent,
    'created_at', c.created_at, 'updated_at', c.updated_at, 'closed_at', c.closed_at,
    'messages', prayer.care_messages_json(c.id, v_uid),
    -- Whether help is being organized (no volunteer names).
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', o.id, 'title', o.title, 'starts_at', o.starts_at, 'status', o.status,
                                 'helpers_needed', o.helpers_needed, 'share_name', o.share_name, 'has_logistics', o.logistics <> '',
                                 'accepted_count', (select count(*) from prayer.care_signups s
                                                     where s.opportunity_id = o.id and s.status in ('accepted', 'completed')))
                               order by o.starts_at)
                                 from prayer.care_opportunities o where o.care_id = c.id and o.status <> 'draft'), '[]'::jsonb));
end;
$$;

-- Messages between the requester and the care team.
create function public.care_message(p_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  c prayer.care_requests;
  v_team boolean;
  v_id uuid;
begin
  select * into c from prayer.care_requests where id = p_id for update;
  if not found then
    raise exception 'That care request wasn''t found.' using errcode = 'P0002';
  end if;
  v_team := c.requester_id <> v_uid;
  if v_team and not prayer.can_act_on_care(c, v_uid) then
    raise exception 'That care request wasn''t found.' using errcode = 'P0002';
  end if;
  if c.status = 'closed' then
    raise exception 'This care request is closed.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'care_message', 20, interval '15 minutes');
  insert into prayer.care_messages (care_id, author_id, from_team, body)
  values (c.id, v_uid, v_team, community.clean_text(p_body, 1, 2000, 'Your message'))
  returning id into v_id;
  update prayer.care_requests set updated_at = now() where id = c.id;
  perform prayer.care_log(c.id, case when v_team then 'team_responded' else 'requester_replied' end);
  if v_team then
    perform community.notify(c.requester_id, 'care_response', null,
      jsonb_build_object('care_request_id', c.id, 'detail', jsonb_build_object('to', 'requester')), 'care_response:' || c.id);
  elsif c.assigned_to is not null then
    perform community.notify(c.assigned_to, 'care_response', null,
      jsonb_build_object('care_request_id', c.id, 'detail', jsonb_build_object('to', 'team')), 'care_reply:' || c.id);
  end if;
  return v_id;
end;
$$;

create function public.care_request_withdraw(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  c prayer.care_requests;
begin
  select * into c from prayer.care_requests where id = p_id and requester_id = v_uid for update;
  if not found then
    raise exception 'That care request wasn''t found.' using errcode = 'P0002';
  end if;
  if c.status = 'closed' then
    return;
  end if;
  update prayer.care_requests set status = 'closed', closed_reason = 'withdrawn', closed_at = now(), updated_at = now() where id = c.id;
  update prayer.care_opportunities set status = 'canceled', updated_at = now() where care_id = c.id and status in ('draft', 'open', 'filled');
  perform prayer.care_log(c.id, 'withdrawn');
  if c.assigned_to is not null then
    perform community.notify(c.assigned_to, 'care_response', null,
      jsonb_build_object('care_request_id', c.id, 'detail', jsonb_build_object('to', 'team')), 'care_reply:' || c.id);
  end if;
end;
$$;

create function public.care_set_consent(p_id uuid, p_consent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  update prayer.care_requests
     set share_consent = coalesce(p_consent, false), consent_at = case when p_consent then now() end, updated_at = now()
   where id = p_id and requester_id = v_uid;
  if not found then
    raise exception 'That care request wasn''t found.' using errcode = 'P0002';
  end if;
  perform prayer.care_log(p_id, 'consent_changed', jsonb_build_object('consent', coalesce(p_consent, false)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Care team workspace
-- ---------------------------------------------------------------------------
-- p_filter: unassigned | mine | open | closed
create function public.care_team_queue(p_filter text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  v_today date := (now() at time zone coalesce((select timezone from public.church_settings), 'America/Chicago'))::date;
begin
  if coalesce(p_filter, '') not in ('unassigned', 'mine', 'open', 'closed') then
    raise exception 'Choose a valid filter.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
               'id', c.id, 'kind', c.kind, 'summary', c.summary, 'status', c.status,
               'needed_on', c.needed_on, 'needed_until', c.needed_until,
               'requester', community.display_name(c.requester_id),
               'assigned', case when c.assigned_to is null then null else community.display_name(c.assigned_to) end,
               'assigned_me', c.assigned_to = v_uid,
               'follow_up_on', c.follow_up_on,
               'follow_up_due', c.follow_up_on is not null and c.follow_up_on <= v_today and c.status <> 'closed',
               'created_at', c.created_at, 'updated_at', c.updated_at)
             order by c.follow_up_on nulls last, c.created_at)
               from prayer.care_requests c
              where case p_filter
                      when 'unassigned' then c.assigned_to is null and c.status <> 'closed'
                      when 'mine' then c.assigned_to = v_uid and c.status <> 'closed'
                      when 'closed' then c.status = 'closed'
                      else c.status <> 'closed' end), '[]'::jsonb),
    'counts', jsonb_build_object(
      'unassigned', (select count(*) from prayer.care_requests where assigned_to is null and status <> 'closed'),
      'mine', (select count(*) from prayer.care_requests where assigned_to = v_uid and status <> 'closed'),
      'due', (select count(*) from prayer.care_requests
               where assigned_to = v_uid and status <> 'closed' and follow_up_on <= v_today)),
    'can_assign', prayer.holds(v_uid, 'care.assign'));
end;
$$;

create function public.care_team_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  c prayer.care_requests;
  p public.profiles;
  v_notes boolean;
begin
  select * into c from prayer.care_requests where id = p_id;
  if not found then
    raise exception 'That care request wasn''t found.' using errcode = 'P0002';
  end if;
  perform prayer.log_access('care_request_viewed', 'care_request', c.id);
  select * into p from public.profiles where id = c.requester_id;
  v_notes := prayer.can_read_notes(c, v_uid);
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'summary', c.summary, 'details', c.details,
    'needed_on', c.needed_on, 'needed_until', c.needed_until,
    'contact_method', c.contact_method, 'contact_note', c.contact_note,
    -- Only the channel the requester chose; never directory-hidden fields.
    'contact', case c.contact_method when 'phone' then p.phone when 'email' then p.email end,
    'requester', community.display_name(c.requester_id),
    'status', c.status, 'closed_reason', c.closed_reason,
    'assigned', case when c.assigned_to is null then null else community.display_name(c.assigned_to) end,
    'assigned_me', c.assigned_to = v_uid,
    'follow_up_on', c.follow_up_on,
    'share_consent', c.share_consent, 'consent_at', c.consent_at,
    'created_at', c.created_at, 'updated_at', c.updated_at, 'closed_at', c.closed_at,
    'can_act', prayer.can_act_on_care(c, v_uid),
    'can_assign', prayer.holds(v_uid, 'care.assign'),
    'can_read_notes', v_notes,
    'messages', prayer.care_messages_json(c.id, v_uid),
    'notes', case when v_notes then coalesce((select jsonb_agg(jsonb_build_object(
                     'id', n.id, 'body', n.body, 'author', community.display_name(n.author_id), 'created_at', n.created_at)
                   order by n.created_at) from prayer.care_notes n where n.care_id = c.id), '[]'::jsonb) end,
    'activity', coalesce((select jsonb_agg(jsonb_build_object(
                    'action', a.action, 'actor', case when a.actor_id is null then null else community.display_name(a.actor_id) end,
                    'detail', a.detail - 'assignee', 'assignee', case when a.detail ? 'assignee' then community.display_name((a.detail ->> 'assignee')::uuid) end,
                    'at', a.created_at) order by a.created_at desc)
                  from (select * from prayer.care_activity where care_id = c.id order by created_at desc limit 100) a), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(prayer.opportunity_card(o, v_uid) || jsonb_build_object(
                         'logistics', o.logistics, 'share_name', o.share_name, 'group_id', o.group_id,
                         'signups', coalesce((select jsonb_agg(jsonb_build_object(
                                       'profile_id', s.profile_id, 'name', community.display_name(s.profile_id),
                                       'status', s.status, 'note', s.note, 'created_at', s.created_at) order by s.created_at)
                                     from prayer.care_signups s where s.opportunity_id = o.id), '[]'::jsonb))
                       order by o.starts_at) from prayer.care_opportunities o where o.care_id = c.id), '[]'::jsonb));
end;
$$;

-- Status and follow-up date. Closing needs a reason. The requester is told
-- the status changed (generic outside the app).
create function public.care_team_update(p_id uuid, p_status text, p_follow_up_on date, p_closed_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  c prayer.care_requests;
begin
  if coalesce(p_status, '') not in ('submitted', 'in_review', 'coordinating', 'fulfilled', 'closed') then
    raise exception 'Choose a status.' using errcode = '22023';
  end if;
  if p_status = 'closed' and coalesce(p_closed_reason, '') not in ('fulfilled', 'resolved', 'declined', 'withdrawn') then
    raise exception 'Choose why the request is closing.' using errcode = '22023';
  end if;
  select * into c from prayer.care_requests where id = p_id for update;
  if not found or not prayer.can_act_on_care(c, v_uid) then
    raise exception 'You can update requests assigned to you or not yet assigned.' using errcode = '42501';
  end if;
  update prayer.care_requests
     set status = p_status::prayer.care_status,
         closed_reason = case when p_status = 'closed' then p_closed_reason end,
         closed_at = case when p_status = 'closed' then coalesce(closed_at, now()) end,
         follow_up_on = p_follow_up_on,
         follow_up_notified_on = case when p_follow_up_on is distinct from follow_up_on then null else follow_up_notified_on end,
         updated_at = now()
   where id = c.id;
  if p_status::prayer.care_status <> c.status then
    perform prayer.care_log(c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', p_status));
    perform community.notify(c.requester_id, 'care_response', null,
      jsonb_build_object('care_request_id', c.id, 'detail', jsonb_build_object('to', 'requester', 'status', p_status)),
      'care_status:' || c.id);
    if p_status = 'closed' then
      update prayer.care_opportunities set status = 'canceled', updated_at = now() where care_id = c.id and status in ('draft', 'open');
    end if;
  end if;
  if p_follow_up_on is distinct from c.follow_up_on then
    perform prayer.care_log(c.id, 'follow_up_set', jsonb_build_object('on', p_follow_up_on));
  end if;
end;
$$;

create function public.care_team_coordinators()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_capability('care.assign');
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', community.display_name(p.id)) order by lower(community.display_name(p.id)))
                     from public.profiles p where prayer.holds(p.id, 'care.coordinate')), '[]'::jsonb);
end;
$$;

create function public.care_team_assign(p_id uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.assign');
  c prayer.care_requests;
begin
  select * into c from prayer.care_requests where id = p_id for update;
  if not found then
    raise exception 'That care request wasn''t found.' using errcode = 'P0002';
  end if;
  if c.status = 'closed' then
    raise exception 'Reopen the request before assigning it.' using errcode = '22023';
  end if;
  if p_assignee is not null and not prayer.holds(p_assignee, 'care.coordinate') then
    raise exception 'Choose a care coordinator.' using errcode = '22023';
  end if;
  if p_assignee is not distinct from c.assigned_to then
    return;
  end if;
  update prayer.care_requests
     set assigned_to = p_assignee,
         status = case when p_assignee is not null and status = 'submitted' then 'in_review'::prayer.care_status else status end,
         updated_at = now()
   where id = c.id;
  perform prayer.care_log(c.id, case when p_assignee is null then 'unassigned' else 'assigned' end,
                          case when p_assignee is null then '{}'::jsonb else jsonb_build_object('assignee', p_assignee) end);
  if p_assignee is not null and p_assignee <> v_uid then
    perform community.notify(p_assignee, 'care_assigned', null, jsonb_build_object('care_request_id', c.id), 'care_assigned:' || c.id);
  end if;
end;
$$;

create function public.care_team_note(p_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  c prayer.care_requests;
  v_id uuid;
begin
  select * into c from prayer.care_requests where id = p_id;
  if not found or not prayer.can_read_notes(c, v_uid) then
    raise exception 'Only the assigned coordinator and care leads can add internal notes.' using errcode = '42501';
  end if;
  perform community.rate_limit(v_uid, 'care_note', 30, interval '15 minutes');
  insert into prayer.care_notes (care_id, author_id, body) values (c.id, v_uid, community.clean_text(p_body, 1, 1000, 'The note'))
  returning id into v_id;
  perform prayer.care_log(c.id, 'note_added');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Volunteer opportunities
-- ---------------------------------------------------------------------------
-- p: {id?, care_id, title, details, starts_at, ends_at, helpers_needed,
--     audience (church|group|team), group_id, logistics, share_name}
create function public.care_opportunity_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_care uuid := nullif(p ->> 'care_id', '')::uuid;
  c prayer.care_requests;
  o prayer.care_opportunities;
  v_audience text := coalesce(p ->> 'audience', 'church');
  v_group uuid := case when p ->> 'audience' = 'group' then nullif(p ->> 'group_id', '')::uuid end;
  v_start timestamptz := nullif(p ->> 'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p ->> 'ends_at', '')::timestamptz;
begin
  if v_id is not null then
    select * into o from prayer.care_opportunities where id = v_id for update;
    if not found then
      raise exception 'That opportunity wasn''t found.' using errcode = 'P0002';
    end if;
    if o.status not in ('draft', 'open') then
      raise exception 'Only draft or open opportunities can be edited.' using errcode = '22023';
    end if;
    v_care := o.care_id;
  end if;
  select * into c from prayer.care_requests where id = v_care;
  if not found or not prayer.can_act_on_care(c, v_uid) then
    raise exception 'You can organize help only for requests assigned to you or not yet assigned.' using errcode = '42501';
  end if;
  if c.status = 'closed' then
    raise exception 'This care request is closed.' using errcode = '22023';
  end if;
  if v_audience not in ('church', 'group', 'team') then
    raise exception 'Choose who can volunteer.' using errcode = '22023';
  end if;
  if v_audience = 'group' and not exists (
       select 1 from community.groups g
        where g.id = v_group and g.status = 'active'
          and (g.visibility = 'discoverable' or community.group_member(g.id, v_uid))) then
    raise exception 'Choose an active group.' using errcode = '22023';
  end if;
  if v_start is null then
    raise exception 'Choose when help is needed.' using errcode = '22023';
  end if;
  if v_end is not null and v_end <= v_start then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into prayer.care_opportunities (care_id, created_by, title, details, starts_at, ends_at, helpers_needed,
                                           audience, group_id, logistics, share_name)
    values (c.id, v_uid, community.clean_text(p ->> 'title', 3, 120, 'The task'),
            community.clean_text(coalesce(p ->> 'details', ''), 0, 600, 'The details'), v_start, v_end,
            coalesce(nullif(p ->> 'helpers_needed', '')::smallint, 1), v_audience, v_group,
            community.clean_text(coalesce(p ->> 'logistics', ''), 0, 1000, 'The logistics'),
            coalesce((p ->> 'share_name')::boolean, false))
    returning id into v_id;
    perform prayer.care_log(c.id, 'opportunity_created');
  else
    update prayer.care_opportunities
       set title = community.clean_text(p ->> 'title', 3, 120, 'The task'),
           details = community.clean_text(coalesce(p ->> 'details', ''), 0, 600, 'The details'),
           starts_at = v_start, ends_at = v_end,
           helpers_needed = coalesce(nullif(p ->> 'helpers_needed', '')::smallint, 1),
           audience = v_audience, group_id = v_group,
           logistics = community.clean_text(coalesce(p ->> 'logistics', ''), 0, 1000, 'The logistics'),
           share_name = coalesce((p ->> 'share_name')::boolean, false),
           updated_at = now()
     where id = v_id
    returning * into o;
    -- An open opportunity can't start sharing details without consent.
    if o.status = 'open' and (o.share_name or o.logistics <> '') and not c.share_consent then
      raise exception 'The requester hasn''t agreed to share their name or logistics with volunteers.' using errcode = '22023';
    end if;
    perform prayer.care_log(c.id, 'opportunity_edited');
  end if;
  return v_id;
end;
$$;

-- Exactly what each group of people would see, before publishing.
create function public.care_opportunity_preview(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  o prayer.care_opportunities;
  c prayer.care_requests;
begin
  select * into o from prayer.care_opportunities where id = p_id;
  select * into c from prayer.care_requests where id = o.care_id;
  if o.id is null or not prayer.can_act_on_care(c, v_uid) then
    raise exception 'That opportunity wasn''t found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'listing', prayer.opportunity_card(o, null) - 'my_status' - 'accepted_count',
    'accepted', prayer.opportunity_private(o),
    'consent', c.share_consent,
    'blocked', (o.share_name or o.logistics <> '') and not c.share_consent,
    'status', o.status);
end;
$$;

create function public.care_opportunity_publish(p_id uuid, p_confirm boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  o prayer.care_opportunities;
  c prayer.care_requests;
begin
  select * into o from prayer.care_opportunities where id = p_id for update;
  select * into c from prayer.care_requests where id = o.care_id;
  if o.id is null or not prayer.can_act_on_care(c, v_uid) then
    raise exception 'That opportunity wasn''t found.' using errcode = 'P0002';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'Review the preview and confirm what will be shared.' using errcode = '22023';
  end if;
  if o.status <> 'draft' then
    raise exception 'This opportunity is already published.' using errcode = '22023';
  end if;
  if c.status = 'closed' then
    raise exception 'This care request is closed.' using errcode = '22023';
  end if;
  if (o.share_name or o.logistics <> '') and not c.share_consent then
    raise exception 'The requester hasn''t agreed to share their name or logistics with volunteers. Remove them or ask the requester first.' using errcode = '22023';
  end if;
  update prayer.care_opportunities set status = 'open', published_at = now(), updated_at = now() where id = o.id;
  perform prayer.care_log(c.id, 'opportunity_published', jsonb_build_object('audience', o.audience, 'share_name', o.share_name,
                                                                            'logistics', o.logistics <> ''));
end;
$$;

create function public.care_opportunity_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  o prayer.care_opportunities;
  c prayer.care_requests;
begin
  if coalesce(p_status, '') not in ('open', 'filled', 'completed', 'canceled') then
    raise exception 'Choose a status.' using errcode = '22023';
  end if;
  select * into o from prayer.care_opportunities where id = p_id for update;
  select * into c from prayer.care_requests where id = o.care_id;
  if o.id is null or not prayer.can_act_on_care(c, v_uid) then
    raise exception 'That opportunity wasn''t found.' using errcode = 'P0002';
  end if;
  if o.status = 'draft' then
    raise exception 'Publish the opportunity first, or delete the draft by canceling it.' using errcode = '22023';
  end if;
  update prayer.care_opportunities set status = p_status, updated_at = now() where id = o.id;
  perform prayer.care_log(c.id, 'opportunity_' || p_status);
end;
$$;

-- Member list: open opportunities in the viewer's audience, plus ones they
-- signed up for. Never request text, notes, contact details, or logistics.
create function public.care_opportunities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  return coalesce((select jsonb_agg(prayer.opportunity_card(o, v_uid) order by o.starts_at)
                     from prayer.care_opportunities o
                     join prayer.care_requests c on c.id = o.care_id
                    where c.requester_id <> v_uid
                      and ((o.status = 'open' and o.starts_at > now() - interval '1 day' and prayer.opportunity_eligible(o, v_uid))
                           or (o.status <> 'draft' and exists (select 1 from prayer.care_signups s
                                                               where s.opportunity_id = o.id and s.profile_id = v_uid
                                                                 and s.status in ('offered', 'accepted', 'completed'))))), '[]'::jsonb);
end;
$$;

create function public.care_opportunity(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  o prayer.care_opportunities;
  c prayer.care_requests;
  v_signup text;
begin
  select * into o from prayer.care_opportunities where id = p_id;
  select * into c from prayer.care_requests where id = o.care_id;
  select status into v_signup from prayer.care_signups where opportunity_id = o.id and profile_id = v_uid;
  if o.id is null or o.status = 'draft' or c.requester_id = v_uid
     or not ((o.status = 'open' and prayer.opportunity_eligible(o, v_uid)) or v_signup in ('offered', 'accepted', 'completed')) then
    raise exception 'That opportunity wasn''t found.' using errcode = 'P0002';
  end if;
  return prayer.opportunity_card(o, v_uid)
      || jsonb_build_object('can_volunteer', o.status = 'open' and prayer.opportunity_eligible(o, v_uid)
                                             and coalesce(v_signup, 'withdrawn') in ('withdrawn', 'declined'))
      || case when v_signup in ('accepted', 'completed') and prayer.opportunity_eligible(o, v_uid)
              then jsonb_build_object('private', prayer.opportunity_private(o)) else '{}'::jsonb end;
end;
$$;

create function public.care_volunteer(p_id uuid, p_on boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  o prayer.care_opportunities;
  c prayer.care_requests;
  v_prev text;
begin
  select * into o from prayer.care_opportunities where id = p_id for update;
  select * into c from prayer.care_requests where id = o.care_id;
  if o.id is null or o.status = 'draft' or c.requester_id = v_uid then
    raise exception 'That opportunity wasn''t found.' using errcode = 'P0002';
  end if;
  select status into v_prev from prayer.care_signups where opportunity_id = o.id and profile_id = v_uid;
  if p_on then
    if o.status <> 'open' or not prayer.opportunity_eligible(o, v_uid) then
      raise exception 'This opportunity isn''t taking volunteers.' using errcode = '22023';
    end if;
    perform community.rate_limit(v_uid, 'care_volunteer', 20, interval '1 hour');
    insert into prayer.care_signups (opportunity_id, profile_id, note)
    values (o.id, v_uid, nullif(community.clean_text(coalesce(p_note, ''), 0, 300, 'Your note'), ''))
    on conflict (opportunity_id, profile_id) do update
      set status = 'offered', note = excluded.note, created_at = now(), decided_at = null, decided_by = null
      where prayer.care_signups.status in ('withdrawn', 'declined');
    perform prayer.care_log(c.id, 'volunteer_offered');
  else
    update prayer.care_signups set status = 'withdrawn', decided_at = now()
     where opportunity_id = o.id and profile_id = v_uid and status in ('offered', 'accepted');
    if found then
      perform prayer.care_log(c.id, 'volunteer_withdrew');
      if v_prev = 'accepted' and o.status = 'filled' then
        update prayer.care_opportunities set status = 'open', updated_at = now() where id = o.id;
      end if;
      if v_prev = 'accepted' and c.assigned_to is not null then
        perform community.notify(c.assigned_to, 'care_response', null,
          jsonb_build_object('care_request_id', c.id, 'detail', jsonb_build_object('to', 'team')), 'care_reply:' || c.id);
      end if;
    end if;
  end if;
end;
$$;

-- accept | decline | complete
create function public.care_signup_decide(p_opportunity uuid, p_profile uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('care.coordinate');
  o prayer.care_opportunities;
  c prayer.care_requests;
  s prayer.care_signups;
  v_accepted integer;
begin
  select * into o from prayer.care_opportunities where id = p_opportunity for update;
  select * into c from prayer.care_requests where id = o.care_id;
  if o.id is null or not prayer.can_act_on_care(c, v_uid) then
    raise exception 'That opportunity wasn''t found.' using errcode = 'P0002';
  end if;
  select * into s from prayer.care_signups where opportunity_id = o.id and profile_id = p_profile for update;
  if not found then
    raise exception 'That volunteer wasn''t found.' using errcode = 'P0002';
  end if;
  select count(*) into v_accepted from prayer.care_signups where opportunity_id = o.id and status in ('accepted', 'completed');
  case p_action
    when 'accept' then
      if s.status <> 'offered' then
        raise exception 'Only new offers can be accepted.' using errcode = '22023';
      end if;
      if o.status <> 'open' or v_accepted >= o.helpers_needed then
        raise exception 'This opportunity already has enough helpers.' using errcode = '22023';
      end if;
      if not prayer.opportunity_eligible(o, p_profile) then
        raise exception 'This volunteer is no longer eligible.' using errcode = '22023';
      end if;
      update prayer.care_signups set status = 'accepted', decided_at = now(), decided_by = v_uid
       where opportunity_id = o.id and profile_id = p_profile;
      if v_accepted + 1 >= o.helpers_needed then
        update prayer.care_opportunities set status = 'filled', updated_at = now() where id = o.id;
      end if;
      perform community.notify(p_profile, 'care_volunteer', null, jsonb_build_object('care_opportunity_id', o.id), 'care_volunteer:' || o.id);
    when 'decline' then
      if s.status not in ('offered', 'accepted') then
        raise exception 'That offer can''t be declined.' using errcode = '22023';
      end if;
      update prayer.care_signups set status = 'declined', decided_at = now(), decided_by = v_uid
       where opportunity_id = o.id and profile_id = p_profile;
      if s.status = 'accepted' and o.status = 'filled' then
        update prayer.care_opportunities set status = 'open', updated_at = now() where id = o.id;
      end if;
    when 'complete' then
      if s.status <> 'accepted' then
        raise exception 'Only accepted volunteers can be marked complete.' using errcode = '22023';
      end if;
      update prayer.care_signups set status = 'completed', completed_at = now()
       where opportunity_id = o.id and profile_id = p_profile;
    else
      raise exception 'Unknown action.' using errcode = '22023';
  end case;
  perform prayer.care_log(c.id, 'volunteer_' || case p_action when 'accept' then 'accepted' when 'decline' then 'declined' else 'completed' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema prayer from public, anon, authenticated;

revoke execute on function
  public.care_request_create(text, text, text, date, date, text, text, boolean, uuid), public.care_my_requests(),
  public.care_request(uuid), public.care_message(uuid, text), public.care_request_withdraw(uuid), public.care_set_consent(uuid, boolean),
  public.care_team_queue(text), public.care_team_request(uuid), public.care_team_update(uuid, text, date, text),
  public.care_team_coordinators(), public.care_team_assign(uuid, uuid), public.care_team_note(uuid, text),
  public.care_opportunity_save(jsonb), public.care_opportunity_preview(uuid), public.care_opportunity_publish(uuid, boolean),
  public.care_opportunity_status(uuid, text), public.care_opportunities(), public.care_opportunity(uuid),
  public.care_volunteer(uuid, boolean, text), public.care_signup_decide(uuid, uuid, text)
from public, anon;

grant execute on function
  public.care_request_create(text, text, text, date, date, text, text, boolean, uuid), public.care_my_requests(),
  public.care_request(uuid), public.care_message(uuid, text), public.care_request_withdraw(uuid), public.care_set_consent(uuid, boolean),
  public.care_team_queue(text), public.care_team_request(uuid), public.care_team_update(uuid, text, date, text),
  public.care_team_coordinators(), public.care_team_assign(uuid, uuid), public.care_team_note(uuid, text),
  public.care_opportunity_save(jsonb), public.care_opportunity_preview(uuid), public.care_opportunity_publish(uuid, boolean),
  public.care_opportunity_status(uuid, text), public.care_opportunities(), public.care_opportunity(uuid),
  public.care_volunteer(uuid, boolean, text), public.care_signup_decide(uuid, uuid, text)
to authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261024000400', 'prayer_care', 'phase-6');

commit;
