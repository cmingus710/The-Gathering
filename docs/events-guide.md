# Events and calendars (Phase 4)

How events work, how to run them, and how members' calendar subscriptions behave. Technical design: [architecture.md](architecture.md#events-and-calendars-phase-4).

## Who can do what

| Person | Can |
| --- | --- |
| Visitors (no account), pending and suspended accounts | See **public** events and download them to a calendar. Can't register. |
| Approved members | See public and **members-only** events, register, cancel, join waitlists, subscribe to their own private calendar feed, turn optional reminders off. |
| Event coordinators (`event_coordinator` role, capability `events.manage`) | Everything under Admin → Events: create, edit, preview, publish (now or scheduled), unpublish, cancel, archive, restore; edit or cancel single dates; see attendee lists and waitlists; export attendees; register or cancel someone (with a reason, audited); manage categories and event settings. **No** membership, finance, or role access. |
| Super administrators | Everything event coordinators can (implicitly), plus assigning the Event coordinator role. |

Group-only events are not available yet: there is no group model until Phase 5. The database has an integration point (`events.group_member`) and keeps the "group" audience disabled by constraint, and the admin form doesn't offer it.

## Running an event

1. **Admin → Events → New event.** Fill in the details. New events are saved as **drafts**, which nobody but event coordinators can see.
2. **Preview** shows the event page as members will see it.
3. **Publish** now, or enter a date and time to **schedule** publication. Scheduled events appear automatically at that time (no job needed).
4. **Registrations:** turn on "Members register", optionally set a capacity (per date), a waitlist, and when registration closes (hours before start).
5. **Attendees:** open a date from the event page ("Dates and registrations") to see who is registered, the waitlist in order, and cancellations. **Export CSV** downloads name, email, status, and times for that date (recorded in the audit log). Attendee lists are only for organizers; they never appear to members.
6. **Changes:** editing a published event emails registrants **only** when the date, time, or place of a date they're registered for changes. Wording and image edits don't send email.
7. **Cancel** (whole event) or **Cancel this date only**: the record stays, the calendar shows it as canceled, calendar feeds publish the cancellation, and registered and waitlisted people are emailed. Canceled events can't be edited; archive them when you're done.
8. **Unpublish** is only possible while nobody is registered (otherwise cancel, so people are told). **Archive** hides an event everywhere but keeps the record.

### Homepage "Coming up" banner

The member home page features the **next** event the member can see (canceled dates and timed events already under way are skipped; an all-day or multi-day event stays until its last day ends). Its banner image is chosen in this order:

1. The event's own **homepage banner**: **Admin → Events → (event) → Homepage banner** (right-hand column).
2. The event's **cover image** (the Image section of the event form).
3. The church-wide **default banner**: **Admin → Events → Settings → Default Coming up banner**.
4. A branded charcoal-and-gold background (no image).

Both banner controls take a wide PNG, JPEG, or WebP (at least 960 px across, up to 4 MB), which is re-encoded without metadata. Each needs an image description for screen readers. Click the image (or use the two sliders) to set the **focal point** that stays visible when the banner is cropped; the Phone and Desktop previews show the result. **Replace image** swaps the file; **Remove banner** deletes it. Banner changes never email registrants or change calendar feeds.

Banners are private: an event's banner is visible only to people who can see that event, and the default only to approved members. The date leaf, title, and time are drawn by the app from the event itself, so never put dates or text in the image.


- Daily, weekly (chosen weekdays), or monthly (same date, or "the first/second/third/fourth/last <weekday>"), every 1 to 12 periods, ending on a date (up to two years) or after a number of dates (up to 200).
- Times are local to the event's time zone: a weekly 9:00 AM gathering stays at 9:00 AM through daylight-saving changes.
- On the nights clocks change, a time in the repeated or skipped hour is resolved the way PostgreSQL does: 1:30 AM on the fall-back night means the second (standard-time) 1:30, and 2:30 AM on the spring-forward night becomes 3:30 AM. Avoid scheduling in those hours.
- **Monthly on the 29th, 30th, or 31st** skips months that don't have that date (it never moves to the last day).
- **Nonexistent times** (the hour skipped in spring, e.g. 2:30 AM) move forward to 3:30 AM. **Repeated times** (the hour repeated in autumn, e.g. 1:30 AM) use the second, standard-time one. The edit page warns when dates were shifted.
- Each date has its own page and registrations. **Change this date only** moves a date, changes its time or place, or adds a note; later series edits leave it alone.
- Editing the series keeps every existing date's registrations. If an edit removes a date that has registrations, it's kept as **canceled** (and people are told) instead of being deleted; dates without registrations are removed.

### Registration rules

- One place per member account. Guest registration, household guest counts, and registering children are deferred until their consent and permission flows exist.
- Registration closes at the time you set, or when the date starts. Members can cancel until the date starts.
- **Capacity** is enforced in the database with the date locked, so simultaneous requests can never overbook. Duplicate requests return the existing registration.
- **Waitlist** order is first come, first served. When a place opens (a cancellation, a capacity increase, or capacity removed), the first person still eligible is **registered automatically and their place is confirmed**, and they're emailed. They don't need to accept; they cancel if they can't come.
- **Reducing capacity** never removes anyone already confirmed. New confirmations wait until the count drops below the new capacity.
- **Suspension or loss of access:** if a member stops being an approved member, or the event's audience no longer includes them, their current and future registrations and waitlist places are canceled ("no longer eligible") and places go to the waitlist. They are **not** emailed about it (they can no longer see member events), and their queued emails are dropped. Reinstatement doesn't restore registrations.
- **Organizer registrations:** an organizer can register a member (ignoring the deadline; capacity applies unless "Allow over capacity" is ticked) or cancel someone's registration. Both require a reason and are written to the audit log. The member gets the usual email.

