-- Phase 10 · Youth groups, leaders, enrollment, and youth events with
-- versioned permission forms, per-child registration, and restricted
-- logistics. Events stay in the Phase 4 events system: a youth event is an
-- ordinary series with audience 'youth' plus youth.event_settings.
--
-- Rules
--   * Leaders see only their assigned groups. A group keeps at least one
--     active leader until it is archived (trigger, advisory lock).
--   * Rosters (child display names, participation, consent status) go only
--     to the group's leaders and youth administrators; never contact
--     details, birth dates, or logistics.
--   * Registration is per child, by a verified guardian allowed to register
--     (or the independent youth when the policy and event allow it and the
--     event needs no forms or logistics). The occurrence row is locked for
--     every capacity decision; a new registrant never jumps the waitlist.
--   * A required form is satisfied only by a granted decision for its
--     current published version, or for an earlier version when every later
--     version was published as non-material, made by a guardian who is
--     still verified and allowed to sign forms. Declining or withdrawing
--     cancels the child's upcoming registrations for that event.
--   * Logistics (emergency contact, pickup notes, optional accommodation
--     notes) are visible only to designated personnel of that event, and
--     each viewing is logged without values.

-- ---------------------------------------------------------------------------
-- Groups and leaders (youth.manage)
-- ---------------------------------------------------------------------------
create function youth.guard_last_leader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid := coalesce(old.group_id, new.group_id);
begin
  perform pg_advisory_xact_lock(hashtext('youth.leaders:' || v_group::text));
  if old.status = 'active' and old.role = 'leader'
     and (tg_op = 'DELETE' or new.status <> 'active' or new.role <> 'leader')
     and exists (select 1 from youth.groups g where g.id = v_group and g.status = 'active')
     and not exists (select 1 from youth.group_leaders l
                      where l.group_id = v_group and l.profile_id <> old.profile_id and l.status = 'active' and l.role = 'leader') then
    raise exception 'This group needs at least one leader. Assign another leader first, or archive the group.' using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger group_leaders_keep_one
  before update of status, role or delete on youth.group_leaders
  for each row execute function youth.guard_last_leader();

create function public.youth_admin_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_capability('youth.manage') or public.has_capability('youth.enroll') or public.has_capability('youth.publish')) then
    perform youth.require_cap('youth.manage');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'id', g.id, 'name', g.name, 'description', g.description, 'status', g.status,
            'leaders', (select count(*) from youth.group_leaders l where l.group_id = g.id and l.status = 'active'),
            'enrolled', (select count(*) from youth.enrollments e where e.group_id = g.id and e.status = 'active'))
          order by g.status, lower(g.name))
     from youth.groups g), '[]'::jsonb);
end;
$$;

create function public.youth_admin_group_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.manage');
  g youth.groups;
begin
  if btrim(coalesce(p ->> 'name', '')) = '' or char_length(btrim(p ->> 'name')) > 80 or char_length(coalesce(p ->> 'description', '')) > 1000 then
    raise exception 'Enter a group name (80 characters or fewer).' using errcode = '22023';
  end if;
  if p_id is null then
    insert into youth.groups (name, description, created_by) values (btrim(p ->> 'name'), coalesce(p ->> 'description', ''), v_uid)
    returning * into g;
    perform youth.audit('youth.group_created', 'youth_group', g.id);
  else
    update youth.groups set name = btrim(p ->> 'name'), description = coalesce(p ->> 'description', '')
     where id = p_id and status = 'active'
    returning * into g;
    if g.id is null then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
    perform youth.audit('youth.group_updated', 'youth_group', g.id, jsonb_build_object('fields', array['name', 'description']));
  end if;
  return jsonb_build_object('id', g.id);
end;
$$;

-- Archiving keeps history, locks discussions, and stops new registrations.
create function public.youth_admin_group_archive(p_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.manage');
begin
  if p_on then
    update youth.groups set status = 'archived', archived_at = now() where id = p_id and status = 'active';
    update youth.discussions set status = 'locked' where group_id = p_id and status = 'open';
  else
    if not exists (select 1 from youth.group_leaders l where l.group_id = p_id and l.status = 'active' and l.role = 'leader') then
      raise exception 'Assign a leader before restoring the group.' using errcode = '22023';
    end if;
    update youth.groups set status = 'active', archived_at = null where id = p_id and status = 'archived';
  end if;
  if not found then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform youth.audit(case when p_on then 'youth.group_archived' else 'youth.group_restored' end, 'youth_group', p_id);
end;
$$;

-- Roster for youth administrators and the group's own leaders.
create function public.youth_group_roster(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  g youth.groups;
begin
  select * into g from youth.groups where id = p_group;
  if g.id is null or not (youth.is_leader(g.id, v_uid) or public.has_capability('youth.manage') or public.has_capability('youth.enroll')) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', g.id, 'name', g.name, 'description', g.description, 'status', g.status,
    'my_role', (select jsonb_build_object('role', l.role, 'can_publish', l.can_publish, 'can_manage_enrollment', l.can_manage_enrollment)
                  from youth.group_leaders l where l.group_id = g.id and l.profile_id = v_uid and l.status = 'active'),
    'leaders', coalesce((select jsonb_agg(jsonb_build_object('profile_id', l.profile_id, 'name', community.display_name(l.profile_id),
                                                           'role', l.role, 'can_publish', l.can_publish,
                                                           'can_manage_enrollment', l.can_manage_enrollment,
                                                           'effective', youth.is_leader(g.id, l.profile_id))
                                         order by l.role, community.display_name(l.profile_id))
                          from youth.group_leaders l where l.group_id = g.id and l.status = 'active'), '[]'::jsonb),
    -- Display names and participation only: no contact details, birth
    -- dates, guardians' identities, or logistics.
    'members', coalesce((select jsonb_agg(jsonb_build_object('child_id', c.id, 'display_name', c.display_name,
                                                           'participation', c.participation,
                                                           'has_account', c.account_id is not null and youth.is_active_youth(c.account_id),
                                                           'paused', c.restricted_at is not null)
                                         order by lower(c.display_name))
                          from youth.enrollments e join youth.children c on c.id = e.child_id
                         where e.group_id = g.id and e.status = 'active' and c.status = 'active'), '[]'::jsonb));
end;
$$;

-- Approved adults holding youth.lead (names only), for leader assignment.
create function public.youth_admin_leader_candidates(p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform youth.require_cap('youth.manage');
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by lower(x.name)) from (
    select p.id, community.display_name(p.id) as name from public.profiles p
     where youth.holds(p.id, 'youth.lead')
       and (v_q is null or community.display_name(p.id) ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     limit 50) x), '[]'::jsonb);
