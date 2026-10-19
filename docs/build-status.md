# Build status

Last updated: 2026-10-21 · Phase 4 branch `phase-4/events-calendar` (stacked on Phase 3, PR #6, which includes Phase 2, PR #5)

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
