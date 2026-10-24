# Administrator guide

The short version of every administrative job, with links to the detailed guides. Everything here is in the app under **Administration** (desktop sidebar, or More → Administration on a phone). You only see the sections your roles allow; a super administrator assigns roles but does **not** automatically get finance, youth, prayer-team, or other people's private content.

| Section | Location | Detailed guide |
| --- | --- | --- |
| Members and roles | Admin → Members | below, [directory-privacy-guide.md](directory-privacy-guide.md) |
| Church settings, announcements | Admin → Church settings, Announcements | below |
| Community and moderation | Admin → Community, Moderation | [community-moderation-guide.md](community-moderation-guide.md), [messaging-privacy-guide.md](messaging-privacy-guide.md) |
| Prayer and care | Admin → Prayer reports, Prayer settings | [prayer-care-guide.md](prayer-care-guide.md), [prayer-privacy-guide.md](prayer-privacy-guide.md) |
| Prayer Library | Admin → Prayer Library (moderators), Prayer Library categories (settings managers) | [prayer-library.md](prayer-library.md) |
| Gallery | Admin → Gallery | [gallery-guide.md](gallery-guide.md), [media-consent-workflow.md](media-consent-workflow.md) |
| Events | Admin → Events | [events-guide.md](events-guide.md) |
| Teaching content, media, podcasts | Admin → Teaching content, Media library, Podcasts | [media-guide.md](media-guide.md), [podcast-guide.md](podcast-guide.md), [media-limitations.md](media-limitations.md) |
| Reading plans and Bible sources | Admin → Reading plans, Bible sources | [reading-plan-guide.md](reading-plan-guide.md), [bible-sources.md](bible-sources.md) |
| Memory verses | Admin → Memory verses | [memory-admin-guide.md](memory-admin-guide.md) |
| Giving | Admin → Giving | [finance-guide.md](finance-guide.md), [giving-setup.md](giving-setup.md) |
| Notifications | Each member's Notifications → Settings | [notifications.md](notifications.md) |
| Youth & families | Admin → Youth & families | [youth-family-admin-guide.md](youth-family-admin-guide.md), [youth-permission-matrix.md](youth-permission-matrix.md) |
| Audit log | Admin → Audit log | below |

## Approving members and assigning roles