end;
$$;

-- {role, can_publish, can_manage_enrollment, status: active|removed}
create function public.youth_admin_leader_set(p_group uuid, p_profile uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.manage');
  v_status text := coalesce(p ->> 'status', 'active');
  v_role text := coalesce(p ->> 'role', 'leader');
begin
  if v_status not in ('active', 'removed') or v_role not in ('leader', 'helper') then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  if not exists (select 1 from youth.groups where id = p_group and status = 'active') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if v_status = 'active' and not youth.holds(p_profile, 'youth.lead') then
    raise exception 'Give this person the Youth leader role first (Administration → Members).' using errcode = '22023';
  end if;
  if v_status = 'active' then
    insert into youth.group_leaders (group_id, profile_id, role, can_publish, can_manage_enrollment, added_by)
    values (p_group, p_profile, v_role, coalesce((p ->> 'can_publish')::boolean, false),
            coalesce((p ->> 'can_manage_enrollment')::boolean, false), v_uid)
    on conflict (group_id, profile_id) do update
      set role = excluded.role, can_publish = excluded.can_publish, can_manage_enrollment = excluded.can_manage_enrollment,
          status = 'active', removed_at = null, removed_by = null;
  else
    update youth.group_leaders set status = 'removed', removed_at = now(), removed_by = v_uid
     where group_id = p_group and profile_id = p_profile and status = 'active';
  end if;
  perform youth.audit('youth.leader_' || case when v_status = 'active' then 'set' else 'removed' end, 'youth_group', p_group,
                      jsonb_build_object('profile', p_profile, 'role', v_role,
                                         'can_publish', coalesce((p ->> 'can_publish')::boolean, false),
                                         'can_manage_enrollment', coalesce((p ->> 'can_manage_enrollment')::boolean, false)));
  perform youth.after_leader_change(p_profile);
end;
$$;

-- Replaced in the notifications migration.
create function youth.after_leader_change(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enrollment (youth.enroll, or a leader allowed to manage enrollment)
-- ---------------------------------------------------------------------------
create function youth.may_enroll(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_capability('youth.enroll') or youth.leader_may(p_group, p_profile, 'enroll');
$$;

create function public.youth_enroll_candidates(p_group uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not youth.may_enroll(p_group, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'display_name', c.display_name) order by lower(c.display_name))
     from (select * from youth.children c
            where c.status = 'active' and c.restricted_at is null
              and c.display_name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
              and not youth.enrolled(p_group, c.id)
            order by lower(c.display_name) limit 20) c), '[]'::jsonb);
end;
$$;

create function public.youth_enroll(p_group uuid, p_child uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  if not youth.may_enroll(p_group, v_uid) or not exists (select 1 from youth.groups where id = p_group and status = 'active') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if not youth.child_active(p_child) then
    raise exception 'That child profile isn''t available.' using errcode = '22023';
  end if;
  insert into youth.enrollments (group_id, child_id, enrolled_by) values (p_group, p_child, v_uid)
  on conflict (group_id, child_id) do update set status = 'active', enrolled_by = excluded.enrolled_by, enrolled_at = now(),
                                                 ended_at = null, ended_by = null;
  perform youth.family_event(p_child, null, 'group.enrolled');
  perform youth.audit('youth.enrolled', 'youth_group', p_group, jsonb_build_object('child', p_child));
end;
$$;

-- Ends an enrollment (staff/leader: removed; a guardian allowed to manage the
-- profile: left). Upcoming registrations for that group's events are canceled.
create function public.youth_unenroll(p_group uuid, p_child uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_guardian boolean := youth.guardian_can(p_child, v_uid, 'manage_profile');
begin
  if not (youth.may_enroll(p_group, v_uid) or v_guardian) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  update youth.enrollments set status = case when v_guardian then 'left' else 'removed' end, ended_at = now(), ended_by = v_uid
   where group_id = p_group and child_id = p_child and status = 'active';
  if not found then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform youth.cancel_group_registrations(p_group, p_child);
  perform youth.family_event(p_child, null, 'group.' || case when v_guardian then 'left' else 'removed' end);
  perform youth.audit('youth.unenrolled', 'youth_group', p_group, jsonb_build_object('child', p_child));
  perform youth.after_access_change(p_child);
end;
$$;

-- ---------------------------------------------------------------------------
-- Forms (youth.forms)
-- ---------------------------------------------------------------------------
create function youth.current_version(p_form uuid)
returns youth.form_versions
language sql
stable
security definer
set search_path = ''
as $$
  select * from youth.form_versions v where v.form_id = p_form and v.status = 'published' order by v.version desc limit 1;
$$;

create function public.youth_admin_forms()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform youth.require_cap('youth.forms');
  return coalesce((select jsonb_agg(jsonb_build_object(
            'id', f.id, 'title', f.title, 'status', f.status, 'updated_at', f.updated_at,
            'current_version', (youth.current_version(f.id)).version,
            'events', (select count(*) from youth.event_forms ef where ef.form_id = f.id),
            'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status, 'material', v.material,
                                                                    'body', v.body, 'statement', v.statement, 'change_summary', v.change_summary,
                                                                    'published_at', v.published_at) order by v.version desc)
                                   from youth.form_versions v where v.form_id = f.id), '[]'::jsonb))
          order by f.status, lower(f.title))
     from youth.forms f), '[]'::jsonb);
end;
$$;

create function public.youth_admin_form_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.forms');
  f youth.forms;
