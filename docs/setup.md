# Setup

Never commit real keys. `.env*` files are ignored, except `.env.example`.

## 1. Environment variables

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + local | Yes | Project URL, e.g. `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel + local | Yes | Publishable key (`sb_publishable_…`). `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy) also works. |
| `NEXT_PUBLIC_SITE_URL` | Vercel **Production** + local | Production | Canonical URL for auth email links. Leave unset on Preview, where `VERCEL_BRANCH_URL` is used automatically. |
| `RESEND_API_KEY` | Vercel (server) | Optional | App notifications (membership approved). Without it, approvals still work and admins are told no email was sent. |
| `EMAIL_FROM` | Vercel (server) | With Resend | e.g. `The Gathering <hello@your-domain.org>`, on a domain verified in Resend |
| `SUPABASE_SECRET_KEY` | Your terminal only | For bootstrap | Secret key (`sb_secret_…`) or legacy `SUPABASE_SERVICE_ROLE_KEY`. **Do not add it to Vercel**: the app never needs it. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GIVING_INGEST_SECRET` | Vercel Preview (server, sensitive) | For giving | Stripe **test** key, webhook signing secret, and the shared ingest secret. See [giving-setup.md](giving-setup.md). Live keys are refused. |
| `GIVING_EMAIL_ALLOWLIST`, `GIVING_WEBHOOK_HOST` | Vercel Preview | For giving | Test-email allowlist; dedicated webhook hostname |
| `EVENTS_JOB_SECRET` | Vercel Preview, branch-scoped (server, sensitive) | For event email | Shared with `events.secrets('job')`; signs the scheduler and email delivery. Without it, events and RSVPs work but email stays queued. See [events-guide.md](events-guide.md#scheduler-reminders-and-retries). |
| `EVENTS_EMAIL_ALLOWLIST` | Vercel Preview | Recommended | Test addresses that may receive event email outside production (falls back to `GIVING_EMAIL_ALLOWLIST`; with neither, nothing is sent) |
| `CRON_SECRET` | Vercel Production (later) | Optional | Only if a Vercel cron should also call `GET /api/jobs/events` after release |
| `TEST_DATABASE_URL` | Local / CI | For DB tests | Postgres superuser URL. The tests create and drop a throwaway database. |

## 2. Supabase

### Database

The schema is in `supabase/migrations/` and must be applied in filename order:

1. `20261018000100_identity_and_capabilities.sql`
2. `20261018000200_church_settings.sql`
3. `20261018000300_announcements.sql`
4. `20261018000400_storage.sql`
5. `20261018000500_explicit_function_grants.sql`
6. `20261019000100_member_profiles.sql` (Phase 2)
7. `20261019000200_directory.sql` (Phase 2)
8. `20261019000300_households.sql` (Phase 2)
9. `20261019000400_profile_photos.sql` (Phase 2)
10. `20261020000100_giving_schema.sql` (Phase 3)
11. `20261020000200_giving_ingest.sql` (Phase 3)
12. `20261020000300_giving_access.sql` (Phase 3)
13. `20261021000100_events_schema.sql` (Phase 4)
14. `20261021000200_events_jobs.sql` (Phase 4)
15. `20261021000300_events_access.sql` (Phase 4)

Giving also needs the ingest secret stored in `giving.secrets`, plus Stripe test keys and the webhook. See [giving-setup.md](giving-setup.md).

Events need the job secret in `events.secrets` and the database scheduler (`pg_cron` + `pg_net`) for reminders. The three Phase 4 migrations can be applied in one transaction with `supabase/manual/2026-10-21-apply-events.sql`. See [events-guide.md](events-guide.md).

**Project `ymuiutwdnhxdqsetnwkt`:** all nine migrations are applied, and the history matches the repository versions; see [migration-history.md](migration-history.md). Phase 2 was applied through the SQL connector with the repository version numbers recorded, plus one snippet (the `household_leave` function, which contains `delete from`) run in the SQL editor.

For a new project, run `supabase link --project-ref <ref> && supabase db push`, or paste each file into the SQL editor in order.

`supabase/seed.sql` contains **synthetic** local-only data (`example.test` accounts). It runs only on a local stack (`supabase db reset`). Never run it against production.

### Authentication (Dashboard → Authentication)

1. **Sign In / Providers → Email:** enabled. **Confirm email:** ON.
2. **URL Configuration:**
   - Site URL: your production URL (e.g. `https://app.example.org`)
   - Redirect URLs:
     - `http://localhost:3000/**`
     - `https://<production-domain>/**`
     - `https://*-<vercel-team-slug>.vercel.app/**` (Vercel previews)
