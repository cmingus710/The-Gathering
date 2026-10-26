# Scripture highlights

Members highlight verses in the Bible reader in six colors. Highlights are private, saved to the member's account (so every signed-in device shows them), and appear automatically in **My Journal → Scripture Highlights**. Migration `20261126000100_scripture_highlights`.

## For members

- **Selecting.** In the reader, select a verse number, then more verse numbers to build a range: each verse outside the range extends it (16, then 17, then 18 selects 16–18; 16 then 20 selects 16–20), tapping the first or last verse again removes it, and tapping a verse inside the range ends the range there. Shift-click, or Shift+↑/↓ from a focused verse number, extends from the first verse chosen. On a phone, **Select verses** turns on verse-selection mode: a tap anywhere on a verse selects it; ordinary text selection pauses while it's on, and scrolling works as usual. **Escape** or **Cancel** clears the selection.
- **One chapter at a time.** A selection stays within the chapter on screen. To highlight across a chapter break, highlight each chapter on its own page; My Journal lists them as separate passages.
- **The toolbar** shows the reference and the selection's current color ("Mixed colors" when it differs or only some verses are highlighted), six color buttons (each named; a check marks the selection's color, a bar marks a color only some verses have), **Remove highlight** (when any verse is highlighted), **Add to Memory Verses**, **Bookmark**, **Write privately**, and **Cancel**.
- **Changing.** A color applies only to the selected verses, so a range can be recolored or removed in part. Choosing a new color for already-highlighted verses changes their color.
- **Saving.** The toolbar shows *Saving…*, then *saved*, or *wasn't saved* with **Retry**. The page changes only after the server confirms. If the same verses were changed on another device since the page loaded, nothing is overwritten: the current highlights are shown and the member chooses again. Coming back to the tab re-reads the chapter's highlights.
- **My Journal → Scripture Highlights** lists passages (adjacent verses with the same color) with reference, translation, color, date, and the passage text as available now. Search by reference ("John 3", "Psalm 23:1–3", "Romans"); filter by color and translation; sort by most recently highlighted (default) or Bible order. Each passage has **Open in Bible**, **Add to Memory Verses**, **Write a reflection** (the existing journal editor; a reflection is an ordinary journal entry and stays if the highlight is removed), color buttons, and **Remove highlight**. This is the same data as the reader, not a copy.
- **Add to Memory Verses** opens the existing *Add a memory verse* page with the passage and translation filled in. The member reviews the text and confirms; the usual rules apply (eligible versions, at most 30 verses, licensed versions' practice modes and memory permission). A version that can't be memorized is explained, and no other version is chosen in its place. A passage already in My Verses is offered to open instead of being added again. Adding never changes the highlight; removing the highlight never removes the memory verse or its progress.

## Bookmarks

- **Bookmark** in the toolbar saves the selected verse or range (a private row in `bible.bookmarks`, unchanged schema). The button reads **Bookmarked** (pressed) when the selection matches an existing bookmark, and choosing it again removes that bookmark. A confirmation appears just above the dock with **View bookmarks**, and a small bookmark marker appears before the passage's first verse in the reader.
- **Bible reading → Bookmarks** (`/bible/bookmarks`, also linked from the top of every chapter) lists bookmarks newest first with reference, translation, and date added. **Continue reading** opens the reader at the passage's first verse (`?focus=16-18#v16`), outlines the bookmarked verses, and says "Picking up at your bookmark". Plan-day bookmarks open the plan day as before. Remove one, or all, from the same page.

## What's stored

`bible.highlights`: one row per member, translation, book, chapter, and verse (primary key), with color, `created_at` (first highlighted), `updated_at` (last change), and `revision` (from one sequence). Overlapping selections and repeated saves update the same rows, never duplicate them. No scripture text is stored, for any translation.

Highlights are **translation-specific**. A verse is checked against the translation's own versification (`bible.chapter_last_verse`: its stored verses, or the reference versification for licensed versions) and never mapped onto another translation.

## Functions

| Function | Who | What |
| --- | --- | --- |
| `bible_highlights(translation, book, chapter)` | approved members and active youth accounts, own rows | A chapter's highlights with revision and `updated_at` |
| `bible_highlight_apply(p jsonb)` | same | Color or remove one verse or a contiguous range in one chapter. Takes each verse's `expected` revision; refuses (returns `conflict` with the current highlights) when a verse changed since, unless it already has the requested state (a retried save). One chapter at a time per member (advisory lock). Removing works in a retired translation; coloring needs an active one. |
| `bible_highlight_passages(p jsonb)` | same | Grouped passages for My Journal; color, translation, and reference filters; `recent` or `bible` order; paging |
| `bible_highlight_set(…)` | same | Kept for compatibility (same result shape); accepts the new colors and keeps `created_at` on recolor |

Grants: the new functions for `authenticated` only (not `anon`, not `service_role`); `bible.highlight_rows` and `bible.highlight_color_ok` for no API role; the table stays closed. No administrator or capability opens another member's highlights.

## Licensed translations (API.Bible)

- Highlights keep references and colors only. Text is fetched when shown, through the existing provider integration (`resolveText`) and its existing in-memory cache policy (only when the translation allows caching, for at most its `cache_days`); unchanged otherwise.
- Text is shown verbatim; the highlight is a background on the verse text only, never the verse number, headings, or attribution. The translation's attribution and the provider's copyright line appear under the passage in the reader and in My Journal.
- **FUMS:** the reader reports a chapter's `fumsId` once per page load (unchanged). Changing a highlight's color doesn't reload the text, so it reports nothing new. My Journal reports each `fumsId` once per view (a recolor or a re-render reuses the text already shown and reports nothing). Text isn't written to logs, analytics, browser storage, or test fixtures.
- If the provider can't be reached (or access lapses), the highlight is kept and listed by reference with "isn't responding" / "can't be reached" and **Try again**. No other translation is shown in its place.

## Testing

- **Database** (`tests/db/scripture-highlights.test.ts`, PostgreSQL 16 from every migration, synthetic verses): six colors; ranges, overlaps, partial recolor and removal with one row per verse; contiguous ranges only; `created_at` kept and revisions moved only on real changes; a stale save refused and a retried save accepted; two concurrent connections (the second sees the first and changes nothing); separate translations and translation-specific verse counts, licensed versions on the reference versification; no text columns or text in the table; grouping, filters, both orders, paging; journal ↔ reader changes and the last verse removed; two-member isolation, administrator, pending, suspended, anonymous, direct table and helper access refused; active youth accounts; retired translations (remove only); memory verses (and their progress) and journal entries untouched by highlight changes, and highlights untouched by memory changes.
- **Unit**: `src/lib/bible/highlights.test.ts` (selection, mixed state, expected revisions, links, reference search) and `src/lib/bible/reader-colors.test.ts` (all six colors defined for light, dark, and system dark; text contrast at least 4.5:1, measured at 8.5:1 or more; colors distinguishable).
- **Browser walkthrough** (`tests/e2e-local/15-scripture-highlights.spec.ts`, local `supabase start` (CLI 2.122) with every migration and the seed, production build, Chromium, desktop and Pixel 7 emulation): 13 passed, 1 skipped (the keyboard check runs on desktop only). Covers six colors, mixed state, partial recolor and removal, reload, a second signed-in session, an administrator seeing nothing, journal ↔ reader sync, filters and order, removing a passage, axe on the journal view, quick add to Memory Verses and the existing-verse offer, a licensed highlight's unavailable state (synthetic `API_BIBLE_KEY`; API.Bible not reachable, so no licensed text was fetched), and a version not permitted for memory. The existing memory walkthrough (spec 10) still passes. Set `HIGHLIGHT_SHOTS=<folder>` to save screenshots.
- **Not verified:** physical phones and tablets (touch was checked with Chromium's Pixel 7 emulation), screen readers, and a live API.Bible key (FUMS reporting with real `fumsId`s, the provider's copyright line). Check these on a real device and with the church's key before announcing the feature.
