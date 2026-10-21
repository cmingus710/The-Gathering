-- Recovery only · Re-create the scheduler in a rebuilt or restored project.
--
-- Use after docs/operations-recovery.md "Recovering the database" (migrations
-- plus data), because events.call_worker() and the pg_cron job live outside
-- the migrations. Don't use the dated *-scheduler.sql scripts for this: each
-- points job_url at an old branch preview.
--
-- The function below is the definition in 2026-10-22-community-scheduler.sql,
-- identical to the hosted project's (pg_get_functiondef md5 1796361f…, read
-- 2026-10-21). job_url is production. Needs the restored job secret in
-- events.secrets (it must equal EVENTS_JOB_SECRET in Vercel Production).
-- Safe to rerun; one transaction.
begin;

do $preflight$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261022000500') then
    raise exception 'Nothing was changed: apply the migrations first.';
  end if;
  if not exists (select 1 from events.secrets where name = 'job') then
    raise exception 'Nothing was changed: restore events.secrets (or run 2026-10-21-create-events-job-secret.sql and set the same value in Vercel) first.';
  end if;
end
$preflight$;

update events.settings
   set job_url = 'https://www.gathering.church/api/jobs/events',
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
revoke execute on function events.call_worker() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'events-worker';
select cron.schedule('events-worker', '*/5 * * * *', 'select events.call_worker()');

commit;
