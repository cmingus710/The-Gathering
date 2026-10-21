# Roadmap

Each phase is built, verified, and reviewed before the next begins.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Foundation, branding, authentication, and administration | **Merged** (device checks outstanding) |
| 2 | Membership and directory | **Merged** (PR #14) |
| 3 | Giving and contributions | **Merged** (PR #14), Stripe test mode |
| 4 | Events and calendars | **Merged** (PR #14) |
| 5 | Community, groups, messaging, and notifications | **Merged** (PR #14); hosted database applied; web push keys not set |
| 6 | Prayer and care | **Merged** (PR #14); hosted database applied |
| 7 | Teaching and media | **Merged** (PR #14); hosted database applied |
| 8 | Bible reading and journals | **Merged** (PR #14 with Phases 2–7); hosted database applied, including the `000700` follow-up |
| 9 | Memory verses | **Merged** (PR #15), **in production** since 2026-10-20; hosted database applied |
| 10 | Youth and families | **Built** (PR #16, not merged); hosted database **applied** (steps 1–10, 2026-10-21); policy-gated features off until the church approves a policy |
| 11 | Release readiness, verification, and polish | **Built** (PR into `main`, includes #16 and #17); see [phase-11-release-readiness.md](phase-11-release-readiness.md) |
| 12 | Phone push and ministry tools | Planned |
| 13 | Attachments, Lesson Studio, Follow Along | Planned |

## Hooks already in place for later phases

- **Navigation:** later modules can be listed as "Coming later" (not links) in `src/lib/navigation.ts`. A module becomes a link by switching its `status` to `available` and adding its route.
- **Roles:** `youth_leader` (`youth.lead`) is assignable since Phase 10 (plus a per-group assignment). `group_leader` stays reserved and unused: Phase 5 assigns group leadership per group instead.
- **Profiles:** directory, household, and advanced profile fields were added in Phase 2 (see build-status.md).
- **Groups (Phase 5, done):** `events.group_member()` now checks real group membership, the `series_groups_unavailable` constraint is replaced, and the event form has a group selector.
- **Bible (Phase 8, done):** the Bible tile is live with the supplied art. Canonical books use USFM codes (`bible.books`, `src/lib/bible/books.ts`, names identical to Phase 7's scripture references).
- **Memory verses (Phase 9, done):** passages are captured from the Phase 8 stored-text source as versioned snapshots (translation + reference + content hash) so practice is always scored against the exact wording; Phase 13 (attachments, Lesson Studio, Follow Along) is untouched.
- **Youth and families (Phase 10, done):** child profiles are records, not logins; their guardian-recorded practice lives in `youth.practice_*` and moves into the youth's own memory history at activation. Challenges stay adult-only (no family challenge type yet). Phase 11 can build on `youth.guardian_can`, `youth.is_leader`, and the policy settings; Phase 12 phone push reuses the generic `youth` notification text; Phase 13 (attachments, Lesson Studio, Follow Along) is untouched.
- **Phone push (Phase 12):** teaching and gallery notices use the existing web push and email; native phone push is Phase 12.
