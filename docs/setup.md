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
| `EVENTS_JOB_SECRET` | Vercel Preview, branch-scoped (server, sensitive) | For event and community email/push | Shared with `events.secrets('job')`; signs the scheduler and email delivery. Without it, events and RSVPs work but email stays queued. See [events-guide.md](events-guide.md#scheduler-reminders-and-retries). |
| `EVENTS_EMAIL_ALLOWLIST` | Vercel Preview | Recommended | Test addresses that may receive event email outside production (falls back to `GIVING_EMAIL_ALLOWLIST`; with neither, nothing is sent) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Vercel Preview (private key sensitive, server only) | Optional (web push) | VAPID key pair for web push and a contact (`mailto:…` or `https://…`). Without all three, push is off and in-app/email still work. See [notifications.md](notifications.md#web-push-optional). |
| `MEDIA_RATE_SECRET` | Vercel Preview (server, sensitive) | Optional | Key for hashing visitor IP addresses in the public podcast feed's rate limit (falls back to `EVENTS_JOB_SECRET`). Never logged; hashes are purged within a day. |
| `API_BIBLE_KEY` (any name you choose) | Vercel (server, sensitive) | Only for an API.Bible translation | The church's API.Bible key. The translation stores only this variable's **name**. Not needed for stored-text translations such as the WEB. See [bible-sources.md](bible-sources.md#apibible-configuration). |
| `API_BIBLE_BASE_URL` | Vercel (server) | Optional | API.Bible base URL (default `https://rest.api.bible/v1`); only the provider's own https hosts are accepted. |
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
16. `20261021000400_settings_safeupdate.sql` (Phase 4 fix: settings saves on hosted Supabase)
17. `20261022000100_community_schema.sql` (Phase 5)
18. `20261022000200_community_notifications.sql` (Phase 5)
19. `20261022000300_community_forum.sql` (Phase 5)
20. `20261022000400_community_groups.sql` (Phase 5)
21. `20261022000500_community_messaging_moderation.sql` (Phase 5)
22. `20261023000100_home_coming_up_banner.sql` (home redesign)
23. `20261024000100_prayer_schema.sql` (Phase 6)
24. `20261024000200_prayer_notifications.sql` (Phase 6)
25. `20261024000300_prayer_requests.sql` (Phase 6)
26. `20261024000400_prayer_care.sql` (Phase 6)
27. `20261025000100_media_schema.sql` (Phase 7)
28. `20261025000200_media_library.sql` (Phase 7)
29. `20261025000300_media_content.sql` (Phase 7)
30. `20261025000400_media_podcasts.sql` (Phase 7)
31. `20261025000500_media_gallery.sql` (Phase 7)
32. `20261025000600_media_notifications.sql` (Phase 7)
33. `20261026000100_bible_schema.sql` (Phase 8)
34. `20261026000200_bible_sources.sql` (Phase 8)
35. `20261026000300_bible_plans.sql` (Phase 8)
36. `20261026000400_bible_member.sql` (Phase 8)
37. `20261026000500_journal.sql` (Phase 8)
38. `20261026000600_bible_notifications.sql` (Phase 8)
39. `20261026000700_bible_import_statistics.sql` (Phase 8 follow-up)
40. `20261027000100_memory_schema.sql` (Phase 9)
41. `20261027000200_memory_collections.sql` (Phase 9)
42. `20261027000300_memory_practice.sql` (Phase 9)
43. `20261027000400_memory_challenges.sql` (Phase 9)
44. `20261027000500_memory_notifications.sql` (Phase 9)
45. `20261028000100_youth_event_audience.sql` (Phase 10)
46. `20261028000200_youth_schema.sql` (Phase 10)
47. `20261028000300_youth_access.sql` (Phase 10)
48. `20261028000400_youth_family.sql` (Phase 10)
49. `20261028000500_youth_accounts.sql` (Phase 10)
50. `20261028000600_youth_groups_events.sql` (Phase 10)
51. `20261028000700_youth_communication_learning.sql` (Phase 10)
52. `20261028000800_youth_media_consent.sql` (Phase 10)
53. `20261028000900_youth_notifications.sql` (Phase 10)
54. `20261028001000_youth_transition_second_admin.sql` (Phase 10 follow-up)

Phase 10 (youth and families) migrations each have a one-transaction operator script, `supabase/manual/2026-10-28-apply-youth-<1-10>.sql` (2–63 KB, under the SQL editor limit), with a preflight (step 1 needs `20261027000500`; each later step needs the one before; none runs twice). Step 10 is a follow-up fix (two-administrator adult transition). Step 1 only adds the `youth` event audience (an enum value can't be used in the transaction that adds it), so it must be its own run. No environment variables and no scheduler change: youth reminders run inside the existing `community.tick()`. They create the private `youth` bucket (child avatars). Then assign the youth and family roles at Administration → Members (explicit only, even for super administrators) and approve a policy before any policy-gated feature works ([youth-family-admin-guide.md](youth-family-admin-guide.md#first-time-setup)). `supabase/tests/youth-fingerprint.sql` compares the hosted result with a fresh build (expected digests in [migration-history.md](migration-history.md#phase-10-2026-10-28)).

Phase 9 (scripture memory) migrations each have a one-transaction operator script, `supabase/manual/2026-10-27-apply-memory-<1-5>.sql` (17–87 KB), with a preflight (step 1 needs `20261026000700`; each later step needs the one before; none runs twice). Run them in order in the SQL editor. No environment variables and no scheduler change: memory reminders and challenge milestones run inside the existing `community.tick()`. They create the private `memory` bucket. Then assign **Memory verse editor** / **Memory verse publisher** at Administration → Members, and authorize group leaders at Administration → Memory verses if wanted ([memory-admin-guide.md](memory-admin-guide.md)). Memory practice needs an active stored-text translation (the WEB). `supabase/tests/memory-fingerprint.sql` compares the hosted result with a fresh build (expected digests in [migration-history.md](migration-history.md#phase-9-2026-10-27)).

Phase 8 (Bible reading and journals) migrations each have a one-transaction operator script, `supabase/manual/2026-10-26-apply-bible-<1-7>.sql` (step 7 is a small follow-up; the others are 19–55 KB, under the SQL editor limit), with a preflight (previous step recorded, this one absent). Run them in order in the SQL editor. No scheduler change is needed: reminders run inside the existing `community.tick()`, which the designated deployment already calls. They create the private `bible` bucket. Then, at Administration → Members, assign the Bible source manager and reading plan editor/publisher roles as needed ([reading-plan-guide.md](reading-plan-guide.md#who-can-do-what)), and set up a translation ([bible-sources.md](bible-sources.md)). `supabase/tests/bible-fingerprint.sql` compares the hosted result with a fresh build.

Phase 7 (teaching and media) migrations each have a one-transaction operator script, `supabase/manual/2026-10-25-apply-media-<1-6>.sql` (37–59 KB, under the SQL editor limit), with a preflight (previous step recorded, this one absent). Run them in order in the SQL editor, then `supabase/manual/2026-10-25-media-scheduler.sql` to make the Phase 7 preview the designated scheduler deployment. They create the private `media` and `media-uploads` buckets. After applying, assign the content publisher, media manager, podcast manager, and gallery moderator roles as needed ([media-guide.md](media-guide.md#roles-and-permissions)). `supabase/tests/media-fingerprint.sql` compares the hosted result with a fresh build.

Phase 6 (prayer and care) migrations each have a one-transaction operator script, `supabase/manual/2026-10-24-apply-prayer-<1-4>.sql`, with a preflight (previous step recorded, this one absent). Run them in order in the SQL editor. No scheduler change is needed: follow-up reminders run inside the existing `community.tick()`. After applying, assign prayer/care roles at Administration → Members (explicit only; see [prayer-care-guide.md](prayer-care-guide.md)). Retention stays off until the church adopts a policy ([prayer-retention.md](prayer-retention.md)).

Phase 5 (community) migrations each have a one-transaction operator script, `supabase/manual/2026-10-22-apply-community-<1-5>.sql`, kept under the SQL editor's request limit. Run them in order; each refuses to run out of order or twice. Then run `supabase/manual/2026-10-22-community-scheduler.sql` (after filling in the designated branch URL) so the existing scheduler also handles community digests, retention, and delivery. Status on the hosted project: [build-status.md](build-status.md#phase-5-community-groups-messaging-and-notifications).

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

### Realtime (Phase 5)

Community live updates use **private** Broadcast channels (`member:<id>`), authorized by an RLS policy on `realtime.messages` that the Phase 5 migrations create. Nothing to configure in the dashboard: private channels work with the default setting. If you ever turn on **Realtime → Settings → "Allow public access: off"**, community updates keep working, because they never use public channels. The app falls back to polling every 60 seconds if Realtime is unavailable.

### Storage

The migrations create both buckets with type and size limits:
- `branding` (public, 2 MB, PNG/JPEG/WebP)
- `announcement-images` (private, 4 MB, PNG/JPEG/WebP)
- `profile-photos` (private, 1 MB, WebP only; the app re-encodes every upload with `sharp`)
- `event-images` (private, 2 MB, WebP; Phase 4)
- `group-images` (private, 2 MB, WebP; Phase 5; readable only by people who may see the group)
- `media` (private, 50 MB, audio/video/images/PDF/PPTX/VTT; Phase 7; readable only through the content visibility rules, via short-lived signed links)
- `media-uploads` (private, 50 MB, JPEG/PNG/WebP/HEIC; Phase 7; quarantine for gallery originals, deleted after processing)
- `bible` (private, 50 MB, WebP/PDF/CSV/TSV/plain text; Phase 8; plan covers readable by the plan's members, staged text imports and reference PDFs readable only by Bible source managers)
- `memory` (private, 10 MB, WebP; Phase 9; collection covers readable only by people who can see the collection, written by its editors)

The 50 MB limits match the Free plan's per-file cap. On a paid plan, raise the project's upload limit (Storage → Settings) and the bucket limit together, then the limits in `/admin/media/settings`. Storage, egress, and video delivery costs: [media-guide.md](media-guide.md#storage-delivery-and-costs).

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
