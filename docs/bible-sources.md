# Bible sources and translations

Who: **Bible source managers** (`bible_source_manager` role, capability `bible.manage`; super administrators hold it implicitly).
Where: **Admin → Bible sources** (`/admin/bible/sources`).

The app never generates, paraphrases, completes, or combines scripture. Every verse belongs to exactly one translation, is shown with that translation's code and attribution, and comes from a source the church has confirmed it may use.

## Choosing a source

| Source | How members get text | Status in this build |
| --- | --- | --- |
| **Stored text** (structured import) | Verses imported from a CSV/TSV/verse-per-line file, reviewed, and published into the database | **Works and tested** (database tests + unit tests) |
| **API.Bible** (American Bible Society) | Fetched on the server per passage with the church's key | **Works in production** with the church's key and licensed translations (confirmed 2026-10-22); unit tests use recorded response shapes (see below) |
| **Bible PDF** | Never shown to members. Kept as a private reference for administrators | Upload, checks, and restricted preview work |

### The church hasn't chosen a translation yet

Until it does, use the **World English Bible (WEB)** for testing. It is public domain and clearly labelled as WEB wherever it appears; it is never substituted for another translation.

- **Rights (verified 2026-10-20 through search results of eBible.org's copyright page; ebible.org itself was blocked from this environment):** the WEB is dedicated to the public domain. "World English Bible" is a trademark of eBible.org; if the text is changed in any way it must not be called the World English Bible. The app doesn't change wording, so the name is used. Sources: [ebible.org/web/copyright.htm](https://ebible.org/web/copyright.htm), [ebible.org/eng-web/copyright.htm](https://ebible.org/eng-web/copyright.htm).
- **The data used here:** the npm package `world-english-bible@1.0.1` (a JSON conversion of eBible.org's WEB HTML), downloaded from the npm registry and checked against its published SHA-512 by `scripts/bible-prepare-web.mjs`. The script changes whitespace only (joins verse segments, poetry lines with a line break, trims spaces) and writes the CSV for import. 31,103 verses; the five verses the WEB leaves empty (Luke 17:36, Acts 8:37, 15:34, 24:7, Romans 16:25) are flagged in review for an explicit "deliberately omitted" decision.
- **Because the conversion is third-party,** spot-check the review page against [ebible.org/web](https://ebible.org/web/) before publishing (the review page shows staged chapters with line references for this).

Suggested WEB settings: rights **Public domain**, attribution "World English Bible (WEB). Public domain. eBible.org.", copy/print/export allowed, caching not needed (stored text).

```bash
# Download the package from the npm registry (do not install it), then:
curl -sO https://registry.npmjs.org/world-english-bible/-/world-english-bible-1.0.1.tgz
node scripts/bible-prepare-web.mjs --tarball world-english-bible-1.0.1.tgz --out web.csv
```

### American Standard Version (ASV), offered beside the WEB

The ASV (1901) is the second public-domain version, so members can choose between WEB and ASV (see [bible-reading-guide.md](bible-reading-guide.md#choosing-your-bible-version)). The WEB stays the church's default; the ASV is added as another active translation.

- **Rights:** published in the United States in 1901; public domain. No trademark or naming condition.
- **The data used here:** `eng-asv.zefania.xml` from [seven1m/open-bibles](https://github.com/seven1m/open-bibles) at a pinned commit (Zefania XML by the Free Bible Software Group, which names Biola University's Unbound Bible ASV as its source). `scripts/bible-prepare-asv.mjs` checks its SHA-256, refuses DOCTYPE/entity declarations, and changes typography only (backtick apostrophes become ’, spaces collapse). 31,102 verses.
- **Why this copy:** three ASV copies were compared verse by verse; see [asv-crosscheck.md](asv-crosscheck.md). Only this copy is used. The cross-check lists the 63 verses where it disagrees with both others; spot-check them against a printed ASV or [ebible.org/asv](https://ebible.org/asv/) in the review before publishing.
- **What the review will show:** Romans 16:26–27 as *beyond the usual numbering* (the ASV places the doxology at 16:25–27; keep them) and Romans 14:24–26 as *missing* (acknowledge). No verses are empty: the ASV prints verses such as Acts 8:37 in square brackets (its margin readings), and the brackets are kept, as are `[supplied words]`. There are no Psalm superscriptions or poetry line breaks in this source.

Suggested ASV settings: code **ASV**, name "American Standard Version (1901)", rights **Public domain**, attribution "American Standard Version (1901). Public domain.", copy/print/export allowed. Activate it; leave WEB as the default (or make ASV the default if the church prefers).

```bash
# Download the pinned file (raw.githubusercontent.com), then:
curl -sO https://raw.githubusercontent.com/seven1m/open-bibles/f257a3559025c3f873b48a75019f53a9354ed7de/eng-asv.zefania.xml
node scripts/bible-prepare-asv.mjs --xml eng-asv.zefania.xml --out asv.csv
```

A plan is prepared and validated in one translation (its own). Members who prefer another version read each day's passages in that version when the passage exists there; otherwise that passage is shown in the plan's version with a note. Every passage is labelled with its code, and verses are never mixed within one passage.

### Licensed translations

Check the publisher's **current** terms before configuring, and record what you checked in the translation's "What the license says" field. Summaries found 2026-10-20 (from search results; the official pages were unreachable from this environment, so confirm them):

- **API.Bible**: API key per application; caching allowed but refreshed at least every 30 days; **FUMS tracking script required** on web pages that show its scripture; copyright text (from the API's `copyright` field) shown with every passage; Starter plan apps must show a visible link to api.bible; commercial use needs a paid license; no sub-licensing; passage length limits are stated differently in different places (200 vs 500 verses), so check. Sources: [docs.api.bible](https://docs.api.bible/quick-start/licensing-and-access), [care.api.bible](https://care.api.bible/article/396-licensing-policies-quick-reference), [api.bible/faq](https://api.bible/faq).
- **ESV API** (Crossway): non-commercial use; at most 500 verses per query or half a book; rate limits; a required copyright notice. No ESV adapter is built; it could be added beside API.Bible. Sources: [api.esv.org](https://api.esv.org/), [Crossway permissions](https://www.crossway.org/permissions/).

**Uploading a Bible PDF doesn't grant permission to redistribute its text.**

## Adding a translation

1. **Admin → Bible sources → Add a translation.** Enter a short code (shown beside every passage), the name, and where the text comes from.
2. **Rights and permissions.** Everything starts at the most restrictive setting:
   - basis (not verified / public domain / licensed / written permission) and notes on the terms;
   - whether a temporary copy may be kept (and for how many days, at most 30);
   - whether members may copy, print, or include text in exports (copy and print are browser courtesies: the reader disables selection and hides text when printing, but these can't be enforced against a determined person);
   - the most verses shown on one page;
   - for API.Bible, whether its tracking script is required.
   Tick **"I've checked the current terms…"** to confirm. Changing any permission later clears the confirmation; on an active translation you must confirm again in the same save.
3. **Text** (stored-text translations): upload a file, review, publish (below).
4. **Activate** by typing the code. Requires confirmed rights and published text (or, for API sources, the provider's Bible ID and the setting name).
5. **Make it the church's default** (used by the reader and new plans).

Retiring a translation is refused while published plans use it or it's the default.

## Importing text (staged review)

Formats (UTF-8, up to 50 MB):

- **CSV / TSV** with a header row `book,chapter,verse,text` and optional `heading,paragraph,poetry` (`1`/`true`). `book` is a USFM code (`GEN`, `1CO`, `JHN` …) or a book name. Quoted values can contain commas and line breaks (poetry lines).
- **Verse per line** (`.txt`): `GEN 1:1 In the beginning…`; lines starting with `#` are comments.

Flow:

1. On the translation page, **Import text** → choose the file. It uploads straight to the private `bible` bucket (progress and cancel), then the server reads it back with size limits, parses it, and stages every line. **Nothing is visible to members.**
2. **Review** (`/admin/bible/sources/imports/<id>`):
   - Summary counts.
   - **Flagged lines**, each with its source reference (`line 1234`):
     - *no text* → accept as a deliberately omitted verse (members see "This verse isn't included in this translation");
     - *beyond the usual numbering* → keep (versification differs);
     - *couldn't be read* / *unknown book* → leave the line out (its verse then counts as missing);
     - *repeats an earlier line* → can't be accepted: fix the file.
   - **Missing verses**: verses the reference numbering expects in the chapters the file covers that no line provides.
   - **Staged text** of any chapter with line references, to compare against the source.
3. **Publish**: every flagged line decided, no duplicates, missing verses acknowledged, and the translation code typed. Publishing replaces the translation's stored text as a whole, in one transaction, and reports plan passages that no longer fit. Staged lines are then deleted (the summary is kept).

Nothing is ever repaired, guessed, or filled in. If a line is wrong, fix the file and import again.

## Reference PDFs

**Bible sources → Reference PDFs.** Enter the translation, where the file came from, attribution, and the permission statement, and confirm. The PDF uploads to the private bucket; the server checks the `%PDF` signature, size (50 MB), page count (20,000), and whether pages carry selectable text or scanned images. Opening it uses a 5-minute signed link for source managers only (`/api/bible/references/<id>`). It is never shown to members or publicly downloadable.

**Why no text is extracted from PDFs:** print layouts (columns, footnotes, cross-references, drop-cap chapter numbers, running heads) don't preserve verse boundaries reliably, and scanned pages would need OCR, which guesses. Use the structured import (or a licensed API) for member-facing text; the PDF stays as the reference to check it against.

## API.Bible configuration

1. Get a key from API.Bible for the church's application and plan. The key decides which Bibles it can read (the ones the church has permission for).
2. In Vercel, add the key as a **sensitive** environment variable (for example `API_BIBLE_KEY`) for the environments that should read it, and redeploy. Optional: `API_BIBLE_BASE_URL` (only `https://rest.api.bible/...` or `https://api.scripture.api.bible/...` are accepted; anything else disables the source).
3. **Add a translation** → source **API.Bible** → keep (or type) the **name** of the variable (never the key) → **Show the Bibles this key can use**. This asks API.Bible's `GET /v1/bibles` and lists each Bible with its `bible_id` (e.g. `de4e12af7f28f599-01`). **Use this** fills the Bible ID, code, name, and language; check them, add the copyright and attribution wording the license requires, and save. Repeat for each licensed translation. The Bible ID is always the `bible_id`, never the shorter DBL ID (`de4e12af7f28f599`), which several editions share. The key stays on the server; requests go only to the provider's hosts (fixed allowlist, no redirects, public addresses only, 8-second limit).
4. Confirm the terms (FUMS, notices, caching, verse limits) and check passages on a preview before activating.

Caching: when the translation allows it, a copy is kept in the server's memory (per instance) for at most the configured days, keyed by translation, text version, and passage. It is never written to the database and never reused for another translation. When the provider is down or the key is missing, members see "This passage isn't available right now"; nothing else is shown in its place.

## Reusing scripture (memory verses, Phase 9)

References everywhere use the same identifiers: translation id + USFM book code + chapter + verse (`bible.books`, `bible.verses`). Phase 9 can read verses through `bible_passage` without copying Bible data.
