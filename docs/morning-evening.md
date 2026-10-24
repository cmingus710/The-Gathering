# Morning & Evening — Charles Spurgeon (imported devotional collection)

Charles Spurgeon's *Morning and Evening* as an imported, read-only devotional
collection beside the church's own devotionals: a morning and an evening
reading for every calendar day, repeating each year.

- Migration: `supabase/migrations/20261118000100_devotional_collections.sql` (schema only; it imports nothing)
- Hosted apply script: `supabase/manual/2026-11-18-apply-devotional-collections.sql`
- Pinned source: `data/devotionals/morning-and-evening/` (`m_e.json`, its `LICENSE`, `README.md`)
- Normalizer and provenance constants: `src/lib/devotionals/morning-evening.ts`
- Dry run: `npm run devotional:dry-run` (results: [morning-evening/dry-run.txt](morning-evening/dry-run.txt), [JSON](morning-evening/dry-run.json))

## 1. Source and provenance

| | Finding |
| --- | --- |
| Data file | `data/m_e.json` in [dwahrens/morning-and-evening](https://github.com/dwahrens/morning-and-evening), pinned to commit `e05b8e89d67e01808a3384794416aeeca016d65e` (HEAD of `main`, 2025-12-30). The file itself is unchanged since `bd60a0f7` (2021-06-25); git blob `b85d2370…`; SHA-256 `b4fb4f15…cf96`; 1,609,601 bytes. |
| Software licence | Apache License 2.0 (the repository's `LICENSE`, copied beside the data file as the licence requires). It covers dwahrens' application and the file as distributed. |
| Text provenance | dwahrens credits [russianryebread/morning-and-evening](https://github.com/russianryebread/morning-and-evening) (2015, **no licence file**), whose README says the HTML "was lifted off spurgeon.org". The dwahrens JSON is identical, record for record, to the russianryebread JSON (`6caf9386`), which also holds 12 `null` records that dwahrens dropped. |
| Rights in the text | Spurgeon (1834–1892) published *Morning by Morning* (1865) and *Evening by Evening* (1868); the text is in the public domain. CCEL publishes it marked public domain: https://www.ccel.org/s/spurgeon/morn_eve/morn_eve.html. The collection records rights `public_domain`, the CCEL URL as the text source, and the Apache notice for the data file. |
| Original, not a revision | The text is the 19th-century original: "thou/thy/thee", "remaineth", "-eth" verbs, British spelling ("dishonours", "favoured"), KJV quotations, and Spurgeon's hymn quotations (Watts, Hart, Bunyan). It is not Alistair Begg's or another modernized revision (those replace the archaic pronouns). |
| **Not verified here** | CCEL, spurgeon.org, the Wayback Machine, and Project Gutenberg were **unreachable from the build environment** (egress proxy). A word-for-word comparison against CCEL could not be run. Before publishing, an editor should compare a sample (suggested: Jan 1 morning, Mar 16 morning, Jun 20 evening, Feb 29 both, Dec 31 evening) against the CCEL page. |

Members see an **About this text** section under every reading: title and
author, rights statement, CCEL link, the source repository with path, commit
and import date, and the licence notice. Editors see the same plus the SHA-256
on the collection's admin page.

The source application is not embedded or deployed; only the text is imported.

## 2. The dataset (actual counts)

- **732 records → 732 readings**: 366 mornings, 366 evenings.
- **All 366 calendar days have both readings, including February 29.**
- No missing days, no duplicates, no malformed records, no HTML, no HTML entities, no U+FFFD.

### Corrections made by the normalizer (verified, all counted in the report)

| Correction | Readings | Why it is safe |
| --- | ---: | --- |
| Removed the first two body lines ("January 1st — Morning Reading" + key verse) | 732 | They duplicate the page heading and the key verse. Each heading is checked against the record's month/day/time; a mismatch blocks the import. |
| Split the key verse into quotation + reference ("Joshua 5:12") | 732 | Every key verse has the form `"…" — Reference`; a record without it blocks the import. |
| Windows-1252 control characters → the characters they encode (U+0097 → —, U+0093/94 → ", U+0092 → ', U+0096 → hyphen in "self-forgetting", "well-known") | 52 (115 changes) | Unambiguous mis-decoding; straight quotes match the rest of the file. |
| Double-decoded curly quotes (`â\x80\x9c`) in March 16 morning's key verse, which sat inside straight quotes | 1 | Was `""I am a stranger with thee.""`; now `"I am a stranger with thee."`. |
| Joined soft-wrapped lines (newline + 4 spaces mid-paragraph) | 653 | Source HTML wrapping; a word-for-word comparison of all 732 readings before and after shows **no word lost or added**. |
| Kept hymn/poem lines on their own lines (newline + 5+ spaces) | 124 (396 lines) | Includes April 7 morning's numbered list, which is also line-by-line in the source. |
| Whitespace (CRLF, indentation, a no-break space used as indentation) | 732 | Layout only. |

**Capitalization warning.** The upstream README warns that "the first letter
of each day needs to be capitalized". That is true of its *HTML* file
(`iSRAEL'S weary…`), but **not of this JSON**: 0 readings start lowercase, so
no capitalization was changed. The normalizer would capitalize a lowercase
first letter (tested), and reports it.

### Left as the source has it (listed for review)

- 102 readings use a hyphen as a dash (`"Grow in grace"-not`) — how the source renders some dashes.
- 2 readings have a space before punctuation (`why not now ?` on Jan 1 morning; Mar 5 evening). Likely an artifact, but not verified against a printed edition.
- 4 readings have a paragraph starting lowercase because the sentence continues after a quoted hymn — correct.
- 1 reading (Jun 20 evening) mentions "Evening Readings" — Spurgeon referring to his own book, not a duplicated heading.

## 3. How it works

### Data (migration 20261118000100)

All in the private `media` schema, reached only through `SECURITY DEFINER` functions:

- `media.collections` — title, card line, author, description, cover (a media-library image), audience (members or one group; never public), `status` draft/published, `enabled` (show/hide), provenance columns.
- `media.collection_readings` — one row per calendar reading: stable `id`, stable `source_key` (`01-01-morning`), `month`, `day`, `slot` (no year), key verse, reference, body (plain text; blank line between paragraphs, single line breaks inside a hymn). **Unique per collection by `source_key` and by `(month, day, slot)`.** The text as last imported is kept beside the current text; they differ only after an editor's correction.
- `media.collection_reading_revisions` — every earlier text.
- `media.collection_imports` / `collection_import_rows` — each import's dry-run report, staged rows, and result.
- `journal.entries` gains `collection_reading_id` and `reading_date` (link kind `collection_reading`), with a unique index on `(profile_id, collection_reading_id, reading_date)`.

Church devotionals (`media.items` kind `devotional`) are untouched: the archive, home, search, and notices don't see the 732 readings.

### Read rule

`media.collection_visible`: **enabled AND published AND the audience allows the
caller** (approved adult members, or the group's active members). Every member
function — the devotionals-page card, the daily view, direct links, search,
cover images (`media.asset_used_visibly`), and journal link previews — applies
it at call time. Visitors (anon) can't call any of them (grant baseline
unchanged). Youth accounts are refused like every adult-only teaching function
(`media.is_member` requires an approved adult), so existing youth safeguards hold.

### Import (administrator-controlled)

Admin → Teaching content → **Devotional collections** → **Import Morning & Evening** (content publishers).

1. The page runs the **dry run** on every visit from the pinned file (hash checked; nothing written) and shows counts, coverage, February 29, missing/duplicate/malformed, corrections and warnings.
2. **Import** re-runs it on the server, refuses on any problem, then: `import_begin` (creates the collection on first import as an **unpublished, hidden draft**), stages readings in batches of 100, and `import_apply` applies **all of them in one transaction**. If staging or apply fails, nothing reaches the readings; the import is recorded as `failed` with the reason.
3. Rerunning: unchanged readings stay; a reading nobody edited takes changed source text (old text saved as a revision); **a reading an editor corrected is never overwritten** — if the source changed it is reported as a **conflict**, and the reading's admin page shows the new source text with a "Use the new source text" button. Readings missing from a source are reported, never deleted. Reading ids never change.
4. One audit entry per import (counts only). **No email, push, in-app notice, or feed entry** is created (verified by tests).

Bulk content never goes through a migration. The CLI dry run (`npm run devotional:dry-run`, `--json`, `--sample 03-16-morning`, `--verify-upstream`) uses the same normalizer and writes nothing.

### Members

- **Devotionals page**: a "Daily reading collections" section with the card **Morning & Evening / Daily readings by Charles Spurgeon** and links to **Today's Morning reading** and **Today's Evening reading** — only those two readings. Church devotionals stay above it, unchanged.
- **Daily view** `/devotionals/collections/morning-evening?date=YYYY-MM-DD&slot=morning|evening`: Morning/Evening buttons, a date picker, Today, previous/next reading (evening → next morning, across months and years), search box, the reading (key verse, Scripture reference, "by Charles Spurgeon", paragraphs and hymn lines), **Reflect in My Journal**, **Link to this reading**, and About this text. Only the one reading is sent to the browser.
- **Today** uses the member's own time zone (their notification time-zone setting, else the church's — `community.member_tz`), computed by the database, so daylight-saving changes don't move the date. "Today" opens the evening reading from 5 p.m. local time.
- **February 29**: the dataset has both readings. In leap years Feb 29 is its own day. In other years Feb 28 shows its own readings plus a labelled "Leap-day readings" note linking to the Feb 29 ones; nothing is invented.
- **Direct links** `/devotionals/collections/morning-evening/readings/<id>` use the stable id; the reading is shown on its date in the member's current year (`?on=` keeps a specific date).
- **Search** `/devotionals/collections/morning-evening/search?q=` searches key verses, references, and text; each result shows the day and Morning/Evening ("January 1 · Morning · Joshua 5:12").
- **Scripture references** open the app's Bible reader at that book and chapter (`/bible/read?b=JOS&c=5`) in the member's chosen translation, under that translation's licensing rules. Spurgeon's quotation in the reading is never replaced.

### My Journal

- "Reflect in My Journal" opens the existing journal editor linked to the reading **and the calendar date being read**. If the member already has a reflection for that reading and date (active or archived), the button reads **Open my reflection** and opens it; the database also refuses a second one (unique index; a race returns a clear message without losing the text, which stays in the editor).
- Different years are different dates, so reflections stay distinct. A Feb 29 reading read in a common year is dated Feb 28.
- Privacy is unchanged: journal functions remain owner-only; no staff path, no counts in admin pages, nothing in audit logs or notices. Export includes "Morning & Evening: January 1 · Morning (Joshua 5:12), read 2026-01-01".
- When the collection is hidden or removed, the entry keeps its text and says "About a devotional reading for January 1, 2026 that's no longer available."
- Completion tracking does not exist for devotionals, so none was added.

## 4. Administration

Content editors (`content.edit`) review and correct drafts; content publishers (`content.publish`) import, publish, hide, correct live readings, and remove — the same split as church devotionals.

- **Collection page**: readings by month, search, "Corrected only"; details (title, card line, description, cover via the media library, audience); publishing (Publish and show / Hide / Show again / Return to draft); provenance; import history with each dry-run report and result; remove.
- **Reading page**: preview as members see it, the correction form, the imported text with "Restore the imported text", any newer source text from a conflict, and earlier versions.
- **A correction applies to that calendar reading in every year** (readings have no year). The id stays the same, so links and reflections stay attached. Concurrent edits are refused (revision check).

## 5. Review and publish (exact steps)

1. Apply the migration (see Release below).
2. Deploy the app.
3. As a content publisher: Admin → Teaching content → **Devotional collections** → **Import Morning & Evening**. Check the dry run reads *Ready to import*, 732 readings, 366 of 366 days, February 29 present. Select **Import into a draft collection**.
4. On the collection page, check "Import finished: 732 added". The badge reads *Draft · not visible*; members see nothing.
5. Review readings (month filter; open several). Compare the suggested sample against CCEL (§1). Correct anything needed.
6. Optionally edit the description or choose a cover image; optionally limit to one group.
7. Select **Publish and show to members**. Check /devotionals as a member.

To take it down: **Hide from members** (reversible, nothing lost).

## 6. Rollback

- **Hide** (normal): members lose discovery and access immediately; readings, corrections, and journal entries stay.
- **Remove the collection** (publishers, collection page, only while hidden or draft, type `morning-evening`): deletes this collection's readings, import history, and revisions only. Church devotionals and all other content are untouched. Members' journal entries keep their text; their link becomes "no longer available". Equivalent SQL (only after hiding): `delete from media.collections where key = 'morning-evening';`
- **Schema rollback** (only if the feature is abandoned, after removing the collection): drop the functions created by the migration; recreate `journal.link_json`, `journal_linked`, `journal_entry_create`, `journal_entry_unlink`, `media.asset_used_visibly`, `media.asset_usage` from their previous migrations; `alter table journal.entries drop column collection_reading_id, drop column reading_date` (after setting any `collection_reading` entries to `link_kind = 'none'`, keeping their text); restore `entries_link_kind_check`; drop the five `media.collection*` tables.

## 7. Verification

| Check | How | Result |
| --- | --- | --- |
| Counts and coverage, Feb 29 | `src/lib/devotionals/morning-evening.test.ts`, dry run | 732 / 366+366 / 366 days / Feb 29 both — pass |
| Text vs source | word-stream comparison of all 732 readings; Jan 1 morning checked word for word | 0 differences besides the listed corrections |
| Text vs CCEL | — | **not run** (CCEL unreachable from the build environment); reviewer step 5 |
| Every reference opens the Bible reader | test parses all 732 references | pass |
| Rerun creates no duplicates, keeps ids | `tests/db/devotional-collections.test.ts` | pass |
| Rerun never overwrites a correction; conflict reported | DB test | pass |
| Invalid input / partial staging fails clearly, nothing applied | DB test (dry run not ok; 400 of 732 staged; malformed row) | pass |
| No notification storm | DB test and browser test count notifications, email and push outbox | unchanged — pass |
| Draft/hidden/group/youth/pending/anon access | DB test | pass |
| Today in member time zone; Dec 31 → Jan 1; Feb 28/29 in 2027/2028 | unit and DB tests, browser | pass |
| Member functions under PostgREST's read-only transactions | DB test (found and fixed a real bug: search was `stable` but writes a rate-limit row) | pass |
| Journal: one per reading/date, distinct per year, private, kept when hidden/removed | DB and browser tests | pass |
| Church devotionals unaffected | DB test; full existing suite | pass |
| UI: landing, Morning/Evening, keyboard, date picker, Today, previous/next, search, direct link, reflection, hide | `tests/e2e-local/12-devotional-collections.spec.ts`, desktop 1280px and Pixel 7 | 8/8 pass |
| Accessibility light and dark (axe WCAG 2.2 AA), no sideways scroll | same spec | pass |

The browser walkthrough ran against a local stand-in for the Supabase stack (PostgreSQL 16 with the real migrations and seed, Supabase Auth v2.170.0, PostgREST v12.2.3, a path proxy), because Docker images couldn't be pulled in the build environment. Storage wasn't available, so cover images weren't exercised in the browser.

## 8. Release

1. Owner approval to apply `20261118000100` to the hosted project.
2. Run `supabase/manual/2026-11-18-apply-devotional-collections.sql` in the SQL editor (one transaction; preflight refuses the wrong stage or a second run; self-checks; records the migration).
3. Deploy. 4. Import and publish per §5. Nothing is imported automatically.
