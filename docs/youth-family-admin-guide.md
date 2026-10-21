# Youth & families: administration guide

Phase 10. For staff who run youth ministry and family administration. Members' and guardians' side: [guardian-guide.md](guardian-guide.md). Who can do what: [youth-permission-matrix.md](youth-permission-matrix.md). Photos: [media-consent-workflow.md](media-consent-workflow.md). Retention, deletion, and adult transition: [youth-retention.md](youth-retention.md). Design: [architecture.md](architecture.md#youth-ministry-and-families-phase-10).

> **Nothing here makes the church legally compliant on its own.** The app records decisions, verifications, and consent the church makes; it doesn't verify ages, identities, custody, or signatures. The church decides its policies (with legal advice where needed) and records them under **Policy**.

## Where things are

| Task | Location | Role (capability) |
| --- | --- | --- |
| Overview of your youth areas | **Administration → Youth & families** `/admin/youth` | any youth/family role |
| Draft and approve the church's youth policy | `/admin/youth/policy` | Youth policy administrator (`youth.policy`) |
| Guardian requests, verification, child profiles, restrictions, eligibility, youth-account invitations, adult transition, history | `/admin/youth/families`, `/admin/youth/families/children/<id>` | Family administrator (`family.verify`) |
| Youth groups, leaders, enrollment | `/admin/youth/groups`, `/admin/youth/groups/<id>` | Youth ministry administrator (`youth.manage`, `youth.enroll`, `youth.publish`) |
| Permission forms and versions | `/admin/youth/forms` | Permission form administrator (`youth.forms`) |
| Make an event youth-only; forms; event details to collect; personnel; attendee and consent lists | `/admin/youth/events`, `/admin/youth/events/<id>` | `youth.forms` or `youth.manage` (dates, capacity, deadlines stay in **Administration → Events**) |
| Photo consent reviews, photo associations, known copies | `/admin/youth/media` | Photo consent reviewer (`youth.media_consent`) + Gallery moderator to see images |
| Reports about youth discussions (including about leaders) | `/admin/youth/reports` | Youth safeguarding reviewer (`youth.safeguarding`) |
| Leaders' own work: roster, enrollment, announcements, learning, discussions, reports, event lists | **Youth → Leading** `/youth/lead` | Youth leader (`youth.lead`) **and** an assignment to that group |
| Event logistics (emergency contacts, pickup notes) | `/youth/lead/events/<id>/logistics` | Designated personnel of that event (a leader of its group, or `youth.logistics`) |
| Assign the roles above | **Administration → Members → member → Roles** | Super administrator (`roles.manage`) |

**Super administrators don't hold youth or family capabilities automatically** (like finance, prayer, and care). They can assign the roles, which is audited. Roles can't be assigned to youth accounts.

## First-time setup

1. Assign **Youth policy administrator** to two people (approval needs someone other than the last editor).
2. Draft the policy (`/admin/youth/policy`): paste the church's wording, choose each setting, save. The second person approves it with the reference to where the church approved it (minutes, date) and the typed phrase `approve version N`. Until then the safe defaults apply (see below).
3. Assign **Family administrator** to at least two people (nobody can verify their own relationship).
4. Assign **Youth ministry administrator**; create groups; give each leader the **Youth leader** role, then add them to groups with the permissions they need (publish, manage enrollment).
5. Assign **Permission form administrator**; write forms; publish version 1.
6. Assign **Photo consent reviewer** (with **Gallery moderator** to see images) and **Youth safeguarding reviewer**.

## Policy decisions that need church input

Each is a setting on the policy page. Until a version that allows it is approved, it stays off.

| Decision | Setting | Default until decided |
| --- | --- | --- |
| Whether youth get their own accounts at all, and who is eligible (in the church's words) | `independent_accounts`, `eligibility_rule` | Off: no youth accounts can be invited or activated |
| A minimum age, if the church sets one (the app never invents one) | `minimum_age_years` | None; when set, a recorded date of birth is required and checked, otherwise activation is refused |
| Whether a verified guardian must authorize each youth account | `guardian_authorization_required` | Required |
| More than one verified guardian per child | `multiple_guardians` | One guardian per child |
| Whether to collect a child's date of birth at all | `birth_date_required` | Not collected |
| Youth registering themselves for events (only events with no forms or details) | `youth_rsvp` | Off |
| Supervised group discussions, and how many effective leaders a group needs first | `youth_discussions`, `discussion_min_leaders` | Off; 2 leaders when on (plus a fixed floor of 3 enrolled children) |
| Whether guardians may read their child's group discussions | `guardian_discussion_access` | No access |
| Moderated group prayer threads | `group_prayer` | Off |
| Progress sharing for independent youth (the youth chooses) | `progress_sharing` | Off |
| Recording consent for **public** use of photos (websites, social media, banners) | `public_media_consent` | Off; the app never publishes photos publicly either way |
| Reviewed transition to adult access | `adult_transition` | Off |
| Automatic deletion of event logistics after an event | `logistics_retention_days` | Never deleted automatically |

Also needs church input, outside the app settings:

- **Confidential youth care**: there is no reviewed access and escalation policy, so the app offers no confidential youth prayer or care submission. Youth are pointed to a parent or guardian, a leader in person, or the church office. Adult prayer and care remain adult-only.
- **How guardians are verified** (in person, known to staff, church records) and what to do about disputes. The app records the method and lets you restrict a child's profile; it never collects identity documents or custody papers.
- **Child check-in/check-out and pickup authorization**: not built. Pickup notes are information from families, not authorization.
- **Wording of permission forms**, which events need them, and who staffs events (personnel).
- **Legal review** of the policy and forms (for example, any applicable children's online privacy rules, such as COPPA in the US, whose amended rule took effect in 2025 with a compliance date of 22 April 2026). The app doesn't decide whether they apply.

## Guardian requests and verification

1. An approved adult asks under **Youth → Family dashboard → Link a child**: child's preferred name, relationship, optional details, and a date of birth only if the policy collects it. They always get the same answer ("Waiting for review") and never learn whether a child record exists.
2. Open `/admin/youth/families`. For each request, confirm the relationship yourself, then choose **Create a new child profile** or one of the existing profiles whose name matches, record how you verified it, and tick each permission this guardian should have (all start unticked). **Verify and link.** Or **Decline**.
3. Nothing is matched automatically (names, households, addresses, email). Being in a household never creates a guardianship. You can't review your own request.
4. The requester gets a generic "Your request was reviewed" notice. If linked, the child appears on their dashboard.

On a child's page you can change each guardian's permissions, **Pause access** (suspend), **Restore access**, or **Revoke** (final; a new request starts over), and **Restrict** the whole profile (for example, a disputed relationship): every guardian and youth-account path pauses, guardians see only "access is paused", nobody is notified, and affected photos are hidden for review. Every action appears in the child's **History** (actions and states only, never values). Opening a child's page is itself logged because it shows private eligibility data.

## Independent youth accounts (policy-gated)

Requires `independent_accounts` in the approved policy, then for each child:

1. **Record eligibility** under the current policy version on the child's page (eligible / not eligible). A new policy version needs a new determination.
2. If the policy sets a minimum age, a date of birth must be recorded and meet it; otherwise invitation and activation are refused.
3. Create an invitation (family administrator, or a verified guardian allowed to manage the account) with the youth's **own** email address. It can't be an address that already has an account. The one-time code is shown once; give it in person. No email is sent by the app.
4. If the policy requires guardian authorization and an administrator created the invitation, a verified guardian authorizes it from their dashboard.
5. The youth signs up normally with that email, confirms it from the Supabase confirmation email, signs in, and enters the code at `/youth-activate`. Activation refuses anyone whose account was ever approved, has roles, or belongs to a household (no merging identities). Sign-ups with an invited email start as youth accounts and can't be approved as adults by membership administrators.
6. The account records the policy version accepted and who authorized it. Practice recorded on the child profile moves into the youth's own history.

Youth accounts see only the Youth area and the learning tools (Bible reading, journal, memory verses). Every adult feature refuses them in the database: directory, messages, community, groups, prayer, care, giving, gallery, teaching pages behind sign-in, and administration. There is no youth self-registration path.

## Groups, leaders, enrollment

- Youth groups are separate from community groups (no open rosters, join requests, or messaging).
- Leaders need the **Youth leader** role **and** an assignment; removing either removes access at once. An active group always keeps one leader; assign another or archive the group first.
- Leaders see only their groups' rosters: preferred names and participation. No contact details, dates of birth, guardians' identities, logistics, journals, practice answers, finance, or membership tools.
- Enrollment: youth ministry administrators with `youth.enroll`, or leaders allowed to manage enrollment. Guardians allowed to manage the profile can remove their child from a group. Leaving cancels upcoming registrations for that group's events.

## Youth events and permission forms

1. Create the event as usual in **Administration → Events** (draft).
2. In `/admin/youth/events/<id>`, choose the youth group, required forms, and only the details the event needs (emergency contact, pickup notes, optional family notes), and whether eligible youth may register themselves. This makes it youth-only; the general event editor can't change it back. Then publish it in Events.
3. Designate **event personnel** (leaders of the group or youth logistics role holders). Only they see logistics, each viewing is logged, and the values never appear in descriptions, rosters, calendar feeds, notifications, exports, or the audit log.
4. Attendee lists show each child's registration and the state of every form: *Permission given*, *Needs a decision*, *Needs renewed permission*, *Declined*, *Withdrawn*.
5. Changing a form: save a new draft version and publish it. Choose **Material** (the default) when what guardians agree to changes: earlier permission stops counting and guardians of registered children get a notice. Use **Wording fix only** for typos.
6. Declining or withdrawing permission cancels the child's upcoming places for that event and promotes the waitlist. A checkbox records a verified guardian's agreement, the time, and the form version; it isn't a legally verified signature. No IP addresses or device data are stored.

## Announcements, discussions, learning

- Leaders allowed to publish (or `youth.publish` for all groups) post announcements for youth and/or guardians. Guardians get a notification; email and push say only "There's an update in Youth & Families".
- Discussions (when the policy allows): only leaders start them; youth reply; everyone sees who can read it; there are no private messages anywhere in the Youth area. Posting stops if the group drops below the policy's leader count or three enrolled children.
- Reports go to the group's leaders and safeguarding reviewers; reports about a leader's content go only to safeguarding reviewers who don't lead that group. Reporters aren't identified to reviewers. Evidence is cleared 180 days after resolution.
- Learning: assign church-wide memory collections, reading plans, or devotionals/lessons to a group. Guardians allowed to practice can practice memory verses with a child; it's recorded on the child.

## Testing safely

Use only synthetic names (prefix `[TEST]`) and authorized adult test accounts. Never involve real children or families. Email in testing goes only to the allowlist. Afterwards: archive `[TEST]` child profiles, revoke test guardianships and invitations, archive test groups and forms, remove temporary roles (all audited).
