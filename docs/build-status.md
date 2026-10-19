# Build status: Phase 1

Last updated: 2026-10-18 · Branch `claude/sweet-lamport-fsrqcc`

## Summary

Phase 1 code is complete, and the database schema is live in Supabase project `ymuiutwdnhxdqsetnwkt`. Live sign-up, email, and Vercel checks still need the external configuration in [setup.md](setup.md).

## Verified here

| Check | Result |
| --- | --- |
| `npm run lint` (ESLint, zero warnings) | Pass |
| `npm run typecheck` | Pass |
| `npm run build` (production; all routes dynamic) | Pass |
| Unit tests (palette contrast, time zones/DST, Markdown XSS, schemas, uploads, redirects, error mapping) | 84 pass |
| Database authorization tests: real migrations on PostgreSQL 16 with a Supabase shim | 41 pass |
| Playwright browser tests: desktop 1280 px and Pixel 7, built app, no Supabase | 32 pass |
| Schema applied to Supabase project; tables, policies, buckets, auth triggers inspected | Done |
| Hosted migration history equals the five repository migrations; fresh-from-files schema matches hosted in all 17 fingerprint categories | Pass |
| Supabase security advisor | Reviewed (see notes) |

### What the database tests prove

- **Registration:** creates a pending profile automatically. Forged `role`/`membership_status` sign-up metadata is ignored.
- **Members:** can edit only their name, preferred name, and phone. They can't change their status, email, roles, another profile, or the audit log.
- **Capabilities:** content editors get only `announcements.manage` (no membership or finance access). Membership admins can't assign roles or touch super admins. Pending and suspended accounts hold no capabilities, even if they have roles.
- **Status changes:** approve, suspend, and reinstate work with an audit trail, and nobody can change their own status.
- **Super administrators:** the bootstrap works once, needs a verified email, and isn't callable by clients. The last active super admin can't be revoked, suspended, or deleted, and a handover works.
- **Settings:** publicly readable, persisted only by settings managers, invalid time zones rejected, audit records field names only.
- **Announcements:**
  - Anonymous, pending, and suspended viewers see only live public announcements. Approved members also see members-only ones.
  - Drafts, future-scheduled, expired, and archived announcements are hidden from readers.
  - A scheduled announcement becomes visible at its time with no job.
  - Authorship can't be forged, announcements can't be deleted from the app, and the audit never records content.
- **Storage:** announcement images follow announcement visibility. Branding uploads need `settings.manage`. Both buckets accept raster types only.

### What the browser tests prove

- Welcome page renders the approved logo at its natural aspect ratio, with no horizontal scroll on phone or desktop.
- Unconfigured contact details and gathering times show empty states.
- Manifest fields and every icon URL (192/512, any and maskable), `favicon.ico`, `icon.png`, `apple-icon.png`, `sw.js`, and `offline.html` are served. The Apple web-app meta tags, `theme-color`, and manifest link are present.
- `/home`, `/profile`, `/announcements`, `/admin`, `/admin/members`, and `/admin/settings` redirect signed-out visitors to sign-in.
- Form errors are announced, linked by `aria-describedby`, and marked `aria-invalid`. Password rules are enforced and non-secret values are preserved.
- With no auth service, sign-in says so instead of pretending to succeed.
- Skip link and focus outline work from the keyboard.
- Sign-out is POST-only and sends `Clear-Site-Data`.
- Install guidance is shown.

## Hosted preview (Vercel, verified 2026-10-18)

Preview: `https://the-gathering-git-phase-1-deployment-ver-56f120-paint-by-number.vercel.app` (Vercel Authentication required to view)

| Check | Result |
| --- | --- |
| Preview build with Supabase env vars | Pass (`dpl_FQtcZi3HfPN2tqukbFsNxvJXcUbE`) |
| Welcome page reads church settings from the hosted database (no "unavailable" notice) | Pass |
| Signed-out `/admin/members` → `/sign-in?next=/admin/members` | Pass |
| Protected responses `private, no-store`; security headers present | Pass |
| Production builds paused (merge to `main` canceled by Ignored Build Step) | Pass |

