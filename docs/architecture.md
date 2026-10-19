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
| Group leader | `groups.lead` (reserved) | Phase 5 |
| Youth leader | `youth.lead` (reserved) | Phase 10 |

`settings.manage`, `roles.manage`, and `audit.view` belong to super administrators only. Super administrators don't receive `finance.*` implicitly: finance access is granted only through a finance role (which a super administrator can assign, audited).

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
