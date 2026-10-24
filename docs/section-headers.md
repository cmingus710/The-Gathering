# Section headers

Each member section's landing page opens with the same header: the section's dimensional menu artwork, the page title (its one `h1`), a short description, the section's actions, and a decorative banner in charcoal and gold (dark) or ivory and gold (light) with a fine gold rule.

- Component: `src/components/ui/section-header.tsx` (`<SectionHeader section="events" … />`)
- Section list (label, icon): `src/lib/section-headers/sections.ts`
- Styles: `.section-header` in `src/app/globals.css`
- Background pairs: `assets/section-headers/background-manifest.json`
- Web copies: `npm run section:backgrounds` (also runs before every build) writes `public/images/section-headers/<section>-<dark|light>-<640|1280>.webp` and `src/lib/section-headers/backgrounds.generated.ts`

## How the banner works

- The page passes both themes' images as CSS custom properties. The stylesheet paints only the one for the resolved theme (`data-theme` light/dark, or the OS setting for System), so the first paint is right, the banner follows a theme change while the page is open, and only that one image is downloaded (the 1280 px copy on 2× screens, 640 px otherwise).
- The art keeps its proportions, is anchored right, and its left edge is masked into the banner colour (sampled from the artwork's own left edge by the generator), so there is no seam or stretching at any width.
- The title block carries its own backdrop in that colour, fading out just past the text, so text never sits on the artwork. Measured contrast: titles 9.3:1 or better, descriptions 5.4:1 or better, in both themes at desktop, phone, and 320 px.
- On phones the art is scaled to the banner height and faded back rather than the banner growing. Long titles, translations, and enlarged text wrap and the banner grows; with very little room (a narrow phone with large text) the icon moves above the title.
- `size="compact"` is a slimmer version for overview pages inside a section (Calendar & reminders, Memory progress, Ways to help, …) and for Messages. Item pages, editors, players, and conversations keep their existing headings so their content stays high on the page.
- Forced-colours mode hides the decoration and keeps the text.

## Background mapping

| Section (route) | Dark source | Light source |
| --- | --- | --- |
| Events (`/events`) | Faint Gold Calendar on Charcoal-1.png | Elegant ivory calendar banner-18.png |
| Prayer (`/prayer`) | Quiet charcoal with golden rays-2.png | Soft Ivory Rays and Gold Curves-16.png |
| Devotionals (`/devotionals`) | Open Book in Golden Dawn-3.png | Ivory sunrise over an open book-17.png |
| Sunday lessons (`/lessons`) | Closed Bible with Gentle Gold Illumination-2.png | Closed Bible in Ivory and Gold-19.png |
| Books (`/reading`) | Antique Gold Books in Shadow-1.png | Ivory bookscape with golden accents-21.png |
| Music (`/music`) | Quiet golden musical curves on charcoal-3.png | Ivory harmony with golden curves-20.png |
| Podcasts (`/podcasts`) | Antique microphone over golden waveforms-4.png | Elegant Ivory Microphone Waveform-22.png |
| Videos (`/videos`) | Golden cinema frames on charcoal-6.png | Ivory Cinema Frames with Champagne Accents-24.png |
| Media gallery (`/gallery`) | Charcoal Gallery with Golden Mountain Frames-5.png | Ivory mountain frames on gold-23.png |
| My Journal (`/journal`) | Open Notebook in Warm Gold-7.png | Ivory journal and fountain pen-26.png |
| Youth & Families (`/youth`) | Playful golden stars and tree-8.png | Ivory Gathering with Golden Tree-25.png |
| Community (`/community`) | Golden conversation curves on charcoal-9.png | Ivory and Gold Conversation Flow-27.png |
| Messages (`/messages`) | Quiet Gold Message Bubbles-10.png | Ivory message bubbles in champagne gold-29.png |
| Announcements (`/announcements`) | Quiet Gold Megaphone on Charcoal-11.png | Elegant Megaphone Announcement Banner-28.png |
| Give (`/give`, `/giving`) | Cupped Hands and Golden Heart-12.png | Champagne hands cradling a heart-30.png |
| Directory (`/directory`) | Connected silhouettes in antique gold-14.png | Warm ivory header with connected gold silhouettes-32.png |
| Bible reading (`/bible`) | Open Bible in gilded shadows-15.png | Ivory Banner with Golden Open Bible-31.png |
| Memory verses (`/memory`) | Quiet Charcoal Banner with Golden Verse Cards-13.png | Ivory gold verse card backdrop-33.png |

All sources live in `assets/brand/source/` (never served). Videos has no menu artwork, so its header shows the Videos glyph tile, as the Home launcher would.

## Adding a section

1. Put the dark and light PNGs in `assets/brand/source/` and add a line to `background-manifest.json`.
2. Add the section to `SECTIONS` in `src/lib/section-headers/sections.ts`.
3. Run `npm run section:backgrounds`, then use `<SectionHeader section="…" />` on the page.

Screenshots: [docs/section-headers/](section-headers/).
