# Scripture memory: privacy and challenge sharing (Phase 9)

## What is private

Everything a member does in practice is owner-only: verses in My Verses, sessions and answers, accuracy, hints, confidence, review steps and dates, practice days, badges, settings, and personal collections.

- Stored in the private `memory` schema (no Data API access, RLS on with no policies), reached only through functions that filter on the signed-in member.
- **No staff path exists.** Super administrators, memory editors and publishers, Bible and reading-plan staff, content editors, membership administrators, group leaders, and household members can't read another member's results. Tests check a household member, a super administrator, a memory editor and publisher, and a group leader (`tests/db/memory.test.ts`): each gets "not found" for another member's verse and can't start, hint, reveal, or submit their practice.
- Administration screens show collections and verses only. The single hint of use is "members are practicing it" on a verse (so staff retire rather than delete it); there are no counts, names, or results.
- Answers and results never go to analytics, logs, search, the audit log, or administrative dashboards. API routes don't log bodies and return `private, no-store`; pages are `private, no-store`; the service worker caches none of it. The audit log records collection and challenge changes by field name and state only.
- This is access control, not end-to-end encryption: the database operator can technically read the rows.

## Reminders

Email and push never include a verse, a count of verses, accuracy, or history ("A new memory verse is ready", "You have memory verses ready to review"). In the app, the weekly reminder may name the reference after a visibility recheck. Before any reminder is queued or delivered, membership, the member's reminder choices and pause, collection visibility, and challenge participation are rechecked.

## Group challenges: what participation reveals

Joining is explicit, after reading this, and adults only (group membership requires an adult account).

**Shared:** a count of practice activities completed on the challenge's verses, from the moment of joining (or resuming sharing) until the challenge ends, added into a group total.

**Never shared:** names in the total, any person's count, accuracy, hints, confidence, missed days, which verses someone knows, or a ranking. Organizers (leaders and publishers) see exactly the member view.

Safeguards for small groups:

- Totals (and the number of people sharing) stay hidden until at least the challenge's threshold shares (minimum 3, default 5).
- Totals are rounded down to a multiple of 5 and count through the end of the previous day (church time zone; the final day counts once the challenge ends), so one person's activity can't be read from a change in the total.
- Residual risk, stated plainly: someone who watches a small group's total over several days and knows who practices could still guess roughly. Raise the threshold for small groups.

### Withdrawal and deletion

Totals are computed live from current participation and current practice records; nothing is stored per person in shared form. So:

| Event | Effect on the total |
| --- | --- |
| Pause sharing | Removed at once; practice while paused is never counted. Resuming counts only from that moment. |
| Leave | Removed at once. Rejoining counts only from the new join. |
| Leaving the group, removal, or suspension | Participation ends automatically (trigger) and contributions are removed. Reinstated members must choose to join again. |
| Deleting a verse or all practice history | Those practices disappear from the total. |
| Account deletion | Everything is deleted with the account. |
| Milestone already announced | Not announced again, even if the total later falls and rises. |

## Families and youth

Phase 10 ([youth-permission-matrix.md](youth-permission-matrix.md)). Sharing a household still gives no access to anyone's practice.

- **Child profiles** (no login): a verified guardian allowed to practice records practice for the child under Youth & Families. It's stored on the child (`youth.practice_*`), never on the guardian's own cards, and other guardians allowed to see progress see summaries only. The kids presentation on a member's own account still records the member's progress.
- **Independent youth accounts** use Memory verses like any member; their practice is theirs. Guardians see a summary (verses practiced, review-ready verses, days practiced, badge names) only when the church's policy offers sharing and the youth switches it on. Never typed answers, journal entries, or reflections.
- When a child profile activates its own account, its practice moves into the youth's own history.
- Leaders, family administrators, and super administrators have no view of anyone's practice. No child leaderboards or rankings exist.
- Challenges remain adult-only (`community.group_member` excludes youth accounts); no family challenge type was added.
- `memory.member_settings.presentation` is presentation only and is never read as an age or permission.

## Retention

Practice history stays until the member deletes it or their account. Practice sessions (the server's record of what was shown) are cleaned up after 2 days if abandoned and 30 days after submission; results stay in practice history. Personal practice of a verse is never deleted because a collection was archived or a verse retired. Canonical scripture is never deleted when a member removes a verse.
