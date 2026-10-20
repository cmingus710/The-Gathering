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

## Home menu artwork

The home launcher uses the supplied dimensional tiles (19 square PNGs, 1254 px, listed in `assets/menu/icon-manifest.json`, stored in `assets/brand/source/<name>.png`). They are never recoloured, cropped, or labelled: each tile already carries its own coloured background, and the label is HTML underneath.

- `npm run menu:icons` (also run before every build) writes WebP copies at 96, 160, 240, and 336 px to `public/images/menu/optimized/` and lists them in `src/lib/home/menu-art.generated.ts`. Unchanged sources are skipped by content hash. `-- --check` lists any missing artwork.
- Tiles load through `srcset`, so a phone tile downloads a 3–16 KB WebP instead of a 2 MB PNG. The originals stay outside `public/`.
- A missing artwork falls back to the original `TileIcon` glyph on a neutral tile.
- The dock uses the supplied small glyphs (`home`, `events`, `community`, `messages`, `more`), inlined in `src/components/icons/dock-glyphs.tsx` so they take the theme colour.

## Home launcher

`src/lib/home/launcher.ts` is the shared configuration. Each entry has a stable `id`, `label`, `art`, fallback `glyph`, `order`, `status`, and optional `requires` (capabilities), `feature` (for example `giving`), and `count` (unread badge). Adding a module is one entry; the layout adapts.

- Only `available` entries the viewer may open are shown. `upcoming` entries (Prayer, Podcasts, Lessons, Bible, Devotionals, Memory verses, Youth) document what plugs in later and are never links. Administration is never a tile.
- Columns follow the launcher's own width in rem (container queries): 2 below 19.5rem (narrow phones, or large text), 3 on phones, 4 to 6 on wider screens. Art is capped at 7rem.
- With more rows than fit, the grid scrolls inside a bounded area: three rows on phones, two on short screens and desktop, at most about 60% of the viewport, plus 40% of the next row as a cue. Edge fades and a small gold cue show there is more.
- Scrolling only goes vertically and hands off to the page at either end (no overscroll containment). Every tile is in the tab order; a focused tile is scrolled clear of the fades (`scroll-padding`). Reduced motion removes the lift and smooth scrolling.

## Section pages and hubs

The home tiles carry through to each section, so the app doesn't drop to plain text after the launcher.

- **`SectionHero`** (`src/components/ui/section-hero.tsx`) is the header of a section's main page: the section's home tile (same artwork, same shadow) on the greeting banner's surface, the serif title with the short gold rule, the description, and actions aligned with the text. It takes `PageHeader`'s props plus `art` and `glyph`. Used on Directory, Events, Community, Messages, Groups, Give, News, Notifications, Prayer, Devotionals, Sunday lessons, Podcasts, Church reading, Music, Gallery, Bible reading, Teaching & media, and My Journal. Profile keeps its avatar card. Detail pages, forms, and admin pages keep the plain `PageHeader`.
- **`TileGrid`** (`src/components/ui/tile-grid.tsx`) shows a hub's sections as dimensional tiles with the launcher's columns, labels, hover, and focus, but never scrolls on its own. Used for the Teaching & media sections and Bible reading's "Yours".
- Entries without supplied artwork (Teaching & media, My Journal, Bookmarks & highlights) use their glyph on a neutral tile, the launcher's missing-art fallback. Supplying artwork for them later only needs the image and an `art` name.
- The sidebar, the admin area, and list rows keep the line icons.

## Navigation

- **Phone dock:** Home, Events, Community, Messages, and More, on a slim floating surface: smoked glass on dark, translucent ivory on light, a solid surface where `backdrop-filter` is unsupported or reduced transparency is requested.
  - The active tab gets a gold capsule. Labels stay visible, and Messages carries its unread badge.
  - The dock floats above the safe area. The page reserves `--dock-clearance` (`6rem` + safe area) below its content, and `scroll-padding-bottom` keeps focused elements clear of it. Sticky form bars use the same token.
- **More sheet:** sections for Church life, Connect, You, and Administration (administrators only), then Appearance, Sign out, and Coming later.
- **Desktop sidebar:** the same sections, with the approved full logo at the top and the theme control and sign-out at the bottom.
- **Floating controls:** there are none in the app. The Next.js dev indicator is turned off (`devIndicators: false`) because it covered the tab bar.

## Home

Matches the approved home design (`docs/design/home-mockup.webp`).

1. **Header (phones):** the approved symbol (unchanged, with a faint warm halo on dark) and the church name in the serif, then notifications and the profile avatar.
2. **Greeting banner:** charcoal to muted gold with a fine gold border, the date line, "Good morning/afternoon/evening, <preferred name>" in the church time zone, a short gold rule, and the approved symbol oversized at low opacity on the right. Long names wrap at a smaller size.
3. **Launcher** (above).
4. **Coming up:** the next event the member can see, as an image-led banner with a calendar leaf built in HTML (month, day, weekday from the event's own date and time zone), the title, time, and place, and a round arrow. Images fall back from the event's homepage banner to its cover to the church-wide default to a branded background; see events-guide.md. With no event, a compact branded strip with no date.
5. **Life at The Gathering:** the latest announcement, image-led when it has an image and text-led otherwise, plus up to two compact lines. The heading chevron opens all announcements.
6. **Gathering times** with the next one marked.

On desktop, Coming up and Gathering times share the wider column and Life at sits beside them.

"Coming later" moved off the home page: upcoming modules stay listed in the More sheet and sidebar, and in the launcher configuration.
