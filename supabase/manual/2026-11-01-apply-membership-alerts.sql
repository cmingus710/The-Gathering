-- Membership approval alerts · Apply migration 20261101000100_membership_approval_alerts to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/membership-approval-alerts.md, "Release steps"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: a new private `membership` schema (RLS on, no table grants),
-- four settings functions granted to `authenticated`, two triggers on
-- auth.users that only queue rows (failures there are warnings, never
-- errors), and create-or-replace of public.community_job (two more
-- operations) and community.has_due_work (one more check). Alerts start
-- OFF with no recipients, so nothing is emailed until an administrator
-- turns them on, and accounts already waiting are never notified.
--
-- It copies supabase/migrations/20261101000100_membership_approval_alerts.sql
-- verbatim and records it under its repository version (created_by =
-- membership-alerts). All or nothing: one transaction; out of order or a
-- second run stops at the preflight with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('youth.account_invitations') is null or to_regprocedure('media.has_due_feeds()') is null
     or to_regprocedure('public.community_job(text, text, bigint, text)') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000400') then
    raise exception 'Nothing was changed: the previous step (20261031000400) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101000100')
     or to_regnamespace('membership') is not null then
    raise exception 'Nothing was changed: 20261101000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261101000100_membership_approval_alerts.sql
-- =========================================================================
-- Membership approval alerts: email designated administrators once when a
-- new account first becomes eligible for membership approval.
--
-- Additive only: a new private `membership` schema (no API grants, RLS on),
-- four settings functions for `settings.manage` holders, a trigger on
-- auth.users, and two new operations on the existing signed community job
-- (one scheduler, one secret). The only replaced functions are
-- public.community_job (same operations plus two) and
-- community.has_due_work (same checks plus one).
--
-- When an alert is queued
--   * Email/password registration: when auth.users.email_confirmed_at goes
--     from null to a value (the verification link was used).
--   * An account created already verified (Google/Apple sign-in, or Auth
--     with confirmation off): on insert, after on_auth_user_created has
--     created the pending profile (triggers fire in name order).
--   Sign-ins, profile edits, provider linking on a verified account, and
--   repeated verification callbacks never move email_confirmed_at from null,
--   and approval_alerts is unique per profile, so an account is alerted at
--   most once, ever. Accounts that were already verified when this ships are
--   never alerted (no backfill), and turning alerts on later doesn't queue
--   anything for accounts that became eligible while they were off.
--   Only pending adult accounts qualify; an email with an open youth
--   invitation is a youth activation, not a membership request.
--
-- Delivery
--   One row per recipient in membership.alert_deliveries, sent separately
--   (nobody sees another recipient's address) through Resend with the
--   idempotency key "membership-alert-<delivery id>", so a retry after a
--   timeout can't send twice. Failed sends retry after 10 × attempts
--   minutes, up to 5 attempts; a send stuck in `sending` for 10 minutes is
--   marked failed and retried. Each row is rechecked when claimed: skipped
--   if the account is no longer pending, alerts were turned off, or the
--   recipient was removed.
--
-- Previews share this database with production. Sign-ups made on a preview
-- carry registration_environment = 'preview' (set by the app's sign-up
-- action); their alerts are marked `test`. Production claims only real
-- alerts and previews only test alerts (sent only to the preview's email
-- allowlist), so a preview registration can't email production recipients.
-- The flag only ever suppresses an alert for the registrant's own account.

create schema membership;
revoke all on schema membership from public, anon, authenticated;

create table membership.alert_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into membership.alert_settings (id) values (true);

create table membership.alert_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$'),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One row per account, ever: the deduplication record.
create table membership.approval_alerts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  source text not null check (source in ('email_verified', 'verified_at_signup')),
  test boolean not null default false,
  -- Snapshot at eligibility, so every recipient (and every retry, which
  -- reuses the provider idempotency key) gets the same message.
  applicant_name text not null default '',
  applicant_email text not null default '',
  eligible_at timestamptz not null default now(),
  -- How many deliveries were queued (0 when alerts were off or nobody was listed).
  recipients integer not null default 0
);

create table membership.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references membership.approval_alerts (id) on delete cascade,
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'suppressed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Provider error name or a skip reason: never a secret or message body.
  last_error text check (char_length(last_error) <= 300),
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (alert_id, recipient_email)
);