1. **Admin → Members** opens on **Pending**: people who registered and verified their email.
2. Open a person, check you know them, then **Approve**. The page tells you whether the welcome email was sent. If it says no email was sent, tell the person yourself.
3. **Google and Apple registrations** arrive pending like any other. A Google or Apple email (or its domain) doesn't prove membership. An address ending `@privaterelay.appleid.com` is Apple's Hide My Email relay, and the list says so. If someone already has an account and signed in with a different Google/Apple email by mistake, **Decline** the extra registration and point them to Profile → Sign-in methods on their real account ([social-login-setup.md](social-login-setup.md#account-linking-behaviour)).
4. **Decline** (pending) or **Suspend** (approved) asks you to confirm. Suspended people lose member access on their next page load; nothing is deleted. **Reinstate** restores it.
5. **Roles** on the same page: **Assign** takes effect on the person's next page load. **Remove** asks you to confirm. Every change is in the audit log. You can't change your own status, and the last super administrator can't be removed.
6. Optional: to be emailed when someone new is waiting, a super administrator lists recipients under **Church settings → Membership approval notifications** ([membership-approval-alerts.md](membership-approval-alerts.md)).
7. Give each person only the roles they need. Common pairs: *Membership administrator* (approvals), *Content editor/publisher* (teaching), *Event coordinator*, *Community moderator*, *Prayer moderator*, *Gallery moderator*, *Finance viewer/administrator*.
8. **Direct messaging** is off for everyone until an administrator confirms the person is an adult (Members → person → Direct messaging).
9. Correcting someone's profile records which fields changed (not the values) in the audit log.

## Church settings and announcements

- **Admin → Church settings:** church name, gathering times, contact details, logo and app icon. Empty fields show friendly "will be posted soon" text, never invented details.
- **Admin → Announcements:** draft, schedule, publish, archive; pin; **public** (on the welcome page) or **members only**; optional expiry. Links in announcements must be full `https://` addresses, `mailto:`, `tel:`, or site paths like `/events`.

## Moderating community, prayer, and gallery

- **Moderation** shows reports by reason. Open one to see only the reported content as captured, then dismiss, take action, or restrict the member's posting (the reason is shown to them and recorded).
- **Prayer reports** and **Prayer settings** are for prayer moderators and leads. Team-only and private requests are never visible to moderators unless reported, and identity lookups for anonymous requests are logged.
- **Gallery:** approve or reject uploads; photos showing children need a recorded consent decision. "Report or ask to remove" requests appear under Gallery → Reports.

## Managing events

**Admin → Events → New:** title, date, times (in the church's time zone), location, audience (public, members, or a group), optional RSVP with capacity and waitlist, reminders. Save as draft, then **Publish**. Changing the time or place notifies registered people; wording-only edits don't. Cancel rather than delete an event with registrations. Event times on the night clocks change: 1:30 AM on the fall-back night means the second (standard-time) 1:30; a 2:30 AM start on the spring-forward night becomes 3:30. Details: [events-guide.md](events-guide.md).

## Publishing reading plans, devotionals, lessons, podcasts, and playlists

- **Teaching content** holds devotionals, lessons (with handouts, slides, audio, or video attached), book recommendations, and music playlists. Editors draft; publishers publish or schedule.
- **Devotional collections** (Teaching content → Devotional collections) holds imported, read-only collections such as Charles Spurgeon's *Morning & Evening*: a dry run, an all-or-nothing import into a hidden draft, review and corrections, then publish or hide. See [morning-evening.md](morning-evening.md).
- **Media library** holds uploaded audio and video (MP4, up to 50 MB) and external videos (YouTube, Vimeo).
- **Podcasts:** add a feed address; the app checks it and refreshes it on the scheduler.
- **Playlists:** paste a Spotify link. Spotify may play 30-second previews to people who aren't signed in to Spotify.
- **Books:** Audible and store links open the provider's site; there is no in-app audiobook playback.
- **Reading plans:** build by hand or import CSV, preview, publish, feature. Revising a published day needs a reason.
- **Memory verses:** collections and weekly assignments; see [memory-admin-guide.md](memory-admin-guide.md).

## Teacher tools that exist today

Teachers with the content roles can publish lessons with attached handouts and media, and authorized group leaders can run memory-verse collections and challenges for their groups.

**Lesson builder and workbook (Phase 13, after its migration is applied):**
1. Open a lesson under **Teaching content**, then choose **Lesson builder**.
2. Add blocks (introduction, Scripture, teaching, discussion or written question, illustration, image, audio/video, reflection, closing), and order them with Up and Down.
3. Anything in a dashed **Teacher only** box (a teacher note, or a whole block marked "Hide this whole block from members") never reaches members, the preview, or the page source.
4. Use **Preview the member workbook** to check, then publish the lesson as usual.

Editors change drafts; changing a live lesson needs the publisher role. Rewording a question keeps members' answers and shows them the wording they answered. Removing a block keeps answers for their authors. Members' answers are private: they are saved in each member's My Journal, and no teacher or administrator view exists. Full guide: [phase-13/lessons-workbook.md](phase-13/lessons-workbook.md).

**Books (Phase 13):** create a **Book** (title, author, description, cover image with confirmed rights, optional Audible link and Kindle book URL, side by side). Then, on its edit page, set **Reading details** (reading dates, related lesson). Add **Reading assignments** for the chapter schedule. Members open Kindle or Audible with their own accounts; nothing is embedded. Full guide: [phase-13/reading-kindle-audible.md](phase-13/reading-kindle-audible.md).

**Not built:** a printable workbook or handout export, live presenter "Follow Along", and member-created handouts. Don't announce these.

## Fundraising campaigns (Phase 13)

Finance administrators (`finance.manage`) go to **Administration → Finance → Campaigns**:
1. Create a draft: title, description, optional image, goal, optional dates, the fund it gives to, and whether it's public or members-only.
2. **Publish** it. The fund is locked once published.
3. **Close** it to stop new gifts; the total stays visible. **Archive** it to hide it.

Cash and check gifts for a campaign go through **Record cash/check** with the campaign chosen (`finance.record`). The meter counts succeeded gifts, less refunds and open or lost disputes. Test and live totals never mix, and the meter never shows donors or individual amounts. Exact definition: [phase-13/campaigns.md](phase-13/campaigns.md#progress-definition).

## Giving administration and statements

Giving is in **Stripe test mode**: no real money moves. Finance roles see contributions, record cash and checks, issue refunds, reconcile, export CSV, and prepare statements. Statements stay watermarked drafts until the church enters and approves its legal name, address, tax ID, and wording in Admin → Giving → Settings. Going live needs a separate, explicit decision ([giving-setup.md](giving-setup.md)).

## Notification preferences and delivery troubleshooting

- Members choose per category: off, immediate email, or daily/weekly digest, plus quiet hours. In-app notices always appear.
- Email and phone-notification text is deliberately generic ("You have a new notification"); details show only after signing in.
- **Phone/web push is not switched on yet** (no push keys configured). Members get in-app and email notices.
- Someone not getting email: check their Notifications → Settings; check the address is verified; check spam. Delivery logs are in Resend; a developer can check the queue (`community.email_outbox`, `events.outbox`) for `failed` rows.

## Youth policy, roles, consent, and safeguarding

Youth features are **off** until the church approves a youth policy. Approval needs two different policy administrators, the confirmation phrase, and a reference to the church's own decision. **Do not approve a policy to "try it out"**: approval is recorded permanently and turns features on for real families. Guardians are verified by a family administrator (never by themselves); leaders need both the Youth leader role and a group assignment; consent forms are versioned; safeguarding reports about a leader are hidden from that group's leaders. Full workflow and the policy decisions the church must make: [youth-family-admin-guide.md](youth-family-admin-guide.md).

## Audit log

Admin → Audit log lists who did what and when: approvals, suspensions, role changes, profile corrections, finance actions, moderation. It records field names and counts, never message, prayer, journal, or payment details.
