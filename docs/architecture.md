# Architecture

## Overview

```
Browser (PWA) ──► Next.js on Vercel ──► Supabase (Auth · Postgres + RLS · Storage)
                     │                         ▲
                     └── Resend (app emails)    └── Supabase Auth sends auth emails via Resend SMTP
```

- **Rendering:** everything is server-rendered per request (`dynamic = "force-dynamic"` in the root layout; Cache Components off). Private pages are never prerendered, shared-cached, or prefetched across sessions.
- **Data access:** server components and Server Actions use a per-request Supabase client carrying the member's session (`src/lib/supabase/server.ts`). Row-level security applies to every query.
- **No service credentials at runtime:** the app reads only the publishable key. The secret key is used only by the operator script `scripts/bootstrap-super-admin.mjs`.

## Source layout

```
src/
  app/
    (public)/        welcome page, install guidance
    (auth)/          sign-in, sign-up, forgot/reset password, check-email (+ actions.ts)
    (member)/        home, announcements, directory, profile (edit, photo, privacy,
                     preview, household): approved members only
    (events)/        events list, month, detail, ICS download, calendar & reminders
                     (public events open to visitors)
    (member)/community, groups, messages, notifications   Phase 5 (approved members)
    admin/community, admin/moderation                     Phase 5 administration
    (member)/prayer        prayer requests, care requests, ways to help, team workspace (Phase 6)
    admin/prayer           prayer reports, settings, sensitive-access log (Phase 6)
    (member)/bible, journal  Bible reading plans, reader, bookmarks; My Journal (Phase 8)
    admin/bible            reading plans and Bible sources (Phase 8)
    (member)/memory        memory home, assignment, collections, My Verses, practice, review,
                           progress, settings, challenges; /memory/lead for authorized group leaders (Phase 9)
    admin/memory           memory verse collections, assignments, preview, challenges (Phase 9)
    (member)/youth         Youth home, family dashboard, child pages, events and forms, practice,
                           groups, discussions, leading, youth account (Phase 10)
    admin/youth            youth policy, families, groups, forms, youth events, photo consent,
                           safeguarding (Phase 10)
    youth-activate         youth account activation with a one-time code (Phase 10)
    admin/           dashboard, members, ministry interests, settings, announcements, audit
    auth/confirm     email-link landing (token_hash or PKCE code)
    auth/sign-out    POST-only sign-out with Clear-Site-Data
    account-status   pending / suspended messaging
    manifest.ts, favicon.ico, icon.png, apple-icon.png
  components/        ui/ (buttons, fields, alerts, badges…), layout/, brand/, announcements/, pwa/
  lib/               auth/, announcements/, directory/, profile/, settings/, email/, supabase/, theme/,
                     time, uploads, navigation
  proxy.ts           session refresh + signed-out redirect (convenience only)
supabase/
  migrations/        versioned schema (source of truth)
  templates/         auth email templates
  seed.sql           synthetic local-only data
  tests/             Supabase shim for integration tests
tests/db             RLS / authorization integration tests
tests/e2e            Playwright browser tests
assets/brand/source  supplied artwork (never modified)
public/brand, public/icons   generated web/PWA assets
```

## Authorization model

Two independent axes:

1. **Membership status** (`profiles.membership_status`): `pending` → `approved` ↔ `suspended`. Only approved members reach member content.
2. **Capabilities** granted through **roles** (`roles`, `role_capabilities`, `user_roles`). Capabilities apply only while the holder is approved.

| Role | Capabilities (Phase 1) | Assignable |
| --- | --- | --- |
| Super administrator | all (implicit) | yes |
| Membership administrator | `members.view`, `members.manage` | yes |
| Content editor | `announcements.manage` | yes |
| Finance administrator | `finance.view`, `.record`, `.export`, `.manage`, `.refund` | yes (explicit only) |
| Finance viewer | `finance.view` | yes (explicit only) |
| Event coordinator | `events.manage` | yes |
| Community administrator | `community.manage` | yes (Phase 5) |
| Community moderator | `community.moderate` | yes (Phase 5) |
| Prayer team member | `prayer.confidential` | yes, explicit only (Phase 6) |
| Prayer moderator | `prayer.moderate` | yes, explicit only (Phase 6) |
| Prayer and care lead | `prayer.confidential`, `.moderate`, `.identity` | yes, explicit only (Phase 6) |
| Care coordinator | `care.coordinate` | yes, explicit only (Phase 6) |
| Care team lead | `care.coordinate`, `care.assign` | yes, explicit only (Phase 6) |
| Group leader | `groups.lead` (reserved; leadership is per group, see Phase 5) | no |
| Reading plan editor | `reading.edit` | yes (Phase 8) |
| Reading plan publisher | `reading.edit`, `reading.publish` | yes (Phase 8) |
| Bible source manager | `bible.manage` | yes (Phase 8) |
| Memory verse editor | `memory.manage` | yes (Phase 9) |
| Memory verse publisher | `memory.manage`, `memory.publish` | yes (Phase 9) |
| Youth leader | `youth.lead` (plus an assignment to each group) | yes, explicit only (Phase 10) |
| Youth ministry administrator | `youth.manage`, `youth.publish`, `youth.enroll` | yes, explicit only (Phase 10) |
| Family administrator | `family.verify` | yes, explicit only (Phase 10) |
| Permission form administrator | `youth.forms` | yes, explicit only (Phase 10) |
| Youth event logistics | `youth.logistics` | yes, explicit only (Phase 10) |
| Photo consent reviewer | `youth.media_consent` | yes, explicit only (Phase 10) |
| Youth safeguarding reviewer | `youth.safeguarding` | yes, explicit only (Phase 10) |
| Youth policy administrator | `youth.policy` | yes, explicit only (Phase 10) |

`settings.manage`, `roles.manage`, and `audit.view` belong to super administrators only. Super administrators don't receive `finance.*`, `prayer.*`, `care.*`, `youth.*`, or `family.*` implicitly: those are granted only through explicit roles (which a super administrator can assign, audited).

### Enforcement layers (deny by default)

1. **Database:** RLS on every table. Column-level grants mean members can update only their name fields and `phone` on `profiles`, and only their own details and privacy choices on `member_profile_details`. `user_roles`, `audit_log`, and membership status have no client write path. Privileged changes go through `SECURITY DEFINER` functions (`admin_set_membership_status`, `admin_grant_role`, `admin_revoke_role`) that re-check `has_capability()` and write audit entries.
2. **Server:** layouts and every Server Action call `requireApprovedMember()` / `requireCapability()` (`src/lib/auth/viewer.ts`). The user is verified with `auth.getUser()` on each request.
3. **Proxy:** sends signed-out visitors to sign-in and marks protected responses `private, no-store`. It's not relied on for authorization.

### Safeguards

- Sign-up metadata is ignored except the display name, so a forged role or status has no effect.
- Members cannot change their own status. Membership admins cannot change a super admin's status.
- **Last super administrator:** triggers on `user_roles` and `profiles` (serialized with an advisory lock) block removing, suspending, or deleting the last active super admin.
- **Initial super administrator:** `bootstrap_super_admin(email)` is executable only by the service role, requires a verified email, and refuses to run once a super admin has ever been appointed (`system_state`).
- **Audit log:** status changes, role changes, settings changes (field names only), and announcement lifecycle (state and field names, never content).

## Member directory and privacy (Phase 2)

### Data model