create index alert_deliveries_due_idx on membership.alert_deliveries (next_attempt_at)
  where status in ('pending', 'sending', 'failed');
create index alert_deliveries_recent_idx on membership.alert_deliveries (created_at desc);

alter table membership.alert_settings enable row level security;
alter table membership.alert_recipients enable row level security;
alter table membership.approval_alerts enable row level security;
alter table membership.alert_deliveries enable row level security;
revoke all on all tables in schema membership from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------
create function membership.enqueue_approval_alert(p_profile uuid, p_source text, p_test boolean)
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

  if (select enabled from membership.alert_settings) then
    insert into membership.alert_deliveries (alert_id, recipient_email)
    select v_alert, r.email from membership.alert_recipients r;
    get diagnostics v_count = row_count;
    update membership.approval_alerts set recipients = v_count where id = v_alert;
  end if;
  return v_alert;
end;
$$;

-- Never blocks sign-up or verification: any failure here is only a warning.
create function membership.on_auth_user_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform membership.enqueue_approval_alert(
      new.id,
      case when tg_op = 'INSERT' then 'verified_at_signup' else 'email_verified' end,
      coalesce(new.raw_user_meta_data ->> 'registration_environment', 'production') <> 'production');
  exception when others then
    raise warning 'Membership approval alert not queued (%).', sqlstate;
  end;
  return new;
end;
$$;

-- Named to fire after on_auth_user_created (which creates the profile).
create trigger on_auth_user_verified_alert
  after insert on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function membership.on_auth_user_verified();

create trigger on_auth_user_verified_alert_update
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function membership.on_auth_user_verified();

-- ---------------------------------------------------------------------------
-- Delivery (signed job operations)
-- ---------------------------------------------------------------------------
create function membership.op_alert_claim(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((v ->> 'limit')::integer, 10), 1), 50);
  v_test boolean := coalesce((v ->> 'test')::boolean, false);
  v_enabled boolean := (select enabled from membership.alert_settings);
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

create function membership.op_alert_result(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := v ->> 'status';
  -- retry = false: a permanent rejection (e.g. an invalid address) isn't retried.
  v_retry boolean := coalesce((v ->> 'retry')::boolean, true);
begin
  if v_status not in ('sent', 'failed', 'suppressed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  update membership.alert_deliveries
     set status = v_status,
         last_error = case when v_status = 'sent' then null else left(v ->> 'error', 300) end,
         provider_message_id = left(v ->> 'provider_id', 200),
         sent_at = case when v_status = 'sent' then now() end,
         attempts = case when v_status = 'failed' and not v_retry then greatest(attempts, 5) else attempts end,
         next_attempt_at = case when v_status = 'failed' then now() + make_interval(mins => 10 * attempts) else next_attempt_at end,
         updated_at = now()
   where id = (v ->> 'id')::uuid and status = 'sending';
  return jsonb_build_object('ok', found);
end;
$$;

-- Real (non-test) alerts waiting to be sent: wakes the scheduler.
create function membership.has_due_alerts()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from membership.alert_deliveries d
                   join membership.approval_alerts a on a.id = d.alert_id
                  where not a.test
                    and (d.status = 'pending' or (d.status = 'failed' and d.attempts < 5)
                         or (d.status = 'sending' and d.updated_at < now() - interval '10 minutes'))
                    and d.next_attempt_at <= now());
$$;

-- Same checks as 20261025000600, plus membership approval alerts.
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
      or media.has_due_feeds()
      or membership.has_due_alerts();
$$;

-- Same as 20261022000200, plus the two membership alert operations.
create or replace function public.community_job(p_op text, p_payload text, p_ts bigint, p_sig text)
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
    when 'membership_alert_claim' then membership.op_alert_claim(v)
    when 'membership_alert_result' then membership.op_alert_result(v)
    else null
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings (settings.manage only; never visible to members or visitors)
-- ---------------------------------------------------------------------------
create function membership.require_settings_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_capability('settings.manage') then
    raise exception 'You do not have permission to manage membership approval notifications.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function public.membership_alert_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform membership.require_settings_manager();
  return jsonb_build_object(
    'enabled', (select enabled from membership.alert_settings),
    'updated_at', (select updated_at from membership.alert_settings),
    'recipients', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'email', r.email, 'created_at', r.created_at) order by r.email)
                              from membership.alert_recipients r), '[]'::jsonb),
    -- Delivery status for troubleshooting: recipient, status, attempts, and
    -- the provider's error name. No applicant details.
    'recent', coalesce((select jsonb_agg(x order by x.created_at desc) from (
                          select d.id, d.recipient_email, d.status, d.attempts, d.last_error, d.created_at, d.sent_at,
                                 d.updated_at, a.test
                            from membership.alert_deliveries d
                            join membership.approval_alerts a on a.id = d.alert_id
                           order by d.created_at desc
                           limit 25) x), '[]'::jsonb));
