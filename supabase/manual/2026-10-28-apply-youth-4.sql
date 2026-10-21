-- Phase 10 · Step 4 of 9: apply migration 20261028000400_youth_family to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Policy administration, guardian requests and verification, child profiles, restrictions, eligibility, and the family dashboard.
--
-- It copies supabase/migrations/20261028000400_youth_family.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-10).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('youth.children') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000300') then
    raise exception 'Nothing was changed: the previous step (20261028000300) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000400') then
    raise exception 'Nothing was changed: 20261028000400 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261028000400_youth_family.sql
-- =========================================================================
-- Phase 10 · Families: versioned policy administration, guardian requests
-- and verification, child profiles, independent youth accounts, and the
-- reviewed transition to adult access.
--
-- Rules
--   * Only a family administrator (family.verify) creates or verifies a
--     guardianship, and never their own. A request never reveals whether a
--     child record exists; the requester sees only their request's status.
--     Nothing is matched automatically (names, addresses, email domains, and
--     households are ignored).
--   * Guardian permissions are per child and per capability.
--   * A restricted child (e.g. disputed relationship) pauses every guardian
--     and youth-account path until a family administrator lifts it.
--   * Independent youth accounts need the approved policy to allow them, a
--     family administrator's eligibility determination under that policy
--     version, the policy's minimum age when the church set one (with a
--     recorded birth date, otherwise refused), verified guardian
--     authorization when the policy requires it, a one-time code bound to
--     the youth's own verified login email, and a fresh account. Nothing can
--     be self-asserted (no age checkbox, no birthday edit).
--   * Adult transition is explicit and reviewed; it never grants direct
--     messaging (that still needs a membership administrator's eligibility
--     record).

