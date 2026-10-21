# Build status

Last updated: 2026-10-21 · Phase 13 branch `claude/inspiring-sagan-jlwim7`, based on `main` (`25b7087`, Phase 12 merged) · PR into `main` (not merged)

## Phase 13: Requested features and experience improvements

Everything: [phase-13/README.md](phase-13/README.md) (audit matrix, final status, verification, release steps, limits). Member guide: [phase-13/member-guide.md](phase-13/member-guide.md).

**Nothing was merged, deployed, applied to the hosted database, or sent to anyone. Stripe stays in test mode.**

- **Added:**
  - Fundraising campaigns with a progress meter (`20261031000100`).
  - Photo and video attachments in discussions (`20261031000200`).
  - Lesson builder with a private member workbook (`20261031000300`).
  - Kindle links, reading dates, and private progress for church books (`20261031000400`).
  - A Settings page with a desktop account menu.
  - A notification bell panel.
  - Call, text, email, map, and directions actions on contact details.
- **Fixed:**
  - Choosing System appearance pinned the browser bar colour.
  - `+44 (0)…` numbers dialled wrongly.
  - Hardened the phone dock (background continues below the bar; it steps aside for the keyboard).
- **Verified locally:**
  - Lint, typecheck, and build pass.
  - Vitest 887/887 (73 files, including database suites on PostgreSQL 16.15).
  - Playwright signed-out 322/324 (2 apply only without Supabase configured).
  - 71/71 signed-in Chromium journey checks at phone, tablet, and desktop sizes.
  - Hosted-apply scripts rehearsed in both orders.
