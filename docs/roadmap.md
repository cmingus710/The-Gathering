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
| 7 | Teaching and media | **Built** (PR into `main`, stacked on Phase 6); hosted database scripts ready (owner to apply); walkthrough pending |
| 8 | Bible reading and journals | Planned |
| 9 | Memory verses | Planned |
| 10 | Youth and families | Planned |
| 11 | Ministry tools and connected experience | Planned |
| 12 | Launch readiness | Planned |

## Hooks already in place for later phases

- **Navigation:** Grow is listed as "Coming later" (not links) in `src/lib/navigation.ts`. A module becomes a link by switching its `status` to `available` and adding its route.
- **Roles:** `youth_leader` (`youth.lead`) stays reserved for Phase 10. `group_leader` stays reserved and unused: Phase 5 assigns group leadership per group instead.
- **Profiles:** directory, household, and advanced profile fields were added in Phase 2 (see build-status.md).
- **Groups (Phase 5, done):** `events.group_member()` now checks real group membership, the `series_groups_unavailable` constraint is replaced, and the event form has a group selector.
- **Bible (Phase 8):** the Bible tile stays "Coming later"; Phase 7 didn't reuse its icon. Scripture references on teaching content are stored normalized (`src/lib/media/scripture.ts`) so Phase 8 can link them to reading plans.
- **Phone push (Phase 12):** teaching and gallery notices use the existing web push and email; native phone push is Phase 12.
