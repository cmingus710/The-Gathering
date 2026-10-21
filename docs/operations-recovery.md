# Operations, backups, and recovery

How the app runs unattended, what is backed up, and how to recover. The recovery procedure below was rehearsed on a disposable local Supabase stack on 2026-10-21; it has **not** been run against the hosted project, and a production restore must never be used as a test.

## What runs on its own

| Job | Where | Schedule | Protection |
| --- | --- | --- | --- |
| `events-worker` (pg_cron) | Hosted database | Every 5 minutes | Calls `events.call_worker()`, which runs the database ticks and POSTs a signed request (HMAC, ±300 s) to `events.settings.job_url` |
| Job endpoint `/api/jobs/events` | Production (`job_url` = `https://www.gathering.church/api/jobs/events`) | When called | Signature checked in constant time; sends event, community, prayer, media, reading, memory, and youth email/push from outboxes; refreshes due podcast feeds |
| Database ticks (`events.tick`, `community.tick`, …) | Hosted database | Inside each run | Transaction advisory locks (overlapping runs do nothing) and dedupe keys (each notice once) |

**Retries:** email up to 5 attempts (10 × attempt minutes apart), push up to 3 (5 × attempt minutes); expired push subscriptions (404/410) and those failing 5 times are removed. **Overlap:** two runs at once queue each reminder once (tested with separate connections). **Preview-to-production:** only the URL in `events.settings.job_url` receives scheduler calls; previews never do. But previews have the same job secret and database, so a preview can still send email when someone *uses* it (blocker 2 in [phase-11-release-readiness.md](phase-11-release-readiness.md#release-blockers)).

**Health check (read-only SQL):**

```sql
select count(*) runs, count(*) filter (where status <> 'succeeded') failed
  from cron.job_run_details where start_time > now() - interval '24 hours';
select status, count(*) from events.outbox group by 1;
select status, count(*) from community.email_outbox group by 1;
select status, count(*) from community.push_outbox group by 1;
```

Healthy: about 288 runs a day with 0 failed, and no `failed` rows with 5 attempts. On 2026-10-21: 288 runs, 0 failed, outboxes all `sent`.

## Who can investigate, and where

| What | Where | Who |
| --- | --- | --- |
| App errors, request logs | Vercel → the-gathering → Logs / Observability (runtime errors grouped) | Vercel team members |
| Database, cron runs, auth logs | Supabase → project The-Gathering → Logs, Database → Cron | Supabase organization members |
| Email delivery and bounces | Resend dashboard (Gathering account) | Resend account owner |
| Payments (test mode) | Stripe Dashboard (sandbox) | Stripe account owner |
| Who changed what in the app | Admin → Audit log | Super administrators |

The existing tools cover this; no paid monitoring service is needed for the pilot. The one concrete unmet need is **backups**, below.

## Backups: current capability

| | Today (Free plan) | After upgrading to Pro |
| --- | --- | --- |
| Database daily backups | **None you can restore from the dashboard** | Daily, 7 days kept, restore from Database → Backups |
| Point-in-time recovery | No | Paid add-on (needs a Small compute add-on) |
| Storage files (photos, media, PDFs) | **Never included** in database backups | **Still never included** |
| Auto-pause after ~7 quiet days | Yes (restorable for 90 days) | No |

So: upgrade to Pro, **and** keep your own copies of files, because no Supabase plan backs up Storage objects.

## Taking a backup

On a trusted computer, with the Supabase CLI and Node installed, from the repository folder. You need the database password (Supabase → Project Settings → Database) and the project's secret key (Project Settings → API keys). Never paste either into a file in the repository, a chat, or an issue.

```sh
# Database: the connection string from Project Settings → Database → Connect (session pooler).
npx supabase@2 db dump --db-url "$DB_URL" -f backup/roles.sql --role-only
npx supabase@2 db dump --db-url "$DB_URL" -f backup/schema.sql
npx supabase@2 db dump --db-url "$DB_URL" -f backup/data.sql --data-only --use-copy
npx supabase@2 db dump --db-url "$DB_URL" -f backup/history.sql --data-only --schema supabase_migrations

# Files (every bucket, with a SHA-256 manifest):
NEXT_PUBLIC_SUPABASE_URL=https://ymuiutwdnhxdqsetnwkt.supabase.co SUPABASE_SECRET_KEY=… \
  node scripts/storage-backup.mjs backup backup/storage
```

The backup holds every member's personal data, prayer requests, messages, journals, giving records, and the scheduler's signing secret (`events.secrets`). Store it encrypted (for example an encrypted disk image), never in GitHub, email, or a shared drive. Suggested rhythm: before every release and monthly; keep the last three.

## Recovering the database

Use the dashboard restore first if you are on Pro and a daily backup from before the problem exists (Database → Backups → Restore). The project is offline while it restores. Afterwards, check the scheduler and run the fingerprints (step 6 below).

To rebuild from your own backup (for example into a new project), use **migrations plus data**, not the dumped schema. The rehearsal showed why: restoring `schema.sql` into a new project silently gives `anon` execute rights on about 100 functions (new projects' default privileges re-grant them) and drops the app's storage access policies (the `storage` schema isn't dumped).

1. Create the target project (or pause the app first: roll production back and stop the scheduler with `select cron.unschedule('events-worker');`).
2. Apply the repository migrations in order (`supabase link` then `supabase db push`, or the `supabase/manual` operator scripts in date order on the hosted project). This creates the exact schema, grants (including `20261029000100`), storage buckets, and policies.
3. Empty only the tables the backup refills, then load the data with triggers off:
   ```sh
   grep '^COPY ' backup/data.sql | awk '{print $2}' \
     | grep -v -E '"storage"\."(buckets_vectors|vector_indexes|buckets_analytics|migrations)"|"supabase_functions"|"auth"\."schema_migrations"' > backup/targets.txt
   psql "$DB_URL" -v ON_ERROR_STOP=1 -c "truncate $(paste -sd, backup/targets.txt) cascade"
   # Remove the same platform-managed COPY blocks from data.sql, then:
   psql "$DB_URL" -v ON_ERROR_STOP=1 -c "set session_replication_role = replica" -f backup/data-app.sql
   ```
   (The truncate step replaces the rows migrations seed, such as roles and categories, with the backed-up ones.)
4. Restore files: `node scripts/storage-backup.mjs restore backup/storage` (dry run), then add `--yes`. It overwrites every file from the copy, because after a database restore the bucket listings come from restored metadata even when the files are gone.
5. Re-create the scheduler with `supabase/manual/recovery-scheduler.sql` (the hosted `events.call_worker()` definition, production URL, the 5-minute job; rehearsed). `events.call_worker()` and the cron job aren't in the migrations, and the dated `*-scheduler.sql` scripts point at old branch previews, so don't rerun those.
6. Verify: row counts against the backup; `supabase/tests/*-fingerprint.sql` against the digests in [migration-history.md](migration-history.md); sign in as the test administrator; the next cron run succeeds.

**Rehearsal result (local, 2026-10-21):** synthetic accounts, posts, prayers, events, and three files were backed up, deleted, and restored this way. Row counts were identical in all 46 non-empty tables, file hashes were identical, sign-in worked, and the youth fingerprint equalled the hosted digests in all 14 categories.

## Migrations that can't be undone in place

No migration has a "down" script; every one is forward-only. Treat all of them as irreversible on the hosted database:

- Phase 10 (`20261028000100`…`001000`) replaced shared functions that production already uses (`is_approved_member`, community notification delivery). Going back means a new migration restoring the earlier definitions, not dropping Phase 10.
- Migrations that create tables can only be "undone" by dropping them, which deletes everything stored since.
- `20261029000100_function_grant_baseline` only changes grants and is safe to re-run; on hosted it changes nothing.

Correct mistakes with a new, rehearsed forward migration. Never edit an applied migration and never reset the hosted database.

## Deployment rollback

Vercel → the-gathering → Deployments → previous production deployment → **Promote**. Code rolls back instantly; the database does not, so a rollback across a schema change needs the code to work with the newer schema (true for Phase 9 code on the Phase 10 schema today). See [pilot-launch-runbook.md](pilot-launch-runbook.md#rollback).
