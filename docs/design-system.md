# Design system: member experience

The visual system for The Gathering's member app. Branch `design/member-experience`, stacked on Phase 5 (`phase-5/community-messaging`).

## Principles

- Ivory, white, charcoal, and restrained gold. Gold accents mark things; it is not a background colour.
- Use different shapes for different jobs: illustrated tiles for features, date-led cards for events, an editorial card for announcements, compact divided rows for conversations, threads, and categories, and plain surfaces for forms.
- Serif (Source Serif 4) for page titles and selected feature headings. Sans (Source Sans 3) for navigation, controls, and body text. Section headings are sentence case.
- Never invent content. Every panel shows real, authorized data or a short empty state, and only administrators see setup actions.

## Tokens

Defined once in `src/app/globals.css` and mirrored in `src/lib/theme/tokens.ts`. Unit tests check that the two agree and that every text/background pair used meets WCAG AA in both themes.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#F7F4ED` ivory | `#141311` | Page canvas |
| `surface` | `#FFFFFF` white | `#1F1D1B` | Cards, rows, sidebar |
| `surface-muted` | `#F1ECE2` | `#2A2825` | Wells, chips, avatars |
| `text` | `#363430` charcoal | `#F7F4ED` ivory | Body and headings |
| `text-secondary` | `#6B655B` | `#B8B1A4` | Supporting text |
| `primary` | `#80642F` deep gold | `#C9AA72` | Links, active state, focus ring (accessible text gold) |
| `accent` | `#AD8C53` gold | `#AD8C53` gold | Icon highlights, rules, motif. **Never small text on light** |
| `cta` / `on-cta` | charcoal / ivory | ivory / charcoal | Main buttons |
| `success` | `#4A5D45` (olive family) | `#A3BC99` | Status |
| `danger` | `#A14538` clay | `#E8998A` | Destructive actions, errors |

The approved palette (`brand-gold`, `brand-charcoal`, `ivory`, `white`, `sand`, `deep-gold`, `warm-gray`, `olive`, `clay`) is kept unchanged as named colours.

Type scale: `text-eyebrow` 0.8125rem, `text-meta` 0.9375rem, body 1.0625rem, `text-title` 1.0625rem semibold, `text-display` 1.75rem (2.125rem from `sm`). All sizes are in rem, so browser text size and zoom still apply.

Radii are `control` 0.75rem, `tile` 0.875rem, and `card` 1rem. Elevation comes from `--elev-card`, `--elev-lift`, and `--elev-bar`, each tuned per theme.

Shared pieces: `Card`, `SectionHeading`, `SectionLink`, `PageHeader`, `ListRow` (with `plain` for use inside `rowListClass`), `EmptyState` (with `glyph`), `SegmentedTrack`/`segmentClass`, `Badge`, `Button`, `ConfirmDialog`, `DateBlock`, and `ThemeControl`.

## Themes

- **Choices:** Light, Dark, and System. The choice is stored per device in the `theme` cookie for one year (`src/lib/theme/preference.ts`). With no saved choice, or an unknown value, the app uses Light.
- **No flash:** the root layout renders `data-theme` from the cookie on the server, along with a matching `theme-color`. System mode uses `prefers-color-scheme` in CSS. No blocking script is needed.
- **Applying a change:** the control updates the page at once and saves through a Server Action. Without JavaScript, its Save button submits the same form.
- **Scoped themes:** themes work on any element (`[data-theme]`), so the icon reference can show both side by side.
- **Logo:** the approved artwork is never recoloured. On light it appears as is; on dark the symbol sits on an ivory disc and the full logo on an ivory plaque (`.brand-mark`, `.brand-plaque`).

## Custom icon system

`src/components/icons/icon.tsx`, names and concepts in `src/lib/icons.ts`. Reference page: `/design/icons` (administrators only).

- **Grid and stroke:** 24-unit grid, 1.75 stroke (2 when selected), round caps and joins, and corner radii of 2–2.75.
- **Layers:** structure in `currentColor`, one gold accent (`.g-accent`), and a soft gold wash that appears only when selected and in the tile variants (`.g-fill`).
- **Variants:**
  - `Icon` for navigation at 20–24 px, with `active` for the selected state.
  - `TileIcon` (48 px), an illustrated medallion with a fragment of the gathering arc, for home tiles.
  - `SpotIcon` (56 px) for empty states.
