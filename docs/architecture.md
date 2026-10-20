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
| Youth leader | `youth.lead` (reserved) | Phase 10 |

`settings.manage`, `roles.manage`, and `audit.view` belong to super administrators only. Super administrators don't receive `finance.*`, `prayer.*`, or `care.*` implicitly: those are granted only through explicit roles (which a super administrator can assign, audited).

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

- `manifest.webmanifest`: name "The Gathering", standalone, dark (#121110) theme and background, `any` and `maskable` icons at 192 and 512.
- Icons are generated from the supplied icon artwork by `scripts/generate-brand-assets.mjs`. They're square and not pre-rounded, and the maskable versions are verified to stay inside the 80% safe zone.
- `public/sw.js` caches only `/_next/static/*`, `/brand/*`, `/icons/*`, and `offline.html`. Navigations are network-only, with a generic offline page, and nothing private is ever stored.
- Sign-out is a POST that clears Supabase cookies and sends `Clear-Site-Data: "cache"`.