begin
  if btrim(coalesce(p ->> 'title', '')) = '' or char_length(btrim(p ->> 'title')) > 160 then
    raise exception 'Give the form a title.' using errcode = '22023';
  end if;
  if coalesce(p ->> 'status', 'active') not in ('active', 'archived') then
    raise exception 'Choose a status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into youth.forms (title, created_by) values (btrim(p ->> 'title'), v_uid) returning * into f;
  else
    update youth.forms set title = btrim(p ->> 'title'), status = coalesce(p ->> 'status', status) where id = p_id returning * into f;
    if f.id is null then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
  end if;
  perform youth.audit('youth.form_saved', 'youth_form', f.id);
  return jsonb_build_object('id', f.id);
end;
$$;

-- Saves the form's single draft version: {body, statement, material, change_summary}.
create function public.youth_admin_form_draft(p_form uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.forms');
  v youth.form_versions;
begin
  if btrim(coalesce(p ->> 'body', '')) = '' or btrim(coalesce(p ->> 'statement', '')) = '' then
    raise exception 'Enter the form text and the statement guardians agree to.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('youth.form:' || p_form::text));
  if not exists (select 1 from youth.forms where id = p_form) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  update youth.form_versions
     set body = p ->> 'body', statement = btrim(p ->> 'statement'),
         material = coalesce((p ->> 'material')::boolean, true), change_summary = coalesce(p ->> 'change_summary', '')
   where form_id = p_form and status = 'draft'
  returning * into v;
  if v.id is null then
    insert into youth.form_versions (form_id, version, body, statement, material, change_summary, created_by)
    values (p_form, coalesce((select max(version) from youth.form_versions where form_id = p_form), 0) + 1, p ->> 'body',
            btrim(p ->> 'statement'),
            -- The first version is always material.
            coalesce((p ->> 'material')::boolean, true) or not exists (select 1 from youth.form_versions where form_id = p_form),
            coalesce(p ->> 'change_summary', ''), v_uid)
    returning * into v;
  end if;
  return jsonb_build_object('id', v.id, 'version', v.version);
end;
$$;

-- Publishing never changes an earlier version. A material version means
-- guardians of registered children must decide again; they are told so.
create function public.youth_admin_form_publish(p_version uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.forms');
  v youth.form_versions;
  v_affected integer := 0;
  r record;
begin
  select * into v from youth.form_versions where id = p_version for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'Only a draft version can be published.' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> 'publish' then
    raise exception 'Type "publish" to confirm.' using errcode = '22023';
  end if;
  if v.version = 1 and not v.material then
    update youth.form_versions set material = true where id = v.id;
  end if;
  update youth.form_versions set status = 'published', published_by = v_uid, published_at = now() where id = v.id returning * into v;
  if v.material and v.version > 1 then
    for r in
      select distinct reg.child_id, ef.series_id
        from youth.event_forms ef
        join events.occurrences o on o.series_id = ef.series_id and o.ends_at > now()
        join youth.registrations reg on reg.occurrence_id = o.id and reg.status <> 'canceled'
       where ef.form_id = v.form_id
    loop
      v_affected := v_affected + 1;
      perform youth.notify(g.guardian_id, 'youth_form_needed',
                           jsonb_build_object('youth_child_id', r.child_id, 'series_id', r.series_id),
                           'youth_form:' || v.id || ':' || r.child_id)
         from youth.guardianships g where g.child_id = r.child_id and g.status = 'verified' and g.can_sign_forms;
    end loop;
  end if;
  perform youth.audit('youth.form_published', 'youth_form', v.form_id, jsonb_build_object('version', v.version, 'material', v.material));
  return jsonb_build_object('version', v.version, 'material', v.material, 'renewals_needed', v_affected);
end;
$$;

-- The text of one published version (anyone with a youth relationship may read it).
create function public.youth_form_version(p_version uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v youth.form_versions;
begin
  if v_uid is null or not (youth.is_adult(v_uid) or youth.is_active_youth(v_uid)) then
    raise exception 'Only approved members can do that.' using errcode = '42501';
  end if;
  select * into v from youth.form_versions where id = p_version and status = 'published';
  if v.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v.id, 'form_id', v.form_id, 'title', (select title from youth.forms where id = v.form_id),
                            'version', v.version, 'body', v.body, 'statement', v.statement, 'published_at', v.published_at,
                            'change_summary', v.change_summary);
end;
$$;

-- needed | granted | declined | withdrawn | renewal_needed
create function youth.consent_state(p_series uuid, p_child uuid, p_form uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cv youth.form_versions := youth.current_version(p_form);
  d youth.consents;
  dv integer;
begin
  if cv.id is null then
    return 'needed';
  end if;
  select * into d from youth.consents c where c.series_id = p_series and c.child_id = p_child and c.form_id = p_form
   order by c.decided_at desc, c.id desc limit 1;
  if d.id is null then
    return 'needed';
  end if;
  if d.withdrawn_at is not null then
    return 'withdrawn';
  end if;
  -- The deciding guardian must still be verified and allowed to sign.
  if d.guardian_id is null or not youth.guardian_can(p_child, d.guardian_id, 'sign_forms') then
    return 'needed';
  end if;
  if d.decision = 'declined' then
    return 'declined';
  end if;
  select version into dv from youth.form_versions where id = d.form_version_id;
  if exists (select 1 from youth.form_versions v where v.form_id = p_form and v.status = 'published' and v.version > dv and v.material) then
    return 'renewal_needed';
  end if;
  return 'granted';
end;
$$;

create function youth.consents_ok(p_series uuid, p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from youth.event_forms ef where ef.series_id = p_series
                      and youth.consent_state(p_series, p_child, ef.form_id) <> 'granted');
$$;

create function youth.forms_json(p_series uuid, p_child uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'form_id', f.id, 'title', f.title, 'version_id', (youth.current_version(f.id)).id,
           'version', (youth.current_version(f.id)).version, 'state', youth.consent_state(p_series, p_child, f.id),
           'consent_id', (select c.id from youth.consents c where c.series_id = p_series and c.child_id = p_child and c.form_id = f.id
                           and c.withdrawn_at is null order by c.decided_at desc limit 1)) order by f.title), '[]'::jsonb)
    from youth.event_forms ef join youth.forms f on f.id = ef.form_id
   where ef.series_id = p_series;
$$;

create or replace function youth.outstanding_forms(p_child uuid, p_guardian uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when not youth.guardian_can(p_child, p_guardian, 'sign_forms') then 0 else
    (select count(*)::integer from (
       select distinct ef.series_id, ef.form_id
         from youth.registrations r
         join events.occurrences o on o.id = r.occurrence_id and o.ends_at > now()
         join youth.event_forms ef on ef.series_id = o.series_id
        where r.child_id = p_child and r.status <> 'canceled'
          and youth.consent_state(ef.series_id, p_child, ef.form_id) <> 'granted') x) end;
$$;

-- ---------------------------------------------------------------------------
-- Youth event setup (youth.forms or youth.manage)
-- ---------------------------------------------------------------------------
create function youth.require_event_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  if not (public.has_capability('youth.forms') or public.has_capability('youth.manage')) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function public.youth_admin_events()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform youth.require_event_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
            'series_id', s.id, 'title', s.title, 'status', s.status, 'audience', s.audience, 'start_date', s.start_date,
            'youth', es.series_id is not null, 'group', (select g.name from youth.groups g where g.id = es.group_id),
            'forms', (select count(*) from youth.event_forms ef where ef.series_id = s.id),
            'next', (select min(o.starts_at) from events.occurrences o where o.series_id = s.id and o.ends_at > now() and o.status = 'scheduled'))
          order by es.series_id is null, s.start_date desc)
     from events.series s left join youth.event_settings es on es.series_id = s.id
    where s.status <> 'archived' and (s.audience::text = 'youth' or s.status = 'draft')), '[]'::jsonb);