- **Accessibility:** icons are decorative (`aria-hidden`) unless given a `title`. Navigation keeps text labels, and icon-only buttons have accessible names.

| Name | Label | Concept | In use |
| --- | --- | --- | --- |
| `home` | Home | Doorway arch under a soft roof | Nav |
| `directory` | Directory | People in a welcoming circle around a gathering point | Nav, home tile, admin Members |
| `community` | Community | Two overlapping discussion forms | Nav, home tile, categories |
| `groups` | Groups | Three figures, centre head in gold | Nav, home tile, group placeholder |
| `messages` | Messages | Conversation bubble with written lines | Nav, home tile, header |
| `prayer` | Prayer | Joined hands with a rising light | "Coming later" (Phase 6) |
| `events` | Events | Calendar with a gold date marker | Nav, home tile, empty states |
| `bible` | Bible Reading | Open book with a ribbon | "Coming later" (Phase 8) |
| `memory` | Memory Verses | Scripture card with a spark | Reserved (Phase 9) |
| `devotionals` | Devotionals | Sunrise above an open page | Reserved |
| `podcasts` | Podcasts | Microphone with sound arcs | "Coming later" (Teaching & media, Phase 7) |
| `lessons` | Sunday Lessons | Open Bible on a lectern | Reserved |
| `youth` | Youth | Energetic figures joined at the hands | Reserved (Phase 10) |
| `giving` | Giving | Open hand supporting a heart | Nav, home tile, admin Giving |
| `profile` | Profile | Person with a gold head | Nav |
| `announcements` | Announcements | Megaphone with sound arcs | Nav, home tile, admin |
| `admin` | Administration | Stewardship shield with a gold check | Account/admin entry points |
| `notifications` | Notifications | Bell with a gold clapper | Header, nav |
| `more` | More | Three tiles and a gold circle | Phone tab bar |
| `settings` | Settings | Two sliders, one gold | Admin |
| `audit` | Audit log | Clipboard with a gold clip | Admin |
| `moderation` | Moderation | Shield with a gold notice mark | Admin |
| `sprout` | Ministry interests | Sprout with one gold leaf | Admin |

Reserved icons are only drawn. Unfinished modules are shown only as "Coming later" and are never linked.

Small utility glyphs (chevrons, pins, locks, sun and moon) still come from `lucide-react`.

## Navigation

- **Phone tab bar:** Home, Events, Community, Messages, and More. Profile is always one tap away from the header avatar.
  - The bar is docked to the bottom edge, with a top border, a soft shadow, and safe-area padding.
  - The active tab gets a gold indicator, a selected icon, and bold text. Tabs are 60 px tall.
  - The page reserves `6rem + safe area` at the bottom, so content and sticky composers never sit under the bar.
- **More sheet:** sections for Church life, Connect, You, and Administration (administrators only), then Appearance, Sign out, and Coming later.
- **Desktop sidebar:** the same sections, with the approved full logo at the top and the theme control and sign-out at the bottom.
- **Floating controls:** there are none in the app. The Next.js dev indicator is turned off (`devIndicators: false`) because it covered the tab bar.

## Home

1. Welcome panel: the date, a serif greeting, the next gathering (from church settings), and the gathering-arc motif. The motif is an original abstract figure, not the symbol.
2. Quick access, in a three-column grid: Directory, Events, Community, Messages (with live unread count), Groups, and Give when online giving is configured (News otherwise).
3. Upcoming events (next 60 days, up to 3). The first is a date-led featured card with its cover image when one exists.
4. Announcements: the latest in an editorial layout, plus two compact lines.
5. Gathering times and the address, as an information panel.
6. Coming later: modules from later phases, labelled as not available. This is also where Bible reading, devotional, and lesson content will plug in.

"View all" appears only when there is something to view. Empty states are short and compact. Setup actions (create an event, post an announcement, add gathering times) appear only to people holding the matching capability.
