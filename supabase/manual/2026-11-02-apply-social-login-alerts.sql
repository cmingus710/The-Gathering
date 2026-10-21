-- Membership alerts for Google/Apple sign-ups · Apply migration
-- 20261102000100_membership_alerts_social_signups to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: replaces membership.on_auth_user_verified (same behaviour plus a
-- 10-minute hold for new Google/Apple accounts) and adds
-- public.membership_alert_settle_own(boolean), granted to `authenticated`
-- only. Email registrations are unaffected. Safe to apply before Google or
-- Apple is enabled: the hold only applies to accounts those providers create.
--
-- It copies supabase/migrations/20261102000100_membership_alerts_social_signups.sql
-- verbatim and records it under its repository version (created_by =
-- social-login-alerts). All or nothing: one transaction; out of order or a
-- second run stops at the preflight with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regprocedure('membership.on_auth_user_verified()') is null
     or to_regprocedure('membership.enqueue_approval_alert(uuid, text, boolean)') is null then
    raise exception 'Nothing was changed: the membership approval alerts aren''t installed. Apply 20261101000300 first.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261101000300') then
    raise exception 'Nothing was changed: the previous step (20261101000300) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261102000100')
     or to_regprocedure('public.membership_alert_settle_own(boolean)') is not null then
    raise exception 'Nothing was changed: this step was already applied.';
  end if;
end
$preflight$;

create or replace function membership.on_auth_user_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert uuid;
begin
  begin
    v_alert := membership.enqueue_approval_alert(
      new.id,
      case when tg_op = 'INSERT' then 'verified_at_signup' else 'email_verified' end,
      coalesce(new.raw_user_meta_data ->> 'registration_environment', 'production') <> 'production');
    -- Google/Apple: give the app's callback time to classify and name it.
    if v_alert is not null and tg_op = 'INSERT'
       and new.raw_app_meta_data ->> 'provider' in ('google', 'apple')
       and new.raw_user_meta_data ->> 'registration_environment' is null then
      update membership.alert_deliveries
         set next_attempt_at = now() + interval '10 minutes'
       where alert_id = v_alert and status = 'pending';
    end if;
  exception when others then
    raise warning 'Membership approval alert not queued (%).', sqlstate;
  end;
  return new;
end;
$$;

create function public.membership_alert_settle_own(p_test boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_alert uuid;
begin
  if v_uid is null then
    return false;
  end if;
  update membership.approval_alerts a
     set test = a.test or coalesce(p_test, false),
         applicant_name = coalesce(
           (select left(coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.full_name), ''), ''), 120)
              from public.profiles p where p.id = a.profile_id),
           a.applicant_name)
   where a.profile_id = v_uid
     and a.source = 'verified_at_signup'
     and exists (select 1 from public.profiles p where p.id = v_uid and p.membership_status = 'pending')
     and a.eligible_at > now() - interval '1 hour'
     and not exists (select 1 from membership.alert_deliveries d where d.alert_id = a.id and d.status <> 'pending')
  returning a.id into v_alert;
  if v_alert is null then
    return false;
  end if;
  update membership.alert_deliveries
     set next_attempt_at = now(), updated_at = now()
   where alert_id = v_alert and status = 'pending';
  return true;
end;
$$;

revoke all on function public.membership_alert_settle_own(boolean) from public, anon;
grant execute on function public.membership_alert_settle_own(boolean) to authenticated;

do $check$
begin
  if has_function_privilege('anon', 'public.membership_alert_settle_own(boolean)', 'execute') then
    raise exception 'Nothing was changed: the new function would be callable without signing in. Send this message to the developer.';
  end if;
  if not has_function_privilege('authenticated', 'public.membership_alert_settle_own(boolean)', 'execute') then
    raise exception 'Nothing was changed: signed-in members couldn''t call the new function. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261102000100', 'membership_alerts_social_signups', 'social-login-alerts');

commit;
