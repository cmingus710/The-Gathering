# Membership approval alerts

Designated people get one email when a new account first becomes ready for membership approval, so new registrations don't wait unnoticed.

## Where to enter recipients

**Admin → Church settings → Membership approval notifications** (`/admin/settings`, at the bottom of the page).

- Only people with the `settings.manage` capability (super administrators) see this section or can change it. Membership administrators, members, and visitors can't see the list; the database refuses them too.
- Add one email address at a time (no commas or semicolons). Up to 20. Remove anyone with **Remove**.
- Tick **Send membership approval notifications** and press **Save** to turn alerts on. They start **off**, with nobody listed.
- **Recent deliveries** shows the last 25 sends: recipient, status (Sent, Queued, Failed, Skipped, Not sent (test)), attempts, and the email provider's error name when one failed. No applicant details and no secrets are shown.
- Adding, removing, and switching alerts on or off are recorded in the audit log (without the address).

## When an alert is sent

| Situation | Alert? |
| --- | --- |
| Email/password registration, the verification link is used | **Yes, once** |
| Account created already verified (Google/Apple sign-in, when added) and its pending profile exists | **Yes, once** |
| Registered but never verified | No |
| The verification link opened again, sign-ins, profile edits, provider linking, background retries | No (one alert per account, ever) |
| Alerts off, or nobody listed, at the moment of verification | No, and not later either |
| People who were already waiting when alerts were turned on | No (no backfill) |
| An address with an open youth account invitation (youth activation, not membership) | No |
| The account was approved, declined, or suspended before the email went out | Skipped |

The decision is made in the database (`supabase/migrations/20261101000100_membership_approval_alerts.sql`): a trigger on `auth.users` fires when `email_confirmed_at` goes from empty to set, or when an account is created already confirmed. `membership.approval_alerts` is unique per account, which is what makes "once" hold no matter how often a callback repeats. The trigger never blocks registration or verification: if queueing fails it logs a warning and lets the sign-up continue.

**Google/Apple sign-in isn't built yet.** No extra hook is needed when it is: Supabase creates provider accounts already confirmed, so the insert trigger queues the alert after the profile trigger has created the pending profile. The provider callback should land on `/auth/confirm` (the `code` exchange) so the alert is sent right away; otherwise the scheduler sends it within about 5 minutes. See "Limits" for previews.

## The email

- Subject: **New member awaiting approval — The Gathering**
- The applicant's display name (preferred name, then full name, else "Name not provided"), account email, and the request date and time in the church time zone, labeled with the zone (for example `Sun, Nov 1, 2026, 9:30 AM CST (America/Chicago)`).
- A **Review membership request** button linking to `/admin/members/<id>`. That page requires signing in and the `members.view` capability; approving still takes the usual button there and `members.manage`. The link itself changes nothing.
- Same branding as the welcome email. No passwords, tokens, phone numbers, addresses, or other profile fields.
- Each recipient gets a separate message, so nobody sees the other addresses.
- The membership approved / welcome email is unchanged.

## Delivery

- Queued per recipient in `membership.alert_deliveries` and sent through the existing Resend key and verified sender (`RESEND_API_KEY`, `EMAIL_FROM`) by the existing signed job (`public.community_job`, `EVENTS_JOB_SECRET`).
- Right after a verification link is used, `/auth/confirm` sends due alerts after the redirect (it never delays or fails the redirect). The database scheduler (`events.call_worker` → `community.has_due_work`, every 5 minutes, production only) sends anything left.
- Each message carries the Resend idempotency key `membership-alert-<delivery id>`, and the message content is fixed when the alert is queued, so a retry after a timeout can't produce a second email.
- A failed send is retried after 10, 20, 30, 40 minutes (5 attempts). Permanent rejections (for example an invalid address) aren't retried. A send that doesn't answer in 15 seconds counts as failed; one that never reported back is retried after 10 minutes. Only recipients that weren't sent are retried.
- If Resend isn't configured, alerts stay queued.

## Previews and test environments

Previews share the production database, so a preview registration could otherwise alert real administrators. Two safeguards:

1. The sign-up action records `registration_environment` (`production`, `preview`, or `development`) on the new account. Alerts for non-production registrations are marked **test**. Production never sends test alerts; previews never send real ones.
2. Outside production, email goes only to `EVENTS_EMAIL_ALLOWLIST` (falling back to `GIVING_EMAIL_ALLOWLIST`), exactly as for community email; other recipients are marked **Not sent (test)**. Subjects get a `[TEST]` prefix and the body a test banner.

So testing on a preview needs: an address you control on the preview's allowlist **and** on the recipient list, alerts switched on, and a new registration made on that preview. Test alerts are sent only by the preview, right after verification; ones older than a day are dropped.

## Release steps (owner)

Nothing here has been applied to the hosted project.

1. Approve and merge the PR.
2. Apply the migration: run `supabase/manual/2026-11-01-apply-membership-alerts.sql` in the SQL editor. It's additive, runs in one transaction, refuses to run twice, and leaves alerts off. Order doesn't matter relative to the code deploy: old code ignores the new tables, and new code shows "Notification settings couldn't be loaded" until the migration exists.
3. No new environment variables. The scheduler needs no change (it already calls `community.has_due_work()`).
4. Hosted verification, with your authorization: on a preview with your own test address in `EVENTS_EMAIL_ALLOWLIST`, add that address as a recipient, turn alerts on, register a new test account on the preview, verify it, and confirm one `[TEST]` email and a "Sent" row. Remove the test address and test account afterwards. Then enter the real recipients on production.

**Rollback:** turn alerts off in the settings section (instant). Rolling back the code leaves harmless queued rows; while alerts are off nothing is queued for delivery.

## Limits

- A registrant who calls Supabase Auth directly can mark their own sign-up as non-production, which only suppresses the alert about themselves; they still appear in **Admin → Members → Pending**.
- Provider sign-in (when added) can't carry `registration_environment`, so a Google/Apple sign-up made on a preview would be treated as production. Before enabling provider sign-in on previews, add a server-side way to mark those alerts as test (for example from the preview's callback) or give previews their own Supabase project.
- Alerts don't repeat if nobody acts on a request.