- **Not done:** preview deployment and hosted checks, physical iPhone/Android and installed-PWA checks, real Stripe/Storage/Kindle/Audible behaviour.
- **Owner actions:** approve the release, back up, run the four `supabase/manual/2026-10-31-apply-*.sql` scripts, then deploy. See [phase-13/README.md](phase-13/README.md#4-release-boundaries-and-setup).

---

# Phase 12 build status

Branch `claude/gifted-knuth-j22tsl`, merged into `main` as #21.

## Phase 12: Controlled pilot and production launch

No new modules. Phase 12 combined the open work into one release candidate, verified the welcome page, Music players, and phone shell in a browser, added a private **Report a problem** action for the pilot, fixed the defects the walkthrough found, and wrote the launch runbook. Everything: [phase-12-launch.md](phase-12-launch.md). Tester checklist: [pilot-checklist.md](pilot-checklist.md).

**Nothing was merged, deployed to production, applied to the hosted database, or sent to anyone.** Hosted checks were read-only.

- **Added:** Report a problem (member form, Admin → Problem reports for super administrators), migration `20261030000100_problem_reports` with `supabase/manual/2026-10-30-apply-problem-reports.sql`; "Testing only" notice on Give.
- **Fixed:** dropdowns that changed value after a validation error (`SelectField`); `/profile` wider than phone screens.
- **Verified locally:** lint, typecheck, builds; Vitest 793/793 (64 files, serial); Playwright signed-out 324/324; signed-in walkthrough 43 passed (01–05, local Supabase on PostgreSQL 17.11).
- **Not done:** hosted signed-in walkthrough and physical-device checks (need the owner).
- **Blockers (owner):** Pro plan and backup, preview protection, giving webhook decision, church settings. See [phase-12-launch.md](phase-12-launch.md#issue-log).

---

# Phase 11 build status

## Phase 11: Release readiness, verification, and polish

### Summary

No new modules: Phase 11 checked what is actually deployed and configured, fixed the defects it found, verified the app signed in through a browser against the real migrations, rehearsed recovery, and wrote the administrator guide and pilot plan. Full matrix, blockers, and actions: [phase-11-release-readiness.md](phase-11-release-readiness.md). Guides: [administrator-guide.md](administrator-guide.md), [pilot-launch-runbook.md](pilot-launch-runbook.md), [operations-recovery.md](operations-recovery.md).

**Nothing was merged, deployed to production, or written to the hosted database.** Hosted checks were read-only SQL, advisors, and Vercel metadata. Giving stays in Stripe test mode; no youth policy was approved; no one was invited.

### Fixed

| Fix | Files |
| --- | --- |
| SSRF check bypassed when Node uses an HTTP proxy (the reported "HTTP 503" in `safe-fetch.test.ts` was the proxy answering because the address check never ran) | `src/lib/media/safe-fetch.ts` (+ regression test) |
| Markdown link `"/\t/evil.example"` treated as same-site | `src/lib/announcements/markdown.ts` (+ tests) |
| Function grants not reproducible from migrations (a rebuilt project let anon call ~160 more functions); new migration, no-op on hosted | `supabase/migrations/20261029000100_function_grant_baseline.sql`, `supabase/manual/2026-10-29-apply-grant-baseline.sql`, `tests/db/grants.test.ts`, shim |
| Clock-dependent tests (a care-opportunity date that would expire 2026-11-01; an ambiguous fall-back-hour reminder) and PR #17 merged | `tests/db/prayer.test.ts`, `tests/db/events.test.ts`, `tests/db/memory.test.ts` |
| Mobile and navigation polish; confirmations for five irreversible actions | composer, dock, admin nav, page header, shells, member controls, gallery, saved, Bible sources, topics |
| Local seed couldn't sign in with real Supabase Auth | `supabase/seed.sql` |
| Recovery tools | `scripts/storage-backup.mjs`, `supabase/manual/recovery-scheduler.sql` |

### Verified locally

Lint (zero warnings), typecheck, production build; **765 Vitest tests** (62 files, serial; database tests against PostgreSQL 16 built from all 55 migrations), and the same suite under a faked clock at 11 instants around UTC/Chicago/New York midnights and both 2026–27 DST changes; **322 Playwright signed-out tests** (desktop and Pixel 7); **35 signed-in walkthrough checks** (`tests/e2e-local`, real local Supabase Auth, PostgREST, Storage, and Mailpit): registration and email verification, pending restrictions, approval, sign-out, password reset, suspension and reinstatement, role grant and confirmed removal, directory opt-out, community post/reply/notification/report with inert markup, prayer audiences, events with RSVP and .ics, giving's not-configured state, youth gate closed, 25-route smoke, axe WCAG 2.2 A/AA on 27 routes (0 violations), 320 px and 200 % text, keyboard, reduced motion, service-worker caches. **Recovery rehearsal** (disposable local stack): database and Storage files backed up, deleted, restored with identical row counts (46 tables) and file hashes; the walkthrough then passed on the restored database.

### Hosted (read-only)

54 migrations (all of Phase 10); production `main` `5add6de` (Phase 9 code on the Phase 10 schema); scheduler 288/288 runs in 24 h to production, outboxes clean; grants equal the new baseline; Free plan (no backups); previews public and sharing the database, Auth, Storage, and email with production; Stripe test webhooks routed to the Phase 3 preview; no VAPID keys. **Not done:** signed-in hosted walkthrough (no credentials; production domain blocked from this environment) and physical-device checks.

### Release blockers

Backups (Free plan), previews writing to production, giving webhooks on a preview, production code behind the schema, hosted signed-in walkthrough. Details and the order to clear them: [phase-11-release-readiness.md](phase-11-release-readiness.md#release-blockers).

---

# Phase 10 build status

Last updated: 2026-10-28 · Phase 10 branch `phase-10/youth-families` (also pushed as `claude/gracious-gauss-im5ojt`), based on the Phase 9 head and then merged with `main` after PR #15 · draft PR [#16](https://github.com/cmingus710/The-Gathering/pull/16) into `main` (not merged)

## Phase 10: Youth ministry and families

### Summary

Phase 10 code is complete and verified locally (database, unit, build, and signed-out browser checks). It started from `phase-9/scripture-memory` (PR #15 was open at the time) and, once #15 was merged, merged `main` (docs-only conflicts resolved), so nothing was duplicated or lost.

**Production status changed during this phase (not by this phase):** another session recorded that `main` (Phase 9) was released to `www.gathering.church` on 2026-10-20 with production builds unpaused and the scheduler moved to production (commit `f40d85c` on `claude/phase-9-scripture-memory-ns026j`, not in `main`). This phase didn't change any Vercel or production setting and didn't merge anything. Because the hosted Supabase project now serves production, the Phase 10 migrations waited for the owner's explicit go-ahead (they change shared checks such as `is_approved_member` and the community notification functions that production uses). With that go-ahead, step 1 was applied through the connector and the owner ran steps 2–9 in the SQL editor on 2026-10-21 (the connector couldn't commit larger schema changes); the hosted youth fingerprint equals the expected digests in all 14 categories. The owner also ran **follow-up step 10** (a fix found by the hosted walkthrough, below), and its re-check passed. Giving stays in Stripe test mode.

**Policy-gated features are off** until the church approves a youth policy (see below). Everything else works for authorized staff and verified guardians once the migrations are applied.

Guides: [youth-family-admin-guide.md](youth-family-admin-guide.md) (admin locations, setup, workflows, policy decisions), [guardian-guide.md](guardian-guide.md), [youth-permission-matrix.md](youth-permission-matrix.md), [media-consent-workflow.md](media-consent-workflow.md), [youth-retention.md](youth-retention.md) (retention, deletion, adult transition). Design: [architecture.md](architecture.md#youth-ministry-and-families-phase-10). Migrations: [migration-history.md](migration-history.md#phase-10-2026-10-28).

### What was built and where

| Area | Where |
| --- | --- |
| Youth tile live with the supplied Youth art; "Youth & Families" in the menus | home launcher, `src/lib/navigation.ts` |
| Youth hub: parent/guardian, leader, and administration entry points; announcements. For independent youth: announcements, upcoming events (self-registration only where allowed), groups, learning, link to "who can see what" | `/youth` |
| Family dashboard: linked children, outstanding forms, upcoming registrations, paused access, request status | `/youth/family`, `/youth/family/request` |
| Child page (per permission): profile, groups, events with form states, photo consent and history, progress summary, own-account invitation/authorization | `/youth/family/children/<id>` |
| Child event: form text (versioned), give/decline/withdraw, event details (emergency contact, pickup notes, optional notes), register/cancel/waitlist | `/youth/family/children/<id>/events/<occurrence>` |
| Practice verses together (recorded on the child): read & repeat, flashcards, say it | `/youth/family/children/<id>/practice` |
| Group page and supervised discussions (audience shown; report; leader moderation) | `/youth/groups/<id>`, `/youth/discussions/<id>`, `/youth/announcements` |
| Leading: groups, roster, enrollment, announcements, learning, discussions, reports, event attendee lists, logistics (personnel only) | `/youth/lead/*` |
| Independent youth: account, sharing choice, adult-transition confirmation; activation with a code | `/youth/account`, `/youth-activate` |
| **Administration** | **Admin → Youth & families** `/admin/youth` · policy `/admin/youth/policy` · families `/admin/youth/families` (+ `/children/<id>`) · groups `/admin/youth/groups` (+ `/<id>`) · forms `/admin/youth/forms` · youth events `/admin/youth/events` (+ `/<id>`) · photo consent `/admin/youth/media` · safeguarding `/admin/youth/reports` |
| Existing screens: event editor shows youth events as managed under Youth; gallery approval explains consent links; member admin labels youth accounts | `/admin/events/*`, `/admin/gallery/<id>`, `/admin/members` |
| Notifications: `youth` category, generic email/push | `/notifications/settings` |

### Permissions by role (summary)

Full matrix: [youth-permission-matrix.md](youth-permission-matrix.md).

| Role | Can | Can't |
| --- | --- | --- |
| Verified guardian | Per child, only the permissions chosen at verification: update profile, register, permission forms, photo consent, view progress summary, practice with the child, manage the child's account, receive updates | See other adults' details, youth passwords, journals, answers, confidential prayer/care, giving, unrelated conversations; sign in as an independent youth; verify themselves |
| Independent youth | Youth area, own learning tools, reply in supervised discussions (policy), self-register only where allowed, choose progress sharing | Any adult feature (directory, messages, community, groups, prayer, care, giving, gallery, admin), change account type or eligibility |
| Youth leader (+ assignment) | Their groups only: roster (names, participation), enrollment and publishing if granted, start/moderate discussions, attendee lists, logistics when designated | Other groups, contact details, birth dates, guardians' identities, reports about themselves, finance, roles, membership, journals, confidential care |
| Family administrator | Requests, verification (never own), permissions, pause/revoke, restrict, child profiles, eligibility, invitations, adult transition, history | Policy approval, practice or journal content |
| Youth ministry admin / forms admin / logistics / consent reviewer / safeguarding / policy admin | Their own areas (see the admin guide) | Anything outside them |
| Super administrator | Assign the roles (audited) | Any youth/family capability without holding the role |

### Policy decisions still needing church input

Independent youth accounts and who is eligible (in the church's words), any minimum age, guardian authorization of youth accounts, more than one guardian per child, collecting dates of birth, youth self-registration for events, supervised discussions and the number of leaders required, guardian access to discussions, moderated group prayer, progress sharing for independent youth, recording public-use photo consent, adult transition, logistics retention, how guardianship is verified and disputes handled, permission-form wording, event staffing, confidential youth care (no reviewed escalation policy, so not offered), check-in/check-out and pickup authorization (not built), and legal review (for example children's online privacy rules such as COPPA in the US; the amended rule's compliance date was 22 April 2026). Details: [youth-family-admin-guide.md](youth-family-admin-guide.md#policy-decisions-that-need-church-input).

### Disabled until the church approves a policy that allows them

Independent youth accounts (invitation and activation) · youth self-registration for events · supervised discussions and group prayer · guardian reading of discussions · progress sharing for independent youth · public-use photo consent · adult transition · multiple guardians per child · date-of-birth collection · automatic logistics deletion. Youth self-registration *of accounts* and confidential youth care have no path at all.

### Verified locally (no hosted services)

Lint (zero warnings), typecheck, production build (every route dynamic; 23 new routes), **755 Vitest tests** (60 files; 48 in the new `tests/db/youth.test.ts` against PostgreSQL 16 built from all 53 migrations), and **322 Playwright tests** (desktop and Pixel 7; 56 new: signed-out redirects for 28 Phase 10 routes and their `private, no-store` headers). `tests/db/safeupdate.test.ts` covers every Phase 10 function. Earlier suites pass with one expectation updated (the Phase 2 "youth accounts blocked" test now checks that only the youth process changes account kind) and one launcher expectation (the Youth tile is live). One Phase 9 test (`memory.test.ts` › "announces a new weekly verse once") fails only between about 00:00 and 05:00 UTC, on the unmodified Phase 9 code too (UTC vs Chicago date in the test); all 755 passed in a full run earlier on 2026-10-20 (UTC); the latest full run at 00:10 UTC had 754 passing plus that one. Follow-up suggested.

| Area | Proven by tests |
| --- | --- |
| Access | `youth` schema closed to clients; pending accounts refused; super administrators hold no youth/family capability implicitly |
| Policy | Safe defaults until approved; unknown settings, independent accounts without a rule, and prayer without discussions refused; approval needs another person, the phrase, and a reference; one approved version; earlier versions retired and immutable |
| Guardianship | Household membership never links; requests answer identically whether a child exists and never reveal ids; pending requests open nothing; nobody verifies their own; one guardian unless the policy allows more; per-capability permissions; restriction, suspension, revocation (final); history without values |
| Child privacy | Not in directory search, event member search, DM recipients, or household displays; birth dates not in audit, history, or notifications; rosters carry names and participation only |
| Leaders | Need the role and an assignment; last leader protected; only their own group; role removal drops access at once; no finance, membership, or other capability |
| Events and consent | Youth events hidden from unrelated adults; adult RSVPs refused; general editor can't widen a youth event; consent and emergency contact required; permission per guardian; capacity and waitlist in order with promotion; material change → renewal with notices; wording fix keeps consent; withdrawal recorded, place released, no device fields |
| Logistics | Only designated personnel; viewing logged with counts; values absent from audit, history, notifications, organizer view, and the event row |
| Youth accounts | Off until policy; eligibility, recorded birth date, and minimum age required (fail closed); invited sign-ups start as youth and can't be approved as adults; wrong code, unconfirmed email, missing guardian authorization, and existing adult accounts refused; code single-use; policy version and authorizer recorded; child practice moves to the account |
| Fail closed | Youth accounts: no `is_approved_member`, capabilities, directory, DMs (either direction), prayer, member RSVPs, announcements table, roles; can't change account kind or eligibility; guardians can't act as the youth |
| Learning and privacy | Guardian practice recorded on the child, never the guardian; journal unreadable by guardian, leader, family admin, super admin; progress summary only when shared, without answers or reflections |
| Discussions | Only leaders start; prayer needs policy; transparent audience; idempotent posts; guardians read-only by policy; posting stops below leader count; reports about leaders hidden from all leaders of that group and reviewed by safeguarding |
| Photo consent | "Permission confirmed" needs links; approval blocked until consent; public use refused by default; withdrawal hides and queues; unhide blocked; guardian conflict blocks; known copies tracked |
| Transition | Policy, both admin confirmations, youth's own confirmation, a second administrator; ends guardianships; keeps learning; no DM eligibility; directory stays off |
| Revocation | Leaving a group cancels places; guardian suspension drops unread notices and consent weight; youth suspension ends youth and memory access; youth account deletion leaves the child guardian-managed |
| Notifications | Guardians only in scope; generic email/push; one reminder per child even with overlapping runs; reminder disappears when the place is canceled; request rate limit |

**Not verified in a browser while signed in:** the Youth pages with real data. They need the Phase 10 migrations on a database the app can reach (see Hosted).

### Hosted

| Check | Result |
| --- | --- |
| Branches pushed | `phase-10/youth-families` and `claude/gracious-gauss-im5ojt` |
| Preview build `25a033b` (`dpl_7WdsnGMS389LybLWMZUS1n2uDAiE`) | **Ready**: `https://the-gathering-q6qd03qd5-paint-by-number.vercel.app`, branch alias `https://the-gathering-git-phase-10-youth-families-paint-by-number.vercel.app` (Vercel Authentication required) |
| Signed-out `/youth/family` → sign-in with `private, no-cache, no-store` (through Vercel's share link) | Pass |
| Hosted migration history (2026-10-21) | Steps 1–9 applied (`20261028000100`…`000900`, `created_by = phase-10`): step 1 through the connector, 2–9 and follow-up step 10 (`20261028001000`) by the owner in the SQL editor; 54 versions in total |
| Hosted `youth-fingerprint.sql` | After steps 1–9: equal to the expected digests in all 14 categories (column 369, constraint 317, function 201, function_grant 183, index 169, rls 37, schema_acl, seeds, storage, trigger 20, type). After step 10: function digest `08bb454c` (201) and grants `c06f82c9` (183), equal to a fresh build |
| Hosted Phase 9 fingerprint (read-only) | Equal to a fresh build in all 15 categories |
| Production | Not touched by this phase (another session released Phase 9 on 2026-10-20) |
| Hosted database-level walkthrough with synthetic families (2026-10-21) | **Pass.** One defect was found, fixed in step 10, and re-checked on hosted. No signed-in browser walkthrough |

### Hosted walkthrough (database level, 2026-10-21)

Run against the hosted project after steps 1–9, as four scenarios. Each ran inside **one transaction that ended in `rollback`**, so no synthetic user, child, group, event, form, photo, consent, notification, or audit row was ever committed. Nothing reached the email or push queue, no roles or settings changed, and there was nothing to clean up. The synthetic users had `@example.invalid` addresses, all names were `[TEST] WT …`, and there were no real children. Each user was created inside the transaction, approved, given only the roles under test, and then acted as `authenticated` with JWT claims.

| Scenario | Checks (all passed unless noted) |
| --- | --- |
| Policy and guardianship | Defaults off before approval; youth tables not readable directly; policy drafter can't approve their own draft, a second policy admin can; super administrator has no implicit youth access; verified guardian sees the child, an unrelated adult gets "Not found"; restriction hides the child from the guardian; family log holds no names |
| Groups, events, forms, logistics | Youth leader role required to lead; last-leader rule; youth event visible to the guardian, not to an unrelated adult; registration needs current consent, then an emergency contact; registration confirmed; a material form change requires renewal (1) and the old version is refused; a non-personnel leader can't see logistics, designated personnel can; the test phone number appears in no audit or notification row |
| Youth account, discussions, reports | An existing adult account can't redeem an invitation; invited youth activates (`active`); youth account fails adult checks (`is_approved_member`/`has_capability` false); no DMs; can't change own account type; discussions need two leaders and three enrolled children (a two-child group was correctly refused); youth posts; guardian reads but can't post; unrelated adult refused; a report about a leader is invisible to that leader and visible to safeguarding; posting stops when supervision drops below the policy |
| Photo consent, adult transition | Approval blocked without consent; public-use consent refused while the policy doesn't offer it; approval with consent; withdrawal hides the photo and opens a review; transition needs the youth's confirmation; guardian access ends; account becomes adult/approved; no DM eligibility granted. **Defect:** the family administrator who *started* a transition could also complete it (docs promise a different administrator). Fixed in `20261028001000_youth_transition_second_admin`, with a DB test and corrected admin page text. **Re-checked on hosted after step 10:** the starting administrator is refused ("A different family administrator must complete this transition.") and a second administrator completes it |

**Not covered on hosted:** a signed-in browser walkthrough (no test credentials in this environment), email delivery, and storage uploads.

### Known limitations (Phase 10)

- **No signed-in browser walkthrough on hosted** (database-level walkthrough only).
- **Guardian practice UI** offers read & repeat, flashcards, and "say it" (self-check). The database supports all six Phase 9 activities for child profiles; missing words, word order, and typing aren't in the guardian UI yet.
- **Youth event covers and the /events list:** youth events appear in the Youth area and family dashboard, not in the general events list, month view, or home banner (those use the audience rule directly); youth event cover images aren't shown.
- **Youth accounts get no email/push or Realtime** (adult-only by design); they see announcements in the Youth area.
- **Teaching resources** assigned to a group are openable by youth only when public (members-only items need an adult account).
- **Photo consent reviewers** need the Gallery moderator role too to see images.
- **Avatars:** the database, storage policy, and permission checks for child avatars exist; there is no upload form yet (profiles show names).
- **No check-in/check-out, pickup authorization, or medical records** (by design).
- **Phone push** remains Phase 12; Lesson Studio, attachments, and Follow Along remain Phase 13.

### Still open from earlier phases

- **Phase 9:** signed-in browser walkthrough (database-level hosted walkthrough passed per `main`); the time-of-day test flake above.
- **Phase 8:** hosted walkthrough; API.Bible not configured.
- **Phase 7:** hosted walkthrough, feed refresh, email/push for teaching and gallery, device and provider embed checks (scheduler moved to production per the other session's record).
- **Phase 6:** hosted walkthrough; prayer/care notification email on hosted.
- **Phase 5:** hosted walkthrough; VAPID keys not set on previews (push off); push on a device.
- **Giving on later previews:** Stripe variables are scoped to the Phase 3 branch, so Give shows as not configured.
- **Phase 4:** .ics import into calendars, private feed subscription, month grid on a phone, screen reader pass.
- **Phase 3:** hosted dispute "lost"; final statements await church details; Apple Pay/Google Pay on a device; test subscription and open test dispute in the Stripe sandbox.
- **Phase 2:** device and screen-reader pass of the directory.
- **Phase 1:** role assignment through the UI, logo/icon replacement upload, installed app on physical devices, VoiceOver/TalkBack.
- **Design:** `design/section-tiles` is unmerged and not included here.

---

# Phase 9 build status

Recorded: 2026-10-27 · Phase 9 branch `phase-9/scripture-memory` (also pushed as `claude/phase-9-scripture-memory-ns026j`), based on `main` after PR #14 (Phases 2–8, member redesign, sign-in redesign) plus the Phase 8 follow-up `b93b514` (`20261026000700`, already applied on the hosted project but not yet in `main`) · merged into `main` by PR [#15](https://github.com/cmingus710/The-Gathering/pull/15) (production builds still paused)

## Phase 9: Scripture memory and practice

### Summary

Phase 9 code is complete and verified locally, including a signed-in walkthrough of the real app against the real migrations. Nothing was duplicated or lost: the branch started from the Phase 8 head, then merged `main` (#14 and the sign-in redesign) and the newer Phase 8 follow-up cleanly. Production builds stay paused; giving stays in Stripe test mode. Phase 10 hasn't started.

**The hosted database is migrated for Phase 9 (2026-10-20).** The owner ran the five operator scripts in the SQL editor; the history lists `20261027000100`…`000500` (`created_by = phase-9`) and `supabase/tests/memory-fingerprint.sql` on the hosted project matches the fresh-build digests in all 15 categories. A database-level hosted walkthrough passed and its `[TEST]` data was removed (below). A walkthrough in the browser while signed in as the test accounts is still to do (I can't sign in as them).

Guides: [memory-admin-guide.md](memory-admin-guide.md) (administration, permission matrix), [memory-member-guide.md](memory-member-guide.md) (members), [memory-scoring.md](memory-scoring.md) (scoring, review schedule, badges), [memory-privacy.md](memory-privacy.md) (privacy, challenge sharing, withdrawal, Phase 10). Design: [architecture.md](architecture.md#scripture-memory-and-practice-phase-9).

### What was built and where

| Area | Where |
| --- | --- |
| Memory Verses tile live with the supplied art (after Bible Reading); "Memory verses" in the menus | home launcher, `src/lib/navigation.ts` |
| Home memory card, only while a verse is assigned (no results shown) | `/home` |
| Memory home: current verse, today's reviews and goal, recent verses, challenges, leading links | `/memory` |
| Current assignment with exact text, translation, attribution, church note, goal; coming up; earlier | `/memory/assignment` |
| Collections: church, group, and private personal ones | `/memory/collections`, `/memory/collections/<id>`, `/memory/collections/new` |
| My Verses; add from the approved source with an exact-text preview; verse detail (schedule, history, version decision, remove/restore/delete, add to my collection) | `/memory/verses`, `/memory/verses/add`, `/memory/verses/<id>` |
| Practice: the six activities, three difficulties, parts for long passages, kids presentation, saved-state handling | `/memory/practice/<id>` |
| Review queue (due today in the member's time zone, upcoming two weeks), progress and badges with "how progress works" | `/memory/review`, `/memory/progress` |
| Practice settings, reminders, pause, download, delete history | `/memory/settings` |
| Opt-in group challenges | `/memory/challenges/<id>` |
| **Management** (staff): collections, verses and assignments, multiweek sequences, covers, publish/schedule/archive/restore/duplicate/delete, text updates, preview, group-leader authorization, challenges | **Admin → Memory verses** `/admin/memory/*` |
| **Management** (authorized group leaders, their groups only) | `/memory/lead/*` |
| Notifications: `memory` category, generic email/push | `/notifications/settings` |

### Scripture source

The approved Phase 8 source: stored-text translations only (WEB and ASV, both public domain, labelled with their codes and attribution). Each memory item keeps the translation, book/chapter/verse range, exact text, attribution, a stable reference key, and a content version (text version + SHA-256 hash). API.Bible translations are refused for memory practice (their text may not be stored, and scoring needs it server-side). Editorial titles, notes, and hints are separate from the text. Local verification used the WEB excerpt fixture (`tests/fixtures/bible/web-sample.csv`); the hosted project has the full WEB and ASV.

### Activities and scoring (summary)

Read & repeat (progressive hiding, not scored) · Flashcards (reference ↔ verse, self-assessed after flipping) · Missing words (choices without ambiguous duplicates in Guided/Growing, typed in Challenge) · Word order (tap/keyboard, no dragging; identical pieces interchangeable, each with its own id) · Type the verse (word-by-word alignment; case and punctuation configurable; contractions never expanded; verse numbers and the reference set aside; the member's text kept beside the comparison) · Self-check (reference only, reveal, self-assessment; no microphone or voice scoring). Accuracy, hints, confidence, completion, and review step are recorded separately; strong recall requires every word with no hints. Full rules: [memory-scoring.md](memory-scoring.md).

### Review schedule and progress definitions

Steps 0–7 with reviews after 0, 1, 2, 4, 7, 14, 30, 60 days, in the member's own calendar; one change per verse per day; early reviews don't move it; a hard day eases back one step; missed days never lower anything. Stages: New, Learning (steps 1–2), Reviewing (3–5), Well known (6–7). Review-ready = reached step 3 (three separate review days); never "mastered". Progress shows verses practiced, review-ready verses, practice activities (total and 7 days), days practiced in the last 28 (no streaks), collection progress, and badges.

### Permission model

| | Editor | Publisher | Authorized group leader | Super admin | Others (incl. household, other staff) |
| --- | --- | --- | --- | --- | --- |
| Draft/edit church & group collections | ✓ | ✓ | their groups | ✓ | — |
| Publish, schedule, archive, text updates | — | ✓ | their groups | ✓ | — |
| Authorize group leaders | — | ✓ | — | ✓ | — |
| Run challenges | — | any group | their groups | ✓ | — |
| See anyone's practice, results, schedule, badges, settings, personal collections | — | — | — | — | — |

### Required configuration (no secret values)

- Database: run `supabase/manual/2026-10-27-apply-memory-1.sql` … `-5.sql` in order; compare with `supabase/tests/memory-fingerprint.sql` (expected digests in [migration-history.md](migration-history.md#phase-9-2026-10-27)) and re-run the earlier fingerprints against a fresh build.
- Roles: assign **Memory verse editor** / **Memory verse publisher** at Administration → Members; authorize group leaders at Administration → Memory verses if wanted.
- No new environment variables, buckets to create by hand, or scheduler changes (reminders run in `community.tick()`; email still needs the existing job secret on the designated deployment).

### Verified locally (no hosted services)

Lint (zero warnings), typecheck, production build (every route dynamic), **707 Vitest tests** (59 files, run serially; 63 in `tests/db/memory.test.ts` against PostgreSQL 16 built from all 44 migrations; 11 new unit tests), and **266 Playwright tests** (desktop and Pixel 7; 44 new). `tests/db/safeupdate.test.ts` covers every Phase 9 function. Earlier-phase suites pass (one expectation updated: super administrators also hold the two memory capabilities; one launcher expectation: the Memory Verses tile is live).

| Area | Proven by tests |
| --- | --- |
| Access | `memory` schema closed to clients; pending/suspended refused; editor drafts but can't publish; publisher publishes; content editor, plan publisher, unauthorized leader get no admin; client keys idempotent; audit without content |
| Scripture | John 3:16–17 captured exactly with code, attribution, ref key, version; editorial text separate; poetry lines kept; long passages split into parts summing to the whole; >30 verses, missing verses, verse-less ranges, API translations refused; omitted verse (Acts 8:37) left out and noted; member preview saves nothing |
| Collections | Current assignment and home card (none without one; no text on the card); scheduled hidden until time; archive hides; group audience only for group members; leader authorized for one group only, never church-wide or another group, revocable; personal collections invisible to others and staff; duplicate → draft; delete only unused drafts; sequence dates; reorder keeps ids; window validation |
| Activities | All six start and submit; flashcard and self-check text only after reveal; missing-word blanks carry no answers, unique choices, case-insensitive by default, wrong answers marked; word order with repeated "the world" accepted in either order, incomplete/duplicate orders refused, hint points to first misplaced position; typed text never sent before submission |
| Scoring | Case and punctuation tolerance only when configured; straight vs curly apostrophes equal; contraction expanded not accepted; Unicode NFC/NFD and Greek; verse numbers and reference set aside with the member's text preserved; missing/extra/changed marks and exact accuracy; hints counted on the server lower the result; long passages require parts; kids parts shorter |
| Safety | Retried submission returns the same result with one attempt; two connections submitting at once record one; expired → status, removed card → conflict, nothing recorded; nobody else can start/hint/reveal/submit; rate limit |
| Schedule | New verses due today; strong recall advances once per day; early reviews don't move; partial keeps step; hard day eases one step without losing review-ready; overdue verses advance normally; time zones decide "today" (Kiritimati vs Pago Pago); learning activity moves a new verse to step 1 only |
| Badges & progress | Awarded once; Explorer after six activities and not again; separate measures, no "mastery" |
| Privacy | Household member, super admin, publisher, editor, leader: not found for another member's verse, can't delete it, not in their lists; admin collection view has no result fields; export is owner-only and omits text when the license doesn't allow export |
| Challenges | Only publishers/authorized leaders; threshold ≥ 3; visible only to the group; explicit opt-in; hidden below threshold; pre-join practice excluded; rounded totals with no names; leaders see the same; pause/resume (from now), leave, losing the group, and suspension remove contributions; reinstated members must rejoin |
| Versions | Re-import changes text → update notice; switching creates a fresh card and keeps the old one's history as "earlier text"; collection text update needs a publisher and a reason; practice continues on the earlier text until the member chooses |
| Deletion | Remove/restore keep history; delete needs confirmation, removes attempts, keeps the passage; delete-all needs the typed phrase and removes cards, awards, personal collections; account deletion removes everything |
| Reminders | Nothing unless asked; one review reminder a day with generic email text and one email; paused hidden; suspension drops unread; weekly verse once with in-app reference and generic email; milestones once, only to sharing participants who asked; two overlapping scheduler runs → one practice reminder |
| Units | Submission queue (saved only on confirmation, backoff, final outcomes, max attempts, offline wait, single flight, HTTP mapping); wording (review dates across DST, non-shaming explanations) |
| Browser (signed out) | Redirects for 20 Phase 9 routes; `/memory/*` `private, no-store`; memory APIs refuse without caching or echoing answers; the service worker caches none of it |

**Local signed-in walkthrough** (real app build against a local stand-in for the Supabase HTTP API over the real migrations; 47 checks, all passing): an administrator created, filled (John 3:16–17, Psalm 23:1–6, Genesis 1:1), sequenced, previewed, and published a `[TEST]` collection; a member saw the live tile and home card, started the assignment, and completed all six activities on a phone (light) and desktop (dark), with "Saved" only after confirmation and focus moving to the result; hidden text absent from the page before reveal; repeated words ordered either way; the typed answer kept beside the comparison; kids presentation at 200% text without sideways scrolling; keyboard-only word order with screen-reader announcements; a dropped connection retried to "Saved"; a signed-out submission kept the answer and saved on retry; a household member and an administrator got "not found" for the member's verse. The walk found and fixed two bugs: repeated field ids in the collection editor (labels pointed at the wrong inputs) and a publish message that vanished after publishing.

### Hosted

| Check | Result |
| --- | --- |
| Branches pushed | `phase-9/scripture-memory` and `claude/phase-9-scripture-memory-ns026j` |
| Preview build `16ec916` (`dpl_3Ajd1vk74hXuwJ9tnjBw4BBXXd1C`) | **Ready**: `https://the-gathering-o1072onrg-paint-by-number.vercel.app` (Vercel Authentication required) |
| Signed-out `/memory/review` → sign-in with `private, no-cache, no-store` (through Vercel's share link) | Pass |
| Production deploys from `main` | Released after the merge: production builds unpaused and `main` deployed to `www.gathering.church` on 2026-10-20; scheduler now targets production ([deployment.md](deployment.md#production-is-live)) |
| Hosted migration history | **Applied** (owner, SQL editor): 44 versions, latest `20261027000500`; memory fingerprint equal to a fresh build in all 15 categories |

### Hosted walkthrough (database level, 2026-10-20)

Run on the hosted project through the real `memory_*` functions as each authorized test account (role `authenticated` with that account's JWT claims, exactly what the app sends), using `[TEST]` content. Accounts: A `robtwebb@me.com` (super administrator), B `breaktwomusic@gmail.com` (approved member of `[TEST] Synthetic Public Group`), C `rob@justlovecorp.com` (teaching staff, no memory roles).

| Check | Result |
| --- | --- |
| A creates `[TEST] Phase 9 walkthrough` (WEB, sequence) with John 3:16–17 (assigned this week), Psalm 23:1–6, Romans 8:28, and publishes | Pass |
| Captured text equals the hosted WEB verses exactly for all three passages; reference keys and source-current checks correct; Psalm 23 split into 5 parts (10 for kids) | Pass |
| C (other staff) refused memory administration; B can't archive A's collection ("not found"); clients can't read the `bible` schema directly | Pass |
| B: home card shows the reference and collection only (no verse text); adding the assignment creates a new verse due today | Pass |
| B completes all six activities; each saved; typing scored 100% with the typed verse number set aside; no answers in the typing, flashcard, or self-check setups; the schedule changes at most once that day; badges First steps, Recited, Explorer awarded once | Pass |
| Retried submission returns the stored result (`replayed`), no extra attempt | Pass |
| A (super administrator) and C get "not found" for B's verse; A's collection view has no accuracy or session fields | Pass |
| A creates `[TEST] Phase 9 challenge` (threshold 3) for the group; C (not in the group) gets "not found"; B joins (totals stay hidden with one person sharing, no names), pauses sharing, leaves | Pass |
| B switches on a review reminder; the scheduler (pg_cron → Phase 7 preview worker → `community.tick()`) created one `memory_review_due` at 21:05 UTC with the generic email title "You have memory verses ready to review", and the email was sent; three later runs added no duplicate | Pass |
| Cleanup: B deleted their practice history through `memory_history_delete`, reminders off; the `[TEST]` challenge, collection, unused passage captures, B's memory settings, the test notice, and memory rate events removed. All memory tables are empty again; no roles were granted or left over | Done |

Not covered on hosted (covered by the local suites): text-version changes (would need editing hosted scripture), challenge totals above the threshold (the group has two members), household denial (no shared household between test accounts), browser rendering signed in.

**Outstanding configuration found:** the hosted WEB and ASV translations have empty attribution text, so pages show only the code and name (for example "WEB · World English Bible"). A Bible source manager should add the attribution wording at Administration → Bible sources (Phase 8 setting; see bible-sources.md).

### Known limitations (Phase 9)

- **Signed-in browser walkthrough on the hosted preview** not done (needs signing in as the test accounts); the database-level hosted walkthrough passed.
- **Hosted WEB/ASV attribution text is empty** (Phase 8 configuration).
- **API.Bible translations** can't be memorized (stored text is required for server-side scoring); none is configured anyway.
- **Hints are counted on the server, but read & repeat "show every word" is reported by the device** (it's an unscored learning activity).
- **Self-check and flashcards** record the member's own judgment and prove nothing; no audio, microphone, or voice scoring (by design).
- **Challenge totals** are rounded and delayed a day; a determined observer of a small group could still guess roughly (documented in memory-privacy.md).
- **Phone push** for reminders arrives with Phase 12 (web push and email work now; VAPID keys still unset on previews).
- **Family/youth challenges, child profiles, and guardian access** are Phase 10 (integration points in memory-privacy.md).
- **No offline practice**: the server chooses each activity, so starting one needs a connection (answers survive a dropped connection).

### Still open from earlier phases

- **Phase 8:** follow-up `20261026000700` is applied on the hosted project but its branch commit (`b93b514`) isn't in `main` yet (this PR includes it); hosted walkthrough; API.Bible not configured.
- **Phase 7:** scheduler handover script (`events.settings.job_url`), hosted walkthrough, feed refresh, email/push for teaching and gallery, device and provider embed checks.
- **Phase 6:** hosted walkthrough; prayer/care notification email on hosted.
- **Phase 5:** hosted walkthrough; VAPID keys not set (push off); push on a device.
- **Giving on later previews:** Stripe variables are scoped to the Phase 3 branch, so Give shows as not configured.
- **Phase 4:** .ics import into calendars, private feed subscription, month grid on a phone, screen reader pass.
- **Phase 3:** hosted dispute "lost"; final statements await church details; Apple Pay/Google Pay on a device; Deployment Protection decision; test subscription and open test dispute in the Stripe sandbox.
- **Phase 2:** device and screen-reader pass of the directory.
- **Phase 1:** role assignment through the UI, logo/icon replacement upload, installed app on physical devices, VoiceOver/TalkBack, production configuration (deliberately not done).
- **Design:** `design/section-tiles` (section header banners and tile hubs) is unmerged and not included here.

---

# Phase 8 build status

## Phase 8: Bible reading plans, scripture reader, and private journals

### Summary

Phase 8 code is complete and verified locally. It starts from the head of `phase-7/teaching-media` (`71728f2`), the newest integrated work, which already includes `main`; nothing was duplicated or lost. None of the earlier PRs is merged, so PR #13 into `main` also shows their commits; merge them in order first (or retarget). Production builds stay paused; giving stays in Stripe test mode. Phase 9 hasn't started.

**The hosted database is migrated for Phase 8 (2026-10-20).** The owner ran the six operator scripts in the SQL editor; the migration history lists `20261026000100`…`000600`, and `supabase/tests/bible-fingerprint.sql` on the hosted project matches the fresh-build digests in all 16 categories. The WEB is imported, published, and active. A follow-up script, `supabase/manual/2026-10-26-apply-bible-7.sql`, fixes import timeouts seen on the hosted project (see migration-history.md); run it before importing more text. Next: import the ASV and run the hosted walkthrough below.

Guides: [bible-sources.md](bible-sources.md) (translations, sources, rights, imports, PDFs), [reading-plan-guide.md](reading-plan-guide.md) (administration, CSV import, correction and versioning policy), [bible-reading-guide.md](bible-reading-guide.md) (members), [journal-privacy.md](journal-privacy.md) (privacy, export, deletion, retention). Design: [architecture.md](architecture.md#bible-reading-plans-scripture-reader-and-journals-phase-8).

### What was built and where

| Area | Where |
| --- | --- |
| Bible tile live with the supplied Bible art; "Bible reading" and "My Journal" in the menus | home launcher, `src/lib/navigation.ts` |
| Hub: today's reading per plan, featured church plan, available plans, bookmarks, journal, preferred Bible version (WEB or ASV), earlier plans | `/bible` |
| Plan: join (start date + time zone, or count-from choice for dated plans), today, progress, all days by month, catch-up, reminders, main plan, start date, leave, delete history | `/bible/plans/<id>`, `/bible/plans/<id>/catch-up` |
| Day: passages in the member's preferred version (falling back to the plan's version per passage, with a note) with translation label and attribution, per-visit version switch, mark read/undo, changed-since notice, reflection (Write privately / Join discussion), related teaching, your notes, bookmark, previous/next | `/bible/day/<id>` |
| Reader: book/chapter navigation, verse numbers, headings, poetry, highlights (4 named colors), bookmarks, notes, text size, spacing, translation switch, copy/print permissions, honest unavailable states | `/bible/read/<code>/<book>/<chapter>` |
| Bookmarks and highlights, data download and clearing | `/bible/bookmarks` |
| My Journal: list, search (POST), archive, export (Markdown/JSON), delete all; editor with autosave and conflict handling; links to passages, plan days and questions, devotionals and lessons ("Write privately" also on devotional/lesson pages) | `/journal`, `/journal/new`, `/journal/<id>` |
| Home "Today's Reading" card (only with an active plan) | `/home` |
| **Reading plan controls** | **Admin → Reading plans** `/admin/bible`, `/admin/bible/plans/<id>` (days, add, CSV template and import, publishing, details, cover, duplicate, change log), `/admin/bible/plans/<id>/days/<day>` (edit, revise with impact, retire), `/admin/bible/plans/<id>/preview`, `/admin/bible/plans/<id>/import/<import>` |
| **Bible source controls** | **Admin → Bible sources** `/admin/bible/sources` (translations, add, recent imports, reference PDFs), `/admin/bible/sources/<id>` (settings, rights, activation, default, text import), `/admin/bible/sources/imports/<id>` (review and publish) |
| Notifications: `reading` category (reminders, plan changes), generic email/push | `/notifications/settings` |

### Selected scripture source and permissions

- **No translation has been selected by the church.** The adapter and the full administration workflow are built for stored text and for API.Bible.
- **Functional testing uses the World English Bible (WEB)**, public domain, labelled WEB everywhere it appears ("World English Bible" is an eBible.org trademark used only for the unaltered text). Data: npm package `world-english-bible@1.0.1`, integrity-checked by `scripts/bible-prepare-web.mjs` (whitespace-only conversion). The test fixture `tests/fixtures/bible/web-sample.csv` is an excerpt (Genesis 1–2, Psalm 23, John 3, Acts 8, Romans 16, Jude).
- **American Standard Version (ASV, 1901)** is offered beside the WEB as a second public-domain version members can choose. Data: `eng-asv.zefania.xml` from seven1m/open-bibles at a pinned commit, SHA-256-checked by `scripts/bible-prepare-asv.mjs` (typography-only conversion), chosen after a three-copy verse-by-verse comparison ([asv-crosscheck.md](asv-crosscheck.md)). Fixture: `tests/fixtures/bible/asv-sample.csv` (same chapters). Members pick their version under **Bible reading → Bible version**; no schema change was needed (reader settings already stored a translation).
- Licensing was checked on 2026-10-20 through search results of the official pages (eBible.org, API.Bible, Crossway); the pages themselves were blocked by this environment's network policy. Summaries and links: [bible-sources.md](bible-sources.md#choosing-a-source).
- **API.Bible adapter: not verified live** (no key, provider unreachable from here). It is tested only against recorded response shapes. FUMS tracking loads only where its text is shown.

### Required configuration (no secret values)

- Database: run `supabase/manual/2026-10-26-apply-bible-1.sql` … `-6.sql` in order; compare with `supabase/tests/bible-fingerprint.sql` (expected digests in [migration-history.md](migration-history.md#phase-8-2026-10-26)).
- Roles: assign **Bible source manager**, **Reading plan editor**, **Reading plan publisher** at Administration → Members (super administrators hold them implicitly).
- Optional, only for a licensed API translation: `API_BIBLE_KEY` (any name; sensitive, server-only) and `API_BIBLE_BASE_URL` in Vercel. Nothing new is needed for stored-text translations.
- Scheduler: none. Reminders run in the existing `community.tick()`; email still needs `EVENTS_JOB_SECRET` on the designated deployment, which is unchanged (the Phase 7 scheduler script is still pending from Phase 7).

### Autosave and conflict behavior

Saves about 1.2 s after typing stops, on leaving a field, and on Ctrl/⌘+S; one save in flight, newer text sent right after (an older response can't overwrite newer text); every save names its base version. Status: Unsaved changes / Saving… / Saved / Not saved (plus offline, signed out, changed elsewhere). "Saved" only after the server confirms the exact text. Temporary failures retry with backoff (1, 2, 5, 10, 30 s); offline waits for the connection; a stale save returns the newer saved text and offers **Keep mine** (overwrite), **Use the other version**, or **Keep both** (mine saved as a new entry); an expired session stops saving, keeps the text, and resumes on Retry after signing in. Leaving with unsaved text asks first. Retried first saves never create two entries (client key). No browser storage.

### Verified locally (no hosted services)

Lint (zero warnings), typecheck, production build (every new route dynamic), **612 Vitest tests** (56 files, run serially; 39 in `tests/db/bible.test.ts` against PostgreSQL 16 built from all 38 migrations), and **218 Playwright tests** (desktop and Pixel 7; 38 new). `tests/db/safeupdate.test.ts` covers every Phase 8 function. Earlier-phase suites all pass (one expectation updated: super administrators now also hold the three Phase 8 capabilities).

| Area | Proven by tests |
| --- | --- |
| Access | `bible`/`journal` schemas closed to anon, members, and admins; pending/suspended refused; source, plan editor, publisher, and content editor scopes |
| Sources | Staging never publishes; omitted verses (Acts 8:37, Romans 16:25) flagged and published only after acceptance; duplicates block; malformed lines and unknown books flagged; typed confirmation; rights must be reconfirmed when permissions of an active translation change; draft translations never readable; no text shared between translations |
| Second version (ASV) | Sample imports through the same review (Romans 16:26–27 flagged beyond numbering and kept only on acceptance, nothing empty); WEB and ASV both listed, default first; each serves its own wording (John 3:16, Psalm 23:1, bracketed Acts 8:37) labelled with its code; preferred version saved per member, not visible to others or admins, only active versions accepted, cleared with an empty choice |
| Scripture accuracy | John 3:16 returned exactly as the source; Psalm 23 heading and poetry lines preserved; translation code and attribution returned; nonexistent chapters/verses refused |
| References | Verse ranges, whole chapters, chapter ranges, cross-chapter ranges, comma continuations, several passages including same-book, aliases, ambiguous names refused, one-chapter books (`Jude 3` vs ambiguous `Jude 1`), invalid chapters/verses, labels identical in SQL and TypeScript |
| CSV import | Templates parse cleanly; explicit date/day mapping; YYYY-MM-DD only; leap days; duplicates, rest-day mistakes, bad references by row; gaps warned; DB validation against the translation; add refuses conflicts; replace; one bad row rolls back everything; drafts only |
| Schedules | Personal days map to the member's start date and zone; calendar "today" follows the plan's zone; midyear join counting from today vs from the start; leap day; DST (New York spring-forward); time-zone date boundaries |
| Progress | Rest days never counted or markable; completion idempotent both ways; opening doesn't mark; catch-up; leave keeps history; rejoin restores it |
| Versioning | Revising a future day needs a reason and a publisher; completions and journal links keep revision 1 and show what was read; past days need "correct-past"; published days can't be deleted, only retired (completions kept); plans with readers can't be deleted; title edits keep progress; structural changes refused; next-version duplicate; archived plans stay readable to those who joined |
| Journals | Idempotent create; unreadable/uneditable/undeletable by household member, super admin, plan publisher and editor, source manager, group leader, content editor; search is owner-only with literal wildcards; stale save → conflict with current text, retry idempotent, force overwrites; linked teaching withheld after archiving while the note stays; suspension pauses access, reinstatement restores; archive, export, delete, delete-all confirmation; no journal text in audit log, notifications, or staff views |
| Annotations | Bookmarks and highlights private, toggle, validated verses, can't be removed by others, exported, clearable; verse rows carry no annotation columns; reader settings separate |
| Reminders | One per day at the member's time, never twice (including two overlapping scheduler runs on separate connections); generic email and push text; rest days, finished readings skipped; leaving a group turns reminders off; paused or left enrollments hide the notice |
| Account deletion | Journal, enrollments, highlights, bookmarks, settings removed |
| Autosave (unit) | Debounce, one save in flight, latest text after, retry backoff, non-retryable stop, conflict choices, session expiry, offline |
| Other units | API adapter (host allowlist, key only in header, outages/misconfiguration honest, caching only when allowed and never across translations), PDF signature/pages/text-layer, export Markdown, highlight contrast in both themes |
| Browser | Signed-out redirects for 16 Phase 8 routes; `/bible`, `/journal` `private, no-store`; journal and Bible APIs refuse signed-out callers without cacheable answers; the service worker caches none of it |

**Not verified in a browser:** the signed-in pages themselves (reader, highlights, autosave UI, admin flows). They need the hosted database; see the walkthrough plan.

### Hosted

| Check | Result |
| --- | --- |
| Branches pushed | `phase-8/bible-reading-journals` and `claude/dreamy-babbage-an0yog` |
| Preview build `cc86476` (`dpl_5ynVxQGfc5P6eDkvByZLgKsJHdPS`) | **Ready**: `https://the-gathering-gi05ridlm-paint-by-number.vercel.app`, branch alias `https://the-gathering-git-phase-8-bible-reading-09a899-paint-by-number.vercel.app` (Vercel Authentication required) |
| Signed-out `/journal` → sign-in with `private, no-cache, no-store` (through Vercel's share link) | Pass |
| Production deploys from `main` | Unchanged: paused (nothing merged) |
| Hosted migration history | **Not applied.** Read-only check 2026-10-20: 32 versions, latest `20261025000600`, no `bible`/`journal` schema or `bible` bucket (the stage step 1 expects) |
| Hosted walkthrough with authorized accounts | **Not done** (needs the migrations and authorized test accounts) |
| API.Bible live integration | **Not configured or verified** |

### Hosted walkthrough plan (after the scripts)

With the authorized test accounts (A: super administrator; B: approved member; C: another member in B's household) and only synthetic journal text marked `[TEST]`:

1. Run scripts 1–6; run `supabase/tests/bible-fingerprint.sql` (compare with migration-history.md) and the earlier fingerprints against a fresh build.
2. A prepares the WEB CSV (`scripts/bible-prepare-web.mjs`), adds translation WEB (public domain, confirm rights), imports it, reviews the five omitted verses and spot-checks chapters against ebible.org, publishes, activates, makes it the default. Then prepares the ASV CSV (`scripts/bible-prepare-asv.mjs`), adds translation ASV the same way, accepts Romans 16:26–27, acknowledges Romans 14:24–26, spot-checks the 63 verses in asv-crosscheck.md, publishes, and activates it (WEB stays default).
3. A uploads a small test PDF as a reference file; opens the restricted preview; signs out and confirms the link route refuses.
4. A creates a dated plan from `docs/samples/reading-plan-dated.csv` (dates moved to this week), previews, publishes, features it; creates a numbered plan by hand with a rest day.
5. B joins both (numbered: start two days ago), opens today, marks read/unread, highlights and bookmarks in the reader, writes `[TEST]` journal entries from a question and a passage; tests autosave across two tabs (conflict), going offline, and signing out mid-edit.
6. A revises a future day B has read and one B hasn't; confirms B's completion stays, B sees the change notice; corrects a past day; retires a day.
7. A (super admin) and C (household) try B's journal URLs: not found. B exports and deletes the test entries.
8. B switches on a reminder a few minutes ahead with email to an allowlisted address; confirm one reminder, generic text; pause it.
9. Clean up: delete `[TEST]` entries, leave/delete test enrollments, archive or delete test plans, remove the test PDF, remove temporary roles (audited).

### Known limitations (Phase 8)

- **Translation:** none chosen by the church; the WEB (default) and ASV are public-domain versions members can choose between. API.Bible is unverified live; no ESV adapter.
- **PDF extraction** is intentionally not offered (reference only; see bible-sources.md).
- **Copy/print restrictions** are browser courtesies, not enforcement.
- **Highlights** are per verse (no partial-verse ranges).
- **Reminders** run every 5 minutes (at or shortly after the chosen time) and are skipped if more than 3 hours late; calendar plans' "today" is the church's date, which can differ from the member's near midnight.
- **Journals** are protected by access control, not end-to-end encryption; no on-device recovery and no offline journaling.
- **Phone push** for reminders arrives with Phase 12 (web push and email work now; VAPID keys still unset on previews).
- **Audio Bible** isn't included (no Listen button). Lesson Studio, attachments, and Follow Along remain Phase 13.

### Still open from earlier phases

- **Phase 7:** scheduler handover script not run (`events.settings.job_url` still points at the Phase 6 preview); hosted walkthrough, feed refresh, email/push for teaching and gallery, device checks, provider embed checks.
- **Phase 6:** hosted walkthrough; prayer/care notification email on hosted.
- **Home redesign:** no PR for `claude/brave-knuth-s19gty`.
- **Phase 5:** hosted walkthrough; VAPID keys not set (push off); push on a device.
- **Giving on Phase 6–8 previews:** Stripe variables are scoped to the Phase 3 branch, so Give shows as not configured.
- **Phase 4:** .ics import into calendars, private feed subscription, month grid on a phone, screen reader pass.
- **Phase 3:** hosted dispute "lost"; final statements await church details; Apple Pay/Google Pay on a device; Deployment Protection decision; test subscription and open test dispute in the Stripe sandbox.
- **Phase 2:** device and screen-reader pass of the directory.
- **Phase 1:** role assignment through the UI, logo/icon replacement upload, installed app on physical devices, VoiceOver/TalkBack, production configuration (deliberately not done).

---

# Phase 7 build status

## Phase 7: teaching, media, and shared resources

### Summary

Phase 7 code is complete. It starts from the head of `phase-6/prayer-care` (the newest integrated work: Phases 2–6, design, and the home redesign) and merges `main`'s one newer commit (the supplied Church Reading, Gallery, and Music icons), so nothing is duplicated or lost. None of the earlier PRs is merged, so the Phase 7 PR into `main` also shows their commits; merge them in order first (or retarget). Production builds stay paused (`main` deploys show Canceled); giving stays in Stripe test mode.

**The hosted database is fully migrated for Phase 7** (owner ran `supabase/manual/2026-10-25-apply-media-1.sql` … `-6.sql` in the SQL editor, 2026-10-20) and matches a fresh build from the files. The scheduler handover script and the hosted walkthrough are still to do.

Guides: [media-guide.md](media-guide.md) (administration, permission matrix, storage and costs), [podcast-guide.md](podcast-guide.md), [gallery-guide.md](gallery-guide.md), [media-limitations.md](media-limitations.md) (members and outside services). Design: [architecture.md](architecture.md#teaching-media-and-shared-resources-phase-7).

### What was built

| Area | Where |
| --- | --- |
| Six sections in the menu with the supplied art (Devotionals, Sunday Lessons, Podcasts, Church Reading, Music, Gallery), plus the Teaching & media hub and Saved | `/devotionals`, `/lessons`, `/podcasts`, `/reading`, `/music`, `/gallery`, `/media`, `/saved` |
| Teaching content editor: drafts, preview, publish/schedule/expiry/archive, audiences, featured and order, people, topics, series, tags, scripture, related links, attachments | `/admin/content`, `/admin/content/calendar`, `/admin/content/library`, `/admin/content/<id>/preview` |
| Media library: direct resumable uploads, validation, processing states, rights, captions and transcripts, external YouTube/Vimeo, usage, replacement, cleanup, usage report | `/admin/media`, `/admin/media/cleanup`, `/admin/media/settings` |
| Podcasts: church shows, optional public RSS, external RSS and Spotify/Apple shows with scheduled and manual refresh | `/admin/podcasts`, `/podcast/feed.xml` |
| Gallery: albums for members or a group, member uploads with progress/cancel/retry, moderation, reports and removal requests | `/admin/gallery`, `/admin/gallery/reports`, `/gallery/mine` |
| Player: one coordinated player, persistent mini-player above the dock, Media Session, saved positions, captions, transcripts, click-to-load embeds | `src/components/media/` |
| Home: compact Teaching & media section (today's devotional, latest lesson, featured podcast, this week's reading), shown only for published content; launcher and Coming up kept | `/home` |
| Notifications: `teaching` and `gallery` categories with per-kind switches, generic email/push, on the existing queues and scheduler | `/notifications/settings` |

**Icons.** All six sections use the supplied dimensional art (`assets/menu/`: devotionals, lessons, podcasts, church-reading, music, gallery; 22 of 22 menu tiles supplied). No temporary symbols were needed. The Bible icon is not reused; the Bible tile stays "Coming later" (Phase 8). Small line glyphs for the nav and empty states (`reading`, `music`, `gallery`, `media`) were added to the in-app icon set; they are drawn in the existing style, not the supplied art.

### Verified locally (no hosted services)

Lint (zero warnings), typecheck, production build, **524 Vitest tests** (44 files, run serially; 40 in `tests/db/media.test.ts` against PostgreSQL 16 built from every migration, 31 new unit tests for embeds, scripture, safe fetching, feeds, files, and images, including a synthetic HEIC fixture), and **180 Playwright tests** (desktop and Pixel 7) pass. `tests/db/safeupdate.test.ts` covers the Phase 7 functions. Earlier-phase suites all still pass.

| Area | Proven by tests |
| --- | --- |
| Access | `media` schema unreadable; staff functions refused without the capability; pending/suspended accounts refused; visitors see only public live items; members see members and their groups' items; group items hidden from non-members (lists, search, details, files, captions, transcripts, covers, bookmarks, history, related links, RSS); drafts, scheduled, expired, archived hidden |
| Publishing | Editors can't publish or make public; public needs a publisher, the confirmation, and an eligible kind; rights required to publish church-hosted media; scheduled items appear at their time with no job; expiry hides; group thread links must fit the audience |
| Files | Public items expose only public-use, rights-confirmed, not-members-only files to visitors; storage read/write/delete policies follow the same rules; removal refused while in use; replacement swaps every reference |
| Losing access | Leaving the group or losing approval hides items and files and deletes unread teaching/gallery notices |
| Podcasts | Public feed contains only public, live, rights-confirmed episodes of the one public church show; external ingest dedupes, updates, hides missing, ignores empty feeds, backs off; claims are leased and rate-limited; external audio only when playback is allowed |
| Gallery | Albums never public; uploads limited (size, batch, daily, pending); retries return the same photo; duplicates refused; approval needs a minors decision; only moderators review; reports; uploader removal |
| Notifications | One content notice at publish time, none for back-catalog; muted kinds respected; gallery notices batched; access rechecked before delivery; generic email text |
| Safety libraries | SSRF (private/reserved IPv4/IPv6, DNS rebinding at connect time, redirects), malformed XML and DOCTYPE/entities refused, VTT sanitized, file sniffing, image metadata (GPS) stripped, HEIC decoded and oriented |
| Browser | Signed-out redirects for 20 Phase 7 routes; teaching, gallery, and saved pages `private, no-store`; media delivery routes give no cacheable answer and no redirect for unknown files; the service worker caches no media |

**Not verified in a browser:** the player itself (mini-player placement above the dock, coordination between players, Media Session, saved positions), uploads to real storage, the gallery viewer, and embeds. They need a database with content, so they are part of the hosted walkthrough. Without Supabase configured (local e2e), the public teaching pages fail to load just as the events pages do.

### Hosted

| Check | Result |
| --- | --- |
| Branch pushed | `phase-7/teaching-media` and `claude/blissful-hypatia-inbw75` |
| `MEDIA_RATE_SECRET` | Set 2026-10-20 in Vercel as a **sensitive Preview** variable for all preview branches (random 256-bit value, not stored anywhere else). Not set for Production (paused); without it the app falls back to `EVENTS_JOB_SECRET` |
| Preview build `6b5687c` (`dpl_CipV8dwh9xBGj4jc2etYdSgcA1t3`) | **Ready**: `https://the-gathering-raw7tufzl-paint-by-number.vercel.app`, branch alias `https://the-gathering-git-phase-7-teaching-media-paint-by-number.vercel.app` (the URL the scheduler script uses) |
| Signed-out `/gallery` → sign-in with `private, no-cache, no-store` (fetched through Vercel's share link) | Pass |
| `/podcast/feed.xml` before the migrations | 404 "Not found" (no public feed configured; the feed itself is public, cached 60 s) |
| Production deploys from `main` | Canceled (production stays paused) |
| Hosted migration history | **Applied 2026-10-20** by the owner in the SQL editor. History: `20261025000100`…`000600`, all `created_by = phase-7` |
| Media fingerprint (`supabase/tests/media-fingerprint.sql`, run through the connector, read-only) | **Pass: hosted equals the rehearsal and a fresh build in all 15 categories** (column 261 · constraint 236 · function 145 · function_grant 134 · index 87 · rls 21 · schema_acl 1 · seed_capability 5 · seed_role 4 · seed_role_capability 6 · seed_settings 1 · storage_bucket 2 · storage_policy 3 · trigger 2 · type 7; digests as in [migration-history.md](migration-history.md#phase-7-2026-10-25)) |
| Community and prayer fingerprints after Phase 7 | **Pass:** community (15 categories) and prayer (13) equal a fresh build from all 32 migrations |
| Direct checks | RLS on 21 of 21 `media` tables; no teaching items, files, or albums yet |
| Scheduler (`supabase/manual/2026-10-25-media-scheduler.sql`) | **Not run yet.** `events.settings.job_url` still points at the Phase 6 preview, which doesn't have the feed refresh code. Teaching and gallery notices already run there (they're in the database's `community.tick()`), but external podcast feeds won't refresh until the script runs |
| Rehearsal | Out of order and rerun both stop at the preflight; schema (17), community (15), prayer (13), and the new media (15) fingerprints match a fresh build. Expected media digests are in [migration-history.md](migration-history.md#phase-7-2026-10-25) |
| Hosted walkthrough with authorized accounts | **Not done** (needs the migrations) |
| Feed refresh, email delivery, and push for teaching/gallery | **Not verified** on hosted |
| Device checks (iPhone/Android mini-player, lock-screen controls, HEIC from a phone camera) | **Not done** |
| Provider checks (YouTube, Vimeo, Spotify, Apple embeds; external RSS) | **Pending**: tested only against parsed IDs and local synthetic feeds. The official provider documentation pages were blocked by this environment's network proxy, so embed parameters follow the providers' published URL formats as found through search |

### Hosted walkthrough plan (after the scripts)

With the authorized test accounts (A: super administrator; B: approved member) and only synthetic or licensed media titled `[TEST] Synthetic …` (generate audio/video with ffmpeg; never member media):

1. Run scripts 1–6 and the scheduler script; run `supabase/tests/media-fingerprint.sql` and compare with the expected digests.
2. A uploads a synthetic MP3, MP4 (under 50 MB), image, PDF, and VTT; confirms rights; adds a YouTube reference to a public test video.
3. A grants B `content_editor` temporarily. B drafts a lesson; confirm B can't publish. A schedules it 10 minutes ahead for a test group with "notify" on; confirm it appears on time without opening the admin, and the notice arrives in-app (and by email only to allowlisted addresses).
4. A makes a devotional public; sign out and confirm only public-use files show; try a members-only file URL signed out (refused).
5. Play audio, navigate (mini-player stays above the dock), start a video (audio pauses), reload (position resumes); check lock-screen controls on a phone.
6. Add an external RSS show with a known public feed; refresh now; confirm no notices; turn on the public feed for a public church show and validate `/podcast/feed.xml`.
7. B uploads a synthetic HEIC to a test album; A reviews (minors: none), approves; B reports it; A resolves; B removes it.
8. Clean up: archive or delete test content, remove test files through cleanup, archive the album, and remove B's temporary role (all audited).

### Known limitations (Phase 7)

- **Video:** progressive MP4 only, 50 MB per file on the Free plan; no transcoding or adaptive streaming; long video belongs on YouTube/Vimeo. No paid provider was added.
- **Signed URLs** work for anyone holding them until they expire (5 minutes for images, 30 for playback).
- **Outside services** keep their own visibility: restricting a page doesn't make YouTube, Vimeo, Spotify, Apple, Audible, or feed content private.
- **Spotify** may play 30-second previews without a Spotify login; the app never downloads or proxies Spotify or external audio.
- **Audible** is an outbound link only; completion is the member's own mark.
- **Screenshots** of gallery photos can't be prevented. No facial recognition; minors are a moderator decision.
- **Cleanup** is manual and reviewed; no automatic retention runs.
- **Search** covers titles, summaries, people, tags, and scripture references of visible content (topics, series, and dates are filters), plus show, external episode, and album titles; not body text or transcripts.
- **Phone push** for teaching arrives with Phase 12 (web push and email work now).
- **Test runs:** run Vitest with `--no-file-parallelism` when `TEST_DATABASE_URL` is set (pre-existing).

### Still open from earlier phases

- **Phase 6:** hosted walkthrough not done; prayer/care notification email not verified on hosted. The scheduler still targets the Phase 6 preview until the Phase 7 scheduler script runs.
- **Home redesign:** no PR exists for `claude/brave-knuth-s19gty`; its banner migration is applied on hosted.
- **Phase 5:** hosted walkthrough not done; VAPID keys not set (push off); push not tested on a device.
- **Giving on Phase 6/7 previews:** the Stripe variables are scoped to the Phase 3 branch only, so Give shows as not configured on these previews.
- **Phase 4:** importing .ics into Apple/Google/Outlook, subscribing to the private feed, month grid on a phone, screen reader pass.
- **Phase 3:** hosted dispute "lost"; final statements await church details; Apple Pay/Google Pay on a device; Deployment Protection decision; test subscription and open test dispute remain in the Stripe sandbox.
- **Phase 2:** device and screen-reader pass of the directory.
- **Phase 1:** role assignment through the UI, logo/icon replacement upload, installed app on physical iPhone/Android, VoiceOver/TalkBack, production configuration (deliberately not done).

---

# Phase 6 build status

## Phase 6: prayer requests and care coordination

### Summary

Phase 6 code is complete. It starts from the newest integrated work: the home redesign branch `claude/brave-knuth-s19gty` (homepage redesign, "Coming up" banners, and the uploaded custom icons from `main`), which already contains design PR #9 and Phases 2–5. The two later Phase 4 documentation commits (`8baa825`, `0c5e0d6`) that Phase 5 had missed were merged in, so nothing is duplicated or lost. Because none of those PRs is merged, the Phase 6 PR into `main` also shows their commits; merge them in order first (or retarget). Production builds stay paused (the `main` deploys show Canceled); giving stays in Stripe test mode.

Preview: `https://the-gathering-d3cgv8af1-paint-by-number.vercel.app` (deployment `dpl_7ZVvAkGTE4eqE2d5XoZ8TjGPFNUM`, commit `b5aee08`, Ready); branch alias `https://the-gathering-git-phase-6-prayer-care-paint-by-number.vercel.app` once the branch builds.

**The hosted database is fully migrated for Phase 6** (owner ran `supabase/manual/2026-10-24-apply-prayer-1.sql` … `-4.sql` in the SQL editor, 2026-10-20) and matches a fresh build from the files. The hosted walkthrough has not been done yet.

Guides: [prayer-care-guide.md](prayer-care-guide.md) (administration and permission matrix), [prayer-privacy-guide.md](prayer-privacy-guide.md) (members), [prayer-retention.md](prayer-retention.md). Design: [architecture.md](architecture.md#prayer-and-care-phase-6).

### Verified locally (no hosted services)

Lint (zero warnings), typecheck, production build (all `/prayer` and `/admin/prayer` routes dynamic), **461 Vitest tests** (37 files, run serially; 25 new in `tests/db/prayer.test.ts` against PostgreSQL 16 built from every migration, 5 new unit tests), and **134 Playwright tests** (desktop and Pixel 7; `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`) pass. `tests/db/safeupdate.test.ts` covers every Phase 6 function. The earlier-phase suites (authorization, directory, giving, events, community, home banner) all still pass.

| Area | Proven by tests |
| --- | --- |
| Access | `prayer` schema and helpers unreadable; functions closed to visitors; pending and suspended accounts refused (including suspended authors' own requests, restored on reinstatement); super administrators hold no `prayer.*`/`care.*` capability without a prayer role |
| Creating and editing | Sharing requires confirming the audience; private drafts visible only to the author and only under My requests; publishing a draft needs confirmation; retried submissions don't duplicate; only the author edits, deletes, or changes status |
| Isolation | Church requests for approved members; group requests only for the group's active members (not the community moderator, super admin, prayer team, prayer moderator, or care coordinator); team requests only for `prayer.confidential` holders; lists, filters, and search return only readable requests; LIKE wildcards are literal; members can share only with active groups they belong to |
| Audience changes | Widening needs confirmation; earlier comments and updates stay with their original audience (outsiders see neither, counts exclude them, `withheld` flagged), insiders still see them, new comments reach the wider audience; narrowing to private is immediate and removes others' follows; audit records the change without content |
| Losing access | Removal from a group ends access and removes the follow; restored membership restores access; removing the prayer team role ends confidential access and removes follows; removing the care coordinator role unassigns their care requests |
| Anonymous display | Detail, lists, notifications, and Realtime payloads carry no author name or id (Realtime payloads contain only `kind`); requester comments and updates show "The requester"; a named requester comment shows the name without the requester label; report evidence and the moderator view say "Anonymous" |
| Identity lookup | Refused for prayer moderators, prayer team, and super administrators; reason of 10+ characters required; returns the name only; recorded in the access log (with reason) and the audit log (without content); refused for named requests and for requests outside the lead's scope |
| Prayers | One per member (repeat is a no-op), removable, count only, no names |
| Comments | Only the author edits or deletes; author can turn comments off; deletion leaves a placeholder with the text erased; 21st comment in 15 minutes refused |
| Moderation | Prayer moderators see church/group reports, never team ones without confidential access; community moderators and super admins can't open prayer reports; evidence holds only the reported item; hide/lock need a reason; hidden content disappears for readers but stays for its author; a report about one group request never opens another; the author is notified |
| Status and deletion | Answered appears under Answered; archive makes it author-only; restoring needs confirmation; deletion removes comments, follows, and notifications and clears evidence in closed reports |
| Retention | Off by default (a 400-day-old closed request is untouched by the tick); only settings managers change it; when enabled, closed requests are archived |
| Notifications | Comment notices merge; in-app shows the title; email has no title, comment, or names and links to `/notifications/open/<id>`; losing access before delivery skips the queued email and hides the notice; narrowing drops queued email and unread notices |
| Care | Requests visible only to the requester and coordinators (not prayer team, leads, super admin, community moderator); not in the prayer feed; contact shown only for the chosen method; assignment needs `care.assign`; internal notes only for the assigned coordinator and care leads, never the requester; non-assigned coordinators can't change the request; activity has no text; follow-up reminder sent once across two ticks with a generic email |
| Volunteers | Preview blocks publishing logistics/name without consent; publishing needs confirmation; listings contain no request text, notes, phone, address, or requester name; volunteers can't accept themselves; accepted volunteers see logistics and first name only while consent holds; withdrawing consent hides them at once; other members never see them |
| Logs | Audit, access, moderation, and care activity logs contain no request, comment, care, or note text |
| Browser | Signed-out redirects for 13 Phase 6 routes; prayer pages `private, no-store`; service worker caches no prayer pages |

### Hosted

| Check | Result |
| --- | --- |
| Preview build `b5aee08` (`dpl_7ZVvAkGTE4eqE2d5XoZ8TjGPFNUM`) | Ready |
| Signed-out `/prayer/team` → sign-in with `private, no-cache, no-store` (fetched through Vercel's share link) | Pass |
| Production deploys from `main` | Canceled (production stays paused) |
| Hosted migration history | **Applied 2026-10-20** by the owner in the SQL editor (choosing "Run without RLS" at Supabase's warning: the scripts enable RLS on every table in a loop the checker doesn't detect). History: `20261024000100`…`000400`, all `created_by = phase-6` |
| Prayer fingerprint (`supabase/tests/prayer-fingerprint.sql`) | **Pass: hosted equals the rehearsal and a fresh build in all 13 categories**: column 156 1f938e2d · constraint 118 9f6c7b9a · function 94 34f5e989 · function_grant 83 9b289f9b · index 59 57ef6211 · rls 15 2486b42d · schema_acl 1 12e169ef · seed_capability 5 f2349438 · seed_role 5 356ebd04 · seed_role_capability 8 5c79805d · seed_settings 1 8d831b0e · trigger 3 e83f479b · type 6 2439f248 |
| Community fingerprint after Phase 6 | **Pass: all 15 categories equal a fresh build** (column 236 4fe6d646 · constraint 174 e69c9854 · function 124 b2103420 · index 101 1741e785 · trigger 4 a02edcd5; the rest unchanged from Phase 5) |
| Scheduler (`supabase/manual/2026-10-24-prayer-scheduler.sql`, applied via the connector 2026-10-20) | `events.settings.job_url` moved from the Phase 5 preview to `https://the-gathering-git-phase-6-prayer-care-paint-by-number.vercel.app/api/jobs/events` (the only designated deployment; the Phase 5 preview no longer receives scheduler requests). `events-worker` cron active every 5 minutes. A database-signed test request returned **200** and ran events tick, community tick, and `prayer.tick()`; so the preview's `EVENTS_JOB_SECRET` (set for all preview branches) matches `events.secrets` |
| Direct checks | RLS on 15 of 15 `prayer` tables; `anon` and `authenticated` have no usage on the `prayer` schema; no prayer or care rows yet; retention off |
| Hosted walkthrough with authorized accounts | **Not done** |
| Notification email delivery for prayer/care | **Not verified** on hosted; the local tests prove only what the claim returns (mocked delivery), not that email arrives |

### Hosted walkthrough plan (after the four scripts)

With the authorized test accounts (A: super administrator; B: approved member) and only synthetic content titled `[TEST] Synthetic …`:

1. Confirm A sees no Prayer reports, workspace, or confidential requests. A grants B `prayer_lead` and A `care_lead` temporarily (both audited).
2. B shares a church request (confirm dialog), an anonymous group request in a test group, and a team request; A (member, not in the group, no prayer team role) sees only the church request; search for a word from the team request returns nothing for A.
3. A prays (count 1, no names), comments, follows; B adds an update and marks it answered; A sees the in-app notice; check Resend shows a generic `[TEST]` email only to allowlisted addresses (if A's prayer email is set to right away).
4. B widens the group request to church: A sees it, the "earlier items aren't shown" note, and no earlier comments. B narrows it back: A loses it immediately.
5. Report review needs a **third authorized account** (C, prayer moderator or lead): reviewers can be neither the reporter nor the reported person, by design. A reports B's church request; C opens it, hides and restores it with a reason, and closes it. B (prayer lead) looks up the anonymous author of a request B can read only if B isn't its author (so with two accounts, A writes an anonymous church request for B to look up), then checks the sensitive-access log.
6. B requests help (meal, consent off); A (care lead) assigns themselves, replies, adds an internal note, sets a follow-up date for today, drafts an opportunity with logistics, sees publishing blocked; B allows sharing; A publishes; B can't volunteer for their own request (a third account would volunteer); A closes the request.
7. Clean up: delete the test prayer requests, withdraw/close the care request, close reports, and remove the temporary roles (all audited).

### Known limitations (Phase 6)

- **No attachments** on requests, comments, or care requests (deferred).
- **Search** matches words in titles and bodies of requests you can read; it doesn't search comments or names.
- **Answered-prayer** and other emails are generic by design and default off for prayer.
- **The requester of a care request can't edit it** after sending; they add details by message.
- **Volunteers are contacted through the coordinator**: there is no volunteer-to-requester messaging, and contact details are never filled in from the directory.
- **Care leads assign coordinators**; coordinators can't claim requests themselves.
- **Retention is off** until the church adopts a policy ([prayer-retention.md](prayer-retention.md)).
- **Super administrators and hosting operators:** a super administrator can grant themselves prayer/care roles (audited); people with direct database access can read everything.
- **Youth** remain unable to use the app (Phase 10).
- **Test runs:** run Vitest with `--no-file-parallelism` when `TEST_DATABASE_URL` is set; parallel files race creating the shim's cluster-wide roles (pre-existing).

### Still open from earlier phases

- **Home redesign:** no PR exists for `claude/brave-knuth-s19gty`; its banner migration is applied on hosted.
- **Phase 5:** hosted walkthrough not done; VAPID keys not set (push off); push not tested on a device. (The scheduler and job secret now serve the Phase 6 preview, which includes all Phase 5 features.)
- **Giving on the Phase 6 preview:** the Stripe variables are scoped to the Phase 3 branch only, so Give shows as not configured on this preview (by design until they're added for this branch).
- **Phase 4:** importing .ics into Apple/Google/Outlook, subscribing to the private feed, month grid on a phone, screen reader pass.
- **Phase 3:** hosted dispute "lost"; final statements await church details; Apple Pay/Google Pay on a device; Deployment Protection decision; test subscription and open test dispute remain in the Stripe sandbox.
- **Phase 2:** device and screen-reader pass of the directory.
- **Phase 1:** role assignment through the UI, logo/icon replacement upload, installed app on physical iPhone/Android, VoiceOver/TalkBack, production configuration (deliberately not done).

---

# Phase 5 build status

## Phase 5: community, groups, messaging, and notifications

### Summary

Phase 5 code is complete on `phase-5/community-messaging`, branched from the head of Phase 4 (`0f5e54a`). None of PRs #5, #6, #7 is merged, so the Phase 5 PR into `main` also shows their commits; merge them in order first (or retarget). Production builds stay paused; giving stays in Stripe test mode.

Preview: `https://the-gathering-git-phase-5-community-messaging-paint-by-number.vercel.app` (deployment `dpl_ACmcScwVYkDXLvDfrBncxpVgr2UZ`, Ready).

**The hosted database is fully migrated** (all five Phase 5 migrations, 2026-10-20) and matches the local build. The hosted walkthrough has not been done yet.

Guides: [community-moderation-guide.md](community-moderation-guide.md), [messaging-privacy-guide.md](messaging-privacy-guide.md), [notifications.md](notifications.md). Design: [architecture.md](architecture.md#community-groups-messaging-and-notifications-phase-5).

### Verified locally (no hosted services)

Lint (zero warnings), typecheck, production build, **359 Vitest tests** (30 files; 53 in `tests/db/community.test.ts` against PostgreSQL 16 built from every migration plus a Realtime shim), and **98 Playwright tests** (desktop and Pixel 7) pass. `tests/db/safeupdate.test.ts` covers every Phase 5 function for hosted pg-safeupdate.

| Area | Proven by tests |
| --- | --- |
| Access | `community` schema unreadable; functions closed to visitors; pending and suspended accounts refused everywhere (counts return 0) |
| Guidelines | Posting refused until the current version is accepted; a new version requires accepting again |
| Discussions | Create/list/detail; client-key retries don't duplicate threads or replies; only the author edits; reactions toggle; moderators (not members or leaders outside their group) pin and lock; locked threads refuse replies and edits; author deletion erases text (placeholder with replies, removed without); cursor paging; 7th thread in an hour refused |
| Church-wide vs group | Group threads unreadable, unrepliable, unreactable, and unreportable by non-members and by moderators/administrators outside the group; absent from recent activity |
| Hidden groups | Not listed and "not found" for non-members; discoverable card shows summary only (no details, leaders, count, roster, discussions); community administrators see hidden groups but not their discussions |
| Requests and invitations | Request idempotent; leader notified; decision once; invitations accepted once, replay/revoked/expired refused; one generic refusal for pending, suspended, and unknown invitees |
| Leader scope | Leaders hold no capability; can't edit other groups, appoint leaders, change visibility, see the report queue, set DM eligibility, or create groups |
| Last leader | Leaving or demotion of the last leader refused; allowed after appointing another or archiving; restore needs a leader |
| Households | Household membership grants no group, conversation, or settings access |
| Group images | Upload only by the group's managers; readable only by people who may see the group |
| Group events | Coordinators can target discoverable groups only (hidden ones need group admin/leadership); list, detail, RSVP, image, and group-events list limited to members; group name shown only to members; removal cancels the registration ("ineligible"), promotes the waitlist, empties the private feed, hides the event notification, drops queued event email |
| DM eligibility | Fails closed with no record; only `members.manage` sets it; can't set your own; pending accounts refused; audit has no details |
| DMs | Search returns only listed, eligible, reachable members (opted-out and pending excluded, 2+ characters); retries return the original message; unread counts and mark-read; non-participants, administrators, and moderators can't read or send; settings (none / shared groups) enforced on every send with the same refusal as a block; blocking stops both directions, hides unread counts and notifications, keeps history, doesn't hide discussion posts; roster messaging to directory opt-outs follows their setting; revoked eligibility and suspension stop sending; 61st message in 10 minutes refused |
| Realtime | Pings go only to participants' private topics, contain no text; RLS lets a member read only their own topic and only while approved; clients can't broadcast |
| Reports | Message reports capture only the selected messages; leaders and members can't open them; every view logged; moderators still can't open the conversation; reports about a leader hidden from that group's leaders and their hide attempts refused; leaders hide/restore ordinary members' posts in their group |
| Restrictions | Moderators only; posting restriction blocks posting but not reading; church membership unchanged; moderators can't suspend membership |
| Notifications and email | Forged job signatures refused; one email per notification (merged replies don't re-email); queued email for a group thread skipped after removal and the title never sent; message emails contain neither text nor sender; failed sends retried; digests once per local day with only digest categories; hidden content disappears from notifications; click-through returns nothing when content is gone or not yours; mute stops notifications; withdrawn invitation's notification disappears |
| Quiet hours | 22:30 and 06:59 CST deferred to 07:00 CST; 07:00 not deferred (end exclusive); 20:59 not deferred; church time zone fallback; invalid zones refused |
| Push | Claims carry generic text only; gone subscriptions removed |
| Retention | Messages purged when both participants delete a conversation and after the retention period; closed report evidence cleared after its period |
| Formatting | Scripts, raw HTML, javascript:/data:/vbscript:/tel:/protocol-relative/credentialed links neutralized; external links nofollow ugc; headings flattened; images as alt text |
| Browser | Signed-out redirects for 14 Phase 5 routes; community pages and APIs `private, no-store`; community API 401 when signed out; service worker push handler present and caches no pages |

### Hosted

| Check | Result |
| --- | --- |
| Preview build `711d9c7` (`dpl_ACmcScwVYkDXLvDfrBncxpVgr2UZ`) | Ready |
| Signed-out `/community` → sign-in, `private, no-cache, no-store` (fetched through Vercel's share link) | Pass |
| Migration step 1 (`20261022000100_community_schema`) via connector | **Applied 2026-10-19**: history row recorded under the repository version, 28 community tables, 24 helpers |
| Migration steps 2–5 | **Applied 2026-10-20** by the owner in the SQL editor (step 2 had timed out in the connector without reaching the database). History: `20261022000100`…`000500`, all `created_by = phase-5` |
| Scheduler extension (`2026-10-22-community-scheduler.sql`) | **Run 2026-10-20.** `events.settings.job_url` = the Phase 5 branch URL; `events-worker` cron job active; `events.call_worker()` now also runs `community.tick()`. The Phase 4 preview is no longer the designated deployment |
| `EVENTS_JOB_SECRET` for branch `phase-5/community-messaging` | Not set (it exists only for `phase-4/events-calendar`); community email/push delivery from this preview waits on it |
| VAPID keys for web push | Not set; push is off on the preview (in-app and email unaffected) |
| Fingerprint (`supabase/tests/community-fingerprint.sql`) | **Pass: hosted equals the rehearsal and a fresh build in all 15 categories**: bucket 1 b30312be · column 233 4907293b · constraint 170 84cd4267 · function 124 976aac81 · function_grant 119 4244a591 · index 98 312126a7 · policy 4 0af60a8f · rls 28 1d13c1ca · schema_acl 1 2b42cc9d · seed_capability 2 be6ee9da · seed_category 4 454934f6 · seed_role 3 2b62cb2d · seed_role_capability 2 080caec3 · seed_settings 1 fcb0122a · trigger 3 5e7129c1 |
| Security advisor after Phase 5 | Reviewed: Phase 5 adds only expected notices: `community_job` executable by `anon` (HMAC-signed, like `events_job` and `giving_ingest`), `community` tables with RLS and no policies (never exposed), and signed-in definer functions that recheck access. Pre-existing: `pg_net` in `public` (Phase 4 scheduler), leaked-password protection off |
| Hosted walkthrough with test accounts | **Not done** |
| Web push on a device | Not done |

### Hosted walkthrough plan (after steps 2–5)

With the two authorized test accounts (A: super administrator; B: approved member) and only synthetic content titled `[TEST] Synthetic …`:

1. A grants B messaging eligibility (Administration → Members → B). Nobody can set their own, so A temporarily gives B the Membership administrator role, B grants A eligibility, and A removes B's role again (all audited).
2. Both accept the guidelines; B posts in General Discussion; A replies; B sees the notification and badge update live; A pins, locks, unlocks.
3. A creates a hidden group with B as leader and a discoverable group; check B's directory views; B invites A to the hidden group; A accepts; replay the invitation link (refused).
4. A (as event coordinator) creates a `[TEST]` group event for the discoverable group; B (member) sees it and RSVPs; A removes B from the group; B loses the event, its feed entry, and the notification.
5. DM A↔B; mark read; block and unblock; report one message; open it in Moderation; confirm only that message is shown and the view is logged.
6. Notification settings: email right away for discussions; quiet hours; confirm Resend shows only allowlisted `[TEST]` emails without message text.
7. Clean up: archive the test groups, delete the test discussions and conversations, close the reports, lift restrictions, revoke the test eligibility and roles granted for the walkthrough.

### Known limitations (Phase 5)

- **No attachments or images** in discussions or messages; group chat deferred.
- **Messaging needs an administrator's adult confirmation** per member; there is no self-service age check. Youth accounts remain disabled.
- **Group leaders can't create group events**; event coordinators do (any discoverable group, or hidden groups they lead/administer).
- **One reply level** (no nested replies). Edits keep no history. Hidden content keeps its text until restored or deleted.
- **Realtime is a refresh signal**; if it's unavailable, pages update within 60 seconds or on focus.
- **Search** for messaging and invitations matches names only, and only directory-listed members.
- **Report evidence and messages** have fixed retention windows (configurable); deleted posts can't be recovered.
- **Reaching the scheduler**: with Vercel Authentication on previews, the database scheduler's request gets 401 (as in Phase 4); delivery then happens only right after member actions.
- **Push** depends on browser support and, on iPhone/iPad, a Home Screen install; never guaranteed.

### Still open from earlier phases

- **Phase 4:** importing .ics into Apple/Google/Outlook, subscribing to the private feed, month grid on a phone, screen reader pass; scheduler-driven reminder on hosted (see Phase 4 section).
- **Phase 3:** hosted dispute "lost"; final statements await church details; Apple Pay/Google Pay on a device; Deployment Protection decision; test subscription and open test dispute remain in the Stripe sandbox.
- **Phase 2:** device and screen-reader pass of the directory.
- **Phase 1:** role assignment through the UI, logo/icon replacement upload, installed app on physical iPhone/Android, VoiceOver/TalkBack, production configuration (deliberately not done).

---

# Phase 4 build status

## Phase 4: events and calendars

### Summary

Phase 4 code is complete on `phase-4/events-calendar`, branched from the head of Phase 3 (`49abbaa`), which already contains Phase 2. Neither earlier PR is merged, so the Phase 4 PR into `main` also shows their commits; merge #5, then #6, then this one (or retarget) to avoid duplicating anything. Production builds stay paused; giving stays in Stripe test mode.

Operating guidance: [events-guide.md](events-guide.md). Design: [architecture.md](architecture.md#events-and-calendars-phase-4).

### Verified locally (no hosted services)

All against a real PostgreSQL 16 database built from every migration (`tests/db/events.test.ts`, 25 tests), plus unit tests (`src/lib/events/*.test.ts`, 16 tests). Full suite: lint, typecheck, production build, 294 Vitest tests (including `tests/db/safeupdate.test.ts`, which checks every app function against hosted Supabase's pg-safeupdate rule), and 64 Playwright tests pass.

| Area | Proven by tests |
| --- | --- |
| Access | `events` schema unreadable directly; public events visible to visitors, pending and suspended accounts; members-only events only to approved members; drafts, unpublished-scheduled, and archived events hidden; managers can preview drafts only through admin functions; group audience blocked |
| Separation of duties | Event coordinator holds `events.manage` and nothing else; members and finance admins are refused event administration |
| Images | Storage rule serves a members-only cover to members only, a public cover to visitors, and nothing after archiving |
| Recurrence and time zones | Weekly 9:00 AM stays 9:00 local across the Nov 1 DST change (14:00Z → 15:00Z); nonexistent 2:30 AM → 3:30 AM CDT; ambiguous 1:30 AM → CST; daily every 2 days; monthly on the 31st skips short months; last Sunday and second Tuesday; 200-date cap; unbounded and >2-year rules rejected; all-day events span local midnights |
| RSVP and capacity | Confirm to capacity, then waitlist in order; duplicate request returns the existing registration; **8 simultaneous requests for 3 places: exactly 3 confirmed**; deadline, disabled registration, canceled event, pending member, and anonymous caller refused; a member can't cancel someone else's registration |
| Waitlist | Deterministic order and positions; automatic promotion on cancellation and on capacity increase; capacity reduction keeps confirmed people and holds new ones on the waitlist |
| Permission changes | Suspension cancels registrations and waitlist places, drops queued email, and promotes the next eligible person; eligibility rechecked at promotion |
| Admin registration | Over-capacity only when chosen; ineligible people refused; registration, cancellation, and export audited with reason and row count, no email addresses in the audit log |
| Editing | Series edits keep occurrence ids and registrations; wording-only edits send no email; time edits notify affected registrants; shortening a series keeps registered dates as canceled (notified) and removes empty ones; single-date overrides survive series edits; single-date cancellation blocks RSVP |
| Lifecycle | Unpublish and archive blocked while people are registered; cancel keeps the record, shows "canceled" to registrants, queues cancellation email, and blocks edits |
| Scheduler and email | Reminders queued once across repeated ticks, honoring opt-out; forged job signatures refused; failed sends retried; non-allowlisted addresses suppressed; recipients who lost access skipped; each message sent once with an idempotency key; claimed data contains no attendee information |
| Feeds | Private token shown once and stored hashed; feed lists only confirmed registrations; rotation invalidates the old token; revocation and suspension return "not found"; no email addresses in feed data; public feed off by default and public-events-only when on |
| ICS | RFC 5545 escaping, 75-octet folding without splitting UTF-8, stable UID, SEQUENCE, LAST-MODIFIED, UTC times, all-day dates with exclusive end, STATUS:CANCELLED; Google Calendar link with the event's zone |
| Forms and email | Meeting links must be https with a real host (no credentials, IPs, local hosts, or ports); field-level validation; email subjects marked [TEST], content escaped, no organizer contact details; promotion email states the place is confirmed |

### Hosted

| Check | Result |
| --- | --- |
| Events migrations on project `ymuiutwdnhxdqsetnwkt` | **Applied 2026-10-19** with the manual script (one transaction). History has 15 rows including the three Phase 4 versions; a fingerprint of the `events` schema (columns, constraints, functions, grants, indexes, policies, schema ACL, seeds, triggers) matches the local build exactly |
| `EVENTS_JOB_SECRET`, allowlist, scheduler | **Set up 2026-10-19.** Job secret created in the database (64 hex characters) and copied into Vercel by the owner (Sensitive, Preview, branch `phase-4/events-calendar`; the value was never displayed). Allowlist falls back to `GIVING_EMAIL_ALLOWLIST`. `pg_cron` 1.6.4 and `pg_net` 0.20.4 enabled; one job, `events-worker`, every 5 minutes, targeting the branch's stable URL; `events.call_worker()` not executable by `anon` or `authenticated`. The two secret copies match: the first signed delivery was accepted (walkthrough, reminder row) |
| Migration `20261021000400_settings_safeupdate` | **Applied 2026-10-19** with `supabase/manual/2026-10-21-apply-settings-fix.sql` (preflight matched both hosted function bodies by checksum). Fixes settings saves rejected by pg-safeupdate (found in the walkthrough; also fixes Phase 3's giving settings save) |
| Hosted walkthrough with synthetic events | **Run 2026-10-19** on the branch preview with the owner's two authorized test accounts (A: super administrator, B: approved member). Only events titled `[TEST] Synthetic …` were used; results below |

#### Walkthrough results (hosted preview, 2026-10-19)

How each item was confirmed: **UI** = the owner did it in the browser and reported the outcome; **DB** = I checked the hosted database rows and audit log; **HTTP** = I fetched the preview signed out; **Resend** = I checked the Resend log.

| Check | Result |
| --- | --- |
| Create drafts; drafts hidden | Pass (UI, DB, HTTP: a draft public event returned "not found" signed out) |
| DST and all-day storage | Pass (DB: weekly 9:00 AM = 14:00Z through Oct 29 and 15:00Z from Nov 5; 3-day all-day event ends at local midnight Nov 1 = 05:00Z) |
| Preview, publish now, scheduled publication | Pass (UI, DB: the scheduled event became visible at its 12:00 PM CDT publish time, not before) |
| Visibility | Pass (UI, DB, HTTP: signed-out visitors saw only the public event; members-only event and its .ics returned "not found" signed out; B saw members-only events) |
| Capacity 1, waitlist, automatic promotion | Pass (UI, DB: B confirmed; A waitlisted #1; B canceled; A promoted to confirmed) |
| Registration emails | Pass (Resend: "You're registered", "on the waitlist", "Registration canceled", "A place opened up", each delivered once, subjects marked [TEST], only to the two allowlisted test addresses) |
| Change notifications | Pass (DB: description-only edit sent nothing; location change sent one "changed: place" email to the confirmed registrant only) |
| Admin registration with reason; export | Pass (DB: B added to the waitlist with reason, audited with `over_capacity: false`; export audited with row count) |
| Single-date edit and cancel | Pass (DB, HTTP: Oct 29 moved to 10:00 (SEQUENCE 1); Nov 12 canceled and published as `STATUS:CANCELLED`) |
| ICS download | Pass (HTTP: UTC times, SEQUENCE, 75-octet folding, `Cache-Control: private, no-store`) |
| Public feed | Pass (HTTP: "not found" while off; when on, only the public event's 7 dates, the canceled one marked CANCELLED, `REFRESH-INTERVAL` 60 min) |
| Private feed: create, rotate, turn off | Pass (UI: links opened, old links "not found"; DB audit: created, created again (rotation), revoked; no token left) |
| Cover image | Pass (DB: stored as a 39 KB WebP in the private bucket; HTTP: signed-out visitor gets a 5-minute signed URL with the alt text) |
| Archive | Pass (UI, DB: archived event hidden from B) |
| Cancel event | Pass (DB, Resend: canceled; both registrants emailed once) |
| Registration deadline | Not exercised on hosted (it would have meant waiting until the day of the event); covered by the database tests |
| Scheduled reminder via the database scheduler | Pass (DB, Resend). A members-only test event at 6:00 PM CDT with a 1-hour reminder and A registered: the `events-worker` run at 22:00:00Z queued the reminder; `events.call_worker()` made its only outbound request of the day, a signed POST that the preview answered **200** (`sent: 1, failed: 0, suppressed: 0`), which also proves the database and Vercel copies of the job secret match; Resend delivered "[TEST] Reminder: [TEST] Synthetic reminder check" to A's allowlisted test address at 22:00:04Z; outbox shows one attempt, sent. Every 5-minute run since setup succeeded, and runs with no email due made no request |

**Cleanup (2026-10-19, DB):** all four `[TEST] Synthetic …` events are archived (none visible to visitors or members), the public feed is back off, no private feed links exist, and no email is pending or failed (11 sent in total, all to the two allowlisted test addresses). One synthetic cover image remains in the private bucket, served to nobody because its event is archived. The `events-worker` schedule stays active (it is the designated scheduler and does nothing when no email is due).

Bugs found in the walkthrough and fixed on this branch (each with lint, typecheck, full tests, and build passing before push):

1. Settings saves failed on hosted Supabase (pg-safeupdate): new migration `20261021000400` plus a test over every app function. Phase 3's `finance_settings_save` had the same bug.
2. After a rejected image upload, Safari submitted "Does not repeat" for a weekly event on the next save, removing its future dates (none had registrations). The form now remounts from the submitted values after every attempt (`68f0db4`); the schedule was restored and re-verified.
3. The cover limit said 8 MB but Vercel caps Server Action bodies at 4.5 MB: now 4 MB, checked before upload.
4. The private-feed panel could hide a new link after a turn-off: one action state now drives both buttons (`2d5fc40`).
5. Cancel was one click with an easy-to-miss reason field: event and date cancellation now confirm in a dialog that holds the reason (`defbbe4`).
6. Narrow screens put "Dates and registrations" below the whole edit form; the single-date form clipped its date field. Both layouts fixed.

### Not verified (calendar clients and devices)

- [ ] Importing a downloaded .ics into Apple Calendar, Outlook, and Google Calendar
- [ ] Subscribing to the private feed in Apple Calendar, Google Calendar, and Outlook, and seeing an update and a cancellation arrive after their refresh
- [ ] Month grid and agenda on a physical phone; screen reader pass (VoiceOver, TalkBack)

### Known limitations (Phase 4)

- **One place per member account.** No guest registration, household guest counts, or registering children (deferred until consent and permission flows exist).
- **Group-restricted events** wait for Phase 5's group model; the integration point exists but the option is hidden.
- **Calendar refresh** is controlled by each calendar app (Google can take up to a day). Downloads and "Add to Google Calendar" are snapshots.
- **Reminders** run every 5 minutes, so they can arrive up to about 5 minutes late; reminders more than 6 hours overdue (e.g. after an outage) are skipped. Registrations made after a reminder's time don't get that reminder.
- **Timed events longer than a day** use a wall-clock length; across a DST change night the end time shifts by an hour.
- **Monthly "5th weekday"** isn't offered; "last" covers the common case.
- **Private feed URLs** can appear in hosting request logs like any URL (the app never logs them); members can rotate them at any time.
- **Scheduler reachability:** with Vercel Deployment Protection on, the scheduler's request to the designated preview gets 401. Reminders still queue and are sent by the next request that reaches the app.

### Still open from earlier phases

- **Phase 3:**
  - Hosted dispute closure ("lost") not exercised.
  - Final (approved) statements not produced on hosted; they wait for the church's approved details.
  - Apple Pay and Google Pay not tried on a device.
  - Vercel Deployment Protection is **off** for the whole project (owner's choice, 2026-10-19), pending a decision to re-enable or adopt a narrower option (giving-setup.md).
  - Test leftovers: Account B's $30 monthly test subscription is active and an open $20 test dispute exists in the Stripe sandbox.
  - Admin → Giving → Settings could not save on hosted Supabase (pg-safeupdate). Fixed by Phase 4 migration `20261021000400` (applied to the hosted project); PR #6 on its own still has the bug, so merge it together with this PR.
- **Phase 2:**
  - Hosted walkthrough complete (owner-confirmed).
  - A device and screen-reader pass of the directory is still outstanding (with Phase 1's list below).
- **Phase 1:** see "Still not verified" in the Phase 1 section.

---

# Phase 3 build status

## Phase 3: giving and contributions (Stripe test mode)

### Summary

Phase 3 code is complete on `phase-3/giving-contributions`. It depends on Phase 2 (PR #5, not yet merged), which this branch includes. Production builds stay paused, and Stripe is test mode only.

**Hosted end-to-end payment testing has not been done yet.** It needs the owner's Stripe test credentials and the database script described below. Everything under "Verified locally" uses the real database functions with an in-memory Stripe stand-in, not live Stripe.

### Verified locally (no hosted services)

| Check | Result |
| --- | --- |
| `npm run lint` / `npm run typecheck` (including Stripe SDK 23 types, API `2026-09-30.endive`) | Pass |
| `npm run build` (17 new routes) | Pass |
| Unit tests: money parsing, CSV formula-injection protection, live-key refusal, email wording ([TEST] marking, no tax claims, claim code only for guests), statement PDF (draft watermark, multi-page, font fallback), webhook signature rejection | Pass |
| DB + processor tests (`tests/db/giving.test.ts`): 31 scenarios against real migrations on PostgreSQL 16 through the signed ingest RPC | Pass |
| All tests | 243 pass |
| Playwright: 64 tests, including `/give` honest when unconfigured, thank-you page never claims success, webhook 503 when unconfigured, new routes protected | Pass |
| Operator SQL script rehearsed against a copy of the hosted state; fingerprint equals fresh-from-files (17/17) | Pass |

The giving DB and processor tests cover:
- **Ingest security:** the ingest path refuses calls when unconfigured, unsigned, mis-signed, stale, or signed for another operation. The API roles have no access to `giving.*`.
- **Checkout preparation:** amount and fund validation, and per-form idempotency.
- **One-time gifts:**
  - Recorded only from provider-confirmed state; reaching the thank-you page alone stays "processing".
  - Delayed confirmation, failed payments (no acknowledgment), and abandoned checkouts (expired, no gift).
  - Out-of-order events (charge before checkout), duplicates, and live-mode events (ignored).
- **Fees:** pending, then known; never estimated.
- **Recurring gifts:**
  - Commitments are separate from payments.
  - Invoices arriving before the subscription, renewals, and duplicate renewals.
  - A failed renewal sends one notice, then recovers.
  - An amount change affects future gifts only, and a fund rename doesn't rewrite history.
  - Cancellation sends one email; weekly guest gifts carry a claim reference.
- **Refunds and disputes:**
  - Partial and full refunds, including ones made outside the app; the original payment and its fee stay intact.
  - Disputes through to lost.
- **Email:** a failed send is retried without duplicating, and test mode suppresses recipients not on the allowlist.
- **Members:** see only their own records, without fees or emails.
- **Guest claims:** a guest gift is never attached by email alone. It needs the emailed reference plus a matching verified email, and attempts are rate-limited.
- **Finance access:**
  - Denied to members, content editors, membership admins, and super admins without a finance role.
  - A finance viewer can't export or record; grant and revoke are audited, and revocation and suspension take effect immediately.
- **Manual gifts:** idempotent; corrections and reversals keep history; the audit has no amounts or notes.
- **Refund checks:** capability and remaining balance are verified before Stripe is called.
- **Totals and statements:** totals are consistent; statement year boundaries follow the church time zone, and reversed gifts are excluded.
- **Reconciliation:** repairs a missed renewal without duplicates.

### Hosted

| Check | Result |
| --- | --- |
| `20261020000100_giving_schema` applied with repo version | Applied |
| Remainder of `20261020000200`, all of `000300`, and Phase 2 `household_leave()` applied by the owner via `supabase/manual/2026-10-20-apply-pending.sql` (2026-10-19) | Applied: history has 12 versions ending `20261020000300`; hosted matches fresh-from-files in all 17 fingerprint categories plus the `giving` schema (functions, columns, constraints, RLS, fund seed); no existing rows changed |
| Security advisor after Phase 3 | Reviewed: only expected notices (`giving` tables have RLS and no policies because they're never exposed; definer functions check capability, ownership, or HMAC; leaked-password protection notice predates Phase 3) |
| Phase 2 hosted UI walkthrough | Pass (see the Phase 2 section) |
| Preview env: `GIVING_WEBHOOK_HOST`, `GIVING_EMAIL_ALLOWLIST` | Set |
| Preview env: `STRIPE_SECRET_KEY` (restricted sandbox key), `STRIPE_WEBHOOK_SECRET`, `GIVING_INGEST_SECRET` | Set by the owner (2026-10-19): Sensitive, Preview only, branch `phase-3/giving-contributions`. Ingest secret created once with the create-only script (64 hex characters). Values never seen or logged by Claude |
| Stripe sandbox webhook destination `https://giving-webhooks.gathering.church/api/stripe/webhook` with the 22 handled events | Created by the owner (2026-10-19) |
| Webhook hostname `giving-webhooks.gathering.church` assigned to the Phase 3 branch | Routing passes: `/`, `/give`, `/admin/finance` return 404; `/api/stripe/webhook` answers POST only (GET 405), `no-store`. **Correction:** that check used a Vercel tool that bypasses protection. Stripe's real deliveries got **401** from Vercel Authentication, because preview-branch custom domains stay protected. The owner then turned Vercel Authentication off for the project (2026-10-19); see giving-setup.md |
| Preview `/give` without Stripe keys shows "Online giving isn't available yet" (no fake checkout) | Pass (`dpl_CnMGQZBHcSG7YPxvHpVC8WoEJwC6`) |
| Build `04184ed` (`dpl_4niEHZ3z4wTBfEbzUbK7UZFfYyAn`) with the giving variables: `/give` shows the live checkout form (key accepted as a test key) | Pass |
| Guest one-time card gift ($50, General Offering, `4242…`) through hosted Stripe Checkout (sandbox) | Pass: 4 webhook events (`checkout.session.completed`, `payment_intent.succeeded`, `charge.succeeded`, `charge.updated`) each processed once after redelivery (first attempts got 401, see above); exactly 1 succeeded payment, `livemode=false`, guest; fee $1.75 / net $48.25 from the balance transaction; intent completed; acknowledgment email sent via Resend on the first attempt; no card data stored |
| Signed-in member monthly gift (Account B, $25 Missions) | Pass: subscription + first invoice payment linked to B; Stripe customer stored for B only; `invoice.paid` recorded the payment, and the parallel `charge.succeeded`/`payment_intent.succeeded` were deliberately ignored (no double count) |
| Change recurring amount ($25 → $30) | Pass: one `customer.subscription.updated`, no proration charge, next date unchanged. Found and fixed: the amount editor stayed open and hid the other controls (`d4e75c8`) |
| Update payment method via the Stripe billing portal | Pass (owner); app stores no card details |
| Guest gift claimed by B with the emailed claim code | Pass: payment and its recurring gift moved to B (`giving.gift_claimed` audited); the other guest gift untouched |
| Cancel recurring gift | Pass: `customer.subscription.deleted` processed once; the other gift stays active; cancellation email sent |
| "My giving" discoverable | Found and fixed: only linked from Give and thank-you pages; added to Profile (`411c841`) |
| Finance admin role granted (super admin alone has no finance access) | Pass: `role.granted` audited |
| Refund from Giving admin | First attempt refused by Stripe (`StripePermissionError`: the restricted key lacked Refunds: Write; nothing refunded). After the owner fixed the key: $50 refund recorded once from `refund.created`/`charge.refunded`, refund email sent, `finance.refund_requested` audited. Hardened: an accepted refund is never reported as failed (`bc37e86`) |
| Record cash/check gift, link donor, correct entry | Found and fixed: entries for a linked member were rejected because the hidden donor-name field was required; fund choice reset after errors (`35f5879`). After the fix: original kept as reversed, correction linked to it, `finance.donor_associated` / `finance.manual_recorded` / `finance.manual_corrected` audited |
| CSV export | Pass: rows match the database, `finance.exported` audited (row count only). Net column renamed `net_before_refunds_usd` (`4e06ba2`) |
| Draft statement PDF for B (2026) | Pass: DRAFT watermark, $25 + $25 + $40 = $90.00, matching the database; members can't download until church details are approved |
| Declined card (`4000…0002`) | Pass: recorded as failed (`generic_decline`), never counted, no acknowledgment |
| Dispute (`4000…0259`, $20) | Pass: `charge.dispute.created` processed once, dispute `needs_response`; left open (closing as lost not exercised on hosted) |
| Reconcile today, run twice | Pass: checked 5 checkouts, 2 invoices, 1 refund, 1 dispute; 0 added, 0 updated, 0 emails |
| Webhook totals | Every Stripe event processed or deliberately ignored exactly once; 0 failed |
| Finance summary via a non-finance database role | Refused ("You do not have permission to do that") |
| Approving church details to produce a final statement | **Not run on hosted** by design: needs the church's approved legal details and wording. Covered by automated tests |

### Known limitations (Phase 3)

- **Test mode only.** Finance views show test-mode records. Release needs a reviewed migration plus live credentials (giving-setup.md).
- **Statements stay drafts** (watermarked, not downloadable by members) until the church enters and approves its legal name, address, tax ID, and wording.
- **Recurring gifts can't be paused or resumed.** Cancellation is immediate.
- **One fund per gift.** USD only.
- **Statement PDF scripts:** names and other entered text render in Latin (including Vietnamese), Greek, Cyrillic, Devanagari, Arabic, Hebrew, Thai, Chinese, Japanese, and Korean using bundled Noto fonts (`assets/fonts`, OFL). Characters no bundled font covers (for example emoji) print as "?" in the page, but the PDF metadata keeps the donor name unchanged. Bold Chinese, Japanese, and Korean text prints in Regular. The fonts add about 18 MB to the statement routes' server bundle.
- **Rate limits are fixed windows:** 10 checkout attempts per 15 minutes per hashed IP for guests (20 for signed-in accounts), and 5 gift-claim attempts per hour.
- **PayPal and Venmo aren't implemented.** The extension point is documented; no buttons are shown.

---

# Phase 2 build status (historical)

## Phase 2: member directory, profiles, privacy, households

### Summary

Phase 2 code is complete on `phase-2/member-directory`, and its migrations are applied to Supabase project `ymuiutwdnhxdqsetnwkt`. Preview: `https://the-gathering-git-phase-2-member-directory-paint-by-number.vercel.app` (Vercel Authentication required). Production stays paused.

### Verified locally (no hosted services involved)

| Check | Result |
| --- | --- |
| `npm run lint` (zero warnings) / `npm run typecheck` | Pass |
| `npm run build` (all routes dynamic, including 7 new member routes and 1 admin route) | Pass |
| Unit tests: Phase 1 suites plus directory formatting, profile/privacy schemas, and photo processing (synthetic images; output checked for metadata removal) | Pass |
| DB tests on PostgreSQL 16 + shim: 41 Phase 1 + 42 Phase 2 (`tests/db/directory.test.ts`) | 83 pass |
| Playwright: desktop + Pixel 7, signed-out redirects for every new route, `private, no-store`, registration directory notice | 52 pass |

The Phase 2 database tests use only synthetic `example.test` accounts. They cover:
- **Profiles:** created automatically with privacy defaults; the directory email is separate from the sign-in email; month/day birthday and email validation; youth accounts blocked.
- **Directory access:** pending and suspended accounts are denied, and anonymous visitors have no access at all.
- **What the directory returns:** only approved, listed adults appear. Hidden values never appear in any response, and search can't match a hidden city, email, phone, or address. Suspension and opt-out take effect immediately, and paging works.
- **Cross-account protection:**
  - No direct reads or edits of other members' rows, and a photo path can't point at another member's folder.
  - Pending and suspended members can't edit details.
- **Roles:**
  - Content editors get no private data and no correction RPC.
  - Membership admins can correct profiles, audited by field name only (no values), and can see opted-out members.
  - Membership admins can't change privacy choices or edit a super admin.
  - Members still can't change their own status or roles.
- **Ministry interests:** only managers edit the catalog (audited). Members can pick only active options for themselves, and the directory shows interests only when shared.
- **Photos:**
  - Uploads only into your own folder and only while approved; the bucket is private, WebP-only, and limited to 1 MB.
  - Visibility follows show-photo, the listing, and membership status.
  - A replaced photo stops being served, there is no update path, and owners can delete their own files.
- **Households:**
  - No direct writes, and only listed members can be invited, with one refusal message for every case.
  - Invitations are private and idempotent. Decline, revoke, expiry, accept, and replay of any of them are all handled.
  - Membership grants no access and reveals no hidden fields.
  - Directory display requires every adult's consent, a second household is refused, and the last adult leaving closes the household.

### Hosted (Supabase project + Vercel preview)

| Check | Result |
| --- | --- |
| Migrations `20261019000100`–`000400` applied with repository version numbers | Applied (see migration-history.md) |
| Fresh-from-files schema matches hosted in all 17 fingerprint categories (excluding the pending `household_leave`) | Pass |
| Preview build of `6249997` (`dpl_EzB5sFq2ZqvbbKCfVdf8ecJpRmQq`) | Ready |
| Signed-out `/directory` → `/sign-in?next=/directory`, `private, no-store` | Pass |
| Preview alias matches the Supabase redirect pattern `https://the-gathering-*-paint-by-number.vercel.app/**` | Pass (pattern match; Site URL unchanged) |
| As the approved test member (DB role and JWT claims): no other profiles or details readable, own details row present, directory lists 2 members, hidden-by-default fields null for members who didn't share them | Pass |
| Anonymous role: no execute on directory functions, no select on details; internal helpers not executable by clients; `profile-photos` private | Pass |
| Security advisor: only expected notices (definer functions that re-check capabilities; `guardianships` and `system_state` deliberately have no policies) | Reviewed |
| Photo upload on the preview stored a processed WebP (38 KB) in the private bucket | Pass |

After the owner ran `supabase/manual/2026-10-20-apply-pending.sql`, `household_leave()` is applied and the fresh-from-files schema matches hosted in all categories with nothing excluded (2026-10-19).

### Hosted UI walkthrough (2026-10-19)

Done by the owner in the preview (`dpl_6drS4hTuucx4jt6iPEyszt48J7Zg`, commit `4c62aca`) with the two existing accounts: A (super admin) and B (approved member, test data only). After each part, Claude checked the result in the database (flags and counts only, no personal values).

| Check | Owner observed | Database check |
| --- | --- | --- |
| Ministry interests created by an admin, then selected by B | Pass | 2 interests created (audited `ministry_interest.created`); B has 2 selected |
| B edits profile details | Pass | Details saved |
| Directory search by name and by city; B's entry shows only the shared fields | Pass | Privacy flags saved |
| Photo hidden by its owner: other member sees initials | Pass (A's photo, viewed by B) | A `show_photo` false, then restored |
| Photo upload | Pass (tested 2026-10-18) | Processed WebP in the private bucket |
| Household: invite, accept, both listed, shown on the directory entry, then B leaves | Pass | End state: B in no household, A's household has 1 member, no open invitations (joins and leaves aren't audited, so only the end state is visible) |
| B opts out of the directory; A can't find B or open the old entry | Pass | B `directory_listed` false |
| Admin correction of B's city | Pass | One `profile.admin_updated` entry by A on B, recording only `["city"]` |
| Admin audit page shows the correction by field name | Pass | Same entry |

During the first privacy pass, B's saved flags didn't match the intended clicks (first all off, later all on). The privacy form is the only writer of these flags. The owner retested and confirmed the form saves what is ticked.

**Restored afterwards:** A has its original privacy choices. B is listed again and, by the owner's choice, shares all of its test details. The two test ministry interests stay active.

### Known limitations (Phase 2)

- Signed photo URLs stay valid for up to 5 minutes after a photo is hidden or the owner leaves the directory. Deleted photos stop at once.
- One household per adult. Children and guardian-managed accounts are not enabled (`guardianships` is reserved).
- There is no notification beyond the in-app badge on Home and Profile when an invitation arrives. No email is sent, by design.
- Ministry-interest options start empty; administrators add them.

---

# Phase 1 build status (historical)

## Summary

Phase 1 code is complete, and the database schema is live in Supabase project `ymuiutwdnhxdqsetnwkt`. Live sign-up, email, and Vercel checks still need the external configuration in [setup.md](setup.md).

## Verified here

| Check | Result |
| --- | --- |
| `npm run lint` (ESLint, zero warnings) | Pass |
| `npm run typecheck` | Pass |
| `npm run build` (production; all routes dynamic) | Pass |
| Unit tests (palette contrast, time zones/DST, Markdown XSS, schemas, uploads, redirects, error mapping) | 84 pass |
| Database authorization tests: real migrations on PostgreSQL 16 with a Supabase shim | 41 pass |
| Playwright browser tests: desktop 1280 px and Pixel 7, built app, no Supabase | 32 pass |
| Schema applied to Supabase project; tables, policies, buckets, auth triggers inspected | Done |
| Hosted migration history equals the five repository migrations; fresh-from-files schema matches hosted in all 17 fingerprint categories | Pass |
| Supabase security advisor | Reviewed (see notes) |

### What the database tests prove

- **Registration:** creates a pending profile automatically. Forged `role`/`membership_status` sign-up metadata is ignored.
- **Members:** can edit only their name, preferred name, and phone. They can't change their status, email, roles, another profile, or the audit log.
- **Capabilities:** content editors get only `announcements.manage` (no membership or finance access). Membership admins can't assign roles or touch super admins. Pending and suspended accounts hold no capabilities, even if they have roles.
- **Status changes:** approve, suspend, and reinstate work with an audit trail, and nobody can change their own status.
- **Super administrators:** the bootstrap works once, needs a verified email, and isn't callable by clients. The last active super admin can't be revoked, suspended, or deleted, and a handover works.
- **Settings:** publicly readable, persisted only by settings managers, invalid time zones rejected, audit records field names only.
- **Announcements:**
  - Anonymous, pending, and suspended viewers see only live public announcements. Approved members also see members-only ones.
  - Drafts, future-scheduled, expired, and archived announcements are hidden from readers.
  - A scheduled announcement becomes visible at its time with no job.
  - Authorship can't be forged, announcements can't be deleted from the app, and the audit never records content.
- **Storage:** announcement images follow announcement visibility. Branding uploads need `settings.manage`. Both buckets accept raster types only.

### What the browser tests prove

- Welcome page renders the approved logo at its natural aspect ratio, with no horizontal scroll on phone or desktop.
- Unconfigured contact details and gathering times show empty states.
- Manifest fields and every icon URL (192/512, any and maskable), `favicon.ico`, `icon.png`, `apple-icon.png`, `sw.js`, and `offline.html` are served. The Apple web-app meta tags, `theme-color`, and manifest link are present.
- `/home`, `/profile`, `/announcements`, `/admin`, `/admin/members`, and `/admin/settings` redirect signed-out visitors to sign-in.
- Form errors are announced, linked by `aria-describedby`, and marked `aria-invalid`. Password rules are enforced and non-secret values are preserved.
- With no auth service, sign-in says so instead of pretending to succeed.
- Skip link and focus outline work from the keyboard.
- Sign-out is POST-only and sends `Clear-Site-Data`.
- Install guidance is shown.

## Hosted preview (Vercel, verified 2026-10-18)

Preview: `https://the-gathering-git-phase-1-deployment-ver-56f120-paint-by-number.vercel.app` (Vercel Authentication required to view)

| Check | Result |
| --- | --- |
| Preview build with Supabase env vars | Pass (`dpl_FQtcZi3HfPN2tqukbFsNxvJXcUbE`) |
| Welcome page reads church settings from the hosted database (no "unavailable" notice) | Pass |
| Signed-out `/admin/members` → `/sign-in?next=/admin/members` | Pass |
| Protected responses `private, no-store`; security headers present | Pass |
| Production builds paused (merge to `main` canceled by Ignored Build Step) | Pass |

## Live authentication and email (hosted preview, 2026-10-18)

Preview: `https://the-gathering-git-phase-1-auth-email-setup-paint-by-number.vercel.app`. Supabase auth uses Resend SMTP from `hello@gathering.church`.

| Check | Result |
| --- | --- |
| Registration creates a pending profile with the supplied name; no roles granted | Pass |
| Verification email delivered through Resend (Resend log: delivered) | Pass |
| Verification link (token-hash template) confirms the address and lands on the pending page | Pass |
| Pending account sent to the status page from `/home`, `/announcements`, `/admin` | Pass |
| Initial super administrator appointed (`bootstrap_super_admin`); audit entry recorded | Pass |
| Second bootstrap attempt refused ("already been appointed") | Pass |
| Sign-out ends the session (one active session after sign-in; Back does not reveal signed-in pages) | Pass |
| Super admin reaches Home and the admin dashboard | Pass |
| Church settings persist, show on the public welcome page, and are audited by field name only | Pass |
| Second account: verification email delivered; pending until approved | Pass |
| Admin approval (`pending → approved`, audited) sends the app's "Welcome to The Gathering" email via Resend | Pass (delivered) |
| Approved member without roles is denied `/admin` | Pass |
| Public vs members-only announcements: signed-out visitors see public only; members see both | Pass |
| Scheduled announcement appears at its publish time with no admin action | Pass |
| Expiring announcement disappears at its expiry time (checked against the database clock) | Pass |
| Announcement image upload saved and audited | Pass |
| Password reset email delivered; reset link sets a new password; old password refused | Pass |
| Suspension blocks member areas immediately; reinstatement restores access (both audited) | Pass |
| Admin cannot change their own membership status | Pass |
| Archive hides announcements; audit records status changes only, never content | Pass |

Test accounts kept: `robtwebb@me.com` (initial super administrator) and `breaktwomusic@gmail.com` (approved member, no roles). All TEST announcements are archived, and the church settings test values were cleared.

## Still not verified (manual or device testing)

- [ ] Role assignment through the UI (for example, granting content editor); the database rules are covered by the authorization tests
- [ ] Logo/icon replacement upload in church settings (announcement image upload was verified)
- [ ] Installed-app appearance on a physical iPhone (Add to Home Screen) and Android device
- [ ] Screen reader pass (VoiceOver and TalkBack)
- [ ] Production: environment variables, unpausing builds, and a production deploy (deliberately not done; see deployment.md)

## Known limitations and notes

- **Brand sources:** the logo and icon reached this environment as WebP renditions (1701×2000 and 2000×1860) of the supplied PNGs. The Illustrator file (`Gathering Icon.ai`) was not available, so no SVG was produced and no vector was fabricated. All web and PWA assets are raster, generated from these sources.
  - The supplied icon had transparent padding and a tiny isolated 2-pixel export speck in the far corner. Display copies remove both; the artwork itself is untouched.
  - The supplied artwork touches its canvas edges, so the circle's top may already have been tightly cropped at export. If original PNG/SVG exports are added to `assets/brand/source/`, rerun `npm run brand:assets`.
- **Small sizes:** at 16 px the favicon is recognizable as the mark but its detail is lost; 32 px and up read clearly.
- **Home Screen icons:** an uploaded replacement icon is used in app headers immediately. Manifest and Home Screen icons stay on the approved artwork until regenerated and redeployed.
- **Supabase advisor warnings (intentional):**
  - "Signed-in users can execute SECURITY DEFINER functions" covers the helpers and admin functions. Each re-checks the caller's capability internally and is covered by tests.
  - "RLS enabled, no policy" on `system_state` is deliberate: there is no client access.
- **Migration history:** the Supabase project's migration history differs from the repo files (see setup.md §2).
- **Not in Phase 1:** directory, households, and advanced profile fields (added in Phase 2); Stripe (Phase 3); realtime features.
