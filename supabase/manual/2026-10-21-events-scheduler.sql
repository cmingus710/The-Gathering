-- Phase 4 · Event reminder scheduler (hosted project only).
--
-- One scheduler for every deployment: a pg_cron job in the database runs
-- every 5 minutes. It queues due reminders itself (events.tick(), under an
-- advisory lock, deduplicated), and when email is waiting it wakes ONE
-- designated deployment with a signed request (pg_net), which sends the
-- queued messages through Resend. Other preview deployments never run a
-- scheduler, and any that do send claim each message under a row lock, so
-- nothing is sent twice.
--
-- Prerequisites: the events migrations and the job secret
-- (2026-10-21-create-events-job-secret.sql), plus EVENTS_JOB_SECRET in
-- Vercel for the designated branch. Safe to rerun: it replaces the job.
--
-- The designated deployment is the stable branch URL below (it follows the
-- latest build of phase-4/events-calendar). Change it here when moving the
-- scheduler to another branch or to production.
begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

update events.settings
   set job_url = 'https://the-gathering-git-phase-4-events-calendar-paint-by-number.vercel.app/api/jobs/events',
       updated_at = now();

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
  -- Reminders are queued in the database even if the app can't be reached.
  perform events.tick();
  if v_url is null or v_key is null then
    return null;
  end if;
  if not exists (select 1 from events.outbox
                  where (status = 'pending' or (status = 'failed' and attempts < 5)
                         or (status = 'sending' and updated_at < now() - interval '10 minutes'))
                    and next_attempt_at <= now()) then
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

select cron.unschedule(jobid) from cron.job where jobname = 'events-worker';
select cron.schedule('events-worker', '*/5 * * * *', 'select events.call_worker()');

commit;

-- Check: select jobname, schedule, active from cron.job where jobname = 'events-worker';
-- Recent runs: select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'events-worker') order by start_time desc limit 5;