end;
$$;

-- Makes an event youth-only for one group, or updates its youth settings:
-- {group_id, youth_rsvp, collect_emergency_contact, collect_pickup, collect_accommodation, form_ids: [...]}.
create function public.youth_admin_event_set(p_series uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_event_admin();
  s events.series;
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_form uuid;
begin
  select * into s from events.series where id = p_series for update;
  if s.id is null or s.status = 'archived' then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from youth.groups where id = v_group and status = 'active') then
    raise exception 'Choose an active youth group.' using errcode = '22023';
  end if;
  if s.audience::text <> 'youth' then
    if s.status <> 'draft' then
      raise exception 'Only a draft event can be made youth-only.' using errcode = '22023';
    end if;
    if exists (select 1 from events.registrations r join events.occurrences o on o.id = r.occurrence_id
                where o.series_id = s.id and r.status <> 'canceled') then
      raise exception 'This event already has member registrations.' using errcode = '22023';
    end if;
    perform set_config('youth.context', 'on', true);
    update events.series set audience = 'youth', group_id = null where id = s.id;
    perform set_config('youth.context', '', true);
  end if;
  insert into youth.event_settings (series_id, group_id, youth_rsvp, collect_emergency_contact, collect_pickup, collect_accommodation, updated_by)
  values (s.id, v_group, coalesce((p ->> 'youth_rsvp')::boolean, false), coalesce((p ->> 'collect_emergency_contact')::boolean, false),
          coalesce((p ->> 'collect_pickup')::boolean, false), coalesce((p ->> 'collect_accommodation')::boolean, false), v_uid)
  on conflict (series_id) do update
    set group_id = excluded.group_id, youth_rsvp = excluded.youth_rsvp, collect_emergency_contact = excluded.collect_emergency_contact,
        collect_pickup = excluded.collect_pickup, collect_accommodation = excluded.collect_accommodation,
        updated_by = excluded.updated_by, updated_at = now();
  if p ? 'form_ids' then
    for v_form in select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'form_ids') x loop
      if (youth.current_version(v_form)).id is null or not exists (select 1 from youth.forms where id = v_form and status = 'active') then
        raise exception 'Only active forms with a published version can be required.' using errcode = '22023';
      end if;
    end loop;
    delete from youth.event_forms where series_id = s.id
       and form_id not in (select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'form_ids') x);
    insert into youth.event_forms (series_id, form_id, added_by)
    select s.id, (x #>> '{}')::uuid, v_uid from jsonb_array_elements(p -> 'form_ids') x
    on conflict do nothing;
  end if;
  perform youth.audit('youth.event_configured', 'event_series', s.id,
                      jsonb_build_object('fields', array['group_id', 'youth_rsvp', 'collect_emergency_contact', 'collect_pickup',
                                                         'collect_accommodation', 'form_ids']));
end;
$$;

-- Back to a members event (drafts only, and only without child registrations).
create function public.youth_admin_event_unset(p_series uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_event_admin();
begin
  if not exists (select 1 from events.series where id = p_series and status = 'draft' and audience::text = 'youth') then
    raise exception 'Only a draft youth event can be changed back.' using errcode = '22023';
  end if;
  if exists (select 1 from youth.registrations r join events.occurrences o on o.id = r.occurrence_id where o.series_id = p_series) then
    raise exception 'This event has child registrations.' using errcode = '22023';
  end if;
  perform set_config('youth.context', 'on', true);
  update events.series set audience = 'members' where id = p_series;
  perform set_config('youth.context', '', true);
  delete from youth.event_forms where series_id = p_series;
  delete from youth.event_personnel where series_id = p_series;
  delete from youth.event_settings where series_id = p_series;
  perform youth.audit('youth.event_unconfigured', 'event_series', p_series);
end;
$$;

-- Designated personnel: a leader of the event's group or a youth.logistics holder.
create function public.youth_admin_personnel_set(p_series uuid, p_profile uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_event_admin();
  es youth.event_settings;
begin
  select * into es from youth.event_settings where series_id = p_series;
  if es.series_id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_on then
    if not (youth.holds(p_profile, 'youth.logistics') or youth.is_leader(es.group_id, p_profile)) then
      raise exception 'Event personnel must lead this group or hold the Youth event logistics role.' using errcode = '22023';
    end if;
    insert into youth.event_personnel (series_id, profile_id, granted_by) values (p_series, p_profile, v_uid) on conflict do nothing;
  else
    delete from youth.event_personnel where series_id = p_series and profile_id = p_profile;
  end if;
  perform youth.audit('youth.personnel_' || case when p_on then 'added' else 'removed' end, 'event_series', p_series,
                      jsonb_build_object('profile', p_profile));
end;
$$;

-- Candidates for personnel: the group's leaders and logistics role holders.
create function public.youth_admin_personnel_candidates(p_series uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  es youth.event_settings;
begin
  perform youth.require_event_admin();
  select * into es from youth.event_settings where series_id = p_series;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', community.display_name(p.id),
                                                     'designated', exists (select 1 from youth.event_personnel ep where ep.series_id = p_series and ep.profile_id = p.id))
                                   order by community.display_name(p.id))
     from public.profiles p
    where youth.holds(p.id, 'youth.logistics') or youth.is_leader(es.group_id, p.id)), '[]'::jsonb);
