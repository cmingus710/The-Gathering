# Prayer and care: administration guide (Phase 6)

For super administrators, prayer and care leads, care coordinators, and prayer moderators. Member-facing explanation: [prayer-privacy-guide.md](prayer-privacy-guide.md). Retention and deletion: [prayer-retention.md](prayer-retention.md). Design: [architecture.md](architecture.md#prayer-and-care-phase-6).

## Roles and capabilities

Prayer and care access comes **only from explicit roles**. No other role grants it, and super administrators do **not** hold these capabilities implicitly (`has_capability()` excludes `prayer.*` and `care.*`, as it already excluded `finance.*`).

| Role | Capabilities | For |
| --- | --- | --- |
| Prayer team member (`prayer_team`) | `prayer.confidential` | Reading and praying for confidential (team-audience) requests |
| Prayer moderator (`prayer_moderator`) | `prayer.moderate` | Reviewing reported prayer content in scope |
| Prayer and care lead (`prayer_lead`) | `prayer.confidential`, `prayer.moderate`, `prayer.identity` | All of the above plus audited identity lookup for anonymous requests, and the sensitive-access log |
| Care coordinator (`care_coordinator`) | `care.coordinate` | The care workspace: requests, status, follow-ups, responses, volunteer opportunities |
| Care team lead (`care_lead`) | `care.coordinate`, `care.assign` | Coordination plus assigning coordinators and reading every internal note |

**Granting:** a super administrator assigns these at **Administration → Members → (member) → Roles**. That is the super administrator's only route to confidential content: they can grant themselves or anyone a prayer/care role, and every grant and removal is written to the audit log (`role.granted` / `role.revoked`). Choose the people deliberately and remove roles when someone steps down; access ends at the next request.

**Infrastructure:** access-controlled is not the same as inaccessible. People who operate the hosting (Supabase project owners with database access, and anyone with the service key) can read the database directly, outside the app's rules. Keep that circle small.

## Permission matrix

"Request" = prayer request. ✓ = yes, — = no.

| Who | Church requests | Group requests | Team (confidential) requests | Others' private drafts | Prayer reports | Anonymous author's identity | Care requests | Internal care notes | Volunteer logistics |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Visitor, pending, or suspended account | — | — | — | — | — | — | — | — | — |
| Approved member | Read, pray, comment | Only groups they actively belong to | — | — | Can report | — | Their own only | — | Only if accepted for that opportunity and the requester consents |
| Author of the request | Always (until deleted, while approved) | Always | Always | Own only | — | Own | — | — | — |
| Group leader | As member | As member of their group | — | — | — | — | — | — | — |
| Community administrator / moderator | As member | As member | — | — | — | — | — | — | — |
| Membership admin, content editor, finance, event coordinator | As member | As member | — | — | — | — | — | — | — |
| Super administrator (no prayer role) | As member | As member | — | — | — | — | — | — | — |
| Prayer team member | As member | As member | ✓ | — | — | — | — | — | — |
| Prayer moderator | As member | Only the reported item (evidence) | Only with prayer team access too | — | Church and group reports; team reports only with `prayer.confidential` | — | — | — | — |
| Prayer and care lead | As member | Reported items | ✓ | — | All | Audited lookup with a reason | — | — | — |
| Care coordinator | As member | As member | — | — | — | — | All (queue, details, chosen contact) | Only on requests assigned to them | Writes them |
| Care team lead | As member | As member | — | — | — | — | All | All | Writes them |

Rules that apply everywhere: database functions recheck the caller on **every** read and change (lists, counts, filters, search, details, comments, updates, notifications, email, push, and report evidence). Hidden content is never sent to the browser and then concealed.

## The workspace (Prayer → Prayer & care workspace)

Shown to prayer team members and care coordinators. Each section loads only for people with the matching capability.

**Care requests** (care coordinators):

- **Unassigned / Assigned to me / All open / Closed.** "Due" counts follow-up dates that have arrived.
- **Request page:** details, the contact the requester chose (phone or sign-in email only when they picked that method; nothing is taken from the directory), status, follow-up date, coordinator, messages, internal notes, activity, volunteer help.
- **Who can change what:** coordinators act on unassigned requests and ones assigned to them; care leads act on any and assign coordinators. Others can read but not change.
- **Status:** Submitted → In review → Coordinating → Fulfilled → Closed (closing needs a reason). The requester is told the status changed, with generic wording outside the app.
- **Follow-up date:** the assigned coordinator gets one reminder on that date (church time zone), from the existing scheduler. Changing the date re-arms it.
- **Messages with the requester** are visible to the requester. **Internal notes** are never shown to the requester or volunteers, and only the assigned coordinator and care leads can read or add them. Keep notes operational ("Meals arranged Mon–Wed"); no medical details.
- **Activity** records actions and state changes (assigned, status, note added, message sent, consent changed, volunteer accepted). It never copies note or message text.
- Opening a care request is recorded in the sensitive-access log (once per person per request per hour).

**Confidential prayer requests** (prayer team): requests whose audience is the prayer and care team. Opening one is recorded (not what you read). They are not monitored continuously; members are told so.

## Volunteer help (limited, care-specific)

This is not the Phase 11 volunteer system: it's one-off help for a single care request.

1. On the care request, **Ask for volunteers**. Write a generic task ("Deliver a dinner"), date and time, helpers needed, and who can volunteer (church members, one group, or care coordinators only).
2. **Logistics** (for example a drop-off address) and the requester's **first name** are shown only to volunteers you accept, and only while the requester consents. Write logistics yourself; nothing is filled in from the directory, and directory privacy settings are never bypassed.
3. Drafts show a **preview** of exactly what everyone sees and what accepted volunteers see. Publishing needs you to confirm it, and is refused if logistics or the name are included without the requester's consent.
4. Members offer to help (with an optional note); you **accept**, **decline**, or **mark done**. Accepting enough helpers marks the opportunity filled. Accepted volunteers are notified (generic email).
5. If the requester withdraws consent, logistics and their name disappear from volunteers' screens at once. Closing or withdrawing the request cancels its open opportunities.

Opportunity lists never contain the request text, internal notes, phone numbers, or addresses.

## Moderation (Administration → Prayer reports)

- Members can report a request, comment, or update. The report captures **only that item** as it was when reported; the anonymous author of an anonymous item shows as "Anonymous".
- Prayer moderators see church and group reports; reports about team (confidential) requests appear only for moderators who also hold `prayer.confidential`. Community moderators never see prayer reports, and a report never opens other requests or groups.
- Opening a report is logged. Actions: hide or restore the request or a comment, lock or unlock comments, each with a reason (shown to the author without your name). Close as "action taken" or "no action needed" with a resolution; reopen if needed.
- Moderators can also act directly on requests they could read anyway (they are in its audience).
- A hidden request stays visible to its author with a notice; readers lose it, and queued notifications for it are dropped.

## Identity lookup (prayer and care leads only)

On an anonymous request (from the request page or its report), **Look up author** asks for a reason of at least 10 characters and returns the display name only (no contact details). It works only on requests the lead can read or has an open report about. Each lookup is recorded in the sensitive-access log (with the reason) and the audit log (without it). The author isn't notified. Use it only when pastoral care or safety requires it.

**Administration → Prayer reports → Sensitive-access log** shows identity lookups and openings of confidential requests, care requests, and reports.

## Member guidance and settings

**Administration → Prayer settings** (church settings managers) edits the short "Before you share" guidance and the retention policy. It reveals no request content. Default guidance:

- Share only what you have permission to share.
- Choose the audience carefully.
- Confidential requests are not monitored continuously.
- This is not an emergency service.

## When access ends

- **Leaving or removal from a group:** group requests disappear immediately; follows are removed.
- **Suspension:** no prayer or care access at all, including the person's own requests, until reinstated.
- **Role removed:** confidential requests, reports, or the workspace disappear immediately. A care coordinator who loses the role is unassigned from their open care requests (recorded as "Unassigned").

## Rate limits

Requests 5 per hour; edits 30 per 15 minutes; updates 10 per hour; comments 20 per 15 minutes; "I'm praying" 60 per 15 minutes; reports 10 per hour; care requests 5 per day; care messages 20 per 15 minutes; notes 30 per 15 minutes; volunteer offers 20 per hour.

## If something is urgent

The app is not an emergency service and the team isn't watching around the clock. If a request suggests someone is in danger, follow the church's safeguarding policy and contact people directly.
