# The Gathering

The church community app for The Gathering: a mobile-first, installable web app for members and administrators.

**Status:** Phases 1–9 in production at `www.gathering.church` (giving in Stripe test mode); Phases 10–12 merged; Phase 13 (campaigns, Kindle/Audible reading, settings, bell panel, contact actions, forum media, lesson workbook) in review. See [docs/build-status.md](docs/build-status.md) and [docs/phase-11-release-readiness.md](docs/phase-11-release-readiness.md).

## Stack

- Next.js 16 (App Router, TypeScript, Server Actions), Tailwind CSS v4
- Supabase: Auth, Postgres with row-level security, Storage
- Resend: transactional email (auth emails through Supabase SMTP, plus app notifications)
- Vercel hosting · Stripe arrives in Phase 3 (not used yet)

## What works in Phase 1

- Branded public welcome page with gathering times, contact details, and public announcements (each shows an empty state until configured)
- Registration → email verification → pending approval → approved member access; sign-in, password reset, sign-out
- Protected member home, announcements, and profile; phone tab bar with a More menu, desktop sidebar
- Admin dashboard, member approval, suspension, and reinstatement, role assignment, church settings with logo/icon replacement, announcements (draft, scheduled, published, archived; pinned; public or members-only; expiry), audit log
- Capability-based authorization enforced in the database (RLS + checked functions) and on the server
- Installable PWA: manifest, any/maskable icons, Apple touch icon, favicon, safe service worker

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in Supabase values
npm run dev                    # http://localhost:3000
```

Full setup (Supabase, Resend, Vercel, first super administrator): [docs/setup.md](docs/setup.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route types + `tsc --noEmit` |
| `npm test` | Unit tests; also runs the RLS integration tests when `TEST_DATABASE_URL` is set |
| `npm run test:db` | Database authorization tests only (needs `TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright browser tests (run `npm run build` first) |
| `npx playwright test -c playwright.local.config.ts` | Signed-in walkthrough against a local Supabase stack (see the readiness doc) |
| `npm run brand:assets` | Regenerate web/PWA icons from `assets/brand/source` |
| `npm run admin:bootstrap -- <email>` | One-time appointment of the first super administrator |

## Documentation

- [docs/setup.md](docs/setup.md): environment variables, Supabase, Resend, Vercel, first admin
- [docs/architecture.md](docs/architecture.md): structure, authorization model, data, security decisions
- [docs/links.md](docs/links.md): adding, editing, and showing hyperlinks in announcements, devotionals, lessons, Community, and Prayer; the link policy and server checks
- [docs/community-mentions.md](docs/community-mentions.md): @mentions of people and groups in Community and Prayer: group controls for leaders, member notification settings, privacy rules, verification, release steps
- [docs/media-cropping.md](docs/media-cropping.md): photo-picker cancellation, the shared image cropper, per-use cover framing, phone image handling, verification, release steps
- [docs/navigation-performance.md](docs/navigation-performance.md): page-navigation latency on phones: measurements, fixes, remaining bottlenecks
- [docs/roadmap.md](docs/roadmap.md): the twelve phases
- [docs/build-status.md](docs/build-status.md): what is done and verified, and what still needs external setup
- [docs/phase-13/README.md](docs/phase-13/README.md): Phase 13 audit, status, verification, release steps, and limits
- [docs/phase-12-launch.md](docs/phase-12-launch.md): release candidate, pilot procedure, release and rollback steps, issue log, device checks
- [docs/phase-11-release-readiness.md](docs/phase-11-release-readiness.md): feature status, release blockers, and validation results
- [docs/administrator-guide.md](docs/administrator-guide.md): everyday administration, with links to the detailed guides
- [docs/membership-approval-alerts.md](docs/membership-approval-alerts.md): emailing designated administrators when a new member is waiting for approval
- [docs/pilot-launch-runbook.md](docs/pilot-launch-runbook.md): adult pilot, release, and rollback
- [docs/operations-recovery.md](docs/operations-recovery.md): scheduler, backups, recovery, and who investigates
- [docs/design-system.md](docs/design-system.md): tokens, light/dark themes, the custom icon set, navigation, and the home layout
