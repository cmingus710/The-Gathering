-- Phase 4 · Create the events job secret (create-only).
--
-- Run once in the SQL editor of The Gathering project (ymuiutwdnhxdqsetnwkt)
-- after the events migrations are applied. Copy the value straight into
-- Vercel as EVENTS_JOB_SECRET (Sensitive, Preview, branch
-- phase-4/events-calendar). Never paste it anywhere else.
--
-- Rerunning never rotates an existing secret: it shows ALREADY SET and
-- changes nothing. To rotate deliberately, update events.secrets where
-- name = 'job', replace EVENTS_JOB_SECRET in Vercel, and redeploy.
with created as (
  insert into events.secrets (name, value)
  values ('job', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (name) do nothing
  returning value
)
select coalesce((select value from created),
  'ALREADY SET: the existing secret was kept and nothing was changed.') as events_job_secret;
