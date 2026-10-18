# The Gathering

The church community app for The Gathering: a mobile-first, installable web app for members and administrators.

**Status:** Phase 1 (foundation, branding, authentication, and administration). See [docs/build-status.md](docs/build-status.md).

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
| `npm run brand:assets` | Regenerate web/PWA icons from `assets/brand/source` |
| `npm run admin:bootstrap -- <email>` | One-time appointment of the first super administrator |

## Documentation

- [docs/setup.md](docs/setup.md): environment variables, Supabase, Resend, Vercel, first admin
- [docs/architecture.md](docs/architecture.md): structure, authorization model, data, security decisions
- [docs/roadmap.md](docs/roadmap.md): the twelve phases
- [docs/build-status.md](docs/build-status.md): what is done and verified, and what still needs external setup