| Table | Holds | Who can read it directly |
| --- | --- | --- |
| `profiles` (+ `first_name`, `last_name`, `account_kind`) | Names, sign-in email, phone, status | The member; `members.view` holders |
| `member_profile_details` | Directory email, address, bio, birthday (month/day), photo path, nine privacy flags | The member; `members.manage` holders |
| `ministry_interests` / `member_ministry_interests` | Catalog and each member's choices | Approved members (active catalog); own choices; `members.manage` |
| `households`, `household_members`, `household_invitations` | Connected adults and in-app invitations | Members of that household; the invitee |
| `guardianships` | Reserved for guardian-managed youth accounts | Nobody (no grants, no policies) |

The private fields sit in their own table because Phase 1 grants table-level `SELECT` on `profiles`, and a table-level grant would automatically cover new columns. A details row with the privacy defaults is created by trigger for every profile.

### Secure directory projection

Members never read another member's rows. The directory is served only by `SECURITY DEFINER` functions:

- `directory_search(query, limit, offset)` returns id, display name, full name, and (when shared) photo path and city/state, plus a total for paging (max 50 per page).
- `directory_member(id)` returns one profile with every hidden field as `null`, active ministry interests when shared, and household members when both adults share their household.

Both functions:
- check `is_approved_member()` on every call, so pending, suspended, and signed-out callers are refused;
- include only approved, adult, listed profiles;
- search only names and, when the member shares it, city (LIKE wildcards are escaped);
- never return the sign-in email, membership status, roles, or privacy flags.

Hidden, pending, suspended, and unknown members all produce the same "not found" page.

**Defaults:** a member is listed after approval with photo, city/state, ministry interests, and household shown. Directory email, phone, street address (with postal code), and birthday stay hidden until the member shares them. Opting out of the directory hides everything from other members but not from membership administrators.

### Photos

- Private `profile-photos` bucket: 1 MB, WebP only. Objects are named `<member id>/<random>.webp`, and a check constraint keeps `photo_path` inside the member's own folder.
- The browser crops (zoom and position sliders) and uploads a 768 px JPEG, so the original never leaves the device. Without JavaScript, the original is uploaded and centre-cropped on the server.
- The server checks the file signature, size (4 MB), and dimensions (128 to 8000 px), then re-encodes with `sharp` to a 512 px WebP with metadata (EXIF/GPS) removed. Only that copy is stored.
- Replacing or removing a photo deletes the old object. There is no storage update policy, so a URL can never start serving a different image.
- Storage RLS (`can_view_profile_photo`) lets approved members read an object only while it is the owner's current photo, the owner is listed, and the owner shares it. The owner and `members.manage` holders can always read it.
- Pages use 5-minute signed URLs and plain `<img>`, so nothing goes through the Next.js image cache.
- **Revocation delay:** hiding or removing a photo stops new URLs immediately, but a URL already on someone's screen keeps working for up to 5 minutes. Removed objects return 404 at once.

### Households

- All writes go through functions: `household_create`, `household_rename`, `household_invite`, `household_revoke_invitation`, `household_respond`, and `household_leave`. Reads go through `my_household()` and `my_household_invitations()`.
- Invitations:
  - are sent in the app to a member chosen from the directory, never by email address;
  - get one refusal message for hidden, pending, suspended, and unknown accounts, so membership can't be probed;
  - expire after 14 days, with lazy expiry and no job;
  - can be revoked, are limited to 10 open per household, and can be answered only once by the invitee (row lock plus status check).
- One household per adult. The last adult to leave closes it.
- A household grants no account access and reveals no hidden fields. Belonging to one does not establish guardianship. Youth accounts are blocked by a constraint (`profiles_youth_accounts_not_enabled`) until a later phase.

### Administration

- Only `members.manage` holders can see directory visibility, read private details, and correct profiles. `admin_update_member_profile()` changes names, contact details, address, bio, birthday, or removes the photo, and audits `profile.admin_updated` with field names only.
- Privacy choices can't be changed by admins; they belong to the member.
- A super administrator's profile can be edited only by a super administrator.
- Ministry-interest options are managed at **Admin → Ministry interests** and are archived rather than deleted. Catalog changes are audited.
- Content editors still have no access to other members' profiles or details.

## Giving (Phase 3)

Full details: [giving-setup.md](giving-setup.md) (configuration, webhook, and release) and [finance-guide.md](finance-guide.md) (operations).

- **Payments:**
  - Stripe-hosted Checkout handles one-time, weekly, and monthly gifts, in USD integer cents.
  - Cards plus Apple Pay and Google Pay are offered through Stripe's dynamic payment methods.
  - Each fund has a Stripe Product, and prices are created inline.
- **Private storage:** all records live in the `giving` schema, which the Data API doesn't expose and the API roles can't use. Access goes through functions:
  - `giving_public_config()` (active funds and limits);
  - `my_giving*()` (own records, any membership state);
  - `finance_*()` (explicit finance capabilities);
  - `giving_ingest()` (server only, HMAC-signed with `GIVING_INGEST_SECRET`; no service-role key in the app).
- **Records:**
  - `intents`: what the donor chose before checkout.
  - `commitments`: recurring subscriptions.
  - `payments`: each actual payment or cash/check gift; only `succeeded` counts. The fund name is snapshotted, so history never changes.
  - `refunds` and `disputes` reference the original payment, which is never altered.
  - `stripe_events` is the webhook ledger, and `email_outbox` tracks delivery separately from payment state.
- **Webhook:**
  - Signature verified on the raw body.
  - Deduplicated by event id.
  - Objects are re-read from Stripe before each write, so delivery order and duplicates don't matter.
  - Status is monotonic (a confirmed payment never moves back).
  - Fees come from the balance transaction or show as pending.
  - It's served on a dedicated public hostname that answers only that path.
- **Trusted mappings:** the Stripe customer ↔ account mapping is written only by the server. User-supplied customer ids are never accepted. Guest gifts attach to an account only through a reference code emailed to the guest plus a matching verified sign-in email, or through a finance user's audited link.
- **Finance access:**
  - `finance.view`, `.record`, `.export`, `.manage`, and `.refund` come only from explicit roles: `finance_admin` or `finance_viewer`.
  - `has_capability()` excludes `finance.*` from the implicit super-admin grant.
  - Capabilities are checked on every call, so revocation is immediate.
- **Statements:** PDFs (pdf-lib, with the church logo) use church-time-zone year boundaries. They stay watermarked drafts, and members can't download them, until finance enters and approves the organization identity and wording.
- **Safety rails:**
  - Live Stripe keys are refused by the app, and live events by the database.
  - Test emails are marked [TEST] and limited to an allowlist.
  - Checkout creation is rate-limited by hashed IP or account.
  - Return URLs come only from configuration.

## Events and calendars (Phase 4)

Operating guidance: [events-guide.md](events-guide.md).

### Data model (private `events` schema)

The `events` schema isn't exposed by the Data API, and `anon`/`authenticated` have no privileges on it. Everything goes through `SECURITY DEFINER` functions in `public` that check membership, audience, and capability on every call.