-- Replaced in the notifications migration.
create function youth.notify(p_profile uuid, p_kind text, p_refs jsonb, p_merge_key text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

-- Replaced in later migrations: everything that must follow a change in who
-- may act for a child (registrations, photos, notifications).
create function youth.after_access_change(p_child uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

-- Active youth accounts also need the approved policy to still allow them.
create or replace function youth.account_child(p_profile uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
    from youth.children c
    join public.profiles p on p.id = c.account_id
   where c.account_id = p_profile and c.status = 'active' and c.restricted_at is null
     and p.account_kind = 'youth' and p.membership_status = 'approved'
     and youth.flag('independent_accounts');
$$;

-- ---------------------------------------------------------------------------
-- Policy
-- ---------------------------------------------------------------------------
create function youth.policy_json(p youth.policies, p_full boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'version', p.version, 'status', p.status, 'title', p.title, 'body', p.body,
    'settings', youth.policy_defaults() || p.settings,
    'approved_at', p.approved_at, 'approval_reference', case when p_full then p.approval_reference end,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'updated_by', case when p_full and p.updated_by is not null then community.display_name(p.updated_by) end,
    'approved_by', case when p_full and p.approved_by is not null then community.display_name(p.approved_by) end);
$$;

-- The approved policy (or the safe defaults) for any approved adult or
-- active youth account.
create function public.youth_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  p youth.policies := youth.current_policy();
begin
  if v_uid is null or not (youth.is_adult(v_uid) or youth.is_active_youth(v_uid)) then
    raise exception 'Only approved members can do that.' using errcode = '42501';
  end if;
  if p.id is null then
    return jsonb_build_object('approved', false, 'settings', youth.policy_defaults());
  end if;
  return youth.policy_json(p, false) || jsonb_build_object('approved', true);
end;
$$;

create function public.youth_admin_policies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform youth.require_cap('youth.policy');
  return jsonb_build_object(
    'defaults', youth.policy_defaults(),
    'policies', coalesce((select jsonb_agg(youth.policy_json(p, true) order by p.version desc) from youth.policies p), '[]'::jsonb));
end;
$$;

-- Creates (p_id null) or edits a draft. Approved and retired versions never change.
create function public.youth_admin_policy_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.policy');
  v_settings jsonb := coalesce(p -> 'settings', '{}'::jsonb);
  v_problem text := youth.policy_settings_problem(v_settings);
  x youth.policies;
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if btrim(coalesce(p ->> 'title', '')) = '' then
    raise exception 'Give the policy a title.' using errcode = '22023';
  end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('youth.policy_version'));
    insert into youth.policies (version, title, body, settings, created_by, updated_by)
    values (coalesce((select max(version) from youth.policies), 0) + 1, btrim(p ->> 'title'), coalesce(p ->> 'body', ''),
            v_settings, v_uid, v_uid)
    returning * into x;
    perform youth.audit('youth.policy_drafted', 'youth_policy', x.id, jsonb_build_object('version', x.version));
  else
    update youth.policies
       set title = btrim(p ->> 'title'), body = coalesce(p ->> 'body', ''), settings = v_settings, updated_by = v_uid
     where id = p_id and status = 'draft'
    returning * into x;
    if x.id is null then
      raise exception 'Only draft policies can be edited. Start a new version instead.' using errcode = '22023';
    end if;
    perform youth.audit('youth.policy_edited', 'youth_policy', x.id, jsonb_build_object('version', x.version));
  end if;
  return youth.policy_json(x, true);
end;
$$;

-- Approval needs a second person (not the last editor), the church's
-- approval reference, and the typed phrase "approve version N".
create function public.youth_admin_policy_approve(p_id uuid, p_confirm text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.policy');
  x youth.policies;
  v_old youth.policies := youth.current_policy();
  v_problem text;
begin
  perform pg_advisory_xact_lock(hashtext('youth.policy_version'));
  select * into x from youth.policies where id = p_id for update;
  if x.id is null or x.status <> 'draft' then
    raise exception 'Only a draft policy can be approved.' using errcode = '22023';
  end if;
  if x.updated_by = v_uid then
    raise exception 'Someone other than the last editor must approve the policy.' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> 'approve version ' || x.version then
    raise exception 'Type "approve version %" to confirm.', x.version using errcode = '22023';
  end if;
  if btrim(coalesce(p_reference, '')) = '' then
    raise exception 'Record where the church approved this policy.' using errcode = '22023';
  end if;
  v_problem := youth.policy_settings_problem(x.settings);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  update youth.policies set status = 'retired', retired_at = now() where status = 'approved' and id <> x.id;
  update youth.policies
     set status = 'approved', approved_by = v_uid, approved_at = now(), approval_reference = left(btrim(p_reference), 300)
   where id = x.id
  returning * into x;
  -- Open invitations were issued under the earlier version: they must be reissued.
  update youth.account_invitations set status = 'revoked'
   where status = 'pending' and policy_id is distinct from x.id;
  perform youth.audit('youth.policy_approved', 'youth_policy', x.id,
                      jsonb_build_object('version', x.version, 'previous_version', v_old.version));
  return youth.policy_json(x, true);
end;
$$;

create function public.youth_admin_policy_discard(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.policy');
  v_version integer;
begin
  delete from youth.policies where id = p_id and status = 'draft' returning version into v_version;
  if v_version is null then
    raise exception 'Only draft policies can be discarded.' using errcode = '22023';
  end if;
  perform youth.audit('youth.policy_discarded', 'youth_policy', p_id, jsonb_build_object('version', v_version));
end;
$$;

-- ---------------------------------------------------------------------------
-- Who am I here (navigation decisions; every action rechecks)
-- ---------------------------------------------------------------------------
create function public.youth_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_child uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  if youth.is_active_youth(v_uid) then
    v_child := youth.account_child(v_uid);
    return jsonb_build_object('kind', 'youth', 'child_id', v_child,
      'display_name', (select c.display_name from youth.children c where c.id = v_child),
      'groups', (select count(*) from youth.enrollments e where e.child_id = v_child and e.status = 'active'));
  end if;
  if not youth.is_adult(v_uid) then
    return jsonb_build_object('kind', case when exists (select 1 from public.profiles where id = v_uid and account_kind = 'youth')
                                           then 'youth_inactive' else 'none' end);
  end if;
  return jsonb_build_object(
    'kind', 'adult',
    'guardian_of', (select count(*) from youth.guardianships g where g.guardian_id = v_uid and g.status = 'verified'
                     and youth.child_active(g.child_id)),
    'paused_guardianships', (select count(*) from youth.guardianships g join youth.children c on c.id = g.child_id
                              where g.guardian_id = v_uid and (g.status = 'suspended' or (g.status = 'verified' and c.restricted_at is not null))),
    'pending_requests', (select count(*) from youth.guardian_requests r where r.requester_id = v_uid and r.status = 'pending'),
    'leads', (select count(*) from youth.group_leaders l where l.profile_id = v_uid and l.status = 'active' and youth.is_leader(l.group_id, v_uid)),
    'personnel', (select count(*) from youth.event_personnel p where p.profile_id = v_uid),
    'caps', (select coalesce(jsonb_agg(c order by c), '[]'::jsonb) from unnest(array['youth.manage', 'youth.publish', 'youth.enroll', 'youth.forms',
                     'youth.logistics', 'youth.media_consent', 'youth.safeguarding', 'youth.policy', 'family.verify']) c
              where public.has_capability(c)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardian requests (any approved adult)
-- ---------------------------------------------------------------------------
create function public.youth_guardian_request(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_id uuid;
  v_birth date;
begin
  perform community.rate_limit(v_uid, 'youth_request', 5, interval '1 day');
  if coalesce(p ->> 'kind', '') not in ('new_child', 'existing_child')
     or coalesce(p ->> 'relationship', '') not in ('parent', 'legal_guardian', 'caregiver')
     or btrim(coalesce(p ->> 'child_name', '')) = '' or char_length(btrim(p ->> 'child_name')) > 60
     or char_length(coalesce(p ->> 'details', '')) > 500 then
    raise exception 'Please complete the request.' using errcode = '22023';
  end if;
  -- A birth date is collected only when the approved policy requires it.
  if youth.flag('birth_date_required') and nullif(p ->> 'birth_date', '') is not null then
    begin
      v_birth := (p ->> 'birth_date')::date;
    exception when others then
      raise exception 'Enter the date of birth as YYYY-MM-DD.' using errcode = '22023';
    end;
    if v_birth > current_date or v_birth < date '1990-01-01' then
      raise exception 'Check the date of birth.' using errcode = '22023';
    end if;
  end if;
  if (select count(*) from youth.guardian_requests where requester_id = v_uid and status = 'pending') >= 10 then
    raise exception 'You have several requests waiting. Please wait for the church office to review them.' using errcode = '22023';
  end if;
  insert into youth.guardian_requests (requester_id, kind, child_name, details, relationship, birth_date)
  values (v_uid, p ->> 'kind', btrim(p ->> 'child_name'), btrim(coalesce(p ->> 'details', '')), p ->> 'relationship', v_birth)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

-- The requester's own requests: status only (never which child, if any, was matched).
create function public.youth_my_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'child_name', r.child_name, 'relationship', r.relationship,
                                                      'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at)
                                    order by r.created_at desc)
                     from youth.guardian_requests r where r.requester_id = v_uid and r.created_at > now() - interval '1 year'), '[]'::jsonb);
end;
$$;

create function public.youth_guardian_request_withdraw(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  update youth.guardian_requests set status = 'withdrawn'
   where id = p_id and requester_id = v_uid and status = 'pending';
  if not found then
    raise exception 'That request can''t be withdrawn.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Family administration (family.verify)
-- ---------------------------------------------------------------------------
create function youth.permission_names(g youth.guardianships)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    case when g.can_manage_profile then 'manage_profile' end, case when g.can_register then 'register' end,
    case when g.can_sign_forms then 'sign_forms' end, case when g.can_media_consent then 'media_consent' end,
    case when g.can_view_progress then 'view_progress' end, case when g.can_practice then 'practice' end,
    case when g.can_manage_account then 'manage_account' end, case when g.can_receive_updates then 'receive_updates' end], null);
$$;

create function youth.permissions_json(g youth.guardianships)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('manage_profile', g.can_manage_profile, 'register', g.can_register, 'sign_forms', g.can_sign_forms,
                            'media_consent', g.can_media_consent, 'view_progress', g.can_view_progress, 'practice', g.can_practice,
                            'manage_account', g.can_manage_account, 'receive_updates', g.can_receive_updates);
$$;

-- Applies {permissions: {...}} to a guardianship row (missing keys = off).
create function youth.with_permissions(g youth.guardianships, p jsonb)
returns youth.guardianships
language plpgsql
immutable
set search_path = ''
as $$
begin
  g.can_manage_profile := coalesce((p ->> 'manage_profile')::boolean, false);
  g.can_register := coalesce((p ->> 'register')::boolean, false);
  g.can_sign_forms := coalesce((p ->> 'sign_forms')::boolean, false);
  g.can_media_consent := coalesce((p ->> 'media_consent')::boolean, false);
  g.can_view_progress := coalesce((p ->> 'view_progress')::boolean, false);
  g.can_practice := coalesce((p ->> 'practice')::boolean, false);
  g.can_manage_account := coalesce((p ->> 'manage_account')::boolean, false);
  g.can_receive_updates := coalesce((p ->> 'receive_updates')::boolean, false);
  return g;
end;
$$;

create function public.youth_admin_requests(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform youth.require_cap('family.verify');
  return coalesce((select jsonb_agg(jsonb_build_object(
            'id', r.id, 'kind', r.kind, 'child_name', r.child_name, 'details', r.details, 'relationship', r.relationship,
            'birth_date_provided', r.birth_date is not null, 'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at,
            'requester', jsonb_build_object('id', r.requester_id, 'name', community.display_name(r.requester_id),
                                            'approved', youth.is_adult(r.requester_id)),
            'decided_by', case when r.decided_by is not null then community.display_name(r.decided_by) end,
            'child', case when r.child_id is not null then (select jsonb_build_object('id', c.id, 'display_name', c.display_name)
                                                              from youth.children c where c.id = r.child_id) end)
          order by r.created_at)
     from youth.guardian_requests r
    where (p_status = 'all' and r.created_at > now() - interval '1 year') or r.status = p_status), '[]'::jsonb);
end;
$$;

-- Approve: {decision: 'approve', child_id? (existing child) | display_name?
--           (new child), verification_method, permissions: {...}}
-- Decline: {decision: 'decline'}
create function public.youth_admin_request_decide(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  r youth.guardian_requests;
  v_child uuid := nullif(p ->> 'child_id', '')::uuid;
  g youth.guardianships;
begin
  select * into r from youth.guardian_requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then
    raise exception 'That request isn''t waiting for review.' using errcode = 'P0002';
  end if;
  if r.requester_id = v_uid then
    raise exception 'Someone else must review your own request.' using errcode = '22023';
  end if;
  if p ->> 'decision' = 'decline' then
    update youth.guardian_requests set status = 'declined', decided_by = v_uid, decided_at = now() where id = r.id;
    perform youth.family_event(null, null, 'request.declined');
    perform youth.audit('youth.request_declined', 'youth_request', r.id);
    perform youth.notify(r.requester_id, 'youth_family', jsonb_build_object('youth_request_id', r.id, 'detail', jsonb_build_object('event', 'request_reviewed')));
    return jsonb_build_object('status', 'declined');
  end if;
  if p ->> 'decision' <> 'approve' then
    raise exception 'Choose approve or decline.' using errcode = '22023';
  end if;
  if coalesce(p ->> 'verification_method', '') not in ('in_person', 'known_to_staff', 'church_records', 'other') then
    raise exception 'Record how the relationship was verified.' using errcode = '22023';
  end if;
  if not youth.is_adult(r.requester_id) then
    raise exception 'The requester''s membership isn''t active.' using errcode = '22023';
  end if;
  if v_child is null then
    insert into youth.children (display_name, created_by)
    values (left(btrim(coalesce(nullif(p ->> 'display_name', ''), r.child_name)), 60), v_uid)
    returning id into v_child;
    if r.birth_date is not null and youth.flag('birth_date_required') then
      insert into youth.child_private (child_id, birth_date, updated_by) values (v_child, r.birth_date, v_uid);
    end if;
    perform youth.family_event(v_child, null, 'child.created');
  elsif not exists (select 1 from youth.children c where c.id = v_child and c.status = 'active') then
    raise exception 'That child profile isn''t active.' using errcode = 'P0002';
  end if;
  if exists (select 1 from youth.guardianships x where x.child_id = v_child and x.guardian_id = r.requester_id
                and x.status in ('pending', 'verified', 'suspended')) then
    raise exception 'This adult already has a relationship with that child on record.' using errcode = '22023';
  end if;
  if not youth.flag('multiple_guardians')
     and exists (select 1 from youth.guardianships x where x.child_id = v_child and x.status in ('verified', 'suspended')) then
    raise exception 'This child already has a verified guardian, and the current policy allows one guardian per child.' using errcode = '22023';
  end if;
  g := youth.with_permissions(null::youth.guardianships, coalesce(p -> 'permissions', '{}'::jsonb));
  insert into youth.guardianships (child_id, guardian_id, relationship, status, can_manage_profile, can_register, can_sign_forms,
                                   can_media_consent, can_view_progress, can_practice, can_manage_account, can_receive_updates,
                                   request_id, verification_method, verified_by, verified_at)
  values (v_child, r.requester_id, r.relationship, 'verified', g.can_manage_profile, g.can_register, g.can_sign_forms,
          g.can_media_consent, g.can_view_progress, g.can_practice, g.can_manage_account, g.can_receive_updates,
          r.id, p ->> 'verification_method', v_uid, now())
  returning * into g;
  update youth.guardian_requests set status = 'approved', child_id = v_child, decided_by = v_uid, decided_at = now() where id = r.id;
  perform youth.family_event(v_child, g.id, 'guardian.verified', 'pending', 'verified', youth.permission_names(g));
  perform youth.audit('youth.guardian_verified', 'youth_guardianship', g.id, jsonb_build_object('permissions', youth.permission_names(g)));
  perform youth.notify(r.requester_id, 'youth_family', jsonb_build_object('youth_request_id', r.id, 'youth_child_id', v_child,
                                                                          'detail', jsonb_build_object('event', 'request_reviewed')));
  return jsonb_build_object('status', 'approved', 'child_id', v_child, 'guardianship_id', g.id);
end;
$$;

-- Children search for family administrators (names and states only).
create function public.youth_admin_children(p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform youth.require_cap('family.verify');
  return coalesce((select jsonb_agg(x.j order by x.n) from (
    select lower(c.display_name) as n, jsonb_build_object(
      'id', c.id, 'display_name', c.display_name, 'status', c.status, 'participation', c.participation,
      'restricted', c.restricted_at is not null, 'account_linked', c.account_id is not null,
      'guardians', (select count(*) from youth.guardianships g where g.child_id = c.id and g.status = 'verified'),
      'paused_guardians', (select count(*) from youth.guardianships g where g.child_id = c.id and g.status = 'suspended'),
      'groups', coalesce((select jsonb_agg(gr.name order by gr.name) from youth.enrollments e join youth.groups gr on gr.id = e.group_id
                           where e.child_id = c.id and e.status = 'active'), '[]'::jsonb)) as j
      from youth.children c
     where v_q is null or c.display_name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
     order by lower(c.display_name) limit 100) x), '[]'::jsonb);
end;
$$;

create function public.youth_admin_child(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  c youth.children;
  v_policy youth.policies := youth.current_policy();
begin
  select * into c from youth.children where id = p_id;
  if c.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  insert into youth.access_log (actor_id, kind, child_id) values (v_uid, 'child_private_view', c.id);
  return jsonb_build_object(
    'id', c.id, 'display_name', c.display_name, 'avatar_path', c.avatar_path, 'participation', c.participation, 'status', c.status,
    'restricted', c.restricted_at is not null, 'restricted_reason', c.restricted_reason, 'restricted_at', c.restricted_at,
    'created_at', c.created_at,
    'birth_date', (select cp.birth_date from youth.child_private cp where cp.child_id = c.id),
    'account', case when c.account_id is not null then jsonb_build_object(
                 'linked_at', c.account_linked_at, 'name', community.display_name(c.account_id),
                 'active', youth.is_active_youth(c.account_id),
                 'status', (select p.membership_status from public.profiles p where p.id = c.account_id)) end,
    'eligibility', (select jsonb_build_object('independent_account', e.independent_account, 'determined_at', e.determined_at,
                                              'determined_by', community.display_name(e.determined_by))
                      from youth.eligibility e where e.child_id = c.id and e.policy_id = v_policy.id),
    'policy_version', v_policy.version,
    'guardians', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', g.id, 'name', community.display_name(g.guardian_id), 'relationship', g.relationship, 'status', g.status,
                    'permissions', youth.permissions_json(g), 'verification_method', g.verification_method, 'verified_at', g.verified_at,
                    'verified_by', case when g.verified_by is not null then community.display_name(g.verified_by) end,
                    'member_active', youth.is_adult(g.guardian_id)) order by g.created_at)
                  from youth.guardianships g where g.child_id = c.id), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', gr.id, 'name', gr.name, 'status', e.status) order by gr.name)
                         from youth.enrollments e join youth.groups gr on gr.id = e.group_id where e.child_id = c.id), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'status',
                                case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
                                'created_at', i.created_at, 'expires_at', i.expires_at,
                                'guardian_authorized', i.guardian_authorized_at is not null) order by i.created_at desc)
                              from youth.account_invitations i where i.child_id = c.id), '[]'::jsonb),
    'transition', (select jsonb_build_object('id', t.id, 'status', t.status, 'started_at', t.started_at, 'youth_confirmed_at', t.youth_confirmed_at)
                     from youth.transitions t where t.child_id = c.id and t.status in ('started', 'confirmed')),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'from', l.from_status, 'to', l.to_status, 'fields', l.fields,
                                                           'at', l.created_at,
                                                           'by', case when l.actor_id is not null then community.display_name(l.actor_id) end)
                                         order by l.created_at desc)
                          from youth.family_log l where l.child_id = c.id), '[]'::jsonb));