end;
$$;

create function public.membership_alert_set_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := membership.require_settings_manager();
  v_old boolean;
begin
  if p_enabled is null then
    raise exception 'Choose on or off.' using errcode = '22023';
  end if;
  select enabled into v_old from membership.alert_settings for update;
  if v_old is distinct from p_enabled then
    update membership.alert_settings set enabled = p_enabled, updated_at = now(), updated_by = v_uid where id;
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (v_uid, 'membership_alerts.settings_changed', 'settings', 'membership_alerts', jsonb_build_object('enabled', p_enabled));
  end if;
  return p_enabled;
end;
$$;

create function public.membership_alert_add_recipient(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := membership.require_settings_manager();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  if char_length(v_email) > 254 or v_email !~ '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$' then
    raise exception 'Enter one valid email address.' using errcode = '22023';
  end if;
  perform 1 from membership.alert_settings for update;
  if (select count(*) from membership.alert_recipients) >= 20 then
    raise exception 'Up to 20 recipients can be listed. Remove one first.' using errcode = '22023';
  end if;
  insert into membership.alert_recipients (email, added_by) values (v_email, v_uid)
  on conflict (email) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'That address is already on the list.' using errcode = '23505';
  end if;
  -- The address itself isn't logged: the list is visible only to settings managers.
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_uid, 'membership_alerts.recipient_added', 'settings', 'membership_alerts', jsonb_build_object('recipient_id', v_id));
  return v_id;
end;
$$;

create function public.membership_alert_remove_recipient(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := membership.require_settings_manager();
begin
  delete from membership.alert_recipients where id = p_id;
  if not found then
    raise exception 'That recipient is no longer on the list.' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_uid, 'membership_alerts.recipient_removed', 'settings', 'membership_alerts', jsonb_build_object('recipient_id', p_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema membership from public, anon, authenticated, service_role;
revoke execute on function
  public.membership_alert_admin(), public.membership_alert_set_enabled(boolean),
  public.membership_alert_add_recipient(text), public.membership_alert_remove_recipient(uuid)
from public, anon, service_role;
grant execute on function
  public.membership_alert_admin(), public.membership_alert_set_enabled(boolean),
  public.membership_alert_add_recipient(text), public.membership_alert_remove_recipient(uuid)
to authenticated;
-- community_job keeps its existing grants (create or replace preserves them).

-- =========================================================================
-- Expected afterwards: nothing in `membership` is reachable through the API,
-- the settings functions need a signed-in user, and alerts start off.
do $check$
begin
  if has_schema_privilege('anon', 'membership', 'usage') or has_schema_privilege('authenticated', 'membership', 'usage') then
    raise exception 'Nothing was changed: the membership schema would be reachable through the API. Send this message to the developer.';
  end if;
  if has_function_privilege('anon', 'public.membership_alert_admin()', 'execute')
     or has_function_privilege('anon', 'public.membership_alert_add_recipient(text)', 'execute') then
    raise exception 'Nothing was changed: a membership alert function would be callable without signing in. Send this message to the developer.';
  end if;
  if not has_function_privilege('anon', 'public.community_job(text, text, bigint, text)', 'execute') then
    raise exception 'Nothing was changed: the scheduler entry point lost its grant. Send this message to the developer.';
  end if;
  if (select enabled from membership.alert_settings) or exists (select 1 from membership.alert_recipients) then
    raise exception 'Nothing was changed: alerts would start switched on. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261101000100', 'membership_approval_alerts', 'membership-alerts');

commit;