end;
$$;

-- Organizer view: settings, personnel, and per-occurrence attendee lists
-- with consent status (never logistics values). For youth event admins, the
-- group's leaders, and designated personnel.
create function public.youth_event_admin(p_series uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  s events.series;
  es youth.event_settings;
  v_admin boolean := public.has_capability('youth.forms') or public.has_capability('youth.manage');
begin
  select * into s from events.series where id = p_series;
  select * into es from youth.event_settings where series_id = p_series;
  if s.id is null or not (v_admin or (es.series_id is not null and (youth.is_leader(es.group_id, v_uid)
                                      or exists (select 1 from youth.event_personnel ep where ep.series_id = s.id and ep.profile_id = v_uid)))) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'series_id', s.id, 'title', s.title, 'status', s.status, 'audience', s.audience, 'timezone', s.timezone,
    'rsvp_enabled', s.rsvp_enabled, 'capacity', s.capacity, 'waitlist_enabled', s.waitlist_enabled, 'rsvp_close_minutes', s.rsvp_close_minutes,
    'can_configure', v_admin,
    'settings', case when es.series_id is not null then jsonb_build_object(
                  'group_id', es.group_id, 'group', (select name from youth.groups where id = es.group_id), 'youth_rsvp', es.youth_rsvp,
                  'collect_emergency_contact', es.collect_emergency_contact, 'collect_pickup', es.collect_pickup,
                  'collect_accommodation', es.collect_accommodation) end,
    'forms', coalesce((select jsonb_agg(jsonb_build_object('form_id', f.id, 'title', f.title, 'version', (youth.current_version(f.id)).version) order by f.title)
                        from youth.event_forms ef join youth.forms f on f.id = ef.form_id where ef.series_id = s.id), '[]'::jsonb),
    'personnel', coalesce((select jsonb_agg(jsonb_build_object('profile_id', ep.profile_id, 'name', community.display_name(ep.profile_id)))
                            from youth.event_personnel ep where ep.series_id = s.id), '[]'::jsonb),
    'i_am_personnel', exists (select 1 from youth.event_personnel ep where ep.series_id = s.id and ep.profile_id = v_uid),
    'occurrences', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'status', o.status,
        'confirmed', (select count(*) from youth.registrations r where r.occurrence_id = o.id and r.status = 'confirmed'),
        'waitlisted', (select count(*) from youth.registrations r where r.occurrence_id = o.id and r.status = 'waitlisted'),
        'attendees', coalesce((select jsonb_agg(jsonb_build_object(
                         'child_id', c.id, 'display_name', c.display_name, 'status', r.status, 'source', r.source,
                         'forms', youth.forms_json(s.id, c.id),
                         'consent_ok', youth.consents_ok(s.id, c.id),
                         'logistics_on_file', exists (select 1 from youth.logistics l where l.series_id = s.id and l.child_id = c.id))
                       order by r.status, r.queued_at, r.id)
                     from youth.registrations r join youth.children c on c.id = r.child_id
                    where r.occurrence_id = o.id and r.status <> 'canceled'), '[]'::jsonb))
      order by o.starts_at)
      from events.occurrences o where o.series_id = s.id and o.ends_at > now() - interval '1 day'), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
