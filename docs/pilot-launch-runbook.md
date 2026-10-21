# Pilot launch and rollback runbook

A controlled adult pilot: a few trusted adults use the real app for two to three weeks before anyone else is invited. Nothing in this document has been done yet; each step is yours to start.

## Before the pilot (gates)

All must be true. Status as of 2026-10-21 in brackets.

1. Supabase organization on **Pro**, and a backup taken with [operations-recovery.md](operations-recovery.md#taking-a-backup), including Storage files. [Not done: Free plan]
2. **Previews isolated:** Vercel Deployment Protection on for previews, or previews pointed at a separate Supabase project. [Not done: previews are public and write to production]
3. **Code matches the hosted schema:** PR #17, PR #16, and the Phase 11 PR reviewed and merged; production deployed from `main`. [Not done: production runs Phase 9 code on the Phase 10 schema]
4. **Hosted signed-in walkthrough** (below) passed on a protected preview, then repeated on production with the test accounts. [Not done]
5. **Giving decision:** hide Give for the pilot, *or* move `giving-webhooks.gathering.church` to Production and re-run the test-mode giving checks. [Not done]
6. Leaked-password protection on; Bible attribution text filled in; church settings (times, contacts) filled in. [Not done]

## Hosted walkthrough checklist

Use the dedicated test accounts only (an administrator and an approved member; add a second member for privacy checks). Use `[TEST]` in every title. Remove test content afterwards.

| # | Flow | Pass when |
| --- | --- | --- |
| 1 | Register a new test address you control, verify by email, see "Thanks for registering" | Email arrives from `hello@gathering.church`; link opens `/auth/confirm` on the same site |
| 2 | Pending account opens `/home`, `/directory`, `/community` | Each goes to the account-status page |
| 3 | Admin approves it | Page says the welcome email was sent; the email arrives |
| 4 | Sign out, sign in, forgot password, reset | Each works; the old password is refused |
| 5 | Admin suspends, member reloads; admin reinstates | Member sees "Your access is paused", then gets back in |
| 6 | Admin assigns Event coordinator, member opens `/admin/events`; admin removes it (confirm dialog) | Access appears and disappears on the next page load |
| 7 | Member edits profile, uploads a photo, hides from directory | Second member can't find them by search or direct link |
| 8 | Member posts a `[TEST]` discussion; second member replies; first sees the in-app notice; second reports it; admin sees the report | All four |
| 9 | Member shares a church-wide `[TEST]` prayer and saves a private draft | Second member sees only the shared one; "I'll pray" count updates |
| 10 | Admin creates and publishes a `[TEST]` members event with RSVP; member registers, downloads the .ics, cancels | Calendar shows the right local time; confirmation email arrives |
| 11 | Open Bible, a reading plan, Memory verses, a lesson, a podcast, the gallery | Each opens; audio plays on a phone |
| 12 | Notifications → Settings: switch a category to immediate email | Next test notice arrives by email with generic wording |
| 13 | Install on an iPhone (Safari → Share → Add to Home Screen) and an Android phone (Chrome → Install) | App opens standalone with the right icon; sign out, reopen: sign-in page, no private content |
| 14 | VoiceOver (iPhone) and TalkBack (Android): sign in, open home, More menu, a discussion, post a reply | Every control is announced with a sensible name |

## Pilot group

- **Who:** 5–10 adults the church already trusts, including one person who uses a screen reader or large text if possible, and at least one Android and one iPhone user. No children, no youth accounts, no guardians.
- **How they join:** they register themselves at `www.gathering.church`; an administrator approves each one. (No bulk invitations exist, and none should be sent.)
- **What to tell them:** this is a trial; giving is a test (no real money) or hidden; notifications come in the app and by email, not as phone pop-ups; don't post anything confidential while testing.
- **Feedback route:** one place only, e.g. a shared email address or a form the church already uses. Ask for: what they tried, what happened, the page address, phone model, and a screenshot. An administrator collects reports twice a week and files each confirmed problem as a GitHub issue.

## Features that stay disabled during the pilot

| Feature | Why | What turns it on |
| --- | --- | --- |
| Live giving | Not authorized; webhooks reach a preview | Separate live-giving plan below |
| Youth & families (independent youth accounts, discussions, self-registration, transitions, and the rest of the policy-gated list) | No approved policy; shared hosting | Separate youth activation plan below |
| Phone/web push | No push keys | Set VAPID keys, test on devices |
| Forum and message attachments, Lesson Studio, Follow Along | Not built | Future phase |

## Live giving requires (separately)

1. Church decision and named finance administrators.
2. Webhook endpoint on production (not a preview), with Stripe **live** restricted key and webhook secret entered by the owner only.
3. The reviewed live-mode migration described in [giving-setup.md](giving-setup.md).
4. Church legal details approved for statements.
5. A test-mode rehearsal on production of one-time, monthly, failed card, refund, and statement before switching.

## Youth activation requires (separately)

1. The church's written youth policy decisions ([youth-family-admin-guide.md](youth-family-admin-guide.md#policy-decisions-that-need-church-input)), legal review (including children's online privacy rules), and named safeguarding staff.
2. A signed-in youth walkthrough on an **isolated** Supabase project, never on the shared one.
3. Policy approval in the app by two different policy administrators, after the above.

## Release steps (when the gates are met)

1. Confirm a backup from today exists (database and files).
2. Merge the reviewed PRs in order (#17, #16, Phase 11). Vercel deploys `main` to production automatically.
3. If the grant-baseline script hasn't been run, run `supabase/manual/2026-10-29-apply-grant-baseline.sql` (it changes nothing and refuses if it would).
4. Check production: `/` and `/sign-in` load; sign in as the test administrator; Admin → Members loads; the scheduler's next run succeeds (Supabase → Database → Cron or Logs).
5. Run the hosted walkthrough checklist on production with the test accounts.
6. Approve the pilot group as they register.

## Rollback

| Problem | Do this |
| --- | --- |
| A bad deployment (pages broken, errors) | Vercel → the-gathering → Deployments → choose the previous production deployment → **Promote** (instant rollback). Then pause production builds if needed: Settings → Git → Ignored Build Step `if [ "$VERCEL_ENV" = "production" ]; then exit 0; else exit 1; fi` |
| A database change went wrong | Don't edit or delete migrations. Write a new forward migration, rehearse it locally, apply it. For data loss, follow [operations-recovery.md](operations-recovery.md#recovering-the-database) |
| Unwanted emails going out | Supabase SQL editor: `select cron.unschedule('events-worker');` stops the scheduler (re-create it with `supabase/manual/recovery-scheduler.sql`, never the dated scheduler scripts, which point at old previews). Or remove `RESEND_API_KEY` from Production and redeploy |
| Someone shouldn't have access | Admin → Members → Suspend (takes effect on their next page load) |
| Pause the whole pilot | Put up an announcement, suspend pilot accounts, or roll back as above. Data stays intact |
