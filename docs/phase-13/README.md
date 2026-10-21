# Phase 13: requested features and experience improvements

Branch `claude/inspiring-sagan-jlwim7`, based on `main` at `25b7087` (Phase 12 merged). **Not merged, not deployed, no hosted migration applied, live giving not enabled, nobody notified.**

Detailed pages: [campaigns](campaigns.md) · [reading: Kindle and Audible](reading-kindle-audible.md) · [settings, phone navigation, notifications, contact links](settings-navigation-notifications.md) · [forum attachments](forum-attachments.md) · [lesson builder and workbook](lessons-workbook.md) · [member guide](member-guide.md).

## 1. Audit before building (2026-10-21)

No open pull requests. What already existed:

| # | Feature | Before Phase 13 | Category |
| --- | --- | --- | --- |
| 1 | Fundraising campaigns | Funds and per-fund totals only; no campaign, goal, or meter | Missing |
| 2 | Kindle and Audible | Books (`media.items` kind `book`) with author, cover, description, Audible link, "current" flag, discussion thread, bookmarks; reading assignments with dates (the chapter schedule). No Kindle link, no reading dates on the book, no private progress, no book notes | Implemented, needed extension |
| 3 | Settings and appearance | Light/Dark/System already worked (cookie, server-rendered, no flash). Sidebar footer had avatar, theme, sign-out; profile page had most links. No settings page, no read-only roles view, no sign-in methods. Bug: choosing System pinned the browser bar colour | Implemented, needed correction and a hub |
| 4 | iPhone bottom navigation | Already a full-width bar at `bottom: 0` with safe-area padding inside (Phase 11). No transformed ancestor, `viewport-fit=cover` set. Remaining risks: the iOS 26.0 fixed-element drift bug, rubber-band overscroll, keyboard covering fields | Implemented, needed verification and hardening |
| 5 | Notification bell | A link to the full page with a live unread count | Missing (dropdown) |
| 6 | Clickable contact info | Phone `tel:` and email `mailto:` links on directory profiles; no SMS, no map/directions; `+44 (0)…` dialled wrongly; admin phone and church address not actionable | Implemented, needed correction |
| 7 | Forum photo/video | Text only ("No images or attachments yet."). Reusable: private buckets, upload client, magic-byte sniffing, `sharp` re-encode with metadata stripped, gallery upload flow | Missing |
| 8 | Lesson builder and workbook | A lesson was one Markdown item with `notes`, which **were returned to every viewer**. No blocks, no workbook, no answers | Missing; existing notes privacy needed a decision |

## 2. Final implementation status

| # | Feature | Status | Migration |
| --- | --- | --- | --- |
| 1 | Campaigns with progress meter | Done | `20261031000100` |
| 2 | Reading: Kindle and Audible | Done (links only; see limits) | `20261031000400` |
| 3 | Settings and appearance | Done | none |
| 4 | Phone bottom navigation | Hardened and verified in Chromium; Safari and device checks pending | none |
| 5 | Notification bell panel | Done | none |
| 6 | Clickable contact information | Done | none |
| 7 | Forum photos and videos | Done | `20261031000200` |
| 8 | Lesson builder and private workbook | Done (no printable export) | `20261031000300` |

**Existing lesson notes:** they keep their meaning (shown to members, and to visitors on public lessons), now labelled "Notes shown to members" in the editor. Teacher-only content lives in the new block model (a teacher note on any block, or a whole block marked teacher-only) and is never selected by any member or anonymous function. Teachers who already wrote private material into the old notes field need to move it; nothing was moved automatically.

## 3. Verification

