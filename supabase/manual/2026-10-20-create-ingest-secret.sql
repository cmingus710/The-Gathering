-- Creates the giving ingest secret ONCE (project ymuiutwdnhxdqsetnwkt).
-- Run in the Supabase SQL editor, then copy the value into Vercel as
-- GIVING_INGEST_SECRET. The value is shown only in your SQL editor.
--
-- It never replaces an existing secret: if one already exists, it changes
-- nothing and says so. (Rotating the secret is a separate, deliberate step
-- in docs/giving-setup.md.)
with created as (
  insert into giving.secrets (name, value)
  values ('ingest', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (name) do nothing
  returning value
)
select coalesce(
  (select value from created),
  'ALREADY SET: the existing secret was kept and nothing was changed.'
) as ingest_secret;
