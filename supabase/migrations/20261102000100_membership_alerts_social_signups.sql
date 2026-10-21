-- Membership approval alerts for Google/Apple sign-ups.
--
-- Supabase Auth creates a Google/Apple account (already verified) before the
-- app sees it, so the insert trigger queues the approval alert before the app
-- can (a) tag a preview sign-up as a test, or (b) collect the name Apple never
-- shares. Two additive changes:
--
--   * membership.on_auth_user_verified (replaced): same as 20261101000300,
--     plus a 10-minute hold on the deliveries of an alert queued for a new
--     Google/Apple account (raw_app_meta_data provider) that carries no
--     registration_environment. The scheduler doesn't claim held rows.
--   * public.membership_alert_settle_own(p_test) (new, authenticated): for the
--     caller's OWN alert only, while their account is pending and no delivery
--     has been attempted, refreshes
--     the applicant name from the profile, optionally marks the alert as a test
--     (it can never unmark one), and releases the hold. The app calls it from
--     the OAuth callback (test = not production) and after the name step.
--
-- Nothing else changes. Like registration_environment, the function can only
-- suppress or settle the caller's own alert: never anyone else's, and never
-- turn a test alert into a real one. If the app never calls it, the hold
-- simply expires and the alert is sent as before.

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