## Calendars

| What | Updates? | Who |
| --- | --- | --- |
| **Download (.ics)** or **Add to Google Calendar** on an event page | **No.** It's a snapshot of the event at that moment. | Anyone who can see the event |
| **Private calendar subscription** (Events → Calendar & reminders) | **Yes**, when the member's calendar app next refreshes (often every few hours; Google Calendar can take up to a day). Includes every date the member is registered for, with changes and cancellations. | Approved members, for their own registrations |
| **Public church calendar** (`/api/calendar/public`) | Yes, same refresh behavior | Anyone, once an event coordinator enables it in Admin → Events → Settings. Public events only. |

### Private feed safety

- The feed URL contains a long random secret. **Anyone with the URL can read the events in it**, so members are warned to keep it private. Only a SHA-256 hash of the secret is stored. The full URL is shown once, when it's created.
- Members can **create a new link** (the old one stops working immediately) or **turn the link off**.
- Every request rechecks the member: suspended or pending accounts, revoked links, and unknown links all get the same "not found". Events the member can no longer see drop out.
- Feeds contain event details only: no attendee lists, other members, or organizer contact details. Descriptions do appear in feeds, so don't put sensitive information in event descriptions.
- Responses are `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. The app never logs feed tokens. As with any URL, the hosting platform's request logs can record the path, so treat a link that appears in a shared log as compromised and create a new one.
- Feed links use the deployment's stable address (`VERCEL_BRANCH_URL` on previews, the production domain after release), so they survive redeployments. Preview feeds never point at production, and vice versa.

## Email

- Sent: registration confirmation, waitlist notice, cancellation confirmation, waitlist promotion, meaningful change, date or event cancellation, and reminders (each event chooses up to three reminder times; members can turn reminders off).
- Every message is a record in `events.outbox` with a unique key, so it's sent at most once even if two deployments or retries overlap. Failures are retried up to 5 times with increasing delays. Admin → Events → Settings lists failed messages with a **Retry** button.
- Before sending, the database rechecks that the recipient is still an approved member who can see the event and still holds the matching registration; otherwise the message is marked "skipped" and nothing about the event is released.
- **Test environments:** email goes only to `EVENTS_EMAIL_ALLOWLIST` (falls back to `GIVING_EMAIL_ALLOWLIST`). With no allowlist, nothing is sent. Every test message is labeled [TEST]. Never use real members' addresses for testing.

## Scheduler (reminders and retries)

**Owner: the database.** One `pg_cron` job (`events-worker`, every 5 minutes) in the Supabase project:

1. queues due reminders in the database (`events.tick()`, under an advisory lock, deduplicated), and
2. if any email is waiting, sends one signed request (`pg_net`, HMAC with the job secret) to the **designated deployment's** `/api/jobs/events`, which delivers the queued email through Resend.

Confirmations and change notices are sent immediately by the action that caused them; the scheduler only adds reminders and retries.

Why the database and not Vercel Cron: Vercel cron jobs run only on **production** deployments (production is paused), and the Hobby plan allows roughly one run a day. The database is the single shared owner across every preview, so reminders are never queued twice. A Vercel cron calling `GET /api/jobs/events` with `Authorization: Bearer $CRON_SECRET` can be added after release; it's safe to run alongside the database job.

### Setup (owner)

1. Apply the events migrations: run [`supabase/manual/2026-10-21-apply-events.sql`](../supabase/manual/2026-10-21-apply-events.sql) in the SQL editor (one transaction; stops harmlessly if already applied).
2. Create the job secret: run [`supabase/manual/2026-10-21-create-events-job-secret.sql`](../supabase/manual/2026-10-21-create-events-job-secret.sql). Copy the value **directly** into Vercel as `EVENTS_JOB_SECRET` (Sensitive, Preview, branch `phase-4/events-calendar`). Rerunning shows `ALREADY SET` and never rotates it.
3. In Vercel (same scope), set `EVENTS_EMAIL_ALLOWLIST` to the authorized test addresses (or rely on `GIVING_EMAIL_ALLOWLIST`), then redeploy the branch.
4. Schedule the worker: run [`supabase/manual/2026-10-21-events-scheduler.sql`](../supabase/manual/2026-10-21-events-scheduler.sql). It enables `pg_net` and `pg_cron`, points the job at `https://the-gathering-git-phase-4-events-calendar-paint-by-number.vercel.app/api/jobs/events`, and schedules it. To move the scheduler to another deployment (or production), change the URL in that script and run it again.

The designated deployment must be reachable without Vercel's login. With Deployment Protection on, the request gets 401: reminders still queue in the database and are delivered when the endpoint becomes reachable (or by the next member or organizer action that sends email), but nothing is lost or duplicated.

**Plan limits:** `pg_cron` and `pg_net` are available on all Supabase plans. Each run makes at most one outbound request, and only when email is waiting. Vercel function time per run is capped at 60 seconds (about 100 emails).
