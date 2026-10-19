# Roadmap

Each phase is built, verified, and reviewed before the next begins.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Foundation, branding, authentication, and administration | **Built**, awaiting external configuration and review |
| 2 | Membership and directory | **Built** (PR #5, awaiting review) |
| 3 | Giving and contributions | **Built**, Stripe test mode (PR #6, awaiting review) |
| 4 | Events and calendars | **Built** (PR into `main`, stacked on #5 and #6, awaiting review) |
| 5 | Community, groups, messaging, and notifications | Planned |
| 6 | Prayer and care | Planned |
| 7 | Teaching and media | Planned |
| 8 | Bible reading and journals | Planned |
| 9 | Memory verses | Planned |
| 10 | Youth and families | Planned |
| 11 | Ministry tools and connected experience | Planned |
| 12 | Launch readiness | Planned |

## Hooks already in place for later phases

- **Navigation:** Community, Prayer, Media, and Grow are listed as "Coming later" (not links) in `src/lib/navigation.ts`. A module becomes a link by switching its `status` to `available` and adding its route.
- **Roles:** `finance_admin`, `group_leader`, and `youth_leader` exist with reserved capabilities (`finance.*`, `groups.lead`, `youth.lead`) marked unavailable and not assignable. A later phase enables them by migration.
- **Profiles:** directory, household, and advanced profile fields were added in Phase 2 (see build-status.md).
- **Groups (Phase 5):** events already support a `group` audience in the schema, blocked by the `series_groups_unavailable` constraint, and `events.group_member()` is the single integration point. Phase 5 replaces that function with real group membership, drops the constraint, and adds the group selector to the event form.