| Table | Holds |
| --- | --- |
| `series` | One event (a one-off is a series of one): title, Markdown description, cover image, category, audience, IANA time zone, local start date and time, length (or day count for all-day), place, online link, organizer name, registration settings, reminder times, recurrence rule, status (`draft`/`published`/`canceled`/`archived`), `publish_at`, `sequence` |
| `occurrences` | Materialized dates. Stable `id` (calendar UID) plus `occurrence_key` (the date the rule generated). Per-date overrides (date, time, length, place, note), `detached`, `orphaned`, status, `sequence` |
| `registrations` | One per member per occurrence: `confirmed`/`waitlisted`/`canceled`, waitlist order `(queued_at, id)`, cancel reason (`member`/`admin`/`ineligible`), source |
| `categories`, `settings` | Configurable categories (seeded: Worship, Fellowship, Bible Study, Youth, Outreach, Serving); public-feed switch, default reminders, scheduler URL |
| `member_prefs`, `feed_tokens` | Optional reminders on/off; SHA-256 of each member's private feed token |
| `outbox`, `secrets` | Email delivery records (dedupe key, status, attempts, backoff); the job HMAC secret |

### Visibility

`events.visible_to(series, profile)` is the single rule: the series is **live** (published or canceled, and `publish_at` has passed) **and** its audience includes the person (`public`: everyone; `members`: approved members; `group`: reserved for Phase 5, blocked by constraint, `events.group_member()` returns false). Drafts and archived events are never visible to members, even to event managers through member functions; managers use the `events_admin_*` functions. The rule is applied in lists, the month view, details, filters, RSVP, image storage (`can_view_event_image`), ICS downloads, both feeds, and email (rechecked at send time).

Member-facing JSON contains the caller's own registration and, with a capacity, the number of places left. It never contains attendee identities, emails, or counts of who is registered.

### Time zones and recurrence

- Each occurrence's instant is `(local date + local time) at time zone tz`, computed in PostgreSQL, so wall-clock times hold across DST. Nonexistent local times move forward by the gap; ambiguous ones resolve to the later (standard-time) instant. All-day events span local midnights.
- `events.rule_dates()` expands daily, weekly (weekday set), monthly by date (skipping months without it), and monthly by ordinal weekday (1st–4th, last), every 1–12 periods, bounded to 731 days and 200 dates. Unbounded rules are rejected by constraint.
- `events.sync_occurrences()` reconciles a series with its rule: existing occurrences keep their ids; new dates are inserted; dates no longer generated are deleted only when nobody is registered, otherwise kept as canceled (`orphaned`) with registrants notified; detached occurrences keep their overrides. Changes to date, time, or place on a published event bump the occurrence `sequence` and queue a `changed` notice for its registrants.

### Registration (transactional)

`events_rsvp` locks the occurrence row (`for update`), checks approved membership, visibility, status, deadline, and capacity, then confirms or waitlists. A new registrant never jumps an existing waitlist. `events.promote()` fills open places from the waitlist in order, rechecking each person's eligibility, and confirms them automatically. Unique `(occurrence_id, profile_id)` prevents duplicates; concurrency is covered by a test that fires simultaneous requests from separate connections. A trigger on `profiles.membership_status` cancels a suspended or un-approved member's current and future registrations, drops their queued emails, and promotes the waitlist.

### Notifications and scheduling

- Actions queue messages in `events.outbox` (unique dedupe keys) and the server sends them immediately through Resend with an idempotency key. `email_claim` uses `for update skip locked`, so concurrent senders never claim the same message; it rechecks access before releasing event details.
- `public.events_job(op, payload, ts, sig)` is the only privileged entry point for the app server: HMAC-SHA256 with `EVENTS_JOB_SECRET` (shared with `events.secrets`), requests older than 5 minutes refused. Ops: `tick`, `email_claim`, `email_result`.
- Scheduling is owned by the database: a `pg_cron` job runs `events.call_worker()` every 5 minutes, which queues reminders under an advisory lock and, when email is waiting, sends one signed `pg_net` request to the designated deployment's `/api/jobs/events`. See [events-guide.md](events-guide.md#scheduler-reminders-and-retries).

### Calendar output

ICS (`src/lib/events/ics.ts`) writes one VEVENT per occurrence with UID `occurrence-<id>@gathering.church`, `SEQUENCE` (series + occurrence), `LAST-MODIFIED`, UTC `DTSTART`/`DTEND` (all-day: `VALUE=DATE` with exclusive end), `STATUS:CANCELLED` for cancellations, RFC 5545 escaping, and 75-octet folding. No RRULE is emitted; recurrence is always expanded and bounded (feeds: 60 days back to 400 days ahead, at most 500 events). Feeds: `/api/calendar/feed/<token>` (private) and `/api/calendar/public`, both `private, no-store`, no referrer, no session handling.

### Images

Covers are validated (signature, 4 MB, which keeps the Server Action under Vercel's 4.5 MB request cap; 320–8000 px), re-encoded by `sharp` to a WebP of at most 1600×1000 without metadata, and stored in the private `event-images` bucket under random names. Storage RLS serves an image only to people who can see its event (or event managers); pages use 5-minute signed URLs.

### Audit

Series creation, edits (field names), and status changes; occurrence edits, cancellations, and restores; organizer registrations and cancellations (with the reason, never contact details); attendee exports (row count); category and settings changes; feed link creation and revocation.

## Community, groups, messaging, and notifications (Phase 5)

Guides: [community-moderation-guide.md](community-moderation-guide.md), [messaging-privacy-guide.md](messaging-privacy-guide.md), [notifications.md](notifications.md).

### Storage and access

Everything lives in a private `community` schema (no Data API exposure, no privileges for `anon`/`authenticated`), reached only through `SECURITY DEFINER` functions in `public` named `community_*`. Every function rechecks, on each call: approved membership and adult account (`community.is_member`), active group membership (`community.group_member`), guideline acknowledgment and community restrictions (`community.require_poster`), DM eligibility, blocks, and recipient settings (`community.can_message`), and server-side rate limits (`community.rate_limit`, a sliding window over `community.rate_events`).

| Area | Tables |
| --- | --- |
| Forum | `categories`, `threads` (one place: a category or a group), `posts`, `reactions`, `follows`, `mutes` |
| Groups | `groups` (discoverable/hidden, active/archived), `group_members` (member/leader; active/left/removed), `group_requests`, `group_invitations` (14-day expiry, single use) |
| Messages | `conversations` (one per pair), `conversation_state` (read and "deleted for me" marks), `messages` (idempotency key), `dm_prefs`, `blocks`, `dm_eligibility` |
| Moderation | `reports` (selected items only, evidence snapshot), `moderation_log`, `restrictions`, `guideline_acks`, `settings` |
| Notifications | `notifications`, `notification_prefs`, `member_settings` (time zone, quiet hours), `email_outbox`, `push_outbox`, `push_subscriptions`, `rate_events` |

### Permissions model

| Who | Church-wide discussions | Group discussions, roster, details | Direct messages | Administration |
| --- | --- | --- | --- | --- |
| Visitor, pending, suspended | No | No | No | No |
| Approved member | Read; post after accepting guidelines | Only groups they actively belong to | Their own conversations; send if eligible | No |
| Group leader | As member | Their groups: manage requests, invitations, members, details, and moderation (not of fellow leaders) | As member | None (no capability) |
| Community administrator | As member | Group metadata and rosters (incl. hidden groups), never discussions | As member | Categories, guidelines, settings, groups, leaders |
| Community moderator | Moderate | Moderate content they're pointed to by reports | Only reported messages (evidence) | Reports, restrictions, log |
| Membership administrator | As member | As member | As member | DM eligibility (audited), membership suspension |

Hidden groups are invisible to non-members (same "not found" as nonexistent). A discoverable group's public card shows name, summary, and image only. Group membership is never inferred from households or ministry interests. The last active leader can't be removed or demoted unless the group is archived (trigger with an advisory lock).

### Messaging eligibility

`profiles.account_kind` defaults to `adult` for every account and was never verified, so it isn't treated as a trusted age classification. Direct messaging requires an explicit `community.dm_eligibility` record set by a `members.manage` holder (audited, can't be self-set), plus approved status and no messaging restriction. No record means no messaging. Youth accounts remain blocked by the Phase 2 constraint.

