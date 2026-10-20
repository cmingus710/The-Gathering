-- Phase 5 · Extend the existing scheduler to community delivery (hosted only).
--
-- Reuses the Phase 4 scheduler: the same pg_cron job ('events-worker', every
-- 5 minutes), the same advisory-locked ticks, the same signed request with
-- EVENTS_JOB_SECRET, and ONE designated deployment. This replaces
-- events.call_worker() so it also runs community.tick() (digests, invitation
-- expiry, retention) and wakes the deployment when community email or push
-- is due. The app's /api/jobs/events handler then sends both.
--
-- Prerequisites: scripts 2026-10-22-apply-community-1 … 5, and
-- EVENTS_JOB_SECRET set in Vercel for the designated branch.
-- Safe to rerun. Change the URL below when moving the scheduler to another
-- branch or to production (only one deployment should ever be designated).
begin;

do $preflight$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261022000500') then
    raise exception 'Nothing was changed: apply the Phase 5 migrations (scripts 1-5) first.';
  end if;
end
$preflight$;

update events.settings
   set job_url = 'https://the-gathering-git-phase-5-community-messaging-paint-by-number.vercel.app/api/jobs/events',
       updated_at = now()
 where id;

create or replace function events.call_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_ts bigint := floor(extract(epoch from now()))::bigint;
  v_request bigint;
begin
  select job_url into v_url from events.settings;
  select value into v_key from events.secrets where name = 'job';
  -- Reminders, digests, expiry, and retention happen in the database even if
  -- the app can't be reached.
  perform events.tick();
  perform community.tick();
  if v_url is null or v_key is null then
    return null;
  end if;
  if not exists (select 1 from events.outbox
                  where (status = 'pending' or (status = 'failed' and attempts < 5)
                         or (status = 'sending' and updated_at < now() - interval '10 minutes'))
                    and next_attempt_at <= now())
     and not community.has_due_work() then
    return null;
  end if;
  select net.http_post(
           url := v_url,
           body := '{}'::jsonb,
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'x-events-ts', v_ts::text,
             'x-events-signature', encode(extensions.hmac('tick.' || v_ts::text || '.', v_key, 'sha256'), 'hex')),
           timeout_milliseconds := 30000)
    into v_request;
  return v_request;
end;
$$;

revoke execute on function events.call_worker() from public, anon, authenticated;

commit;

-- Check: select job_url from events.settings;
-- Recent runs: select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'events-worker') order by start_time desc limit 5;