| Kind | What ran | Result |
| --- | --- | --- |
| Local automated | `npm run lint` | Clean |
| | `npm run typecheck` | Clean |
| | `npm run build` (Next.js 16.4.2) | Succeeds |
| | Vitest, unit + database (PostgreSQL 16.15, every migration applied) | **887/887**, 73 files (Phase 12: 793) |
| | New database suites: `campaigns` 21, `community-attachments` 15, `lesson-workbooks` 18, `books` 7; plus a bell ownership test in `community` | Pass |
| | Playwright signed-out suite (`tests/e2e`) | 322/324: the 2 others only apply when Supabase isn't configured, and this build pointed at a local stand-in |
| | Hosted-apply scripts rehearsed on a Phase-12-stage copy, in order and in reverse | Apply; reruns refused; fingerprints identical to a fresh build |
| Local browser journeys | Chromium (Playwright), signed in, real sign-in form; phone 320×640 and 390×844, tablet 820×1180, desktop 1280×800; light and dark | **71/71 checks** (see below) |
| Hosted checks | None | Not run: no preview deployment of this branch yet |
| Real provider behaviour | Stripe, Amazon/Kindle, Audible, Supabase Storage uploads, web push | Not verified |
| Physical devices | iPhone Safari, installed PWA, Android | Not done |

**How the signed-in browser journeys ran.** Docker isn't available here and GitHub downloads are blocked, so the usual `supabase start` stack couldn't run. A small local stand-in for the Auth/REST/Storage endpoints the app calls ran every query as the real `authenticated`/`anon` roles with JWT claims against PostgreSQL built from all 60 migrations. RLS, grants, and function checks were therefore the real ones. It doesn't reproduce Supabase Storage (no file uploads), Realtime, or GoTrue edge cases. It's a session-only aid and isn't committed.

Browser checks included:
- **Dock:** it reaches the viewport bottom at every size, its background continues below the bar, it steps aside while a text field is focused and comes back afterwards, and it doesn't appear on desktop.
- **Bell:**
  - Opening it leaves the unread count unchanged, and the panel payload carries no URLs.
  - `aria-expanded` is correct; Escape closes it and returns focus; an outside click closes it.
  - The panel stays inside 320 px and 390 px screens.
- **Settings:**
  - The avatar opens Settings, and More lists it.
  - Dark applies immediately and persists across a reload (server-rendered).
  - System restores both `theme-color` metas and follows a live colour-scheme change.
  - The roles section has no controls.
  - On desktop the account menu sits at the bottom left, stays put while the nav scrolls, and closes with Escape.
- **Contact actions:**
  - `+44 (0)20 7946 0958` dials `tel:+442079460958` and has an `sms:` link, and the stored value is shown as typed.
  - Email is a `mailto:` link; maps and directions links are HTTPS and encoded (`#` → `%23`).
  - Unshared fields are absent from page source.
  - The church address on the welcome page has a directions link.
- **Campaigns:**
  - The meter reads "$8,750 raised of $15,000 goal".
  - Other donors' names, individual amounts, and the check number are absent from the page.
  - A members-only campaign is hidden when signed out.
  - The finance detail shows totals by source.
- **Book:**
  - Kindle and Audible links are HTTPS with no iframes, and the access limitation is explained.
  - Private progress persists and shows on the reading list.
- **Workbook:**
  - Teacher-only text is absent from the lesson, the workbook, and the teacher preview HTML, while the builder shows it, clearly marked.
  - Autosave shows Saved, and an answer resumes after reload.
  - With the network blocked, the text is kept and "Couldn't save" shows; it saves after the network returns.
  - A stale second tab gets HTTP 409 and Keep mine / Use the saved one / Keep both, while the other tab's text stays saved.
  - The workbook appears under My workbooks.
- **Forum:** the composer offers photos/video with an explicit type list.

### Screenshots

Local Chromium, synthetic data, captured 2026-10-21 (in `screenshots/`):

