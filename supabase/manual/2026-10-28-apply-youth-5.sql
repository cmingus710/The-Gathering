-- Phase 10 · Step 5 of 9: apply migration 20261028000500_youth_accounts to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Invitation-based independent youth accounts, progress sharing, and the reviewed adult transition.
--
-- It copies supabase/migrations/20261028000500_youth_accounts.sql verbatim and records it in
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
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000400') then
    raise exception 'Nothing was changed: the previous step (20261028000400) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000500') then
    raise exception 'Nothing was changed: 20261028000500 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261028000500_youth_accounts.sql
-- =========================================================================
-- Phase 10 · Independent youth accounts and the reviewed transition to
-- adult access (split from the family migration so each operator script
-- stays under the SQL editor's size limit). Rules: see 20261028000400_youth_family.

-- ---------------------------------------------------------------------------
-- Independent youth accounts
-- ---------------------------------------------------------------------------
-- New sign-ups whose email has an open youth invitation start as youth
-- accounts (the restrictive choice). They stay pending until activation.
create function youth.mark_invited_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from youth.account_invitations i
              where i.email = lower(btrim(new.email)) and i.status = 'pending' and i.expires_at > now()) then
    new.account_kind := 'youth';
  end if;
  return new;
end;
$$;

create trigger profiles_youth_signup
  before insert on public.profiles
  for each row execute function youth.mark_invited_signup();

