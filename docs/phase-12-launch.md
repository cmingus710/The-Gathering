# Phase 12: controlled pilot and production launch

Prepared 2026-10-21 on branch `claude/gifted-knuth-j22tsl` (the Phase 12 branch). **Nothing has been merged, promoted, deployed to production, applied to the hosted database, or sent to anyone.** Every hosted check below was read-only.

Related: [phase-11-release-readiness.md](phase-11-release-readiness.md) · [pilot-checklist.md](pilot-checklist.md) (for testers) · [pilot-launch-runbook.md](pilot-launch-runbook.md) · [operations-recovery.md](operations-recovery.md) · [deployment.md](deployment.md) · [migration-history.md](migration-history.md)

**Recommendation: NO-GO for production today; GO for the adult pilot once owner actions C1–C4 in [Required configuration](#required-configuration) are done and the hosted and phone checks pass (blockers 1–5 in the [issue log](#issue-log)).** The code is ready (all automated checks pass, two defects found in this phase are fixed), but the hosting setup still has the Phase 11 blockers: no backups, public previews writing to production data, and Stripe test webhooks going to an old preview.

## Release candidate

| | |
| --- | --- |
| Branch / PR | `claude/gifted-knuth-j22tsl` → `main`, [PR #21](https://github.com/cmingus710/The-Gathering/pull/21) |
| Release-candidate code commit | `ce4013c` ("Label online giving as testing only"). Later commits on the branch change only `docs/` |
| Base | `main` at `5add6de` (what production serves now) |
| Contains | PR #17 (Phase 9 test timezone fix), PR #16 (Phase 10 youth and families, policy-gated off), PR #20 (Phase 11 release readiness), PR #18 (welcome page redesign), PR #19 (Spotify players on Music), branch `claude/loving-bohr-70o007` (mobile header and docked bottom nav; it had no PR), and the Phase 12 changes below. All merged cleanly, no conflicts |
| Preview | Vercel builds a preview for every push to this branch (`the-gathering-git-claude-gifted-knuth-j22tsl-paint-by-number.vercel.app`). **That preview uses the production database, Auth, and email** (see [Shared resources](#environments-and-shared-resources)). Test it only with the test accounts and `[TEST]` content |

Merging this one PR brings all of the above to `main`. PRs #16–#20 can then be closed as superseded (or merged first in order #17, #16, #20, #18, #19; either way the result is identical).

## What changed in Phase 12

| Change | Why | Coverage |
| --- | --- | --- |
| **Report a problem** (More → You, and the desktop sidebar): category, description, the page path (no query string or fragment, and the member can leave it out), optional "may email me". Private to super administrators at Admin → Problem reports, with Open/Resolved. 5 per member per hour. Approved adult members only | Pilot feedback with no existing mechanism | `tests/db/problem-reports.test.ts` (7), `src/lib/feedback/report.test.ts` (3), browser spec 05 |
| **Defect: dropdowns changed after a validation error.** React resets a form after its action runs; a `<select>` then jumped to its first option while the page still showed the member's choice, so a corrected resubmission sent a different value. Confirmed on *Request help* ("visit" became "meal") and on Report a problem. Fixed once in `SelectField` (`src/components/ui/select.tsx`) | Wrong data saved without the member noticing | Browser spec 05 (care request regression) |
| **Defect: Profile wider than the phone screen** (430 px at 320 and 375 px), which also stretched the bottom navigation past the edge | Mobile layout | Browser spec 05 (nine pages × three widths) |
| **Giving labelled "Testing only"** on `/give` | Production has Stripe test keys and showed a working checkout with no test label | Visual, see [Known limitations](#known-limitations) |
| Migration `20261030000100_problem_reports` (additive) and its SQL-editor script | Report a problem | Rehearsed, see [Migrations](#required-migrations) |
| One Phase 11 browser assertion made robust (a hidden copy during refresh counted twice) | Test-only | — |

The recent UI work, verified in this release candidate (browser spec 05, desktop and Pixel 7):

- **Welcome page:** barn photo loads; the three supplied SVG icons (`/brand/welcome/*.svg`) are served as `image/svg+xml` and rendered; Sign in → `/sign-in`, Create an account → `/sign-up`; no section renders empty (sections with no configured data are left out); no sideways scroll; axe: 0 serious/critical.
- **Music:** each published playlist the member can see shows its Spotify player directly on `/music` (`open.spotify.com/embed/playlist/…`), with Save (round trip to `/saved` checked) and Open in Spotify; drafts don't appear.
- **Phone shell** on `/home`, `/events`, `/community`, `/messages`, `/prayer`, `/music`, `/memory`, `/profile`, `/report-problem` at 320, 375, and 412 px: the full "The Gathering" wordmark fits (never truncated) and clears the bell; bell and profile are ≥ 44 px and on screen; the dock is `position: fixed`, flush with the bottom edge (0 px gap), full width, with a background; the last content and every other fixed control end above the dock; no sideways scroll.

## Known limitations

- **Spotify playback not observed here.** This environment can't reach `open.spotify.com`, so the player frame showed a browser error page in screenshots. The embed URL, Save, and Open in Spotify were checked; actual playback needs a phone check (D4 below).
- **Public welcome information is empty on hosted.** Church settings have no description, gathering times, address, phone, or email, so the welcome page shows only the hero and the three icons (no empty boxes, by design). Fill them in at Admin → Church settings before inviting anyone; nothing was invented here.
- **Giving:** test mode only. The checkout is labelled, but the webhook host still points at the Phase 3 preview, so a pilot test gift would be recorded by old branch code. Either hide Give (close every fund in Admin → Giving → Funds, which shows "No funds are open for giving right now") or move the webhook domain to Production. See blocker 3.
- **Web push off** (no VAPID keys): notifications arrive in the app and by email only.
- **Not built:** forum and message attachments, Lesson Studio, Follow Along, teacher handout builder.
- **The phone dock truncates "Community" to "Commu…" at 320 px** (readable at 375 px and up). Enhancement, not changed.
- **Same grid pattern** as the Profile defect exists on nine other pages (prayer, memory verse, admin detail pages). Measured fine at 320 px on `/prayer` and `/memory`; others weren't measured on a phone.
- Phase 11 Low security notes still apply (no CSP header, direct-upload profile/gallery copies, no app-level sign-in rate limit).

## Required configuration

No new environment variables. Nothing was changed. Owner actions before the pilot:

| # | Action | Where | Status (read-only check, 2026-10-21) |
| --- | --- | --- | --- |
| C1 | Upgrade the Supabase organization "Paint By Numbers" to **Pro**, then take a backup (database and Storage files) | Supabase → Organization → Billing; [operations-recovery.md](operations-recovery.md#taking-a-backup) | **Free** plan |
| C2 | Turn on **Vercel Deployment Protection** (Standard) for previews | Vercel → the-gathering → Settings → Deployment Protection | **Off** (SSO and password protection disabled) |
| C3 | Giving for the pilot: hide Give (close funds) **or** assign `giving-webhooks.gathering.church` to Production and re-run the test-mode giving checks | Admin → Giving, or Vercel → Domains | Webhook domain assigned to branch `phase-3/giving-contributions` |
| C4 | Church settings: description, gathering times, address, contact email/phone | Admin → Church settings | All empty |
| C5 | Leaked-password protection on (needs Pro) | Supabase → Authentication | Off (Phase 11 advisor) |
| C6 | WEB/ASV attribution text | Admin → Bible sources | Empty (Phase 11) |

## Required migrations

Hosted has **54** migrations (latest `20261028001000`); checked with the Supabase connector.

| Migration | Required? | Effect | Compatible with the app deployed now? |
| --- | --- | --- | --- |
| `20261029000100_function_grant_baseline` (Phase 11) | Optional | No privilege change on hosted; records the version. Refuses if anything would change | Yes |
| `20261030000100_problem_reports` (Phase 12) | **Yes**, before the code is merged | Adds `public.problem_reports` (RLS on, no API grants) and three functions for `authenticated`: `problem_report_submit`, `admin_problem_reports`, `admin_problem_report_set_status`. Alters nothing existing | Yes: production code (`5add6de`) never references them; rolling back code leaves an unused table |

- No applied migration was edited.
- **Script:** `supabase/manual/2026-10-30-apply-problem-reports.sql` (one transaction; preflight needs `20261028001000`, refuses a second run; post-check fails if the table or functions would be reachable without signing in; records `created_by = phase-12`). Works whether or not the optional Phase 11 script was run.
- **Rehearsal (local PostgreSQL 16):** a database built from the 54 hosted migrations with their history rows and *without* the grant baseline (the hosted state): the script applied; a rerun stopped at the preflight with "Nothing was changed". Full test suite and a local Supabase stack (PostgreSQL 17.11, the hosted major version) built from all 56 migrations pass.
- If the code reaches production before the migration: Report a problem shows "Your report couldn't be sent" and the admin page shows "Problem reports couldn't be loaded"; nothing else is affected.

## Environments and shared resources

Read-only checks on 2026-10-21; nothing was changed to inspect them.

| Item | Production | Previews | Intended? |
| --- | --- | --- | --- |
| URL | `www.gathering.church` (`gathering.church` → 308), `the-gathering-five.vercel.app`; serves `main` `5add6de` (`dpl_8FFrU3WNeR5yzpMfGRzo8df4t4ky`) | `the-gathering-git-<branch>-paint-by-number.vercel.app`, public | Production yes; previews should be protected (C2) |
| Supabase (DB, Auth, Storage) | `ymuiutwdnhxdqsetnwkt` | **Same project** | Known risk (Phase 11 blocker 2) |
| `NEXT_PUBLIC_SITE_URL` (auth email links) | `https://www.gathering.church` | Not set, so previews use their own branch URL | Yes |
| Auth redirect URLs | Site URL `https://www.gathering.church` plus `/**` (recorded in deployment.md; Auth settings can't be read through the connector) | Preview entries kept | Recheck in Supabase → Authentication → URL Configuration |
| Email | Resend, sender `The Gathering <hello@gathering.church>`, same key | Same key and sender | Previews can email real people (C2) |
| Scheduler | `pg_cron` `events-worker` every 5 min → `https://www.gathering.church/api/jobs/events`; 288/288 runs succeeded in 24 h | None | Yes |
| Job secret | `EVENTS_JOB_SECRET` production+preview (plus two older branch-scoped values) | Same | Acceptable; only production is called |
| Stripe | Test keys in Production; webhook host `giving-webhooks.gathering.church` → **`phase-3/giving-contributions` preview** | Phase 3 branch keys | No (C3) |
| Web push | No VAPID keys; 0 push subscriptions | Same | Off by design |
| Members | 3 profiles, all approved (the owner's test accounts) | — | — |
| Youth | 0 approved policies; youth features gated off | — | Yes |

**No synthetic content is publicly visible:** the only public `[TEST]` items (one event, two announcements) are archived. One `[TEST] Synthetic group supper` event from an earlier phase is still published to a group audience (visible only to that group's members); it isn't this phase's data, so it was left alone. Remove or archive it in Admin → Events if you agree. Members-only playlist, album, and podcast show on hosted are real content and were not touched.

## Validation evidence

All local; nothing hosted was written.

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` | Pass |
| Production build (configured for the local stack, and unconfigured) | Pass |
| Vitest, unit + database (PostgreSQL 16 from all 56 migrations, serial) | **793 / 793** (64 files). A parallel run fails two files creating the same role at once (harness race, known from Phase 11; run serially) |
| Playwright signed-out suite (`npm run test:e2e`, unconfigured build, desktop + Pixel 7) | **324 / 324** |
| Local signed-in walkthrough (`tests/e2e-local` 01–05, real Supabase Auth/PostgREST/Storage/Mailpit on PostgreSQL 17.11, desktop + Pixel 7) | **43 passed, 0 failed**, 21 skipped by design (single-project tests) |
| Automated accessibility (axe WCAG 2.2 A/AA) | 0 serious/critical on the Phase 11 routes plus the welcome page, Report a problem, and Problem reports |
| Hosted signed-in walkthrough | **Not run** (no test credentials here; production domain unreachable from this environment) |
| Physical devices | **Not run** (needs you; see [Device checks](#real-device-checks)) |

Screenshots from the local run (desktop 1280 px and Pixel 7 at 320/390 px) were shared in the session: welcome, Music, home at 320 px, Music and Community at 390 px, Report a problem sent, Problem reports admin.

## Issue log

| # | Severity | Issue | Status |
| --- | --- | --- | --- |
| 1 | **Release blocker** | No backups (Free plan) | Open: owner action C1 |
| 2 | **Release blocker** | Previews public and writing to production data and email | Open: C2 |
| 3 | **Release blocker** | Stripe test webhooks processed by the Phase 3 preview | Open: C3 (or hide Give) |
| 4 | **Release blocker** | Production code behind the hosted schema | Fixed by merging this PR (after the migration) |
| 5 | **Release blocker** | Hosted signed-in walkthrough and phone checks not done | Open: needs you |
| 6 | Important (fixed) | Dropdown value silently changed after a validation error (Request help, Report a problem, any `SelectField` in an action form) | Fixed `4c4d48a`, regression test |
| 7 | Important (fixed) | `/profile` overflowed phones and stretched the dock | Fixed `4c4d48a`, regression test |
| 8 | Important (fixed) | Give showed a test checkout without saying so | Fixed `ce4013c` |
| 9 | Important | Welcome page has no real public information (settings empty) | Open: C4 |
| 10 | Important | Leaked-password protection off; Bible attribution empty | Open: C5, C6 |
| 11 | Later enhancement | "Community" truncated in the dock at 320 px | Recorded |
| 12 | Later enhancement | Web push (VAPID keys and device testing) | Recorded |
| 13 | Later enhancement | Forum/message attachments; Lesson Studio; Follow Along | Recorded (not built) |
| 14 | Later enhancement | Apply `minmax(0,1fr)` to the other single-column grids defensively | Recorded |

Pilot reports arrive at Admin → Problem reports. Triage each one into this table: authorization or privacy failures, lost or corrupted data, broken sign-in, unusable core journeys, mobile navigation, failed uploads or playback, and duplicate or misdirected notifications come first. Enhancement requests go in the last group, not into the pilot release.

## Pilot procedure

1. Complete C1–C4 (C5–C6 recommended), apply the migration, merge, and run the production smoke checks (release steps below).
2. Run the [hosted walkthrough checklist](pilot-launch-runbook.md#hosted-walkthrough-checklist) on production with the test accounts. Use `[TEST]` titles; remove that content afterwards.
3. Do the device checks D1–D10 below.
4. **You choose the pilot testers** (5–10 church-approved adults; no youth, no guardians acting for children, no youth accounts). Nothing is sent until you name the recipients and how to contact them; this app has no bulk-invite feature and none should be used.
5. Testers register at `www.gathering.church`; an administrator approves each one. Give them [pilot-checklist.md](pilot-checklist.md).
6. Two weeks. An administrator reviews Admin → Problem reports twice a week and records confirmed issues in the issue log above.
7. Go/no-go for a congregation-wide launch: no open release blockers, no unresolved privacy or data-loss reports, device checks passed on at least one iPhone and one Android phone.

Stays off during the pilot: live giving, youth features (no policy is approved, and none is to be approved as part of this), web push, and anything listed under Not built.

## Production release steps

Only after you authorize each step:

1. Confirm C1 (Pro plan) and a backup from today (database **and** files).
2. Run `supabase/manual/2026-10-30-apply-problem-reports.sql` in the SQL editor (optionally `2026-10-29-apply-grant-baseline.sql` first). Check: `select version from supabase_migrations.schema_migrations order by version desc limit 2;` shows `20261030000100`.
3. Merge the Phase 12 PR into `main`. Vercel deploys production automatically.
4. Verify the deployed commit: Vercel → Deployments → the production deployment shows the merge commit of this PR, aliased to `www.gathering.church`.
5. Smoke checks with the test accounts: `/` (welcome page and icons), `/sign-in`, sign in as the test administrator; `/home`, More menu, `/music`, `/profile` on a phone; Admin → Members and Admin → Problem reports load; send one `[TEST]` problem report as the test member and mark it resolved; sign out and confirm `/home` returns to sign-in.
6. Errors and scheduling: Vercel → Logs (no new errors), Supabase → Cron (`events-worker` succeeded after the deploy).
7. Report the production URL and outcome.

Not part of release: live giving, youth policy approval, congregation-wide invitations.

## Rollback

| Problem | Do this |
| --- | --- |
| Bad deployment | Vercel → the-gathering → Deployments → `dpl_8FFrU3WNeR5yzpMfGRzo8df4t4ky` (`5add6de`, the current production) → **Promote**. That code works with the new table present. Pause production builds if needed (Ignored Build Step in [deployment.md](deployment.md)) |
| Report a problem misbehaves | Leave the table; roll back code as above, or fix forward. Don't drop the table without a backup; reports are the only copy |
| Database change wrong | No editing or deleting applied migrations. Write a rehearsed forward migration; for data loss follow [operations-recovery.md](operations-recovery.md#recovering-the-database) |
| Unwanted email | `select cron.unschedule('events-worker');` (restore with `supabase/manual/recovery-scheduler.sql`), or remove `RESEND_API_KEY` from Production and redeploy |
| Someone shouldn't have access | Admin → Members → Suspend |
| Pause the pilot | Announcement, suspend pilot accounts, or roll back. Data stays intact |

## Real-device checks

**None of these has been run.** Everything above is from Chromium desktop and Pixel 7 *emulation*. Record each result here as Pass / Fail (with what happened) / Not available, with the device and OS version. Do them on the production URL after release, or on a protected preview.

| # | Device | Check | Result |
| --- | --- | --- | --- |
| D1 | iPhone Safari | Open `www.gathering.church`: welcome photo and three icons; tap Sign in; sign in; header shows the full name, bell, and profile; dock sits on the bottom edge with no gap; scroll up and down so Safari's toolbar shrinks and grows; dock stays put and nothing hides under it | Not run |
| D2 | iPhone Safari | Install: Share → Add to Home Screen; open from the icon: standalone, correct icon, no browser bar; the home indicator sits inside the dock background | Not run |
| D3 | iPhone (installed) | Keyboard: Community → new discussion, and Report a problem: fields stay visible above the keyboard, and the dock doesn't cover the Send button | Not run |
| D4 | iPhone (installed) | Music: press play in a Spotify player (preview or full playback); Open in Spotify opens the Spotify app or site; return to the app with the app switcher; you're still signed in | Not run |
| D5 | iPhone (installed) | Uploads: Profile → photo from the camera roll; Gallery upload if available | Not run |
| D6 | iPhone (installed) | Sign out from More; reopen the app: sign-in page, no private content; Back doesn't show private pages | Not run |
| D7 | Android Chrome | D1, then Install app from the menu or banner, and D3–D6 in the installed app | Not run |
| D8 | Desktop browser | Sign in, sidebar, Report a problem, Admin → Problem reports, sign out | Not run |
| D9 | Any | Notifications: the browser prompt isn't offered (push is off); in-app bell count and email delivery work | Not run |
| D10 | Installed app, after the next deployment | Close and reopen the app: the new version loads (for example, Report a problem is in More) without reinstalling | Not run |

VoiceOver and TalkBack checks remain as listed in the [hosted walkthrough checklist](pilot-launch-runbook.md#hosted-walkthrough-checklist) (row 14).
