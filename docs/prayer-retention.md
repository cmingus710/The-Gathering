# Prayer and care: retention and deletion

What is kept, for how long, and what still needs a church decision. Configure at **Administration → Prayer settings** (church settings managers).

## Default: no automatic deletion

Automatic retention is **off** (`prayer.settings.retention_enabled = false`). Until the church adopts a written policy and a settings manager turns it on (the form requires confirming the policy was adopted), the scheduler doesn't archive or delete any prayer or care record. Nothing destructive has been run against existing records. Member-initiated deletion is always immediate.

## What happens to each item

| Item | Member action | Automatic (only when retention is on) |
| --- | --- | --- |
| **Prayer request** | Author can archive (author-only, restorable) or delete (immediate, permanent; removes its updates, comments, prayers, follows, and notifications) | Closed requests are archived after `closed_archive_days` (default 90); archived requests are deleted after `archived_delete_days` (default 365) |
| **Archived request** | Visible only to the author; restoring needs the audience confirmed again. Archiving never widens visibility | As above |
| **Updates** | Author can edit or delete (removed outright) | Deleted with the request |
| **Comments** | Author can edit; deleting erases the text and leaves a "deleted" placeholder so the conversation still reads correctly | Deleted with the request |
| **Prayer acknowledgments** | Removable by the member | Deleted with the request |
| **Care request** (with messages, internal notes, activity, opportunities, signups) | Requester can withdraw (closes it); it isn't deleted by the requester so the team keeps a record of what was arranged | Closed care requests are deleted with everything attached after `care_delete_days` (default 365) |
| **Internal care notes** | Not editable or deletable individually (operational record) | Deleted with the care request |
| **Report evidence** (snapshot of the reported item) | Cleared immediately for **closed** reports when the author deletes the request; kept for open reports until resolved | Cleared `report_evidence_days` (default 90) after the report closes; the report record (reason, outcome, who acted) stays |
| **Moderation log, sensitive-access log, audit log** | — | Kept. They hold ids, actions, times, and moderators' or leads' reasons, never request, comment, or note text |
| **Notifications** | Mark read | Read notifications deleted after 180 days (Phase 5 rule); delivery records after 60 days |
| **Rate-limit records** | — | 2 days (Phase 5 rule) |

## Account deletion

Deleting an account (by an administrator in Supabase) cascades: the person's prayer requests (with everything attached), their comments and updates, prayers, follows, care requests (with notes, messages, opportunities), and volunteer signups are deleted. References in logs and reports become empty ("Former member"). Report evidence already captured remains until its report is resolved and the evidence period passes.

## Hiding by moderators

A hidden request or comment keeps its text so it can be restored. It's visible only to its author (with a notice) and is subject to the same retention as other content.

## Decisions still needing the church

1. **Adopt a retention policy** and decide the four periods (archive closed requests, delete archived requests, delete closed care requests, clear report evidence). The defaults above are proposals.
2. Whether to **turn on** automatic retention, and when, given it also applies to records created before it's turned on.
3. How long to keep the **moderation, sensitive-access, and audit logs** (currently indefinitely; they contain no content).
4. Whether care coordinators should be able to **delete** individual internal notes.
5. Who should hold the **prayer and care lead** role (identity lookup) and how lookups are reviewed.
6. The safeguarding contact members and the team should use when a request suggests someone is at risk.
