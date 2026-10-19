# Notifications and the scheduler (Phase 5)

Design: [architecture.md](architecture.md#community-groups-messaging-and-notifications-phase-5). Member-facing privacy: [messaging-privacy-guide.md](messaging-privacy-guide.md).

## What creates a notification

| Category | Kinds | Default in app | Default email |
| --- | --- | --- | --- |
| Discussions (`forum`) | Reply to your discussion; reply in a discussion you follow | On | Off |
| Groups (`groups`) | Invitation; join request (to leaders); request approved or declined; removed; role changed | On | Right away |
| Direct messages (`messages`) | New message (one per conversation while unread) | On | Right away (generic text) |
| Moderator actions (`moderation`) | Your post hidden or restored; discussion locked; restriction applied or lifted; new report in your group (leaders) | Always on | Right away |
| Event updates (`events`) | Waitlist promotion, time/place change, cancellation for events you're registered for | On | — (event emails are sent by Phase 4's own outbox) |

Giving never creates a community notification.

Members change these at **Notifications → Settings**: in-app on/off (moderation can't be turned off), email off / right away / daily summary / weekly summary (messages: off or right away only), push on/off per category, quiet hours with a time zone, and mutes (discussion, group, or conversation).

## Rules that keep notifications safe

- **References, not content.** A row holds ids and flags. Wording is computed when it is read.
- **Access is rechecked at every read and every send.** The list, the badge counts, the click-through, each email, each digest, and each push recheck that the reader is still an approved member and can still see the thing (group membership, thread not hidden, invitation still open, event still visible, sender not blocked). If not, the item disappears; a queued email or push is marked `skipped` and never sent.
- **Merging and deduplication.** Unread notifications about the same thing merge (`merge_key`, count, latest time), so a busy discussion creates one item, one email, and a counted title. Delivery records have unique dedupe keys (`n:<notification>` for email, `n:<notification>:<count>` for push, `digest:<member>:<local date>` for digests).
- **Generic outside the app.** Email names church-wide discussion titles but group discussions only by group; direct messages only say "You have a new message" (no text, no sender). Push says only that something is new and links to `/notifications/open/<id>`, which rechecks access before redirecting.
- **Muting and blocking** suppress new notifications at creation. Blocking also hides the blocked person's unread message notifications and unread counts.

## Delivery

| Channel | How | Retries |
| --- | --- | --- |
| In app | Immediate. A content-free Realtime signal on the member's private channel makes open pages refetch. | n/a |
| Email (immediate) | Queued in `community.email_outbox` with `send_after` = end of quiet hours if needed; sent by the signed job through Resend with an idempotency key | Failed sends retry after 10 × attempts minutes, up to 5 attempts; a send stuck in `sending` for 10 minutes is reclaimed |
| Email (digest) | The tick queues one digest per member per local day at the configured hour (weekly ones on the configured day), covering the last day or week | As above |
| Web push | Queued in `community.push_outbox`; sent with VAPID to each registered device | Up to 3 attempts; endpoints answering 404/410 are deleted; endpoints failing 5 times are removed |

Outside production, email goes only to `EVENTS_EMAIL_ALLOWLIST` (falling back to `GIVING_EMAIL_ALLOWLIST`); everything else is marked `suppressed`. Subjects are prefixed `[TEST]`.

## Scheduler

Phase 5 reuses the Phase 4 scheduler instead of adding another:

- **Owner of the schedule:** the database. The `pg_cron` job `events-worker` runs `events.call_worker()` every 5 minutes.
- **What it does now:** `events.tick()` (reminders) and `community.tick()` (digests, invitation expiry, retention), each under its own advisory lock; then, only if event or community email/push is due, one signed `pg_net` request to the designated deployment's `/api/jobs/events`.
- **The app route** sends event email, then runs the community tick and sends community email and push. It is signed with `EVENTS_JOB_SECRET`; the community database entry point (`public.community_job`) uses the same secret with a `community.` prefix in the signed string, so an events signature can't be replayed against it.
- **No duplicates across previews:** only one deployment URL is designated, every message is claimed under a row lock (`for update skip locked`), and every send carries an idempotency key. Other previews may send immediately after an action (best effort), which is safe for the same reasons.
- **Retention run by the tick:** rate-limit records after 2 days; direct messages after `dm_retention_days` (default 730), and as soon as both participants have deleted a conversation; report evidence `report_evidence_days` (default 180) after a report is closed; read notifications after 180 days; sent/skipped delivery records after 60 days (push 14).

### Setup (owner)

1. Apply the Phase 5 migrations (`supabase/manual/2026-10-22-apply-community-1.sql` … `-5.sql`).
2. In Vercel, add `EVENTS_JOB_SECRET` (Sensitive, Preview) for the designated branch, with the **same value** already stored in `events.secrets` (copy it from the Phase 4 variable; never paste it into chat or commit it).
3. Edit the URL in `supabase/manual/2026-10-22-community-scheduler.sql` to the designated branch's stable URL and run it. It replaces `events.call_worker()`; the cron job stays the same.
4. Optional: web push (below).

With Vercel Deployment Protection on, the scheduler's request to a preview is refused (401); in-app notifications still work, queued email waits, and immediate sends after actions still happen.

## Web push (optional)

Implemented, **not yet verified on a device**.

- Members opt in at **Notifications → Settings → Push notifications** by pressing a button. The browser asks for permission only then (never on first visit). Each device is listed and can be removed; "Turn off on this device" unsubscribes in the browser too.
- **Requirements** (current browser documentation):
  - Chrome, Edge, and Firefox on desktop and Android: supported in the browser and in the installed app.
  - Safari on macOS 13 or later: supported.
  - iPhone and iPad: only for a web app **added to the Home Screen** (iOS/iPadOS 16.4 or later) and opened from there; not in Safari tabs. The settings page explains this.
  - Every browser requires `userVisibleOnly: true` (the app always shows a notification) and HTTPS. The app manifest already uses `display: standalone`, which the iOS Home Screen requirement depends on.
  - Sources checked 2026-10-19: MDN [PushManager.subscribe()](https://developer.mozilla.org/docs/Web/API/PushManager/subscribe) (Baseline since March 2023), web.dev [Subscribe a user to push notifications](https://web.dev/articles/push-notifications-subscribing-a-user). Apple's own page didn't come up; the iOS 16.4 / Home Screen requirement is as described by [OneSignal](https://documentation.onesignal.com/docs/web-push-for-ios) and [MoEngage](https://moengage.com/docs/developer-guide/web-sdk/web-push/safari-web-push-for-i-os-and-i-pad-os). Confirm on a device before relying on it.
  - Push is never guaranteed: browsers drop subscriptions, devices may be offline, and the operating system may hide notifications. In-app and email remain the reliable channels.
- **Setup:** generate a VAPID key pair once (for example `npx web-push generate-vapid-keys`) on your own computer. In Vercel (Preview, the designated branch) set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public), `VAPID_PRIVATE_KEY` (Sensitive), and `VAPID_SUBJECT` (`mailto:hello@gathering.church`). Redeploy. Rotating the keys invalidates existing subscriptions; members turn push on again.
- The service worker shows only the generic title and text it receives and opens `/notifications/open/<id>`; it never caches pages.