end;
$$;

-- Create (p_id null) or edit a child profile: {display_name, participation, birth_date}.
create function public.youth_admin_child_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  c youth.children;
  v_fields text[] := '{}';
begin
  if p ? 'display_name' and (btrim(coalesce(p ->> 'display_name', '')) = '' or char_length(btrim(p ->> 'display_name')) > 60) then
    raise exception 'Enter a preferred name (60 characters or fewer).' using errcode = '22023';
  end if;
  if coalesce(p ->> 'participation', 'active') not in ('active', 'paused') then
    raise exception 'Choose a participation status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into youth.children (display_name, participation, created_by)
    values (btrim(p ->> 'display_name'), coalesce(p ->> 'participation', 'active'), v_uid)
    returning * into c;
    perform youth.family_event(c.id, null, 'child.created');
  else
    select * into c from youth.children where id = p_id for update;
    if c.id is null then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
    if p ? 'display_name' and btrim(p ->> 'display_name') <> c.display_name then v_fields := v_fields || 'display_name'::text; end if;
    if p ? 'participation' and p ->> 'participation' <> c.participation then v_fields := v_fields || 'participation'::text; end if;
    update youth.children
       set display_name = coalesce(btrim(p ->> 'display_name'), display_name),
           participation = coalesce(p ->> 'participation', participation)
     where id = c.id
    returning * into c;
  end if;
  if p ? 'birth_date' then
    perform youth.set_birth_date(c.id, p ->> 'birth_date', v_uid);
    v_fields := v_fields || 'birth_date'::text;
  end if;
  if cardinality(v_fields) > 0 then
    perform youth.family_event(c.id, null, 'child.updated', null, null, v_fields);
  end if;
  return jsonb_build_object('id', c.id);
