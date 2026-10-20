-- Phase 6 · Point the existing scheduler at the Phase 6 preview (hosted only).
--
-- No function or cron change is needed: events.call_worker() already runs
-- community.tick(), which (since Phase 6) runs prayer.tick() for care
-- follow-up reminders. This only moves the ONE designated deployment from the
-- Phase 5 preview to the Phase 6 branch, so the Phase 5 preview stops
-- receiving scheduler requests (no duplicate senders). Safe to rerun; to move
-- back, set the Phase 5 URL again.
--
-- The preview needs EVENTS_JOB_SECRET (it is set for all preview branches)
-- with the same value as events.secrets('job').
begin;

do $preflight$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000400') then
    raise exception 'Nothing was changed: apply the Phase 6 migrations (scripts 1-4) first.';
  end if;
end
$preflight$;

update events.settings
   set job_url = 'https://the-gathering-git-phase-6-prayer-care-paint-by-number.vercel.app/api/jobs/events',
       updated_at = now()
 where id;

commit;

-- Check: select job_url from events.settings;