### Content and deletion

Posts use a smaller Markdown subset (`src/lib/community/format.ts`): raw HTML escaped, headings flattened, images shown as alt text, links only http(s)/mailto/same-site with no credentials, `rel="nofollow ugc noopener noreferrer"`. Messages are plain text. Author deletion erases text (a constraint enforces it); a thread with replies remains as a placeholder. Moderator hiding keeps text for restore, visible only to moderators in scope. Attachments and images in discussions and messages are deferred.

### Group-restricted events

`events.group_member` now checks `community.group_member`, and the Phase 4 constraint blocking group audiences is replaced by `(audience = 'group') = (group_id is not null)` with a foreign key. Because every events path already used `events.visible_to`/`audience_allows`, group restriction applies to lists, details, RSVP, waitlist promotion, cover images, ICS downloads, private feeds, reminders, and email rechecks. Event coordinators may target discoverable groups, or hidden groups they lead or administer. Leaving or removal cancels the member's current and future group-event registrations ("ineligible", no email), drops their queued event email for that group, and promotes the waitlist.

### Notifications, delivery, and Realtime

See [notifications.md](notifications.md). Notifications store references only; wording is computed at read time after an access recheck, and email/push claims recheck again. Delivery reuses the Phase 4 scheduler and job secret.

Realtime uses one **private** Broadcast topic per member, `member:<id>`. The RLS policy on `realtime.messages` allows `authenticated` to receive only their own topic and only while approved; there is no insert policy, so clients can't broadcast. The database sends content-free `refresh` signals (`community.ping`); clients refetch through the normal functions. The client (`src/components/community/realtime-provider.tsx`) refetches badge counts on every signal, reconnect, focus, and every 60 seconds, reloads the page when the session expired or membership ended (401/403), and the conversation view merges messages by id, so duplicate or missed signals are harmless across tabs and devices.

### Caching and drafts

Community pages and `/api/community/*` are `private, no-store`, and listed in the proxy's protected prefixes. The service worker never caches them. Drafts live only in component state (controlled inputs), so they survive failed saves but are never written to browser storage. Composers send an idempotency key so retries can't duplicate posts or messages.

## Prayer and care (Phase 6)

Guides: [prayer-care-guide.md](prayer-care-guide.md) (administration and permission matrix), [prayer-privacy-guide.md](prayer-privacy-guide.md) (members), [prayer-retention.md](prayer-retention.md).

### Storage and access

A private `prayer` schema (no Data API exposure, no privileges for `anon`/`authenticated`) reached only through `SECURITY DEFINER` functions named `prayer_*` and `care_*`. Every one rechecks the caller on each call.

| Area | Tables |
| --- | --- |
| Requests | `requests` (audience `church`/`group`/`team`/`private`, status `open`/`answered`/`closed`/`archived`, `anonymous`, author comment switch, moderator lock, hidden marker), `updates`, `comments`, `prayers` (one per member), `follows` |
| Moderation | `reports` (reported item only, evidence snapshot), `moderation_log`, `access_log` (identity lookups and sensitive views, references and reasons only) |
| Care | `care_requests`, `care_messages` (requester ↔ team), `care_notes` (internal), `care_activity` (actions only), `care_opportunities`, `care_signups` |
| Settings | `settings` (member guidance, retention policy; retention off by default) |

**The read rule** (`prayer.can_read`): the author while approved; anyone else only if the request isn't archived or hidden and they are in its current audience (`church`: approved adult; `group`: `community.group_member`; `team`: holds `prayer.confidential`; `private`: nobody). Lists, counts, filters, search, details, comments, updates, notifications (in app, email, push), and reports all apply it. Nothing hidden is sent to the browser.

**Capabilities** `prayer.confidential`, `prayer.moderate`, `prayer.identity`, `care.coordinate`, `care.assign` come only from five explicit roles. `has_capability()` now excludes `prayer.%` and `care.%` from the implicit super-administrator grant (as it excludes `finance.%`); a super administrator can assign the roles, audited. `prayer.holds(profile, capability)` checks someone else's capability (for notifications and assignment). Matrix: [prayer-care-guide.md](prayer-care-guide.md#permission-matrix).

### Audience changes

`prayer.is_narrowing(old, new)` decides: a change to `private`, from `church`, or to the same audience narrows and applies at once; anything else (including publishing a draft and restoring from the archive) needs `p_confirm` equal to the new audience, which the composer's confirmation dialog supplies. After any change the function removes follows by people who can no longer read and drops their unread notices and queued email/push (`prayer.after_access_change`, `prayer.purge_notices`).

**Earlier comments and updates** record the audience they were written for (`posted_audience`, `posted_group`). `prayer.sees_item` shows one only if the reader can read the request now **and** is the request's author, the item's author, or in that original audience. Narrowing therefore applies immediately, and widening never exposes earlier items; readers who can't see some are told only that earlier items exist.

### Anonymous display

Responses never include profile ids except the caller's own "mine" flags. Anonymous requests show "Anonymous"; the requester's updates and anonymous comments show "The requester". A named comment by the requester of an anonymous request shows the name without the "Requester" label (after a warning in the composer). Prayer and care notifications store no actor, so lists, email, push, and Realtime can't reveal who acted; Realtime carries only `{kind}`. No avatars, photos, or profile links appear anywhere in prayer. Report evidence labels anonymous authors "Anonymous". `prayer_identity_lookup` (holders of `prayer.identity`, scoped to requests they can read or have an open report about, reason required) returns the display name and is recorded in `access_log` and `audit_log`.

### Moderation

Prayer reports are separate from community reports, so community moderators never see them. `prayer.can_review`: `prayer.moderate`, not the reporter or reported person, and team-audience reports also need `prayer.confidential`. Actions (hide/restore request or comment, lock/unlock comments) need a reviewable open report about that request, or a request the moderator is in the audience of; a report never opens other requests or groups. Group leaders have no prayer moderation.

### Care

Care requests are private to the requester and `care.coordinate` holders. Coordinators act on unassigned requests and their own; `care.assign` holders assign and read all internal notes; others see notes only when assigned. The team view shows the requester's phone or sign-in email only when they chose that contact method. Activity rows hold actions and state changes, never text. Opportunities have a generic listing (shown to the chosen audience: church, one group, or coordinators), plus logistics and the requester's first name shown only to accepted volunteers and only while `care_requests.share_consent` holds (checked at read time). Publishing is refused when the opportunity carries those details without consent, and requires an explicit confirmation after the preview.

### Notifications and scheduling

Phase 6 extends the Phase 5 notification table and delivery (new nullable references and categories `prayer` and `care`; `prayer_moderation` joins `moderation`). See [notifications.md](notifications.md). Email and push for prayer and care use generic text and link to `/notifications/open/<id>`. Follow-up reminders are queued by `prayer.tick()`, which `community.tick()` calls under its advisory lock, so the existing `pg_cron` job and single designated deployment remain the only scheduler; a per-request "notified on" date keeps reminders to one per date.

### Losing access

Reads are always rechecked. Triggers on group membership end, membership status change, and role removal also remove stale follows and unassign care coordinators who lost `care.coordinate` (`prayer.reconcile_access`).

### Caching, logging, and drafts