end;
$$;

create function youth.set_birth_date(p_child uuid, p_value text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    delete from youth.child_private where child_id = p_child;
    return;
  end if;
  if not youth.flag('birth_date_required') then
    raise exception 'The current policy doesn''t collect dates of birth.' using errcode = '22023';
  end if;
  begin
    v_date := p_value::date;
  exception when others then
    raise exception 'Enter the date of birth as YYYY-MM-DD.' using errcode = '22023';
  end;
  if v_date > current_date or v_date < date '1990-01-01' then
    raise exception 'Check the date of birth.' using errcode = '22023';
  end if;
  insert into youth.child_private (child_id, birth_date, updated_by, updated_at) values (p_child, v_date, p_actor, now())
  on conflict (child_id) do update set birth_date = excluded.birth_date, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- Status changes and permissions: {status?, permissions?, verification_method?}.
-- Revoked is final (a new request starts over).
create function public.youth_admin_guardian_update(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  g youth.guardianships;
  n youth.guardianships;
  v_to text;
  v_fields text[];
begin
  select * into g from youth.guardianships where id = p_id for update;
  if g.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if g.guardian_id = v_uid then
    raise exception 'Someone else must change your own guardianship.' using errcode = '22023';
  end if;
  v_to := coalesce(p ->> 'status', g.status);
  if g.status in ('revoked', 'ended') then
    raise exception 'This relationship has ended. A new request is needed.' using errcode = '22023';
  end if;
  if v_to not in ('verified', 'suspended', 'revoked') and v_to <> g.status then
    raise exception 'Choose verified, suspended, or revoked.' using errcode = '22023';
  end if;
  if v_to = 'verified' and coalesce(p ->> 'verification_method', g.verification_method, '') not in ('in_person', 'known_to_staff', 'church_records', 'other') then
    raise exception 'Record how the relationship was verified.' using errcode = '22023';
  end if;
  if v_to = 'verified' and g.status <> 'verified' and not youth.flag('multiple_guardians')
     and exists (select 1 from youth.guardianships x where x.child_id = g.child_id and x.id <> g.id and x.status in ('verified', 'suspended')) then
    raise exception 'This child already has a verified guardian, and the current policy allows one guardian per child.' using errcode = '22023';
  end if;
  n := g;
  if p ? 'permissions' then
    n := youth.with_permissions(g, p -> 'permissions');
  end if;
  select coalesce(array_agg(k), '{}') into v_fields
    from unnest(youth.permission_names(g) || youth.permission_names(n)) k
   where (k = any(youth.permission_names(g))) <> (k = any(youth.permission_names(n)));
  update youth.guardianships
     set status = v_to, can_manage_profile = n.can_manage_profile, can_register = n.can_register, can_sign_forms = n.can_sign_forms,
         can_media_consent = n.can_media_consent, can_view_progress = n.can_view_progress, can_practice = n.can_practice,
         can_manage_account = n.can_manage_account, can_receive_updates = n.can_receive_updates,
         verification_method = case when v_to = 'verified' then coalesce(nullif(p ->> 'verification_method', ''), verification_method) else verification_method end,
         verified_by = case when v_to = 'verified' and g.status <> 'verified' then v_uid else verified_by end,
         verified_at = case when v_to = 'verified' and g.status <> 'verified' then now() else verified_at end
   where id = g.id
  returning * into n;
  perform youth.family_event(g.child_id, g.id, case when v_to <> g.status then 'guardian.' || v_to else 'guardian.permissions' end,
                             g.status, v_to, v_fields);
  perform youth.audit('youth.guardian_' || case when v_to <> g.status then v_to else 'permissions' end, 'youth_guardianship', g.id,
                      jsonb_build_object('from', g.status, 'to', v_to, 'fields', v_fields));
  perform youth.after_access_change(g.child_id);
  return jsonb_build_object('id', n.id, 'status', n.status, 'permissions', youth.permissions_json(n));
end;
$$;

create function public.youth_admin_child_restrict(p_id uuid, p_on boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  c youth.children;
begin
  if p_on and coalesce(p_reason, '') not in ('disputed_relationship', 'safeguarding', 'other') then
    raise exception 'Choose a reason for the restriction.' using errcode = '22023';
  end if;
  update youth.children
     set restricted_at = case when p_on then coalesce(restricted_at, now()) end,
         restricted_reason = case when p_on then p_reason end
   where id = p_id
  returning * into c;
  if c.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform youth.family_event(c.id, null, case when p_on then 'child.restricted' else 'child.restriction_lifted' end);
  perform youth.audit(case when p_on then 'youth.child_restricted' else 'youth.child_restriction_lifted' end, 'youth_child', c.id,
                      jsonb_build_object('reason', p_reason));
  perform youth.after_access_change(c.id);
end;
$$;

-- Archiving ends enrollments, cancels upcoming registrations, and revokes
-- open invitations. Records are kept (see docs/youth-retention.md).
create function public.youth_admin_child_archive(p_id uuid, p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  c youth.children;
begin
  select * into c from youth.children where id = p_id for update;
  if c.id is null or c.status <> 'active' then
    raise exception 'Only active child profiles can be archived.' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> 'archive' then
    raise exception 'Type "archive" to confirm.' using errcode = '22023';
  end if;
  if c.account_id is not null then
    raise exception 'This child has an independent account. Use the adult transition or unlink it first.' using errcode = '22023';
  end if;
  update youth.children set status = 'archived' where id = c.id;
  update youth.enrollments set status = 'removed', ended_at = now(), ended_by = v_uid where child_id = c.id and status = 'active';
  update youth.account_invitations set status = 'revoked' where child_id = c.id and status = 'pending';
  perform youth.family_event(c.id, null, 'child.archived', 'active', 'archived');
  perform youth.audit('youth.child_archived', 'youth_child', c.id);
  perform youth.after_access_change(c.id);
end;
$$;

-- Eligibility for an independent account under the approved policy version.
create function public.youth_admin_eligibility_set(p_child uuid, p_independent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  v_policy youth.policies := youth.current_policy();
begin
  if v_policy.id is null then
    raise exception 'There is no approved policy to assess eligibility under.' using errcode = '22023';
  end if;
  if not exists (select 1 from youth.children where id = p_child and status = 'active') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  insert into youth.eligibility (child_id, policy_id, independent_account, determined_by)
  values (p_child, v_policy.id, coalesce(p_independent, false), v_uid)
  on conflict (child_id, policy_id) do update
    set independent_account = excluded.independent_account, determined_by = excluded.determined_by, determined_at = now();
  perform youth.family_event(p_child, null, 'child.eligibility', null, case when p_independent then 'eligible' else 'not_eligible' end,
                             array['independent_account']);
  perform youth.audit('youth.eligibility_set', 'youth_child', p_child, jsonb_build_object('policy_version', v_policy.version));
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardians: the family dashboard
-- ---------------------------------------------------------------------------
create function youth.child_brief(c youth.children, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'display_name', c.display_name, 'avatar_path', c.avatar_path, 'participation', c.participation,
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', gr.id, 'name', gr.name) order by gr.name)
                         from youth.enrollments e join youth.groups gr on gr.id = e.group_id
                        where e.child_id = c.id and e.status = 'active' and gr.status = 'active'), '[]'::jsonb),
    'account_linked', c.account_id is not null);
$$;

create function public.youth_family()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  return jsonb_build_object(
    'children', coalesce((select jsonb_agg(youth.child_brief(c, v_uid) || jsonb_build_object(
                    'relationship', g.relationship, 'permissions', youth.permissions_json(g),
                    'outstanding_forms', youth.outstanding_forms(c.id, v_uid),
                    'upcoming', (select count(*) from youth.registrations r join events.occurrences o on o.id = r.occurrence_id
                                  where r.child_id = c.id and r.status <> 'canceled' and o.ends_at > now()))
                  order by lower(c.display_name))
                from youth.guardianships g join youth.children c on c.id = g.child_id
               where g.guardian_id = v_uid and g.status = 'verified' and youth.child_active(c.id)), '[]'::jsonb),
    -- Relationships paused by the church office: no child details.
    'paused', (select count(*) from youth.guardianships g join youth.children c on c.id = g.child_id
                where g.guardian_id = v_uid and c.status = 'active'
                  and (g.status = 'suspended' or (g.status = 'verified' and c.restricted_at is not null))),
    'requests', public.youth_my_requests());
end;
$$;

-- Replaced in the events migration (forms needing a decision for the child).
create function youth.outstanding_forms(p_child uuid, p_guardian uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select 0;
$$;

create function public.youth_family_child(p_child uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  g youth.guardianships := youth.guardianship_of(p_child, v_uid);
  c youth.children;
begin
  if g.id is null or not youth.child_active(p_child) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into c from youth.children where id = p_child;
  return youth.child_brief(c, v_uid) || jsonb_build_object(
    'relationship', g.relationship,
    'permissions', youth.permissions_json(g),
    -- Other verified guardians: a count only (never another adult's details).
    'other_guardians', (select count(*) from youth.guardianships x where x.child_id = c.id and x.status = 'verified' and x.id <> g.id),
    'birth_date', case when g.can_manage_profile then (select cp.birth_date from youth.child_private cp where cp.child_id = c.id) end,
    'birth_date_collected', youth.flag('birth_date_required'),
    'account', case when g.can_manage_account then jsonb_build_object(
                 'linked', c.account_id is not null, 'active', c.account_id is not null and youth.is_active_youth(c.account_id),
                 'policy_allows', youth.flag('independent_accounts'),
                 'guardian_authorization_required', youth.flag('guardian_authorization_required'),
                 'eligible', exists (select 1 from youth.eligibility e where e.child_id = c.id and e.independent_account
                                       and e.policy_id = (youth.current_policy()).id),
                 'invitation', (select jsonb_build_object('id', i.id, 'email', i.email, 'expires_at', i.expires_at,
                                                          'guardian_authorized', i.guardian_authorized_at is not null)
                                  from youth.account_invitations i where i.child_id = c.id and i.status = 'pending' and i.expires_at > now()),
                 'sharing', (select s.share_summary from youth.progress_sharing s where s.child_id = c.id))
               else jsonb_build_object('linked', c.account_id is not null) end);
end;
$$;

-- {display_name?, participation?, birth_date?} by a guardian allowed to manage the profile.
create function public.youth_child_save(p_child uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  c youth.children;
  v_fields text[] := '{}';
begin
  perform community.rate_limit(v_uid, 'youth_child_save', 30, interval '10 minutes');
  if not youth.guardian_can(p_child, v_uid, 'manage_profile') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into c from youth.children where id = p_child for update;
  if p ? 'display_name' and (btrim(coalesce(p ->> 'display_name', '')) = '' or char_length(btrim(p ->> 'display_name')) > 60) then
    raise exception 'Enter a preferred name (60 characters or fewer).' using errcode = '22023';
  end if;
  if p ? 'participation' and p ->> 'participation' not in ('active', 'paused') then
    raise exception 'Choose a participation status.' using errcode = '22023';
  end if;
  if p ? 'display_name' and btrim(p ->> 'display_name') <> c.display_name then v_fields := v_fields || 'display_name'::text; end if;
  if p ? 'participation' and p ->> 'participation' <> c.participation then v_fields := v_fields || 'participation'::text; end if;
  update youth.children
     set display_name = coalesce(btrim(p ->> 'display_name'), display_name), participation = coalesce(p ->> 'participation', participation)
   where id = c.id;
  if p ? 'birth_date' then
    perform youth.set_birth_date(c.id, p ->> 'birth_date', v_uid);
    v_fields := v_fields || 'birth_date'::text;
  end if;
  if cardinality(v_fields) > 0 then
    perform youth.family_event(c.id, (youth.guardianship_of(c.id, v_uid)).id, 'child.updated_by_guardian', null, null, v_fields);
  end if;
end;
$$;

-- Avatar: the server stores the processed WebP under avatars/<child>/<random>.webp
-- (storage policy checks the same permission) and then records it here.
-- Returns the previous path so the server can delete that object.
create function public.youth_child_avatar_set(p_child uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old text;
begin
  if not (youth.guardian_can(p_child, v_uid, 'manage_profile') or public.has_capability('family.verify')) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_path is not null and youth.avatar_child(p_path) is distinct from p_child then
    raise exception 'That image can''t be used.' using errcode = '22023';
  end if;
  select avatar_path into v_old from youth.children where id = p_child for update;
  update youth.children set avatar_path = p_path where id = p_child;
  perform youth.family_event(p_child, null, case when p_path is null then 'child.avatar_removed' else 'child.avatar_changed' end);
  return jsonb_build_object('previous', v_old);
end;
$$;

revoke execute on all functions in schema youth from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261028000400', 'youth_family', 'phase-10');

commit;