## Live authentication and email (hosted preview, 2026-10-18)

Preview: `https://the-gathering-git-phase-1-auth-email-setup-paint-by-number.vercel.app`. Supabase auth uses Resend SMTP from `hello@gathering.church`.

| Check | Result |
| --- | --- |
| Registration creates a pending profile with the supplied name; no roles granted | Pass |
| Verification email delivered through Resend (Resend log: delivered) | Pass |
| Verification link (token-hash template) confirms the address and lands on the pending page | Pass |
| Pending account sent to the status page from `/home`, `/announcements`, `/admin` | Pass |
| Initial super administrator appointed (`bootstrap_super_admin`); audit entry recorded | Pass |
| Second bootstrap attempt refused ("already been appointed") | Pass |
| Sign-out ends the session (one active session after sign-in; Back does not reveal signed-in pages) | Pass |
| Super admin reaches Home and the admin dashboard | Pass |
| Church settings persist, show on the public welcome page, and are audited by field name only | Pass |
| Second account: verification email delivered; pending until approved | Pass |
| Admin approval (`pending → approved`, audited) sends the app's "Welcome to The Gathering" email via Resend | Pass (delivered) |
| Approved member without roles is denied `/admin` | Pass |
| Public vs members-only announcements: signed-out visitors see public only; members see both | Pass |
| Scheduled announcement appears at its publish time with no admin action | Pass |
| Expiring announcement disappears at its expiry time (checked against the database clock) | Pass |
| Announcement image upload saved and audited | Pass |
| Password reset email delivered; reset link sets a new password; old password refused | Pass |
| Suspension blocks member areas immediately; reinstatement restores access (both audited) | Pass |
| Admin cannot change their own membership status | Pass |
| Archive hides announcements; audit records status changes only, never content | Pass |

Test accounts kept: `robtwebb@me.com` (initial super administrator) and `breaktwomusic@gmail.com` (approved member, no roles). All TEST announcements are archived, and the church settings test values were cleared.

## Still not verified (manual or device testing)

- [ ] Role assignment through the UI (for example, granting content editor); the database rules are covered by the authorization tests
- [ ] Logo/icon replacement upload in church settings (announcement image upload was verified)
- [ ] Installed-app appearance on a physical iPhone (Add to Home Screen) and Android device
- [ ] Screen reader pass (VoiceOver and TalkBack)
- [ ] Production: environment variables, unpausing builds, and a production deploy (deliberately not done; see deployment.md)

## Known limitations and notes

- **Brand sources:** the logo and icon reached this environment as WebP renditions (1701×2000 and 2000×1860) of the supplied PNGs. The Illustrator file (`Gathering Icon.ai`) was not available, so no SVG was produced and no vector was fabricated. All web and PWA assets are raster, generated from these sources.
  - The supplied icon had transparent padding and a tiny isolated 2-pixel export speck in the far corner. Display copies remove both; the artwork itself is untouched.
  - The supplied artwork touches its canvas edges, so the circle's top may already have been tightly cropped at export. If original PNG/SVG exports are added to `assets/brand/source/`, rerun `npm run brand:assets`.
- **Small sizes:** at 16 px the favicon is recognizable as the mark but its detail is lost; 32 px and up read clearly.
- **Home Screen icons:** an uploaded replacement icon is used in app headers immediately. Manifest and Home Screen icons stay on the approved artwork until regenerated and redeployed.
- **Supabase advisor warnings (intentional):**
  - "Signed-in users can execute SECURITY DEFINER functions" covers the helpers and admin functions. Each re-checks the caller's capability internally and is covered by tests.
  - "RLS enabled, no policy" on `system_state` is deliberate: there is no client access.
- **Migration history:** the Supabase project's migration history differs from the repo files (see setup.md §2).
- **Not in Phase 1:** directory, households, and advanced profile fields (Phase 2); Stripe (Phase 3); realtime features.
