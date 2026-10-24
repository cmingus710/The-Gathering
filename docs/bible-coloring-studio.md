# Bible Coloring Studio (Learn & Play)

The first Learn & Play player, built on the activity foundation ([learn-and-play.md](learn-and-play.md)). A *Drawing & coloring* activity can carry a coloring picture; children color it with a guardian (or on their own youth account), and each child's picture is saved privately to that child.

Migration: `20261122000100_youth_coloring` (operator script `supabase/manual/2026-11-22-apply-youth-coloring.sql`, **not applied to hosted**). Tests: `tests/db/youth-coloring.test.ts`, `src/lib/youth/coloring.test.ts`, `src/lib/youth/coloring-svg.test.ts`, `tests/unit/coloring-route.test.ts`, `tests/e2e-local/13-coloring-studio.spec.ts`.

## Member experience

On `/youth/play/<id>` for an activity with a picture, below the activity details:

1. **The story in words** (the text alternative to the picture): a short summary written by the editor, and the Scripture references to read it in the Bible.
2. **The studio**, once a guardian has chosen who's coloring (a youth colors as themselves). The picture is the chosen child's; switching children switches pictures.
3. **Artwork attribution** under the studio.

Controls (all large, labeled with text, with a check mark and outline on the selected one, so nothing relies on color alone):

| Control | What it does |
| --- | --- |
| **Fill** | Tap or click a part to fill it with the chosen color (region pictures only). |
| **Brush** | Draw freehand with one finger, a stylus, or a mouse. |
| **Eraser** | Erases brush strokes only, never filled colors or the line art. |
| **Move** | Drag to move around when zoomed in. |
| **Color** | 12 named colors: Red, Orange, Yellow, Green, Sky blue, Blue, Purple, Pink, Brown, Peach, White, Black. |
| **Brush size** | Small, Medium, Large (brush and eraser). |
| **Stay inside the lines** | Region pictures: a brush stroke only colors the part it starts in. |
| **Undo / Redo** | Every change: fills, strokes, erasing, and Start over (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y). |
| **Start over** | Asks first ("Start over? This clears all the coloring on this picture for …"), and can be undone right after. |
| **Zoom out / Zoom in / Fit** | Up to 600%. |
| **Download** | A PNG of the picture (about 2000 pixels on its longest side). |
| **Parts of the picture** | A list of every part by name, showing its current color in words. Choosing one fills it with the current color, and the part is outlined in the picture while focused, so filling works fully from the keyboard and with screen readers. |

**Drawing vs. moving.** One finger, a stylus, or a mouse always draws or fills with the chosen tool. Zooming and panning are separate gestures: two fingers (a second finger cancels a stroke the first one started), the Move tool, Ctrl + scroll (and trackpad pinch), the zoom buttons, or, with the picture focused, `+`, `−`, `0`, and the arrow keys. While a stylus is touching the screen, touches are ignored (palm rejection).

**Page scrolling.** Only the picture captures touch (`touch-action: none` on the picture alone). Swiping anywhere else scrolls the page, and plain mouse-wheel scrolling over the picture scrolls the page too. The picture is at most about two-thirds of the screen height, so there is always room to scroll past it on a phone.

**Reduced motion.** Nothing in the studio animates (zoom is instant); the save spinner stops under `prefers-reduced-motion`, like everything else in the app.

## Saving

