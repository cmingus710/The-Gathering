# Phase 11: release readiness

Assessed 2026-10-21 on branch `claude/quirky-dirac-k63ji2` (main + PR #17 + PR #16 + Phase 11 fixes). Nothing here was merged, deployed to production, or applied to the hosted database.

**Verdict:** the core adult features are ready for a **small adult pilot** once the five blockers in [Release blockers](#release-blockers) are cleared. Giving stays in Stripe test mode and should be hidden or clearly marked as a test during the pilot. Youth features stay off.

Related: [administrator-guide.md](administrator-guide.md) · [pilot-launch-runbook.md](pilot-launch-runbook.md) · [operations-recovery.md](operations-recovery.md) · [build-status.md](build-status.md) · [deployment.md](deployment.md)

## Actual project state (verified, not taken from docs)

| Item | State | How it was checked |
| --- | --- | --- |
| Production | `www.gathering.church` serves `main` at `5add6de` (Phase 9 code plus the owner's brand SVG upload, deployed 2026-10-21 09:15 UTC). Production builds are **not** paused | Vercel deployments and aliases |
| PR #17 (Phase 9 test timezone fix) | Open, mergeable, test-only change. Merged into this branch | GitHub, `git log` |
| PR #16 (Phase 10 youth and families) | Open, not merged. Merged into this branch | GitHub |
| Hosted database | **54 migrations**, including all of Phase 10 (`20261028000100`…`001000`). So **production runs Phase 9 code on a Phase 10 schema** | Supabase migration list |
| Phases merged to `main` | 1–9 | `git log origin/main` |
| Shared infrastructure | Previews and production share **one** Supabase project (database, Auth, Storage), the same Resend key and sender, and the same `EVENTS_JOB_SECRET`. Vercel Deployment Protection is **off**, so every preview URL is public | Vercel env list (names only), project settings |
| Scheduler | `pg_cron` `events-worker` every 5 min → `https://www.gathering.church/api/jobs/events`. Last 24 h: 288 runs, 0 failures; outboxes hold only `sent` rows | Read-only SQL |
| Giving | Production has Stripe **test** keys. The Stripe sandbox webhook goes to `giving-webhooks.gathering.church`, which is assigned to the **`phase-3/giving-contributions` preview**, not production | Vercel project domains, Phase 3 record |
| Web push | No VAPID keys in any environment, so push is off everywhere; 0 push subscriptions | Vercel env list, SQL |
| Members | 3 approved profiles (the owner's test accounts); no real members invited | Read-only SQL |
| Youth policy | None approved; all policy-gated youth features off | SQL, local walkthrough |
| Supabase plan | **Free** (no downloadable backups; project pauses after ~7 days of low activity) | Supabase organization, Supabase docs |

## Feature status matrix

Legend: **Ready** = verified end to end in a browser (locally against real migrations) plus earlier hosted checks · **Ready (DB)** = verified by database tests and hosted database walkthroughs, browser check partial · **Test mode** · **Off** · **Not built**.

| Area | Status | Evidence | Gaps |
| --- | --- | --- | --- |
| A. Registration, verification, pending, approval, sign-in/out, password reset, suspension, roles | **Ready** | Local walkthrough 01 (8 checks, real Supabase Auth + Mailpit) | Approval email only when Resend is configured (honest message otherwise); hosted signed-in walk not done |
| B. Directory, profile, privacy, opt-out, households | **Ready** | Walkthrough 02 (opt-out hides from search and direct URL), Phase 2 hosted UI walk | Profile photo bypass of re-encoding (Low, see security) |
| C. Giving | **Test mode** | Phase 3 hosted sandbox walkthrough (one-time, monthly, failed card, refund, dispute, portal, statements draft); walkthrough 03 (not-configured state, finance refusal) | Webhooks processed by the Phase 3 preview; statements stay drafts; live mode not authorized |
| D. Community forum, replies, reports, moderation, DMs | **Ready** (forum, reports); **Ready (DB)** (DMs) | Walkthrough 02 (post, inert markup, reply notification, report to moderators); DB suites | **Forum/DM media attachments not built** (deferred to "Phase 13" in roadmap; composer says so) |
| E. Prayer | **Ready** | Walkthrough 02 (share confirmation, private drafts invisible to members and super admin, "I'll pray", generic notification text) | Hosted prayer email not observed |
| F. Events | **Ready** | Walkthrough 03 (create, publish, RSVP, .ics in UTC, cancel, outbox), DST sweep | No calendar import (export and feed only, by design); fall-back-hour times documented |
| G. Bible, devotionals, lessons, media, music, podcasts, gallery | **Ready (DB)** + signed-in smoke | 25-route signed-in smoke; DB suites; SSRF fix | Lesson Studio / Follow Along / teacher handout builder **not built**; Audible is an external link only; embeds not checked on devices |
| H. Scripture memory | **Ready (DB)** | Phase 9 hosted DB walk; midnight/DST clock sweep | Hosted signed-in walk not done |
| I. Notifications (in-app, email) | **Ready** (in-app); email **Ready (DB)** | Walkthrough 02 unread count + open link; generic titles | **Web push off** (no VAPID keys); no device push test |
| J. Youth & families | **Off** (policy gate closed) | Walkthrough 03 (no approved policy, super admin has no youth access, member scoped); 48 DB tests; hosted DB walk | Do not activate on shared hosting; signed-in youth walk needs an isolated project |
| PWA | **Ready** (automated) | Service worker caches only public static assets before and after sign-out; offline fallback generic | Installation on physical iPhone/Android not done |
| Accessibility | **Automated pass** | axe WCAG 2.2 A/AA: 0 violations on 27 routes, desktop + Pixel 7, dark theme; 320 px and 200 % text without sideways scroll; keyboard skip link and More menu | Screen reader (VoiceOver/TalkBack) and device checks need you; not a WCAG compliance claim |

## Release blockers

In priority order. Items 1–5 block the adult pilot; 6–8 block a public launch.

1. **No database or file backups** (Free plan). Upgrade the Supabase organization to Pro (daily backups, 7 days; no auto-pause), and take the first manual backup with [operations-recovery.md](operations-recovery.md#taking-a-backup) before inviting anyone. Storage files are never in database backups on any plan; use `scripts/storage-backup.mjs`.
2. **Previews write to production.** Public preview URLs use the production database, Auth, and real email. Anyone who finds a preview can register a real account, and preview testing can email members. Before the pilot: turn Vercel Deployment Protection back on for previews (Standard Protection), or point previews at a separate Supabase project. If Stripe needs the webhook host, use a protection bypass for that path or move the webhook to production (blocker 3).
3. **Giving webhooks go to the Phase 3 preview.** Production checkouts are recorded by old branch code. Either hide Give for the pilot or move `giving-webhooks.gathering.church` to production (Vercel → Domains → assign to Production) and re-run the hosted giving checks in test mode.
4. **Production code is behind the hosted schema.** Production runs Phase 9 code on the Phase 10 schema. It works (sign-in, scheduler 288/288), but review and merge PR #17, PR #16, then this branch, so code and schema match before testers arrive.
5. **Hosted signed-in walkthrough not done.** Local signed-in walkthroughs pass against the real migrations, but no one has signed in to the hosted app as the test accounts. See [the next action](#the-one-next-action).
6. Leaked-password protection is off in Supabase Auth (security advisor). Turn it on (Pro plan).
7. Web push has no VAPID keys; either set them (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) and test on devices, or tell testers notifications arrive in the app and by email only.
8. Bible WEB/ASV attribution text is empty on hosted (Administration → Bible sources).

## What Phase 11 fixed

| Fix | Why | Regression test |
| --- | --- | --- |
| Feed fetcher keeps its SSRF check behind an HTTP proxy (`src/lib/media/safe-fetch.ts`) | With `NODE_USE_ENV_PROXY` + `HTTP_PROXY` (or a replaced global agent), Node sent the request to the proxy and **never ran the private-address check**: the reported "HTTP 503" was the proxy answering. Now a dedicated agent per request and a peer-address check | `safe-fetch.test.ts` reproduces the 503 on the old code |
| Markdown links: `"/\t/evil.example"` was accepted as a same-site path; browsers drop the tab and open another site | Community posts and announcements | `markdown.test.ts`, `format.test.ts` |
| Function grants pinned by migration `20261029000100` | A project built from the repo (recovery target, staging) let anon call ~160 more functions than hosted. No-op on hosted | `tests/db/grants.test.ts` fails without it |
| Two clock-dependent tests | `prayer.test.ts` would have failed for real after 2026-11-01; `events.test.ts` failed during the fall-back hour | Full suite at 11 clock instants |
| Mobile and navigation polish | Composer under the mini-player, dock labels at 320 px, empty "Coming later" menu, double-active admin nav, long emails in headers, 40 px targets, confirmations for five irreversible actions, Decline wording and focus | `navigation.test.ts`, walkthrough 01 (role-removal dialog, focus) |
| Local seed could not sign in | NULL token columns and no identities in `supabase/seed.sql` | Walkthrough suite uses it |
| `prayer` and `events` added to the `no-store` header list | Defense in depth (the proxy already covered prayer) | Walkthrough 03 smoke checks `no-store` on 25 routes |

## Validation results

### Local automated (this environment)

| Check | Result |
| --- | --- |
| Lint (`npm run lint`), typecheck (`npm run typecheck`) | Pass |
| Production build | Pass |
| Vitest (unit + database against PostgreSQL 16 from all 55 migrations, serial) | **765 passed / 765** (62 files) |
| Same suite under a faked clock at 00:30, 03:59, 04:01, 05:01, 23:59 UTC, 2026-11-01 05:30 and 06:30 (fall back), 2026-11-15, 2027-03-14 07:30 (spring forward), 2027-06-15 | All pass after the two test fixes; the unfixed Phase 9 test fails at 00:30 as reported |
| `safe-fetch.test.ts` with a real env proxy (`NODE_USE_ENV_PROXY=1 HTTP_PROXY=…`) | Pass (failed before the fix) |
| Playwright signed-out suite (`npm run test:e2e`, clean unconfigured build) | **322 passed / 322** (desktop and Pixel 7) |
| Local signed-in walkthrough (`tests/e2e-local`, real Supabase Auth/PostgREST/Storage/Mailpit) | **35 passed** (19 flows on desktop; 8 accessibility/PWA checks on each of desktop and Pixel 7), final run on the restored rehearsal database |
| Recovery rehearsal (local, disposable) | Database and files restored: identical row counts in 46 tables, identical file hashes, youth fingerprint equal to hosted digests |

### Hosted database (read-only only)

Migration list (54), scheduler health, outbox state, function-grant baseline (29 anon / 1 service_role / 0 PUBLIC), default privileges, security advisors (expected notices plus leaked-password protection off). Nothing was written.

### Hosted signed-in browser

**Not run.** No test credentials are available here, and this environment can't reach `www.gathering.church` directly (network policy); Vercel's fetch tool confirmed `/sign-in` renders with `private, no-store` and security headers.

### Physical devices

**Not run** (needs you): iPhone and Android installation, standalone launch, push, VoiceOver/TalkBack, media playback and embeds on a phone.

## Local signed-in walkthrough

Repeatable with no hosted services:

```sh
npx supabase@2 init && cp -r supabase/{migrations,seed.sql,templates} <stack>/supabase/   # or run in the repo
# config.toml: site_url http://localhost:3100, enable_confirmations = true, and the two templates in supabase/templates
npx supabase@2 start
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key> \
  NEXT_PUBLIC_SITE_URL=http://localhost:3100 npm run build && npx next start -p 3100
npx playwright test -c playwright.local.config.ts
```

The helpers refuse any non-loopback target. Seeded accounts (`admin@`, `editor@`, `member@example.test`) use the password in `supabase/seed.sql`, which is local-only.

## Security review summary

Checked with code evidence (details in the PR): authorization in route handlers and RPCs, privilege escalation, storage buckets, uploads, embeds, webhooks, job signatures, secrets in bundles and logs, notification text, caching, redirects. Fixed: the SSRF proxy bypass, the Markdown link bypass, the grant baseline. Remaining, all Low:

- Gallery review copies and profile photos can be uploaded directly with the member's own session, skipping server re-encoding (EXIF kept for the uploader's own photo; published gallery copies are re-encoded at approval). Fix needs a privileged upload path.
- Failed youth activation codes aren't counted by the rate limiter (the raise rolls the counter back); codes are 64-bit and email-bound. Youth accounts are off.
- No Content-Security-Policy header (the embed code mentions one). `X-Frame-Options: DENY`, `nosniff`, HSTS, and Permissions-Policy are set.
- `media_public_hit` is callable by anon, so the public-feed rate table can be inflated (purged daily).
- No app-level rate limit on sign-in, sign-up, and reset beyond Supabase Auth's limits, which see Vercel's shared IP. Consider Supabase CAPTCHA before a public launch.

## Configuration and SQL actions for you

| # | Action | Where | Why |
| --- | --- | --- | --- |
| 1 | Upgrade the Supabase organization "Paint By Numbers" to **Pro** | Supabase → Organization → Billing | Daily backups, no auto-pause, leaked-password protection |
| 2 | Take a backup now | [operations-recovery.md](operations-recovery.md#taking-a-backup) | First restorable copy, including files |
| 3 | Turn on Vercel Deployment Protection for previews | Vercel → the-gathering → Settings → Deployment Protection | Previews write to production |
| 4 | Decide giving for the pilot: hide Give, or move `giving-webhooks.gathering.church` to Production | Vercel → Domains | Webhooks currently reach the Phase 3 preview |
| 5 | Review and merge PR #17, then PR #16, then the Phase 11 PR | GitHub | Production code matches the hosted schema |
| 6 | Optional: run `supabase/manual/2026-10-29-apply-grant-baseline.sql` | Supabase SQL editor | Records `20261029000100`; it changes nothing on hosted and refuses if it would |
| 7 | Turn on leaked-password protection | Supabase → Authentication → Settings | Security advisor |
| 8 | Add WEB/ASV attribution text | Admin → Bible sources | Pages show code and name only |
| 9 | Tell me where the three new brand SVGs (`assets/brand/source/gather-with-us.svg`, `grow-in-faith.svg`, `share-life.svg`) go | — | Uploaded to `main`, not used anywhere yet |

## The one next action

Upgrade the Supabase organization to Pro and take the first backup (actions 1–2). Everything else is safer once a restorable copy exists. After that, the hosted signed-in walkthrough needs you to sign in as the admin and approved-member test accounts on a protected preview of this branch (I can't sign in as them); the checklist is in [pilot-launch-runbook.md](pilot-launch-runbook.md#hosted-walkthrough-checklist).