3. **Emails → Templates:** replace the two templates below with the files in `supabase/templates/`. They use the token-hash format, so links work when opened on a different device or browser.
   - Confirm signup: `supabase/templates/confirm-signup.html`
     (link: `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`)
   - Reset password: `supabase/templates/reset-password.html`
     (link: `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`)

   The app always sends a `redirectTo` of `<site>/auth/confirm?next=…`, which is why the templates append with `&`.
4. **Password policy (recommended):** minimum length 10. The app also enforces 10 characters with a letter and a digit.
5. **Rate limits:** keep the defaults. The app shows a friendly "too many attempts" message.

### Storage

The migrations create both buckets with type and size limits:
- `branding` (public, 2 MB, PNG/JPEG/WebP)
- `announcement-images` (private, 4 MB, PNG/JPEG/WebP)
- `profile-photos` (private, 1 MB, WebP only; the app re-encodes every upload with `sharp`)

No dashboard work is needed. Phase 2 adds no environment variables. Photo processing uses `sharp`, a normal runtime dependency that Vercel supports.

## 3. Resend

1. Verify your sending domain in Resend (DNS records).
2. **Auth emails through Resend:** Supabase → Authentication → Emails → SMTP Settings → enable custom SMTP:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key
   - Sender email on the verified domain, sender name "The Gathering"

   Supabase's built-in email service only delivers to project team members and is heavily rate-limited, so custom SMTP is required before real members register.
3. **App notifications:** set `RESEND_API_KEY` and `EMAIL_FROM` in Vercel (server-only, not `NEXT_PUBLIC`).

## 4. Vercel

1. Import the GitHub repository. The framework is detected as Next.js and the defaults are fine (`npm run build`).
2. Add the environment variables from section 1:
   - Supabase URL and publishable key for Production and Preview
   - `NEXT_PUBLIC_SITE_URL` for Production only
   - Resend variables, if used
3. Add the production and preview URL patterns to the Supabase Redirect URLs (section 2).
4. Do not promote to production until Phase 1 is reviewed.

## 5. Appoint the first super administrator (one time)

1. The person registers in the app and clicks the verification link. Their account shows "pending approval".
2. Run **one** of these:
   - **Terminal:**
     ```bash
     NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<secret> \
       npm run admin:bootstrap -- person@example.org
     ```
   - **Supabase SQL editor:**
     ```sql
     select public.bootstrap_super_admin('person@example.org');
     ```
3. They sign out and back in and see **Administration**.

The function refuses to run again once any super administrator has been appointed. Clients can't call it, and it isn't exposed in the app. Add further administrators from **Admin → Members → (member) → Roles**. The database blocks removing or suspending the last active super administrator.

## 6. Local development

```bash
npm install
cp .env.example .env.local      # Supabase URL + publishable key
npm run dev
```

Tests:

```bash
npm run lint && npm run typecheck
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test   # unit + RLS tests
npm run build && npm run test:e2e                                                 # browser tests
```

The RLS tests run the real migrations against plain PostgreSQL 15+ with a small Supabase shim (`supabase/tests/supabase-shim.sql`). They never touch a hosted project.

## 7. Brand assets

The supplied artwork lives in `assets/brand/source/` and is never edited. To regenerate the web and PWA copies after replacing a source file (keep the same filenames), run:

```bash
npm run brand:assets
```

The script refuses to crop artwork and checks that maskable icons stay in the safe zone.