| Area | Files |
| --- | --- |
| Phone dock and bell | [dock](screenshots/phone-dock.png) · [bell panel](screenshots/phone-bell-panel.png) · [bell at 320 px](screenshots/phone-320-bell-panel.png) · [tablet](screenshots/tablet-bell-panel.png) |
| Settings | [phone](screenshots/phone-settings.png) · [dark](screenshots/phone-settings-dark.png) · [More menu](screenshots/phone-more-menu.png) · [desktop account menu](screenshots/desktop-account-menu.png) |
| Contact actions | [directory profile](screenshots/phone-contact-actions.png) |
| Campaigns | [member](screenshots/phone-campaign.png) · [dark](screenshots/phone-campaign-dark.png) · [finance detail](screenshots/desktop-finance-campaign.png) |
| Reading | [book](screenshots/phone-book.png) · [dark](screenshots/phone-book-dark.png) |
| Workbook | [workbook](screenshots/phone-workbook.png) · [offline](screenshots/phone-workbook-offline.png) · [conflict](screenshots/phone-workbook-conflict.png) · [builder](screenshots/desktop-lesson-builder.png) · [teacher preview](screenshots/desktop-lesson-preview.png) |
| Forum | [composer](screenshots/phone-forum-composer.png) |

## 4. Release boundaries and setup

Nothing below has been done; each step needs the owner's go-ahead.

1. **Hosted migrations**, in the SQL editor, after release approval and a fresh backup. The four Phase 13 scripts need the Phase 12 step (`2026-10-30-apply-problem-reports.sql`) first; then any order:
   - `supabase/manual/2026-10-31-apply-giving-campaigns.sql`
   - `supabase/manual/2026-10-31-apply-community-attachments.sql`
   - `supabase/manual/2026-10-31-apply-lesson-workbooks.sql`
   - `supabase/manual/2026-10-31-apply-books-reading.sql`

   Each prints "Nothing was changed: …" and stops if it's out of order or already applied. The deployed app keeps working before and after each one. **Apply them before deploying this branch.** If the code goes out first, every page still loads (checked against a pre-Phase-13 database). Workbook pages say they couldn't be loaded, campaign and book extras are absent, and post deletion falls back to the existing functions.
2. **Storage:** one new private bucket (`campaign-images`, WebP, 2 MB), created by the campaigns script. Forum files use the existing `media-uploads` (originals, deleted after processing) and `media` (`community/…`) buckets. Nothing is deleted automatically: abandoned forum uploads and removed attachments are listed at **Administration → Moderation → Attachment cleanup** for a moderator to delete.
3. **No new environment variables or secrets.** Stripe stays in test mode; live keys are still refused.
4. **Youth:** no youth policy changed. Workbooks, campaigns, forum attachments, and book progress need an approved adult account. Youth still only see public lessons, with no workbook.

## 5. Known limits and follow-ups

- **Kindle and Audible:** links out only. There's no supported full-book embed. Members need their own access, and sign-in can't happen inside the app. See [reading-kindle-audible.md](reading-kindle-audible.md#provider-capabilities-and-limits).
- **Campaigns:**
  - With a single donor, the public total reveals that gift's amount (inherent to showing a total).
  - Gift lists and members' giving history don't show the campaign yet.
  - If a campaign's fund is archived, online gifts to it stop until the fund is restored.
- **Forum attachments:**
  - Media can't be added or removed after posting, and text is still required.
  - No video transcoding: MP4/H.264 only; `.mov`/HEVC is refused with an explanation.
  - Duration and dimensions come from the browser.
  - **Video metadata isn't stripped.** Photos lose all EXIF/GPS, but MP4 files are stored as uploaded, and some Android phones write the recording location into them. Stripping it means rewriting the file on the server (follow-up). Members are told in the guide.
  - Abandoned drafts are removed only through the moderator cleanup page.
- **Workbook:**
  - No printable export (the journal export didn't fit without a new engine).
  - No link to an event occurrence; `delivered_on` stays the service date.
- **Phone navigation:** Safari's own toolbar is outside the page and can't be styled. The iOS 26.0 drift bug is Apple's (fixed in 26.1); the bar now covers any gap it causes.
- **Contact links:** a website can't pick the phone's default maps app, so Google and Apple links are both offered.
EOF
