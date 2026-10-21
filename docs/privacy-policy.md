# Privacy policy: maintenance notes

The public policy is `src/app/(public)/privacy/page.tsx`, served at **https://www.gathering.church/privacy**. It is linked from the sign-in panel footer, the public site footer, and Profile → Security. Google's consent screen (Branding → Privacy policy link) should point at that URL.

**It is a draft for the church to review.** It describes what the app does; it isn't legal advice. Before relying on it, have the church's leadership (and, if available, legal counsel) review it, especially the promises in "Changes to this policy" and "Your choices", and any obligations in your state or country.

## Where each statement comes from

Update the page whenever one of these changes, and change `LAST_UPDATED` at the top of the page.

| Section | Source of truth |
| --- | --- |
| What we collect | `supabase/migrations/20261018000100_identity_and_capabilities.sql`, `20261019000100_member_profiles.sql`, `20261020000100_giving_schema.sql`, `20261021000100_events_schema.sql`, `20261030000100_problem_reports.sql`; `docs/directory-privacy-guide.md`; `src/lib/media/server.ts` (`clientKey`) and `src/lib/giving/checkout.ts` (`ipKey`) for hashed network addresses |
| Signing in with Google or Apple | `docs/social-login-setup.md`; only the display name is copied from provider data (`handle_new_auth_user`) |
| No analytics or advertising | No analytics, ads, or error-tracking package in `package.json`; `docs/journal-privacy.md` |
| Who can see your information | `docs/directory-privacy-guide.md`, `docs/journal-privacy.md`, `docs/memory-privacy.md`, `docs/messaging-privacy-guide.md`, `docs/prayer-privacy-guide.md`, `docs/finance-guide.md`, `docs/administrator-guide.md` |
| Service providers | `docs/deployment.md`, `docs/setup.md`, `docs/giving-setup.md`, `docs/notifications.md`, `src/lib/media/embeds.ts`, `src/components/bible/fums.tsx` |
| Cookies and storage | `src/lib/supabase/*`, `src/app/auth/sign-out/route.ts`, `src/lib/theme/preference.ts`, `src/components/media/player-provider.tsx`, `src/lib/media/workbook.ts`, `public/sw.js` |
| How long we keep information | `docs/notifications.md` (messages 730 days, read notifications 180 days, deliveries 60/14 days, rate limits 2 days), `docs/prayer-retention.md`, `docs/youth-retention.md`, `docs/operations-recovery.md` (backups) |
| Your choices | Account deletion isn't self-service: an administrator deletes the user in Supabase (`docs/prayer-retention.md`); gifts keep the record with the account reference removed |
| Children and youth | `docs/youth-family-admin-guide.md`, `docs/youth-permission-matrix.md`, `docs/media-consent-workflow.md` |
| Contact us | Admin → Church settings (contact email, phone, address). With none set, the page asks people to speak to a pastor or use Report a problem |

## Known gaps to keep in mind

- Members can't delete their whole account themselves; requests go to the office (the policy says so).
- The guest-checkout rate-limit table (`giving.rate_limits`, hashed keys only) has no automatic cleanup.
- Problem reports and the administrative audit log have no automatic retention period.
