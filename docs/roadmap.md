# Roadmap

Each phase is built, verified, and reviewed before the next begins.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Foundation, branding, authentication, and administration | **Merged** (device checks outstanding) |
| 2 | Membership and directory | **Built** (PR #5, awaiting review) |
| 3 | Giving and contributions | **Built**, Stripe test mode (PR #6, awaiting review) |
| 4 | Events and calendars | **Built** (PR into `main`, stacked on #5 and #6, awaiting review) |
| 5 | Community, groups, messaging, and notifications | **Built** (draft PR #8, stacked on #7); hosted database applied; walkthrough pending |
| 6 | Prayer and care | **Built** (PR into `main`, stacked on the home redesign and Phases 2–5); hosted database applied; walkthrough pending |
| 7 | Teaching and media | **Built** (PR into `main`, stacked on Phase 6); hosted database applied; walkthrough pending |
| 8 | Bible reading and journals | **Built** (PR into `main`, stacked on Phase 7); hosted database scripts ready, not yet applied; walkthrough pending |
| 9 | Memory verses | Planned |
| 10 | Youth and families | Planned |
| 11 | Ministry tools and connected experience | Planned |
| 12 | Launch readiness | Planned |

## Hooks already in place for later phases

- **Navigation:** later modules can be listed as "Coming later" (not links) in `src/lib/navigation.ts`. A module becomes a link by switching its `status` to `available` and adding its route.
- **Roles:** `youth_leader` (`youth.lead`) stays reserved for Phase 10. `group_leader` stays reserved and unused: Phase 5 assigns group leadership per group instead.
- **Profiles:** directory, household, and advanced profile fields were added in Phase 2 (see build-status.md).
- **Groups (Phase 5, done):** `events.group_member()` now checks real group membership, the `series_groups_unavailable` constraint is replaced, and the event form has a group selector.
- **Bible (Phase 8, done):** the Bible tile is live with the supplied art. Canonical books use USFM codes (`bible.books`, `src/lib/bible/books.ts`, names identical to Phase 7's scripture references).
- **Memory verses (Phase 9):** read verses through `bible_passage(translation, book, chapter, verse…)`; references are translation id + book code + chapter + verse, so no Bible data needs copying. Phase 13 (attachments, Lesson Studio, Follow Along) is untouched.
- **Phone push (Phase 12):** teaching and gallery notices use the existing web push and email; native phone push is Phase 12.