`/prayer` is a protected prefix (`private, no-store`), pages use a generic document title (never a request title), and the service worker caches no pages. Search is a POST Server Action, so search words never appear in URLs or request logs. Composers keep drafts in component state only; failures keep the text. Server errors shown to members are generic; actions log no request content. Youth participation stays disabled (approved adult accounts only).

## Teaching, media, and shared resources (Phase 7)

Guides: [media-guide.md](media-guide.md) (administration, permission matrix, storage and costs), [podcast-guide.md](podcast-guide.md), [gallery-guide.md](gallery-guide.md), [media-limitations.md](media-limitations.md) (members and outside services).

### Storage and access

A private `media` schema (no Data API exposure, no privileges for `anon`/`authenticated`) reached only through `SECURITY DEFINER` functions: `media_*` for members and visitors, `media_admin_*` for staff, `media_job` for the signed scheduler. Every function rechecks the caller; every `UPDATE`/`DELETE` has a `WHERE` clause (hosted pg-safeupdate).

| Area | Tables |
| --- | --- |
| Library | `assets` (one row per file or external video, status, rights, public-use flag, parent for captions, transcript), `settings` |
| Content | `items` (kind `devotional`/`lesson`/`episode`/`book`/`assignment`/`playlist`, status, publish and expiry times, audience, group, featured, order), `item_media` (attachment role, members-only flag), `item_people`, `item_topics`, `item_links`, `series`, `people`, `topics` |
| Podcasts | `shows` (church or external, feed URL and state, provider link, in-app playback switch, public feed switch), `external_episodes` (imported metadata only) |
| Member data | `bookmarks`, `progress` (saved positions), `completions` (reading), `member_prefs` (muted kinds); private to their owner, no staff view |
| Gallery | `albums`, `photos`, `photo_reports`, `moderation_log` |
| Public feed | `public_hits` (hashed visitor keys for rate limiting, purged daily) |

