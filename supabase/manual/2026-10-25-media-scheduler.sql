-- Phase 7 · Point the existing scheduler at the Phase 7 preview (hosted only).
--
-- No function or cron change is needed: events.call_worker() already runs
-- community.tick(), which (since Phase 7) runs media.tick() for scheduled
-- content notices, batched gallery notices, and rate-limit cleanup, and
-- community.has_due_work() now also reports due podcast feeds, so the signed
-- request reaches /api/jobs/events when feeds need refreshing. This only moves
-- the ONE designated deployment from the Phase 6 preview to the Phase 7
-- branch, so the Phase 6 preview stops receiving scheduler requests (no
-- duplicate senders). Safe to rerun; to move back, set the Phase 6 URL again.
--
-- The preview needs EVENTS_JOB_SECRET (it is set for all preview branches)
-- with the same value as events.secrets('job').
begin;

do $preflight$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000600') then
    raise exception 'Nothing was changed: apply the Phase 7 migrations (scripts 1-6) first.';
  end if;
end
$preflight$;

update events.settings
   set job_url = 'https://the-gathering-git-phase-7-teaching-media-paint-by-number.vercel.app/api/jobs/events',
       updated_at = now()
 where id;

commit;

-- Check: select job_url from events.settings;