- **Private.** The picture is saved to the child profile and activity version (`youth.coloring_artwork`), never to an adult's profile. It is readable and writable only by that child's youth account or a guardian who may currently play for that child (verified, with *Practice with the child*, child active and unrestricted, activity open to the child), checked on every call. Summary-only guardians, leaders, editors, and other staff get nothing. Nothing is shared, posted, or sent to the Media gallery.
- **Autosave.** Changes save about 1.5 seconds after the last one (the journal's autosave controller: one save in flight, retried with backoff, paused while offline). The status line says **Saves as you color**, **Saving…**, **Saved**, or **Unable to save** with the reason (offline, signed out, changed on another device), plus **Retry now** and, when signed out, a link to sign in in a new tab.
- **No silent overwrites.** Every save names the revision it was based on. A save from another tab or device that saved in the meantime, or a delayed save, gets a conflict and nothing is written; the studio shows both pictures side by side and asks: **Keep mine** or **Use the saved one**. A page still showing an older version of the activity can't save (a new version starts fresh; the earlier picture stays with the version it was made on).
- **Temporary connectivity loss.** Until the server confirms a change, a copy is kept on the device (localStorage, key `gathering.coloring.v1:<account>:<child>:<version>`). When the connection returns, saving resumes automatically. If the page is closed or reloaded first, the next visit restores the copy ("Restored changes from this device that hadn't been saved yet", undoable) and saves it; if the saved picture changed meanwhile, both are shown and the person chooses. The copy is removed as soon as the server confirms the picture.
- **Device copies are cleared** on sign-out (the sign-out button, and again on the signed-out page; studios still open in other tabs hear it and stop keeping copies), when the studio opens under a different account (any other account's copies are removed), and after 30 days. While the "this device or saved?" choice is on screen, editing waits and the device copy stays put, so a reload doesn't lose it.
- **What this is not:** offline support. The activity page itself needs a connection to open; only edits made while the page is open (and reopening it later online) are protected.

## Export

**Download** draws the picture on a canvas in the browser and saves `coloring-<activity>.png`. It's available only inside the studio, which only renders for someone the database lets open that child's picture (the child's own youth account, or a guardian with *Practice with the child*). Guardians who only see progress summaries can't open or export it. Nothing is uploaded.

## Coloring pictures (templates)

A picture is stored in the activity version's data-only `config.coloring`, so it is versioned and immutable once published like the rest of the content. It is **never stored or shown as uploaded markup**: it holds only checked, rebuilt geometry.

- **Tap-to-fill (region) pictures** come from an SVG in the "Gathering coloring SVG" format:
  - a root `<svg>` with a `viewBox` (or plain numeric width and height);
  - each fillable part has `data-region="Name"` (a shape, or a `<g>` of shapes as one part). The name is what keyboard and screen reader users hear; an empty `data-region` falls back to `aria-label` or a `<title>` child, then "Part N" with a warning;
  - everything else drawn (stroked, or filled with a dark color) is line art, kept on top of the coloring; white fills and colors in the file are ignored (parts start white);
  - transforms are applied; Inkscape/Sodipodi editor metadata is ignored.
- **Freehand-only pictures** use ordinary line art (JPEG, PNG, WebP, HEIC) uploaded through the existing artwork pipeline (re-encoded WebP, metadata removed). They have no parts, so they can't be tap-filled and "stay inside the lines" isn't offered. The editor labels them **Freehand only: no tap-to-fill** and requires the editor to confirm that. We don't claim that a PNG or JPEG can become a tap-to-fill picture.

### SVG checks (strict: refused, not cleaned)

The upload is refused, with every reason listed, if it contains: scripts (in any namespace), event handlers (`on*` attributes, any case), links or external references (`href`, `xlink:href`, `src`, `xml:base`), `url(…)`, `javascript:`, `vbscript:`, `data:`, CSS `expression(`/`@import`, character references or backslashes in attribute values, `<style>`, `<foreignObject>`, `<iframe>`/`<object>`/`<embed>`, images, `<use>`, `<a>`, animation (`animate*`, `set`, `mpath`, `discard`), filters, patterns, masks, clip paths, symbols, markers, gradients, text and fonts (convert text to paths), `<switch>`, `DOCTYPE` or `ENTITY` declarations (no entity expansion), `CDATA`, processing instructions other than the XML declaration, nested `<svg>`, non-empty `<defs>`, any unknown element, malformed XML, unreadable path data or transforms, nested fillable parts, lines marked as fillable parts, files over 512 KB, more than 4,000 elements, 300 parts, or 800 line-art shapes, or output too detailed to store. These checks apply to the whole document, including metadata.

What is kept: for each part, a generated id (`r1`, `r2`, …), its plain-text name, its outline width, its fill rule, and normalized path data (absolute `M`/`L`/`C`/`Z` commands and numbers only, scaled so the longest side is 1000); the same for line art. The database checks the picture again (`youth.coloring_template_problem`): only known fields, path data matching `^M[MLCZ0-9 .-]*$`, plain-text names and story, valid attribution with an `https://` link if any, freehand line art belonging to the same activity, and a picture only on *Drawing & coloring* activities. The studio draws it with React-rendered `<path d>` and canvas `Path2D`, never `innerHTML`.

### Saved artwork

A child's picture is data only: `{fills: {<part id>: <color key>}, strokes: [{t: "paint"|"erase", c: <color key>, s: "s"|"m"|"l", p: "x,y x,y …", r: <part id>}]}`. The database refuses missing fields, parts the picture doesn't have, colors outside the palette, malformed points, more than 2,000 strokes, or more than 400 KB. The studio stops adding strokes before that and says the picture is full.

## Administration

Admin → Youth & families → Learn & Play activities → an activity → **Coloring picture** (activities of type *Drawing & coloring*):

1. **Tap-to-fill picture (SVG):** choose the SVG, write a short story summary (shown as the text alternative; check it against the Scripture references), record where the artwork came from (original, licensed, public domain, used with permission; artist or source required unless original; license; optional `https://` source link), and confirm the church may use it. **Check and preview** shows every problem, or a preview with the part names and any warnings. **Use this picture for the draft** saves it (checked again on the server and in the database).
2. **Freehand-only picture:** upload the line art under **Artwork** first, then choose it here with a story summary and confirm it's freehand-only. Its recorded source becomes the picture's attribution.
3. **Remove the coloring picture** takes it off the draft.
4. **Preview** shows the studio exactly as members see it; nothing is saved (not even on the device).
5. Publish as usual. Pictures follow the activity's versions: changing the picture of a published activity makes a new draft version; members keep the published one until you publish, and children start the new version fresh (earlier pictures are kept with the version they were made on).

The type can't be changed away from *Drawing & coloring* while a picture is attached. Line art used by a published version is locked like a cover; line art used by the draft's picture can't be removed until the picture is removed.

### Demonstration drafts

The activity list has **Add demonstration coloring drafts**, which adds three unpublished drafts titled "Demo draft: …", drawn as original simple vector artwork for this feature (`src/lib/youth/coloring-demos.ts`), with no text inside the artwork:

| Draft | Parts | Scripture |
| --- | --- | --- |
| Noah's rainbow (rainbow stripes, sky, sun, cloud, dove with an olive leaf, water, the ark) | 17 | Genesis 8:6-12; Genesis 9:8-17 |
| A shepherd and his sheep (shepherd, a sheep and a lamb, hills, sky) | 15 | Luke 15:3-7; Psalm 23:1; John 10:11 |
| Five loaves and two fish (basket, five loaves, two fish, picnic cloth) | 13 | John 6:1-14; Matthew 14:13-21; Mark 6:30-44; Luke 9:10-17 |

They are reviewable drafts: check the artwork, story summaries, and references, then edit, publish, or archive them. Running the button again adds only missing ones. Nothing is published automatically.

## Schema changes (20261122000100)

| Object | Purpose |
| --- | --- |
| `youth.coloring_artwork` | A child's picture per activity version: data, revision, who was at the device |
| `youth.coloring_template_problem`, `youth.coloring_doc_problem`, `youth.coloring_palette`, `youth.coloring_num`, `youth.coloring_int`, `youth.coloring_child` | Internal checks (no API role can call them) |
| `youth_coloring_artwork`, `youth_coloring_save` | Member functions (read and save the chosen child's picture) |
| `youth_admin_activity_coloring_set` | Editor function (set or remove the draft's picture; audited as `youth.activity_coloring_set`) |
| `activity_versions_config_check` | Config limit 64 KB → 256 KB |
| `youth.activity_content`, `youth_admin_activity_save`, `youth.activity_object_readable`, `youth_admin_activity_asset_remove`, `youth_admin_activity` (replaced, same signatures and grants) | Picture rules; config kept when the editor form doesn't send it; members may read published freehand line art; line art locked like a cover |

## Release steps

1. Owner approval, then run `supabase/manual/2026-11-22-apply-youth-coloring.sql` once in the SQL editor (one transaction; refuses out-of-order or repeat runs). Rehearsed locally on PostgreSQL 16 (see [migration-history.md](migration-history.md)).
2. Deploy the app **after** the migration.
3. In Admin → Learn & Play activities, add the demonstration drafts (optional), review them, and publish the ones you want.

No new environment variables, buckets, or scheduled jobs.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test` (unit), and the database suite with `TEST_DATABASE_URL` (`--no-file-parallelism`).
- `tests/db/youth-coloring.test.ts` (15): closed table and helpers; editors only, Drawing & coloring only; refusal of markup, unknown fields, malformed shapes, and bad attribution in pictures (also through the ordinary config path); the picture kept through ordinary editor saves and new drafts; published versions immutable; artwork starting empty, saving privately, reopening; separate pictures per child; stale saves from another device refused with the newer picture returned; youth only as themselves; refusals for other families, children with their own account, summary-only guardians, strangers, leaders, editors, family and ministry administrators, and super administrators; artwork refused when it doesn't fit the picture or palette; earlier artwork kept unchanged when a new version is published; access closing at once (permission removed, child restricted, activity archived); freehand line art (own activity only, locked, readable only by those who may play). Mutating the revision check or the who-may-play check makes it fail.
- `coloring-svg.test.ts` (42): every refusal listed above, inputs built to make the checker's regular expressions backtrack (each must finish quickly), geometry normalization, transforms, part naming, and the three demonstrations. `coloring.test.ts` (14): fill/stroke/undo/redo/start over, history bounds, the size limit measured the way the database measures it, point encoding, stable serialization, artwork and picture checks, palette parity with the migration, device-copy scoping, purge, and restore/conflict decisions. `coloring-route.test.ts` (5): the autosave endpoint's refusals and status mapping. `autosave.test.ts` gained a check that a disposed controller schedules nothing.
- **Browser (local signed-in stack):** `tests/e2e-local/13-coloring-studio.spec.ts`, desktop Chrome (1280 × 900) and Pixel 7 emulation, against a local stack (GoTrue, PostgREST, Storage API on PostgreSQL 16 with every migration and the seed). 22 passed: the editor's demonstration drafts, refused and accepted SVGs, and a preview that saves nothing; fill, brush, eraser, undo/redo, start over (with Cancel), stay inside the lines, autosave, and reopen; keyboard filling; Mark finished alongside coloring; child switching; offline edits kept on the device, saved on reconnect, and restored after closing the page; a second device (conflict, then Keep mine); two-finger pinch (stroke cancelled), Ctrl + scroll, the Move tool, and page scrolling outside but not on the picture; stylus (pen) input; PNG export; not-found for a stranger and a summary-only guardian, 404/401 from the endpoint; sign-out clearing device copies; axe with no violations; reduced motion; no horizontal scrolling.
- **Physical devices: not tested.** Touch, stylus, and pinch were exercised only through Chromium's emulation (CDP touch and pen events). Still to check on a real iPhone/iPad (Safari, Apple Pencil) and an Android phone: drawing feel, palm rejection, pinch, page scrolling around the picture, download behavior, and VoiceOver/TalkBack with the parts list.

## Limits

- Only *Drawing & coloring* activities have a player; the other types still offer only Mark finished.
- No offline support beyond keeping unsaved edits on the device while the page is open (see Saving).
- If a new version is published while a child has unsaved changes, those changes can't be saved to the new version; the studio says so and **Download** still keeps a copy of what's on screen.
- An archived activity, or a child who loses access, can't open their earlier pictures (the same rule as progress). Pictures on a replaced version are kept but not shown.
- Freehand line art downloads include the line art only when the browser allowed it to be drawn on a canvas (signed storage URLs send CORS headers); otherwise Download says it couldn't make the image.
- Pictures are 2,000 brush strokes at most; tap-to-fill colors don't count toward that.