**One read rule.** `media.item_visible` (live status between publish and expiry, then audience: public, approved members, or the group's active members; episodes also need a visible show) is used by every list, detail, search, facet, series page, home section, bookmark, history entry, related link, RSS item, notification, and file. `media.asset_visible` lets a file through only if it's attached to (or the cover, artwork, or caption of) something the caller can see; on a public item, visitors get only files that are `public_ok` with confirmed rights and not members-only. Galleries use `media.album_visible` and `media.photo_visible` (approved photos only; never public). Staff checks use `media.require_cap`, which honors the super administrator's implicit grant.

**Capabilities** `content.edit`, `content.publish`, `media.manage`, `podcasts.manage`, `gallery.moderate`, via roles `content_publisher`, `media_manager`, `podcast_manager`, `gallery_moderator` (and `content_editor`, which gains `content.edit`). None of them reaches messages, prayer, care, journals, giving, or member records.

**Losing access.** Reads are always rechecked, so narrowing an audience, leaving a group, or losing approval hides content and files immediately. Triggers (`media.reconcile_access`) also delete unread teaching and gallery notices the person can no longer see.

### Files and delivery

- **Uploads** go from the browser straight to Storage with a one-time signed upload token from `createSignedUploadUrl` (TUS resumable above 6 MB, signed PUT otherwise), never through a Vercel function. The server then downloads (images) or range-reads (audio/video/documents) the stored object to sniff its real type, check size and dimensions, and record duration; images are re-encoded with `sharp` (HEIC decoded with `heic-decode`), which drops all metadata.
- **Buckets** `media` and `media-uploads` are private. Storage policies call `public.media_can_read_object`, `media_can_write_object` (only the registered path of an upload in progress), and `media_can_delete_object`.
- **Delivery** is through access-checked routes (`/api/media/<asset>/play|file|vtt`, `/api/podcast/episodes/<id>/audio`, `/api/podcast/artwork/<asset>`) that redirect to signed URLs (images 5 minutes, playback and downloads 30 minutes) with `private, no-store`. Captions are sanitized WebVTT served by the app. Signed URLs and request bodies are never logged.
- **Video** is progressive MP4 (no transcoding, no adaptive streaming, no paid provider). YouTube and Vimeo are stored as references and embedded click-to-load from parsed IDs only (`youtube-nocookie.com`, Vimeo `dnt=1`).
- **Cleanup** is reviewed and manual (`media_admin_cleanup_candidates` → delete with the manager's session → `media_admin_objects_deleted`). Files in use can't be removed; replacement swaps references in one transaction.

### Publishing and scheduling

Editors change drafts only; publishing, scheduling, expiry, archiving, and choosing **Public** need `content.publish` (public also needs `confirm_public = 'public'` and is limited to devotionals, lessons, and episodes). Publishing church-hosted media requires confirmed rights. Visibility is computed from `status`, `publish_at`, and `expires_at` on every read, so scheduled items appear on time with no job; `media.tick()` (called by `community.tick()` under its advisory lock) sends each item's notice once at publish time (skipping items live for more than 3 days), batches gallery notices, and purges rate-limit hashes.

### Podcasts and feeds

External feeds are fetched by `/api/jobs/events` (`refreshDueFeeds`) after `community.has_due_work()` reports due feeds, or by **Refresh now** (leased, rate-limited). `safeFetch` resolves DNS at connect time through a custom `lookup` that refuses every non-public address, follows at most 3 redirects manually, and caps time (15 s for feeds) and size (8 MB for feeds). `parseFeed` validates the XML first and refuses DOCTYPE/ENTITY. `media.ingest` dedupes by GUID hash, updates changes, hides vanished episodes, ignores empty feeds, and backs off after failures; imports never notify. External audio is never downloaded or rehosted; it plays from the publisher's URL only when the show allows in-app playback. The public RSS feed (`/podcast/feed.xml`) is built from `media_public_feed`, which returns only public, live episodes whose audio is public-use with confirmed rights, with stable enclosure URLs; the feed and enclosures are rate-limited by a keyed hash of the visitor's IP.

### Player

`PlayerProvider` (root layout) owns one `<audio>` element and the mini-player; `src/lib/media/coordinator.ts` makes every player (native video, embeds) claim playback so starting one pauses the others (YouTube/Vimeo through their postMessage APIs; Spotify/Apple embeds are unloaded). The mini-player sits above the dock and safe areas (`--player-clearance` feeds `--dock-clearance`). Media Session metadata and actions are set when supported. Positions are saved for members every 15 seconds, on pause, and on page hide (`media_progress_save`, keyed `a:<asset>` or `e:<external episode>`), and are never visible to staff.

### Pages, caching, and search

Devotionals, lessons, podcasts, and the hub (`/media`) live in the `(teaching)` route group: visitors see only public content with a sign-in note, members get the app shell. Reading, music, gallery, and saved are members-only (`(member)`). All of them, and `/api/media`, are `private, no-store` (proxy and `next.config.ts`); the service worker caches none of them. `media_search` searches teaching, shows, external episodes, and (members) album titles only.

## Bible reading plans, scripture reader, and journals (Phase 8)

Guides: [bible-sources.md](bible-sources.md) (translations, sources, imports, PDFs), [reading-plan-guide.md](reading-plan-guide.md) (administration, CSV import, versioning policy), [bible-reading-guide.md](bible-reading-guide.md) (members), [journal-privacy.md](journal-privacy.md) (privacy, export, retention).

### Storage and access

Two private schemas (no Data API exposure, no privileges for `anon`/`authenticated`, RLS on with no policies) reached only through `SECURITY DEFINER` functions: `bible_*` (members), `bible_admin_*` (staff), `journal_*` (owner only). Every function rechecks the caller; every `UPDATE`/`DELETE` has a `WHERE` clause.

| Area | Tables |
| --- | --- |
| Canon | `books` (66 rows: USFM code, ordinal, name, testament, reference verse counts per chapter) |
| Sources | `translations` (code, source kind `database`/`api`, provider id and the *name* of the key's environment variable, attribution, copyright, rights basis and confirmation, cache/copy/print/export permissions, per-view verse limit, tracking requirement, status), `verses` (one translation's text: book, chapter, verse, text, omitted flag, heading, paragraph, poetry), `settings` (default translation) |
| Imports | `imports` (structured file, status `uploading → processing → staged → published` / `failed` / `discarded`, summary), `staged_verses` (every source line with its source reference and issue), `reference_files` (PDFs: rights statement, pages, text layer) |
| Plans | `plans` (schedule `calendar`/`personal`, time zone, translation, audience members/group, status, featured, version, previous version), `plan_days` (stable id, date or day number, kind `reading`/`rest`/`catch_up`, heading, notes, questions, linked discussion, revision, retired), `plan_passages` (ordered, book + chapter/verse range + label), `plan_day_links` (devotionals/lessons), `day_revisions` (snapshot of every earlier revision), `plan_changes` (change log), `plan_imports` (CSV previews) |
| Member data | `enrollments` (start date, count-from date, time zone, primary, reminder time/pause, left), `completions` (enrollment + day + revision read), `bookmarks`, `highlights` (translation + book + chapter + verse + color), `reader_prefs` |
| Journals | `journal.entries` (owner, title, body, status, version, client key, optional link to a passage / plan day + revision + question / devotional or lesson) |

**Read rules.** `bible.plan_visible` (published and in the audience: approved members, or the group's active members) decides plans for members; `bible.member_can_read_plan` also opens archived plans to people who joined them. Members read only `active` translations. Journal functions filter on `profile_id = auth.uid()` and nothing else; there is no staff path.

**Capabilities** `reading.edit`, `reading.publish`, `bible.manage` via roles `reading_plan_editor`, `reading_plan_publisher`, `bible_source_manager` (super administrators implicitly). Content editors get none. None of them reaches journals, progress, bookmarks, or highlights.

### Scripture

- **Sources.** `bible_chapter` / `bible_passage` return stored verses, or for API translations the provider configuration; `src/lib/bible/source.ts` then fetches from API.Bible on the server (key from the named environment variable, fixed https host allowlist through the Phase 7 `safeFetch`, no redirects, 8 s / 2 MB). Outages return "unavailable"; nothing is substituted. API text is never stored in the database; an in-memory copy is kept only when the translation allows caching (≤ 30 days), keyed by translation, text version, and passage.
- **Imports.** Files upload from the browser to the private `bible` bucket with one-time tokens; the server reads them back (UTF-8, 50 MB, strict CSV/TSV or verse-per-line parsing), stages every line, and the database flags duplicates, numbering beyond the reference versification, empty verses, and missing verses. Publication requires every flagged line decided, no duplicates, acknowledged missing verses, and the typed code, then replaces the translation's text in one transaction.
- **References.** `src/lib/bible/reference.ts` parses controlled book names and aliases (ambiguous ones refused), whole chapters, chapter ranges, verse ranges, cross-chapter ranges, comma continuations, and several passages; `bible.passage_problem` validates against the translation's own verses (or the reference versification for API sources). Labels are generated identically in SQL and TypeScript.
- **PDFs** are reference files only: signature/size/page checks with `pdf-lib`, text-layer detection, admin-only 5-minute signed preview. No extraction (layout and OCR can't recover verse boundaries reliably).
- **Reader.** Verse numbers precede each verse in reading order (screen readers hear "Verse 16"), headings/paragraphs/poetry come from the source, highlights are the member's own `mark` washes (AA contrast checked), copy/print follow permissions (courtesy only), attribution under every passage; API.Bible's FUMS script loads only where its text is shown.

### Plans, dates, and versioning

- "Today" is `bible.enrollment_today`: the plan's time zone for calendar plans, the member's for personal plans. Personal day N is `start_date + N − 1` (date arithmetic, so DST can't shift it). Progress counts reading days only (rest days never count), from the member's count-from date for midyear joins.
- Completion (`bible_day_complete`) is idempotent both ways and records the day's current revision; opening a reading never marks it.
- Published plans: presentation edits only; schedule/translation/time zone/audience locked; days revised one at a time with a reason (snapshot to `day_revisions`, `revision + 1`, plan `version + 1`), past days only with an explicit correction, retired rather than deleted (completions reference days with `on delete restrict`). Members whose affected day is ahead and unread get one `reading_plan_changed` notice per plan.
- CSV import: parsed and validated on the server (`src/lib/bible/plan-import.ts` plus `bible_admin_validate_refs`), stored as a preview, applied on confirmation in one transaction (`add` refuses conflicts, `replace` clears the draft), revalidating every row. Drafts only.

### Journals and autosave

`src/lib/journal/autosave.ts` keeps one save in flight, debounces edits, names the base version on every save (`journal_entry_save` refuses stale versions with the current text, accepts exact retries idempotently), retries temporary failures with backoff, waits while offline, stops on conflict (keep mine / use saved / keep both) and on session expiry (text kept in memory), and reports "Saved" only after the server confirms the exact text. Saves go through `/api/journal/entries` (create, idempotent client key) and `/api/journal/entries/<id>` (PUT), which return 401/409/429/503 and never log bodies. No browser storage is used for journal text.

### Notifications and scheduling

Category `reading` (`reading_reminder`, `reading_plan_changed`) on the Phase 5–7 notification system. `bible.tick()` runs inside `community.tick()` under its advisory lock: for each active enrollment with reminders on and not paused, at or after the member's local reminder time and less than 3 hours late, once per local date (`last_reminded_on` under a row lock, date in the merge key), skipping rest days, days already read, days without an assignment, and plans the member can no longer see. `community.notify` rechecks membership; `notification_visible` rechecks the enrollment and plan on every read and delivery claim. Email/push text is generic. Losing access (group exit, suspension) switches off reminders for invisible plans and drops unread reading notices.

### Pages and caching

Members: `/bible` (hub), `/bible/today`, `/bible/plans/<id>` (+ `/catch-up`), `/bible/day/<id>`, `/bible/read/<code>/<book>/<chapter>`, `/bible/bookmarks`, `/journal`, `/journal/new`, `/journal/<id>`; home shows a compact Today's Reading card only for an active plan. Staff: `/admin/bible` (plans, days, preview, import, change log), `/admin/bible/sources` (translations, imports, review, PDFs). `/bible`, `/journal`, `/api/journal/*`, `/api/bible/*` are protected, `private, no-store`, and not cached by the service worker; journal page titles are generic.

## Scripture memory and practice (Phase 9)

Guides: [memory-admin-guide.md](memory-admin-guide.md) (administration, permission matrix), [memory-member-guide.md](memory-member-guide.md) (members), [memory-scoring.md](memory-scoring.md) (scoring, review schedule, badges), [memory-privacy.md](memory-privacy.md) (privacy, challenge sharing, withdrawal, Phase 10 integration).

### Storage and access

One private schema, `memory` (no Data API exposure, no privileges for `anon`/`authenticated`, RLS on with no policies), reached only through `SECURITY DEFINER` functions: `memory_*` (members, owner-only), `memory_admin_*` (staff and authorized leaders), `memory_challenge*` (participants and organizers). Every function rechecks the caller; every `UPDATE`/`DELETE` has a `WHERE` clause.

| Area | Tables |
| --- | --- |
| Scripture | `passages` (a captured version of one reference in one stored-text translation: exact verse text, tokens with spacing/line-break flags, practice segments at 32 and 16 words, text version, SHA-256 content hash, `superseded_by`) |
| Content | `collections` (audience members/group/personal, one translation, kind collection/sequence, draft/published/archived, `publish_at` for scheduling, goal, cover), `items` (stable id, passage version, position, editorial title/note/hint, assignment window, retired), `item_versions` (text updates with reasons), `group_authorizations` |
| Member data | `member_settings` (difficulty, presentation, typing rules, celebrations, daily goal, time zone, pause, reminders), `cards` (one per member per passage version: step 0–7, due date, best step, sessions), `sessions` (server-chosen setup, hints, reveal, single submission with stored result, 1-day expiry), `attempts` (completed, accuracy, hints, confidence, quality, steps before/after, local date), `awards` |
| Challenges | `challenges` (group, collection, dates, shared goal, threshold), `challenge_participants` (joined, sharing, left), `challenge_milestones` |

**Capabilities** `memory.manage`, `memory.publish` via roles `memory_verse_editor`, `memory_verse_publisher` (super administrators implicitly). Authorized group leaders (`memory.leader_authorized`: a publisher-authorized group + active Phase 5 leadership) act as publishers for their groups' collections and challenges only. None of these reaches cards, sessions, attempts, settings, or awards.

**Visibility.** `memory.collection_visible`: published and `publish_at` passed, translation still active, and in the audience (approved members, or the group's active adult members); personal collections only to their owner. Archived collections leave browsing; cards keep their history.

### Scripture

Passages come only from the Phase 8 `bible.verses` of an active `database` translation (API text may not be stored, and scoring needs the exact wording on the server). `memory.capture_passage` validates the reference (explicit verses, at most 30 verses / 900 words, omitted verses excluded), hashes the text, and reuses or creates a version; a newer text marks older versions superseded but never changes them. Display uses the stored verses with the translation label and attribution (`ScriptureText`/`Attribution` from Phase 8). Editorial fields live on `items`, never in passage text.

### Practice, scoring, and scheduling

`memory_session_start` builds the activity on the server (`memory.build_setup`: blanks, choice bank without ambiguous duplicates, shuffled pieces with random ids, typing rules) and returns only what may be shown; answers for typing, flashcards, and self-check are fetched by `memory_session_reveal` or returned after submission. Hints are counted in `memory_session_hint`. `memory_session_submit` scores (`score_typed` with LCS alignment, `score_blanks`, `score_order`), records an attempt, applies the schedule (`interval_for`, one change per verse per day), and awards badges idempotently, all in one transaction under a row lock; a retried submission returns the stored result. Details: [memory-scoring.md](memory-scoring.md).

The browser (`src/components/memory/practice/*`) posts to `/api/memory/sessions` and `/api/memory/sessions/<id>` (401/404/409/410/429/503, `private, no-store`, bodies never logged) through `SubmissionQueue` (`src/lib/memory/submit.ts`): "Saved" only after the server confirms; retries with backoff; offline waits; signed-out and expired states keep the answer on the page. No browser storage. Focus moves to the result heading after checking; hidden words are empty boxes with no text in the DOM.

### Notifications and scheduling

Category `memory` (`memory_weekly_verse`, `memory_review_due`, `memory_practice_reminder`, `memory_challenge_milestone`) on the Phase 5–8 notification system; the community functions are regenerated from the Phase 8 definitions with asserted edits. `memory.tick()` runs inside `community.tick()` under its advisory lock: for members with a reminder switched on and not paused, at or after their local reminder time and less than 3 hours late, once per local date per kind (`last_*_on` under a row lock, date in the merge key); a review reminder replaces the practice reminder that day. Milestones are recorded once per challenge (`challenge_milestones`). `notification_visible` rechecks choices, pause, collection visibility, and participation on every read and delivery claim. Email/push text is generic. Losing group membership or approval ends challenge participation (triggers) and drops unread memory notices.

### Pages and caching

Members: `/memory`, `/memory/assignment`, `/memory/collections` (+ `/new`, `/<id>`), `/memory/verses` (+ `/add`, `/<id>`), `/memory/practice/<id>`, `/memory/review`, `/memory/progress`, `/memory/settings`, `/memory/challenges/<id>`, `/memory/lead/*` (authorized leaders); the home shows a compact memory card only while a verse is assigned. Staff: `/admin/memory/*` (shared components in `src/components/memory/manage`). `/memory` and `/api/memory/*` are protected, `private, no-store`, and not cached by the service worker.

## Youth ministry and families (Phase 10)

Guides: [youth-family-admin-guide.md](youth-family-admin-guide.md) (administration, admin locations, policy decisions), [guardian-guide.md](guardian-guide.md), [youth-permission-matrix.md](youth-permission-matrix.md), [media-consent-workflow.md](media-consent-workflow.md), [youth-retention.md](youth-retention.md) (retention, deletion, adult transition).

### Storage and access

A private `youth` schema (no Data API exposure, no privileges for `anon`/`authenticated`, RLS on with no policies) reached only through `SECURITY DEFINER` functions: `youth_*` (members, guardians, youth, leaders) and `youth_admin_*` (staff). Every function rechecks the caller; every `UPDATE`/`DELETE` has a `WHERE` clause; `public.youth_*` functions are executable by `authenticated` only.

| Area | Tables |
| --- | --- |
| Policy | `policies` (versioned: draft → approved → retired; one approved; JSON settings validated by `youth.policy_settings_problem`; safe defaults in `youth.policy_defaults`) |
| People | `children` (preferred name, avatar, participation, status, administrative restriction, linked account), `child_private` (date of birth, only when the policy collects it), `eligibility` (per child per policy version) |
| Guardianship | `guardian_requests`, `guardianships` (per child; status pending/verified/suspended/revoked/ended; eight per-capability permissions, all off until chosen; manual verification method), `family_log` (actions, states, field names only) |
| Youth accounts | `account_invitations` (hashed one-time code bound to the youth's email, policy version, guardian authorization), `account_records`, `transitions`, `progress_sharing` |
| Groups | `groups`, `group_leaders` (role, publish, enrollment permissions; last-leader trigger), `enrollments` |
| Communication | `announcements`, `discussions`, `posts`, `reports` (evidence snapshot, `about_leader`), `moderation_log` |
| Events | `event_settings` (youth group, what to collect, youth self-registration), `event_personnel`, `forms`, `form_versions` (immutable once published; material flag), `event_forms`, `consents` (decision records; withdrawal recorded), `registrations` (per child; capacity and waitlist), `logistics`, `access_log`, `reminders_sent` |
| Learning | `learning` (assignments to a group), `practice_cards`, `practice_sessions`, `practice_attempts` (a child profile's guardian-recorded practice) |
| Photo consent | `media_consents`, `photo_subjects`, `photo_reviews`, `media_reuse` |

### Fail-closed youth accounts

`profiles.account_kind = 'youth'` marks an independent youth account; the Phase 2 constraint that blocked youth accounts is replaced by a trigger that allows account-kind changes (and approval of youth accounts) only inside the youth functions. `is_approved_member()`, `is_super_admin()`, `has_capability()`, and the events "members" audience now require an adult account, so every earlier feature (which already used `community.is_member`, adult-only) refuses youth accounts: directory, households, messages, community, groups, prayer and care, giving, media and gallery, Realtime, administration. Roles can't be granted to youth accounts. Only `bible.is_member` and `memory.is_member` admit an **active** youth account (approved, linked to an active unrestricted child, and the approved policy still allows independent accounts), so youth can use the owner-only learning tools. In the app, `requireApprovedMember()` sends youth accounts to `/youth`; the member layout renders a youth shell for them; adult-only sections have their own guarding layouts; learning pages use `requireLearner()`.

### Guardianship and policy

Only a family administrator verifies a guardianship (never their own), choosing permissions per child and per capability; nothing is inferred from households, names, addresses, or email. Requests never reveal whether a child exists. A restricted child pauses every guardian and youth path. `youth.guardian_can(child, profile, permission)` is the single rule (verified, approved adult, active unrestricted child, permission on). Policy settings come from the approved version or the safe default (`youth.setting`/`youth.flag`); nothing is enabled by default and no age threshold is assumed.

Independent accounts: invitation (family administrator or guardian with *manage account*) → normal Supabase sign-up with that email (sign-ups matching an open invitation start as youth accounts) → email confirmation → `youth_activate(code)`, which requires the policy, current-version eligibility, the policy's minimum age against a recorded date of birth when set, guardian authorization when required, a verified matching email, and a fresh account (never approved, no roles or household). The account records the policy version and authorizing guardian; the child's practice moves into the youth's own memory history. No parallel credentials exist.

### Events, consent, logistics

Youth events are Phase 4 series with `audience = 'youth'` (enum value added alone in `20261028000100`). `events.visible_to` delegates youth events to `youth.event_visible` (group leaders, designated personnel, active youth in the group, guardians allowed to register of enrolled children). Triggers stop adult RSVPs on youth events and stop the general editor from changing a youth event's audience. Registration (`youth.register`) locks the occurrence row, checks enrollment, participation, status, deadline, consent (`youth.consents_ok`), required emergency contact, capacity, and the waitlist; `youth.promote` fills places in queue order, cancelling anyone no longer eligible. `youth.consent_state` accepts a granted decision for the current published version, or an earlier one followed only by non-material versions, made by a guardian still allowed to sign. Logistics are returned only by `youth_logistics_list` to designated personnel (logged in `access_log` with counts) and never appear in descriptions, rosters, feeds, notifications, exports, or audit details.

### Communication and learning

No private messaging exists in the Youth area. Discussions belong to a group, are always visible to its leaders, need the policy plus `discussion_min_leaders` effective leaders and three enrolled children (`youth.supervised`), and only leaders start them. Reports about a leader's content are reviewable only by safeguarding reviewers who don't lead that group (`youth.can_review`). Guardian-led practice reuses Phase 9's `memory.build_setup`, `public_setup`, `session_json`, and scoring functions through `youth.as_session`, recording results on the child.

### Photo consent

`youth.media_state` combines the latest decision of each currently verified guardian (event-specific first); `youth.guard_photo_publication` (trigger on `media.photos`) refuses approving or unhiding a photo whose linked children aren't all *granted*, and refuses "permission confirmed" without links; `youth.media_reconcile` hides affected approved photos and opens reviews whenever consent, guardianship, restriction, or approval changes.

### Notifications

Category `youth` on the Phase 5–9 system (community functions regenerated from the Phase 9 definitions with asserted edits). Recipients are verified guardians (and reviewers for reports); youth accounts get in-app announcements in the Youth area only. `notification_visible` rechecks guardianship, permission, child state, registration, form state, enrollment, and review scope on every read and delivery claim. Email and push are always generic. `youth.tick()` runs inside `community.tick()`: scheduled announcements, one reminder per child per occurrence, invitation expiry, temporary-session and report-evidence cleanup, and logistics deletion only when the policy sets a retention period.

## Announcements

- Stored status is `draft | scheduled | published | archived`, plus `publish_at` / `expires_at`.
- **Scheduling uses the database clock inside RLS:** a row is visible when `status in (scheduled, published) and publish_at <= now() and (expires_at is null or expires_at > now())`. No cron job is needed, and nothing depends on an admin reopening the app.
- Audience: `public` (anyone, including signed-out visitors) or `members` (approved members). Managers see everything.
- Bodies are a Markdown subset rendered by `src/lib/announcements/markdown.ts`: raw HTML is escaped, only http(s)/mailto/tel/relative links are kept, and inline images are dropped. The same renderer powers the admin preview.
- Images live in the private `announcement-images` bucket. Storage RLS lets a caller read an image only if they can read an announcement referencing it, and pages use one-hour signed URLs.
- Admins enter times in the church time zone (default America/Chicago). `src/lib/time.ts` converts to UTC, including the DST gap and repeated hour.

## Church settings and branding

- `church_settings` is a single row that anyone can read and only `settings.manage` can update. All contact, address, schedule, and social fields start empty.
- Logo and icon default to the approved bundled artwork (`logo_path` / `icon_path` null). Replacements are validated server-side by file signature (PNG/JPEG/WebP only, no SVG), size, and dimensions, stored in the public `branding` bucket, and can be reverted.
- The palette lives only in design tokens (`src/app/globals.css`, mirrored in `src/lib/theme/tokens.ts` with contrast tests). There is no theme editor.

## Design system

Dark, card-based interface: near-black background, charcoal cards, ivory text, and the brand gold as the single accent. The approved palette is unchanged and kept as brand tokens; the semantic tokens map it onto the dark interface.

| Token | Value | Use |
| --- | --- | --- |
| background | #121110 | Page background |
| surface / surface-muted | #22201E / #2E2C29 | Cards and list rows / selected states, chips |
| primary (brand gold) | #AD8C53 | Links, section actions, active icons, focus ring (6.0:1 on background, 5.1:1 on cards) |
| cta (ivory) / on-cta | #F7F4ED / #1C1B19 | Pill-shaped main buttons |
| text / text-secondary | #F7F4ED / #B3AC9F | Body / secondary (at least 6.2:1 everywhere they are used) |
| success / danger | #9DB794 / #E59484 | Status, always paired with an icon and text |

Patterns:
- **Floating pill tab bar** (Home, News, Profile, More) on phones; sidebar on desktop.
- **Header:** initial avatar (links to Profile), centered church name, round install button.
- **Sections:** uppercase labels with gold "View all" links.
- **Content:** rounded list rows (icon, label, trailing detail), a horizontal announcement rail, and an author-style announcement feed.
- **Later-phase modules:** shown as list rows with a "Soon" tag, never as links.

The logo and icon keep their original colours on an ivory plaque or circle, because the charcoal artwork would disappear on dark backgrounds. Fonts are Source Sans 3 throughout the interface; Source Serif 4 remains available but is no longer used for headings. Touch targets are at least 44 px, focus outlines are visible, motion respects `prefers-reduced-motion`, and contrast for every pairing is enforced by `src/lib/theme/tokens.test.ts`.

## PWA and caching

- `manifest.webmanifest`: name "The Gathering", standalone, ivory (#F7F4ED) theme and background, `any` and `maskable` icons at 192 and 512.
- Icons are generated from the supplied icon artwork by `scripts/generate-brand-assets.mjs`. They're square and not pre-rounded, and the maskable versions are verified to stay inside the 80% safe zone.
- `public/sw.js` caches only `/_next/static/*`, `/brand/*`, `/icons/*`, and `offline.html`. Navigations are network-only, with a generic offline page, and nothing private is ever stored.
- Sign-out is a POST that clears Supabase cookies and sends `Clear-Site-Data: "cache"`.
