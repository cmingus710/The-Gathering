# Architecture

## Overview

```
Browser (PWA) ──► Next.js on Vercel ──► Supabase (Auth · Postgres + RLS · Storage)
                     │                         ▲
                     └── Resend (app emails)    └── Supabase Auth sends auth emails via Resend SMTP
```

- **Rendering:** everything is server-rendered per request (`dynamic = "force-dynamic"` in the root layout; Cache Components off). Private pages are never prerendered, shared-cached, or prefetched across sessions.
- **Data access:** server components and Server Actions use a per-request Supabase client carrying the member's session (`src/lib/supabase/server.ts`). Row-level security applies to every query.
- **No service credentials at runtime:** the app reads only the publishable key. The secret key is used only by the operator script `scripts/bootstrap-super-admin.mjs`.

## Source layout

```
src/
  app/
    (public)/        welcome page, install guidance
    (auth)/          sign-in, sign-up, forgot/reset password, check-email (+ actions.ts)
    (member)/        home, announcements, profile: approved members only
    admin/           dashboard, members, settings, announcements, audit
    auth/confirm     email-link landing (token_hash or PKCE code)
    auth/sign-out    POST-only sign-out with Clear-Site-Data
    account-status   pending / suspended messaging
    manifest.ts, favicon.ico, icon.png, apple-icon.png
  components/        ui/ (buttons, fields, alerts, badges…), layout/, brand/, announcements/, pwa/
  lib/               auth/, announcements/, settings/, email/, supabase/, theme/, time, uploads, navigation
  proxy.ts           session refresh + signed-out redirect (convenience only)
supabase/
  migrations/        versioned schema (source of truth)
  templates/         auth email templates
  seed.sql           synthetic local-only data
  tests/             Supabase shim for integration tests
tests/db             RLS / authorization integration tests
tests/e2e            Playwright browser tests
assets/brand/source  supplied artwork (never modified)
public/brand, public/icons   generated web/PWA assets
```

## Authorization model

Two independent axes:

1. **Membership status** (`profiles.membership_status`): `pending` → `approved` ↔ `suspended`. Only approved members reach member content.
2. **Capabilities** granted through **roles** (`roles`, `role_capabilities`, `user_roles`). Capabilities apply only while the holder is approved.

| Role | Capabilities (Phase 1) | Assignable |
| --- | --- | --- |
| Super administrator | all (implicit) | yes |
| Membership administrator | `members.view`, `members.manage` | yes |
| Content editor | `announcements.manage` | yes |
| Finance administrator | `finance.view`, `finance.manage` (reserved) | Phase 3 |
| Group leader | `groups.lead` (reserved) | Phase 5 |
| Youth leader | `youth.lead` (reserved) | Phase 10 |

`settings.manage`, `roles.manage`, and `audit.view` belong to super administrators only.

### Enforcement layers (deny by default)

1. **Database:** RLS on every table. Column-level grants mean members can update only `full_name`, `preferred_name`, and `phone`. `user_roles`, `audit_log`, and membership status have no client write path. Privileged changes go through `SECURITY DEFINER` functions (`admin_set_membership_status`, `admin_grant_role`, `admin_revoke_role`) that re-check `has_capability()` and write audit entries.
2. **Server:** layouts and every Server Action call `requireApprovedMember()` / `requireCapability()` (`src/lib/auth/viewer.ts`). The user is verified with `auth.getUser()` on each request.
3. **Proxy:** sends signed-out visitors to sign-in and marks protected responses `private, no-store`. It's not relied on for authorization.

### Safeguards

- Sign-up metadata is ignored except the display name, so a forged role or status has no effect.
- Members cannot change their own status. Membership admins cannot change a super admin's status.
- **Last super administrator:** triggers on `user_roles` and `profiles` (serialized with an advisory lock) block removing, suspending, or deleting the last active super admin.
- **Initial super administrator:** `bootstrap_super_admin(email)` is executable only by the service role, requires a verified email, and refuses to run once a super admin has ever been appointed (`system_state`).
- **Audit log:** status changes, role changes, settings changes (field names only), and announcement lifecycle (state and field names, never content).

## Announcements

- Stored status is `draft | scheduled | published | archived`, plus `publish_at` / `expires_at`.
- **Scheduling uses the database clock inside RLS:** a row is visible when `status in (scheduled, published) and publish_at <= now() and (expires_at is null or expires_at > now())`. No cron job is needed, and nothing depends on an admin reopening the app.
- Audience: `public` (anyone, including signed-out visitors) or `members` (approved members). Managers see everything.
- Bodies are a Markdown subset rendered by `src/lib/announcements/markdown.ts`: raw HTML is escaped, only http(s)/mailto/tel/relative links are kept, and inline images are dropped. The same renderer powers the admin preview.
- Images live in the private `announcement-images` bucket. Storage RLS lets a caller read an image only if they can read an announcement referencing it, and pages use one-hour signed URLs.
- Admins enter times in the church time zone (default America/Chicago). `src/lib/time.ts` converts to UTC, including the DST gap and repeated hour.

## Church settings and branding

- `church_settings` is a single row that anyone can read and only `settings.manage` can update. All contact, address, schedule, and social fields start empty.
- Logo and icon default to the approved bundled artwork (`logo_path` / `icon_path` null). Replacements are validated server-side by file signature (PNG/JPEG/WebP only, no SVG), size, and dimensions, stored in the public `branding` bucket, and can be reverted.
- The palette lives only in design tokens (`src/app/globals.css`, mirrored in `src/lib/theme/tokens.ts` with contrast tests). There is no theme editor.

## Design system

| Token | Value | Use |
| --- | --- | --- |
| brand-gold | #AD8C53 | Decorative accents only (2.9:1 on ivory) |
| brand-charcoal | #363430 | Selected chips, overlays |
| background | #F7F4ED | Page background |
| surface / surface-muted | #FFFFFF / #EAE3D5 | Cards / selected nav, chips |
| primary (Deep Gold) | #80642F | Buttons (white text 5.55:1), links, focus ring |
| text / text-secondary | #363430 / #716B61 | Body / secondary (≥ 4.8:1 on ivory and white) |
| success / danger | #52664D / #A14538 | Status, always paired with an icon and text |

Fonts: Source Serif 4 (headings) and Source Sans 3 (interface), self-hosted via Fontsource. Touch targets are at least 44 px, focus outlines are visible, motion respects `prefers-reduced-motion`, and errors are linked through `aria-describedby` with focus moved to the form message.

## PWA and caching

- `manifest.webmanifest`: name "The Gathering", standalone, ivory theme and background, `any` and `maskable` icons at 192 and 512.
- Icons are generated from the supplied icon artwork by `scripts/generate-brand-assets.mjs`. They're square and not pre-rounded, and the maskable versions are verified to stay inside the 80% safe zone.
- `public/sw.js` caches only `/_next/static/*`, `/brand/*`, `/icons/*`, and `offline.html`. Navigations are network-only, with a generic offline page, and nothing private is ever stored.
- Sign-out is a POST that clears Supabase cookies and sends `Clear-Site-Data: "cache"`.