-- Why a child can't (yet) have an independent account, or null.
create function youth.account_blocker(p_child uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy youth.policies := youth.current_policy();
  v_min numeric := (youth.setting('minimum_age_years') #>> '{}')::numeric;
  v_birth date;
begin
  if v_policy.id is null or not youth.flag('independent_accounts') then
    return 'Independent youth accounts aren''t available under the church''s current policy.';
  end if;
  if not youth.child_active(p_child) then
    return 'This child profile isn''t active.';
  end if;
  if exists (select 1 from youth.children c where c.id = p_child and c.account_id is not null) then
    return 'This child already has an account.';
  end if;
  if not exists (select 1 from youth.eligibility e where e.child_id = p_child and e.policy_id = v_policy.id and e.independent_account) then
    return 'The church office hasn''t confirmed eligibility under the current policy.';
  end if;
  if v_min is not null then
    select birth_date into v_birth from youth.child_private where child_id = p_child;
    if v_birth is null or v_birth + make_interval(years => v_min::integer) > current_date then
      return 'Eligibility can''t be confirmed from the information on record.';
    end if;
  end if;
  return null;
end;
$$;

-- Creates the one-time code (returned once). Family administrators or a
-- verified guardian allowed to manage the account.
create function public.youth_account_invite(p_child uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_admin boolean := public.has_capability('family.verify');
  v_guardian boolean := youth.guardian_can(p_child, v_uid, 'manage_account');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_blocker text;
  v_code text;
  i youth.account_invitations;
begin
  if not (v_admin or v_guardian) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform community.rate_limit(v_uid, 'youth_invite', 10, interval '1 day');
  v_blocker := youth.account_blocker(p_child);
  if v_blocker is not null then
    raise exception '%', v_blocker using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter the youth''s own email address.' using errcode = '22023';
  end if;
  -- Never an existing account (that would merge two identities), and never
  -- the inviter's own address.
  if exists (select 1 from public.profiles p where lower(p.email) = v_email)
     or exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'That email can''t be used. Use the youth''s own email address that isn''t already registered here.' using errcode = '22023';
  end if;
  if exists (select 1 from youth.account_invitations x where x.child_id = p_child and x.status = 'pending' and x.expires_at > now()) then
    raise exception 'An invitation is already open for this child. Revoke it first to create a new one.' using errcode = '22023';
  end if;
  update youth.account_invitations set status = 'expired' where child_id = p_child and status = 'pending';
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into youth.account_invitations (child_id, email, code_hash, policy_id, created_by, guardian_authorized_by, guardian_authorized_at)
  values (p_child, v_email, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), (youth.current_policy()).id, v_uid,
          case when v_guardian then v_uid end, case when v_guardian then now() end)
  returning * into i;
  perform youth.family_event(p_child, null, 'account.invited', null, 'pending');
  perform youth.audit('youth.account_invited', 'youth_child', p_child, jsonb_build_object('guardian_authorized', v_guardian));
  return jsonb_build_object('id', i.id, 'code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4),
                            'expires_at', i.expires_at, 'guardian_authorized', i.guardian_authorized_at is not null);
end;
$$;

-- A verified guardian's authorization of an invitation a family administrator created.
create function public.youth_account_authorize(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  i youth.account_invitations;
begin
  select * into i from youth.account_invitations where id = p_invitation for update;
  if i.id is null or not youth.guardian_can(i.child_id, v_uid, 'manage_account') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if i.status <> 'pending' or i.expires_at <= now() then
    raise exception 'This invitation is no longer open.' using errcode = '22023';
  end if;
  update youth.account_invitations set guardian_authorized_by = v_uid, guardian_authorized_at = now() where id = i.id;
  perform youth.family_event(i.child_id, null, 'account.guardian_authorized');
  perform youth.audit('youth.account_authorized', 'youth_child', i.child_id);
end;
$$;

create function public.youth_account_invite_revoke(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  i youth.account_invitations;
begin
  select * into i from youth.account_invitations where id = p_invitation for update;
  if i.id is null or not (public.has_capability('family.verify') or youth.guardian_can(i.child_id, v_uid, 'manage_account')) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  update youth.account_invitations set status = 'revoked' where id = i.id and status = 'pending';
  perform youth.family_event(i.child_id, null, 'account.invitation_revoked');
end;
$$;

-- Copies a child profile's guardian-recorded practice into the youth's own
-- memory history (nothing is lost; the child copy is then cleared so
-- progress has a single owner).
create function youth.move_practice_to_account(p_child uuid, p_account uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  k youth.practice_cards;
  v_card uuid;
  v_n integer := 0;
begin
  for k in select * from youth.practice_cards where child_id = p_child loop
    insert into memory.cards (profile_id, passage_id, item_id, status, step, due_on, last_scheduled_on, best_step, sessions,
                              last_practiced_at, added_at, removed_at)
    values (p_account, k.passage_id, k.item_id, case when k.status = 'active' then 'active' else 'removed' end, k.step, k.due_on,
            k.last_scheduled_on, k.best_step, k.sessions, k.last_practiced_at, k.added_at,
            case when k.status = 'active' then null else now() end)
    on conflict (profile_id, passage_id) do update
      set step = greatest(memory.cards.step, excluded.step), best_step = greatest(memory.cards.best_step, excluded.best_step),
          sessions = memory.cards.sessions + excluded.sessions, updated_at = now()
    returning id into v_card;
    insert into memory.attempts (card_id, profile_id, passage_id, activity, difficulty, segment, completed, accuracy, hints,
                                 confidence, quality, step_before, step_after, local_date, created_at)
    select v_card, p_account, a.passage_id, a.activity, a.difficulty, a.segment, true, a.accuracy, a.hints, a.confidence, a.quality,
           a.step_before, a.step_after, a.local_date, a.created_at
      from youth.practice_attempts a where a.card_id = k.id;
    v_n := v_n + 1;
  end loop;
  delete from youth.practice_cards where child_id = p_child;
  return v_n;
end;
$$;

-- Redeems a code: the signed-in account must be fresh (pending, never
-- approved, no roles or household) with a verified login email equal to the
-- invited one. Wrong codes give one generic answer.
create function public.youth_activate(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  i youth.account_invitations;
  pr public.profiles;
  v_email text;
  v_confirmed timestamptz;
  v_blocker text;
  v_moved integer;
begin
  if v_uid is null then
    raise exception 'Please sign in with the youth''s own account first.' using errcode = '42501';
  end if;
  perform community.rate_limit(v_uid, 'youth_activate', 8, interval '1 hour');
  select * into i from youth.account_invitations where code_hash = encode(sha256(convert_to(v_code, 'UTF8')), 'hex') for update;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
  if i.id is null or i.status <> 'pending' or i.expires_at <= now() or v_email is distinct from i.email then
    raise exception 'That code didn''t work. Check it, or ask for a new invitation.' using errcode = '22023';
  end if;
  if v_confirmed is null then
    raise exception 'Confirm your email address first (check your inbox), then enter the code again.' using errcode = '22023';
  end if;
  select * into pr from public.profiles where id = v_uid for update;
  if pr.membership_status <> 'pending' or pr.status_changed_at is not null
     or exists (select 1 from public.user_roles where user_id = v_uid)
     or exists (select 1 from public.household_members where profile_id = v_uid)
     or exists (select 1 from youth.children where account_id = v_uid) then
    raise exception 'This account can''t be used for a youth account. Contact the church office.' using errcode = '22023';
  end if;
  if i.policy_id is distinct from (youth.current_policy()).id then
    raise exception 'The church''s policy changed since this invitation was made. Ask for a new invitation.' using errcode = '22023';
  end if;
  v_blocker := youth.account_blocker(i.child_id);
  if v_blocker is not null then
    raise exception '%', v_blocker using errcode = '22023';
  end if;
  if youth.flag('guardian_authorization_required')
     and (i.guardian_authorized_at is null or not youth.guardian_can(i.child_id, i.guardian_authorized_by, 'manage_account')) then
    raise exception 'A parent or guardian needs to authorize this account first.' using errcode = '22023';
  end if;

  perform set_config('youth.context', 'on', true);
  update public.profiles
     set account_kind = 'youth', membership_status = 'approved', status_changed_at = now(),
         status_changed_by = coalesce(i.guardian_authorized_by, i.created_by)
   where id = v_uid;
  perform set_config('youth.context', '', true);
  -- Not listed anywhere adults look.
  update public.member_profile_details set directory_listed = false where profile_id = v_uid;
  update youth.children set account_id = v_uid, account_linked_at = now() where id = i.child_id;
  update youth.account_invitations set status = 'redeemed', redeemed_by = v_uid, redeemed_at = now() where id = i.id;
  insert into youth.account_records (child_id, account_id, invitation_id, policy_id, guardian_authorized_by, guardian_authorized_at)
  values (i.child_id, v_uid, i.id, i.policy_id, i.guardian_authorized_by, i.guardian_authorized_at);
  v_moved := youth.move_practice_to_account(i.child_id, v_uid);
  perform youth.family_event(i.child_id, null, 'account.activated', 'pending', 'active');
  perform youth.audit('youth.account_activated', 'youth_child', i.child_id,
                      jsonb_build_object('policy_version', (select version from youth.policies where id = i.policy_id)));
  perform youth.notify(g.guardian_id, 'youth_family', jsonb_build_object('youth_child_id', i.child_id, 'detail', jsonb_build_object('event', 'account_activated')))
     from youth.guardianships g where g.child_id = i.child_id and g.status = 'verified' and g.can_receive_updates;
  return jsonb_build_object('status', 'active', 'child_id', i.child_id, 'practice_moved', v_moved);
end;
$$;

-- The youth's own account and sharing status.
create function public.youth_account_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_youth();
  v_child uuid := youth.account_child(v_uid);
  r youth.account_records;
begin
  select * into r from youth.account_records where child_id = v_child and account_id = v_uid and ended_at is null order by created_at desc limit 1;
  return jsonb_build_object(
    'display_name', (select display_name from youth.children where id = v_child),
    'activated_at', r.youth_accepted_at,
    'policy_version', (select version from youth.policies where id = r.policy_id),
    'current_policy_version', (youth.current_policy()).version,
    'guardian_authorized', r.guardian_authorized_at is not null,
    'guardians', (select count(*) from youth.guardianships g where g.child_id = v_child and g.status = 'verified'),
    'sharing_mode', youth.setting('progress_sharing') #>> '{}',
    'share_summary', coalesce((select s.share_summary from youth.progress_sharing s where s.child_id = v_child), false),
    'guardian_discussion_access', youth.setting('guardian_discussion_access') #>> '{}',
    'transition', (select jsonb_build_object('id', t.id, 'status', t.status) from youth.transitions t
                    where t.child_id = v_child and t.status in ('started', 'confirmed')));
end;
$$;

create function public.youth_progress_sharing_set(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_youth();
  v_child uuid := youth.account_child(v_uid);
begin
  if coalesce(p_on, false) and youth.setting('progress_sharing') #>> '{}' <> 'youth_choice' then
    raise exception 'Progress sharing isn''t offered under the current policy.' using errcode = '22023';
  end if;
  insert into youth.progress_sharing (child_id, share_summary, chosen_at) values (v_child, coalesce(p_on, false), now())
  on conflict (child_id) do update set share_summary = excluded.share_summary, chosen_at = now();
  perform youth.family_event(v_child, null, 'sharing.' || case when p_on then 'on' else 'off' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Adult transition (reviewed; never automatic on a date)
-- ---------------------------------------------------------------------------
create function public.youth_admin_transition_start(p_child uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  c youth.children;
  v_id uuid;
begin
  if not youth.flag('adult_transition') then
    raise exception 'Adult transition isn''t available under the church''s current policy.' using errcode = '22023';
  end if;
  select * into c from youth.children where id = p_child for update;
  if c.id is null or c.status <> 'active' or c.account_id is null then
    raise exception 'Only an active child profile with an independent account can transition.' using errcode = '22023';
  end if;
  if not coalesce((p ->> 'eligibility_confirmed')::boolean, false) or not coalesce((p ->> 'identity_confirmed')::boolean, false) then
    raise exception 'Confirm eligibility under the current policy and the person''s identity and account ownership.' using errcode = '22023';
  end if;
  if exists (select 1 from youth.transitions t where t.child_id = c.id and t.status in ('started', 'confirmed')) then
    raise exception 'A transition is already in progress.' using errcode = '22023';
  end if;
  insert into youth.transitions (child_id, account_id, policy_id, eligibility_confirmed, identity_confirmed, started_by)
  values (c.id, c.account_id, (youth.current_policy()).id, true, true, v_uid)
  returning id into v_id;
  perform youth.family_event(c.id, null, 'transition.started', null, 'started');
  perform youth.audit('youth.transition_started', 'youth_child', c.id);
  return jsonb_build_object('id', v_id);
end;
$$;

-- The youth confirms it's their own account and that they understand what changes.
create function public.youth_transition_confirm(p_id uuid, p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_youth();
begin
  if lower(btrim(coalesce(p_confirm, ''))) <> 'this is my account' then
    raise exception 'Type "this is my account" to confirm.' using errcode = '22023';
  end if;
  update youth.transitions set status = 'confirmed', youth_confirmed_at = now()
   where id = p_id and account_id = v_uid and status = 'started';
  if not found then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform youth.family_event(youth.account_child(v_uid), null, 'transition.confirmed', 'started', 'confirmed');
end;
$$;

create function public.youth_admin_transition_complete(p_id uuid, p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  t youth.transitions;
begin
  select * into t from youth.transitions where id = p_id for update;
  if t.id is null or t.status <> 'confirmed' then
    raise exception 'The youth must confirm before the transition can be completed.' using errcode = '22023';
  end if;
  if t.account_id = v_uid then
    raise exception 'Someone else must complete this transition.' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> 'complete transition' then
    raise exception 'Type "complete transition" to confirm.' using errcode = '22023';
  end if;
  if not youth.flag('adult_transition') then
    raise exception 'Adult transition isn''t available under the church''s current policy.' using errcode = '22023';
  end if;
  perform set_config('youth.context', 'on', true);
  update public.profiles set account_kind = 'adult' where id = t.account_id;
  perform set_config('youth.context', '', true);
  -- Personal learning history stays with the account. Guardian visibility,
  -- youth groups, and youth event places end. Direct messaging is NOT
  -- granted: a membership administrator decides that separately.
  update youth.guardianships set status = 'ended' where child_id = t.child_id and status in ('pending', 'verified', 'suspended');
  update youth.enrollments set status = 'left', ended_at = now(), ended_by = v_uid where child_id = t.child_id and status = 'active';
  update youth.registrations r set status = 'canceled', canceled_at = now(), cancel_reason = 'ineligible', updated_at = now()
    from events.occurrences o
   where o.id = r.occurrence_id and r.child_id = t.child_id and r.status <> 'canceled' and o.ends_at > now();
  delete from youth.progress_sharing where child_id = t.child_id;
  update youth.account_records set ended_at = now(), ended_reason = 'adult_transition' where child_id = t.child_id and ended_at is null;
  update youth.children set status = 'transitioned' where id = t.child_id;
  update youth.transitions set status = 'completed', completed_by = v_uid, completed_at = now() where id = t.id;
  perform youth.family_event(t.child_id, null, 'transition.completed', 'confirmed', 'completed');
  perform youth.audit('youth.transition_completed', 'youth_child', t.child_id);
  perform youth.after_access_change(t.child_id);
end;
$$;

create function public.youth_admin_transition_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  v_child uuid;
begin
  update youth.transitions set status = 'canceled', canceled_at = now()
   where id = p_id and status in ('started', 'confirmed')
  returning child_id into v_child;
  if v_child is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform youth.family_event(v_child, null, 'transition.canceled', null, 'canceled');
end;
$$;

-- A deleted youth account leaves the child profile guardian-managed.
create function youth.on_account_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.account_id is not null and new.account_id is null then
    update youth.account_records set ended_at = coalesce(ended_at, now()), ended_reason = coalesce(ended_reason, 'account_deleted')
     where child_id = new.id and ended_at is null;
    delete from youth.progress_sharing where child_id = new.id;
  end if;
  return new;
end;
$$;

create trigger children_account_deleted
  after update of account_id on youth.children
  for each row execute function youth.on_account_deleted();

revoke execute on all functions in schema youth from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261028000500', 'youth_accounts', 'phase-10');

commit;
