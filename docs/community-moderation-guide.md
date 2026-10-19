# Community moderation guide (Phase 5)

For community administrators, community moderators, and group leaders. Design: [architecture.md](architecture.md#community-groups-messaging-and-notifications-phase-5).

## Who can do what

| Role | Can | Can't |
| --- | --- | --- |
| **Community administrator** (`community.manage`) | Add, rename, hide, and reorder categories; edit the community guidelines (optionally requiring everyone to accept again); set digest time and retention; create groups with a first leader; appoint and remove leaders; change a group's visibility; archive and restore groups; see that hidden groups exist and who belongs to them | Read private group discussions or direct messages; approve or suspend church membership; finance; assign roles |
| **Community moderator** (`community.moderate`) | Review reports (church-wide, group, and direct-message reports); hide/restore discussions and replies; pin, lock, unlock; apply and lift community restrictions; read the moderation log | Browse conversations (only the messages someone reported); change church membership; finance; roles |
| **Group leader** (per group, not a role) | Edit their group's details and image; approve or decline join requests; invite members (they must accept); remove ordinary members; pin, lock, hide, and restore content in their own group; review reports about their group's discussions | Anything outside their own groups; appoint or remove leaders; restrict members church-wide; review reports about a leader of their group; membership approval, finance, roles |
| **Membership administrator** (existing `members.manage`) | Turn direct messaging on or off for an adult member (audited) | — |
| **Super administrator** | Holds community capabilities implicitly (like other non-finance capabilities) | Finance without a finance role |

Assign the two new roles at **Administration → Members → (member) → Roles**. Group leadership is assigned at **Administration → Community → Groups → Manage**.

Community restrictions are separate from church membership. Only membership administrators suspend membership (Administration → Members); a suspended member loses all community access at once.

## Reviewing a report

1. Open **Administration → Moderation** (leaders: the group's **Manage → Reports**).
2. Opening a report is recorded (`report.viewed`) and moves it to "In review".
3. You see the reason, the reporter's note, and **only the items reported**, as captured when reported (later edits or deletion don't change the evidence). For direct messages you see only the selected messages, never the rest of the conversation.
4. Act within your scope:
   - Hide or restore the discussion or reply (a reason is required; the author is told, without your name).
   - Lock or unlock; pin or unpin.
   - Moderators only: restrict the member's posting, messaging, or both for 1–90 days or until lifted, with a reason shown to them.
5. Close the report as "action taken" or "no action needed" with a resolution. You can reopen it.

Reports about a group leader are marked "About a group leader" and are hidden from that group's leaders, so someone outside the group reviews them.

If a report suggests someone is in danger, follow the church's safeguarding policy and contact the appropriate people directly; the app is not an emergency service.

## What is kept

| Item | After an edit | After the author deletes it | After a moderator hides it | In a report |
| --- | --- | --- | --- | --- |
| Discussion | Only the new text; "edited" and time | No replies: removed. With replies: title and text erased; a "deleted" placeholder keeps the replies in place | Text kept (to allow restoring), shown only to moderators in scope | Snapshot of the reported item only |
| Reply | Only the new text | Text erased; "deleted" placeholder | As above | Snapshot of the reported reply only |
| Direct message | Messages can't be edited | A member can delete a conversation for themselves; once both have, the messages are erased | Not applicable (messages aren't moderated in place) | Snapshot of the selected messages only |

- Report evidence is cleared `report_evidence_days` (default 180) after the report is closed; the report record (reason, outcome, who acted) stays.
- Direct messages are erased after `dm_retention_days` (default 2 years). There is no general audit copy of messages.
- The moderation log and audit log record who did what, when, and why, never message text or post content.
- Reactions on a deleted post are removed with it.

## Guidelines

Edit at **Administration → Community**. Members must accept the current guidelines before posting, replying, or reacting (reading is always allowed). Tick "ask everyone to accept the updated guidelines" for meaningful changes; it bumps the version.

## Groups

- **Discoverable:** any approved member sees the name, short description, and image and can ask to join (if requests are on). The roster, details, discussions, and events stay members-only.
- **Hidden:** visible only to members and community administrators. Join by invitation.
- A group always has at least one active leader. To remove the last leader, appoint another first or archive the group. Archived groups are read-only; open invitations and requests close.
- Removing someone (or them leaving) ends their access immediately and cancels their group-event registrations (the waitlist moves up), with no event email.
