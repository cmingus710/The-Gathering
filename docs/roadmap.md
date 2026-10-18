# Roadmap

Each phase is built, verified, and reviewed before the next begins.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Foundation, branding, authentication, and administration | **Built**, awaiting external configuration and review |
| 2 | Membership and directory | Planned |
| 3 | Giving and contributions | Planned |
| 4 | Events and calendars | Planned |
| 5 | Community, groups, messaging, and notifications | Planned |
| 6 | Prayer and care | Planned |
| 7 | Teaching and media | Planned |
| 8 | Bible reading and journals | Planned |
| 9 | Memory verses | Planned |
| 10 | Youth and families | Planned |
| 11 | Ministry tools and connected experience | Planned |
| 12 | Launch readiness | Planned |

## Hooks already in place for later phases

- **Navigation:** Directory, Give, Events, Community, Prayer, Media, and Grow are listed as "Coming later" (not links) in `src/lib/navigation.ts`. A module becomes a link by switching its `status` to `available` and adding its route.
- **Roles:** `finance_admin`, `group_leader`, and `youth_leader` exist with reserved capabilities (`finance.*`, `groups.lead`, `youth.lead`) marked unavailable and not assignable. A later phase enables them by migration.
- **Profiles:** directory, household, and advanced profile fields are deliberately deferred to Phase 2.
- **Stripe:** no payment code or keys exist yet. Phase 3 will add them behind the `finance.*` capabilities, which content editors and membership admins cannot hold.