create function youth.child_may_attend(p_series uuid, p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select youth.child_active(p_child)
     and exists (select 1 from youth.children c where c.id = p_child and c.participation = 'active')
     and exists (select 1 from youth.event_settings es where es.series_id = p_series and youth.enrolled(es.group_id, p_child));
$$;

-- Fills open places from the waitlist in order; anyone no longer eligible is
-- canceled as ineligible.
create function youth.promote(p_occurrence uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o events.occurrences;
  s events.series;
  r youth.registrations;
  v_confirmed integer;
  v_n integer := 0;
begin
  select * into o from events.occurrences where id = p_occurrence for update;
  select * into s from events.series where id = o.series_id;
  if o.status <> 'scheduled' or s.status <> 'published' or o.starts_at <= now() then
    return 0;
  end if;
  loop
    select count(*) into v_confirmed from youth.registrations where occurrence_id = o.id and status = 'confirmed';
    exit when s.capacity is not null and v_confirmed >= s.capacity;
    select * into r from youth.registrations where occurrence_id = o.id and status = 'waitlisted'
     order by queued_at, id limit 1 for update;
    exit when r.id is null;
    if youth.child_may_attend(s.id, r.child_id) and youth.consents_ok(s.id, r.child_id) then
      update youth.registrations set status = 'confirmed', confirmed_at = now(), updated_at = now() where id = r.id;
      v_n := v_n + 1;
      perform youth.notify(g.guardian_id, 'youth_registration',
                           jsonb_build_object('youth_child_id', r.child_id, 'occurrence_id', o.id, 'detail', jsonb_build_object('change', 'promoted')),
                           'youth_reg:' || r.id || ':promoted')
         from youth.guardianships g where g.child_id = r.child_id and g.status = 'verified' and (g.can_register or g.can_receive_updates);
    else
      update youth.registrations set status = 'canceled', canceled_at = now(), cancel_reason = 'ineligible', updated_at = now() where id = r.id;
    end if;
  end loop;
  return v_n;
end;
$$;

create function youth.cancel_registration(r youth.registrations, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was text := r.status;
begin
  update youth.registrations set status = 'canceled', canceled_at = now(), cancel_reason = p_reason, updated_at = now()
   where id = r.id and status <> 'canceled';
  if v_was = 'confirmed' then
    perform youth.promote(r.occurrence_id);
  end if;
end;
$$;

create function youth.cancel_group_registrations(p_group uuid, p_child uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r youth.registrations;
begin
  for r in
    select reg.* from youth.registrations reg
      join events.occurrences o on o.id = reg.occurrence_id and o.ends_at > now()
      join youth.event_settings es on es.series_id = o.series_id and es.group_id = p_group
     where reg.child_id = p_child and reg.status <> 'canceled'
  loop
    perform youth.cancel_registration(r, 'ineligible');
  end loop;
end;
$$;

create function youth.register(p_occurrence uuid, p_child uuid, p_source text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o events.occurrences;
  s events.series;
  es youth.event_settings;
  r youth.registrations;
  v_confirmed integer;
  v_waiting boolean;
  v_status text;
begin
  -- Every capacity decision for an occurrence is serialized on its row.
  select * into o from events.occurrences where id = p_occurrence for update;
  select * into s from events.series where id = o.series_id;
  select * into es from youth.event_settings where series_id = s.id;
  if o.id is null or es.series_id is null or not events.is_live(s.status, s.publish_at) or not youth.child_may_attend(s.id, p_child) then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  if s.status <> 'published' or o.status <> 'scheduled' then
    raise exception 'This event has been canceled.' using errcode = '22023';
  end if;
  if not s.rsvp_enabled then
    raise exception 'This event doesn''t take registrations.' using errcode = '22023';
  end if;
  if now() >= o.starts_at - make_interval(mins => coalesce(s.rsvp_close_minutes, 0)) then
    raise exception 'Registration for this event has closed.' using errcode = '22023';
  end if;
  if not youth.consents_ok(s.id, p_child) then
    raise exception 'Complete the permission form for this event first.' using errcode = '22023';
  end if;
  if es.collect_emergency_contact and not exists (
       select 1 from youth.logistics l where l.series_id = s.id and l.child_id = p_child
          and btrim(coalesce(l.emergency_name, '')) <> '' and btrim(coalesce(l.emergency_phone, '')) <> '') then
    raise exception 'Add an emergency contact for this event first.' using errcode = '22023';
  end if;
  select * into r from youth.registrations where occurrence_id = o.id and child_id = p_child for update;
  if r.id is not null and r.status <> 'canceled' then
    return jsonb_build_object('status', r.status, 'already', true);
  end if;
  select count(*) into v_confirmed from youth.registrations where occurrence_id = o.id and status = 'confirmed';
  select exists (select 1 from youth.registrations where occurrence_id = o.id and status = 'waitlisted') into v_waiting;
  if s.capacity is null or (v_confirmed < s.capacity and not v_waiting) then
    v_status := 'confirmed';
  elsif s.waitlist_enabled then
    v_status := 'waitlisted';
  else
    raise exception 'This event is full.' using errcode = '22023';
  end if;
  insert into youth.registrations (occurrence_id, child_id, status, source, registered_by, queued_at, confirmed_at)
  values (o.id, p_child, v_status, p_source, p_actor, clock_timestamp(), case when v_status = 'confirmed' then now() end)
  on conflict (occurrence_id, child_id) do update
    set status = excluded.status, source = excluded.source, registered_by = excluded.registered_by, queued_at = excluded.queued_at,
        confirmed_at = excluded.confirmed_at, canceled_at = null, cancel_reason = null, updated_at = now()
  returning * into r;
  perform youth.family_event(p_child, null, 'event.registered', null, v_status);
  return jsonb_build_object('status', r.status,
    'position', case when r.status = 'waitlisted' then (select count(*) from youth.registrations x
                       where x.occurrence_id = o.id and x.status = 'waitlisted' and (x.queued_at, x.id) <= (r.queued_at, r.id)) end);
end;
$$;

create function public.youth_child_register(p_occurrence uuid, p_child uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  perform community.rate_limit(v_uid, 'youth_register', 60, interval '10 minutes');
  if not youth.guardian_can(p_child, v_uid, 'register') then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  return youth.register(p_occurrence, p_child, 'guardian', v_uid);
end;
$$;

create function public.youth_child_cancel(p_occurrence uuid, p_child uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_youth boolean := youth.account_child(v_uid) = p_child;
  r youth.registrations;
begin
  if not (youth.guardian_can(p_child, v_uid, 'register') or v_youth) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform 1 from events.occurrences where id = p_occurrence for update;
  select * into r from youth.registrations where occurrence_id = p_occurrence and child_id = p_child and status <> 'canceled' for update;
  if r.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform youth.cancel_registration(r, case when v_youth then 'youth' else 'guardian' end);
  perform youth.family_event(p_child, null, 'event.canceled', r.status, 'canceled');
end;
$$;

-- Independent youth registering themselves: only when the policy and the
-- event allow it, and the event needs no permission forms or logistics.
create function public.youth_rsvp(p_occurrence uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_youth();
  v_child uuid := youth.account_child(v_uid);
  es youth.event_settings;
begin
  perform community.rate_limit(v_uid, 'youth_register', 60, interval '10 minutes');
  select es2.* into es from events.occurrences o join youth.event_settings es2 on es2.series_id = o.series_id where o.id = p_occurrence;
  if es.series_id is null or not youth.event_visible(es.series_id, v_uid) then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  if not youth.flag('youth_rsvp') or not es.youth_rsvp or es.collect_emergency_contact or es.collect_pickup or es.collect_accommodation
     or exists (select 1 from youth.event_forms ef where ef.series_id = es.series_id) then
    raise exception 'Ask a parent or guardian to register you for this event.' using errcode = '22023';
  end if;
  return youth.register(p_occurrence, v_child, 'youth', v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Consent decisions
-- ---------------------------------------------------------------------------
-- {decision: granted|declined, agree: true}. The guardian must be verified and
-- allowed to sign forms; the version must be the form's current one.
create function public.youth_consent_submit(p_series uuid, p_child uuid, p_version uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v youth.form_versions;
  g youth.guardianships := youth.guardianship_of(p_child, v_uid);
  v_decision text := p ->> 'decision';
  v_id uuid;
  r youth.registrations;
begin
  perform community.rate_limit(v_uid, 'youth_consent', 60, interval '10 minutes');
  if g.id is null or not youth.guardian_can(p_child, v_uid, 'sign_forms') or not youth.child_may_attend(p_series, p_child) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into v from youth.form_versions where id = p_version;
  if v.id is null or v.id is distinct from (youth.current_version(v.form_id)).id
     or not exists (select 1 from youth.event_forms ef where ef.series_id = p_series and ef.form_id = v.form_id) then
    raise exception 'This form has been updated. Please review the current version.' using errcode = '22023';
  end if;
  if v_decision not in ('granted', 'declined') then
    raise exception 'Choose whether you give permission.' using errcode = '22023';
  end if;
  if v_decision = 'granted' and not coalesce((p ->> 'agree')::boolean, false) then
    raise exception 'Check the statement to give permission.' using errcode = '22023';
  end if;
  insert into youth.consents (form_version_id, form_id, series_id, child_id, guardian_id, guardianship_id, decision, policy_id)
  values (v.id, v.form_id, p_series, p_child, v_uid, g.id, v_decision, (youth.current_policy()).id)
  returning id into v_id;
  if v_decision = 'declined' then
    for r in select reg.* from youth.registrations reg join events.occurrences o on o.id = reg.occurrence_id
              where o.series_id = p_series and reg.child_id = p_child and reg.status <> 'canceled' and o.ends_at > now() loop
      perform youth.cancel_registration(r, 'consent_withdrawn');
    end loop;
  end if;
  perform youth.family_event(p_child, g.id, 'consent.' || v_decision);
  perform youth.notify(x.guardian_id, 'youth_consent_changed',
                       jsonb_build_object('youth_child_id', p_child, 'series_id', p_series), 'youth_consent:' || p_series || ':' || p_child)
     from youth.guardianships x
    where x.child_id = p_child and x.status = 'verified' and x.guardian_id <> v_uid and (x.can_sign_forms or x.can_receive_updates);
  return jsonb_build_object('id', v_id, 'state', youth.consent_state(p_series, p_child, v.form_id));
end;
$$;

-- Any verified guardian allowed to sign forms may withdraw. The record stays.
create function public.youth_consent_withdraw(p_consent uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  c youth.consents;
  r youth.registrations;
begin
  select * into c from youth.consents where id = p_consent for update;
  if c.id is null or not youth.guardian_can(c.child_id, v_uid, 'sign_forms') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if c.withdrawn_at is not null then
    return;
  end if;
  update youth.consents set withdrawn_at = now(), withdrawn_by = v_uid where id = c.id;
  for r in select reg.* from youth.registrations reg join events.occurrences o on o.id = reg.occurrence_id
            where o.series_id = c.series_id and reg.child_id = c.child_id and reg.status <> 'canceled' and o.ends_at > now() loop
    perform youth.cancel_registration(r, 'consent_withdrawn');
  end loop;
  perform youth.family_event(c.child_id, c.guardianship_id, 'consent.withdrawn');
  perform youth.notify(x.guardian_id, 'youth_consent_changed',
                       jsonb_build_object('youth_child_id', c.child_id, 'series_id', c.series_id), 'youth_consent:' || c.series_id || ':' || c.child_id)
     from youth.guardianships x
    where x.child_id = c.child_id and x.status = 'verified' and x.guardian_id <> v_uid and (x.can_sign_forms or x.can_receive_updates);
end;
$$;

-- ---------------------------------------------------------------------------
-- Logistics
-- ---------------------------------------------------------------------------
-- {emergency_name, emergency_phone, pickup_note, accommodation_note}: only
-- the fields this event collects are kept.
create function public.youth_logistics_save(p_series uuid, p_child uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  es youth.event_settings;
begin
  perform community.rate_limit(v_uid, 'youth_logistics', 60, interval '10 minutes');
  select * into es from youth.event_settings where series_id = p_series;
  if es.series_id is null or not youth.guardian_can(p_child, v_uid, 'register') or not youth.child_may_attend(p_series, p_child) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if not (es.collect_emergency_contact or es.collect_pickup or es.collect_accommodation) then
    raise exception 'This event doesn''t collect any extra information.' using errcode = '22023';
  end if;
  if char_length(coalesce(p ->> 'emergency_name', '')) > 120 or char_length(coalesce(p ->> 'emergency_phone', '')) > 40
     or char_length(coalesce(p ->> 'pickup_note', '')) > 500 or char_length(coalesce(p ->> 'accommodation_note', '')) > 500 then
    raise exception 'Please shorten your answers.' using errcode = '22023';
  end if;
  insert into youth.logistics (series_id, child_id, emergency_name, emergency_phone, pickup_note, accommodation_note, submitted_by)
  values (p_series, p_child,
          case when es.collect_emergency_contact then nullif(btrim(p ->> 'emergency_name'), '') end,
          case when es.collect_emergency_contact then nullif(btrim(p ->> 'emergency_phone'), '') end,
          case when es.collect_pickup then nullif(btrim(p ->> 'pickup_note'), '') end,
          case when es.collect_accommodation then nullif(btrim(p ->> 'accommodation_note'), '') end, v_uid)
  on conflict (series_id, child_id) do update
    set emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone, pickup_note = excluded.pickup_note,
        accommodation_note = excluded.accommodation_note, submitted_by = excluded.submitted_by, updated_at = now();
  -- The family history records that logistics changed, never the values.
  perform youth.family_event(p_child, null, 'event.logistics_saved');
end;
$$;

-- Designated personnel only (and still eligible to be personnel). Logged.
create function public.youth_logistics_list(p_series uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  es youth.event_settings;
  v_out jsonb;
begin
  select * into es from youth.event_settings where series_id = p_series;
  if es.series_id is null
     or not exists (select 1 from youth.event_personnel ep where ep.series_id = p_series and ep.profile_id = v_uid)
     or not (youth.holds(v_uid, 'youth.logistics') or youth.is_leader(es.group_id, v_uid)) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('child_id', c.id, 'display_name', c.display_name,
                                              'emergency_name', l.emergency_name, 'emergency_phone', l.emergency_phone,
                                              'pickup_note', l.pickup_note, 'accommodation_note', l.accommodation_note)
                            order by lower(c.display_name)), '[]'::jsonb)
    into v_out
    from youth.children c
    left join youth.logistics l on l.series_id = p_series and l.child_id = c.id
   where exists (select 1 from youth.registrations r join events.occurrences o on o.id = r.occurrence_id
                  where o.series_id = p_series and r.child_id = c.id and r.status <> 'canceled');
  insert into youth.access_log (actor_id, kind, series_id, item_count) values (v_uid, 'logistics_view', p_series, jsonb_array_length(v_out));
  return jsonb_build_object('collect_emergency_contact', es.collect_emergency_contact, 'collect_pickup', es.collect_pickup,
                            'collect_accommodation', es.collect_accommodation, 'children', v_out);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a guardian sees for one child
-- ---------------------------------------------------------------------------
create function youth.occurrence_for_child(o events.occurrences, s events.series, es youth.event_settings, p_child uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'occurrence_id', o.id, 'series_id', s.id, 'title', s.title, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
    'all_day', s.all_day, 'timezone', s.timezone, 'location_name', coalesce(o.override_location_name, s.location_name),
    'status', o.status, 'group', (select g.name from youth.groups g where g.id = es.group_id),
    'rsvp_enabled', s.rsvp_enabled, 'closes_at', o.starts_at - make_interval(mins => coalesce(s.rsvp_close_minutes, 0)),
    'registration_open', now() < o.starts_at - make_interval(mins => coalesce(s.rsvp_close_minutes, 0)),
    'places_left', case when s.capacity is not null then greatest(s.capacity - (select count(*) from youth.registrations r
                          where r.occurrence_id = o.id and r.status = 'confirmed'), 0) end,
    'waitlist_enabled', s.waitlist_enabled,
    'registration', (select jsonb_build_object('status', r.status, 'source', r.source, 'cancel_reason', r.cancel_reason,
                                               'position', case when r.status = 'waitlisted' then (select count(*) from youth.registrations x
                                                  where x.occurrence_id = o.id and x.status = 'waitlisted' and (x.queued_at, x.id) <= (r.queued_at, r.id)) end)
                       from youth.registrations r where r.occurrence_id = o.id and r.child_id = p_child),
    'forms', youth.forms_json(s.id, p_child),
    'collects', jsonb_build_object('emergency_contact', es.collect_emergency_contact, 'pickup', es.collect_pickup,
                                   'accommodation', es.collect_accommodation),
    'logistics_on_file', exists (select 1 from youth.logistics l where l.series_id = s.id and l.child_id = p_child),
    'youth_rsvp', es.youth_rsvp and youth.flag('youth_rsvp'));
$$;

create function public.youth_child_events(p_child uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  if not (youth.guardian_can(p_child, v_uid, 'register') or youth.guardian_can(p_child, v_uid, 'sign_forms')
          or youth.guardian_can(p_child, v_uid, 'receive_updates')) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return coalesce((select jsonb_agg(youth.occurrence_for_child(o, s, es, p_child, v_uid) order by o.starts_at)
     from youth.event_settings es
     join events.series s on s.id = es.series_id
     join events.occurrences o on o.series_id = s.id
    where events.is_live(s.status, s.publish_at) and o.ends_at > now() and o.starts_at < now() + interval '180 days'
      and youth.enrolled(es.group_id, p_child)), '[]'::jsonb);
end;
$$;

-- One event for one child, with the guardian's own logistics entry.
create function public.youth_child_event(p_occurrence uuid, p_child uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  o events.occurrences;
  s events.series;
  es youth.event_settings;
  g youth.guardianships := youth.guardianship_of(p_child, v_uid);
begin
  select * into o from events.occurrences where id = p_occurrence;
  select * into s from events.series where id = o.series_id;
  select * into es from youth.event_settings where series_id = s.id;
  if g.id is null or not youth.child_active(p_child) or es.series_id is null or not events.is_live(s.status, s.publish_at)
     or not youth.enrolled(es.group_id, p_child) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return youth.occurrence_for_child(o, s, es, p_child, v_uid) || jsonb_build_object(
    'description', s.description, 'location_address', coalesce(o.override_location_address, s.location_address),
    'cancellation_instructions', s.cancellation_instructions, 'organizer_name', s.organizer_name,
    'child', jsonb_build_object('id', p_child, 'display_name', (select display_name from youth.children where id = p_child)),
    'permissions', youth.permissions_json(g),
    'logistics', case when g.can_register then (select jsonb_build_object('emergency_name', l.emergency_name, 'emergency_phone', l.emergency_phone,
                                                                         'pickup_note', l.pickup_note, 'accommodation_note', l.accommodation_note,
                                                                         'updated_at', l.updated_at)
                                                  from youth.logistics l where l.series_id = s.id and l.child_id = p_child) end);
end;
$$;

-- Canceled occurrences: tell the guardians of registered children.
create function youth.on_occurrence_canceled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'scheduled' and new.status = 'canceled' then
    perform youth.notify(g.guardian_id, 'youth_registration',
                         jsonb_build_object('youth_child_id', r.child_id, 'occurrence_id', new.id, 'detail', jsonb_build_object('change', 'event_canceled')),
                         'youth_occ_canceled:' || new.id || ':' || r.child_id)
       from youth.registrations r join youth.guardianships g on g.child_id = r.child_id
      where r.occurrence_id = new.id and r.status <> 'canceled' and g.status = 'verified' and (g.can_register or g.can_receive_updates);
  end if;
  return new;
end;
$$;

create trigger occurrences_youth_canceled
  after update of status on events.occurrences
  for each row execute function youth.on_occurrence_canceled();

-- Staff can fill open places after raising capacity.
create function public.youth_admin_event_fill(p_occurrence uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform youth.require_event_admin();
  return youth.promote(p_occurrence);
end;
$$;

revoke execute on all functions in schema youth from public, anon, authenticated;
