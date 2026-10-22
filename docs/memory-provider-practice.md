# Memory verses in licensed API versions (NIV, NASB, AMP)

Migration `20261106000100_memory_provider_practice`. Status: **built and gated**. Nothing is offered to members until a Bible source manager records, per version, that its own terms permit memory practice.

## What the official guidance establishes

The owner read these pages, which are unreachable from the build environment:

| Source | Updated | What it says |
| --- | --- | --- |
| [API.Bible: Caching Content](https://care.api.bible/article/401-caching-content) | 2026-08-19 | Cached content must be refreshed at least every 30 days, and every 14 days or less is recommended. Content integrity must be preserved; modification isn't permitted. There's no endpoint that announces content changes. |
| [API.Bible: Common Integration Patterns](https://care.api.bible/article/411-common-integration-patterns) | 2026-10-01 | A memory verse in a curriculum module is listed as an integration pattern. Fetch by passage or verse ID, and cache subject to the applicable licensing policies. FUMS tracking is required for web display, including cached content. |

This supports showing a licensed memory verse **unchanged**, fetched by passage ID, with FUMS. It doesn't establish:

- permission to hide, blank, scramble, or reorder words;
- permission to keep typed answers that may reproduce the passage;
- each translation's own terms. Public guidance doesn't replace the NIV, NASB, or AMP license.

**Cache:** unchanged at **1 day** (`cache_days = 1` on all three), well inside both the 30-day requirement and the 14-day recommendation. A licensed practice session lasts at most that long.

## Practice modes, assessed one by one

| Mode | What the member sees | Status for licensed versions | Why |
| --- | --- | --- | --- |
| Verse page | Full passage, as returned, with copyright and FUMS | **Built** (once the version is confirmed) | Unchanged display of a memory verse: the documented pattern. |
| Flashcards, reference → passage | Reference, then the full passage, unchanged | **Built** (once confirmed) | The text is shown only unchanged. |
| Self-check (recite, then reveal) | Reference, then the full passage, unchanged | **Built** (once confirmed) | Same as flashcards. Records only the member's own confidence. |
| Self-check hints ("it begins…") | The first few words | **Off** | A partial excerpt; whether excerpting counts as modification is unresolved. |
| Flashcards, passage → reference | The full passage on the front | **Off** | Unchanged, but it would put the text in the stored session setup. Could be rebuilt to fetch at display time if wanted. |
| Read & repeat | The passage with words progressively hidden | **Off** | Hides words: a modified presentation. |
| Missing words (fill in the blank) | The passage with blanks and a word bank | **Off** | Modified presentation. The answer key is drawn from the text. |
| Word order | The passage split into shuffled pieces | **Off** | Modified presentation (scrambled). |
| Typed recall | The member types it; a word-by-word comparison is shown and stored | **Off** | The comparison shows the text with marks, and the stored result would keep the typed answer and the expected text. |

"Off" is enforced in the database (`memory.provider_session_start`, `memory_session_hint`) and in the interface, not just hidden. The permission table can only record unchanged-text practice. Enabling any "Off" mode needs written permission and then a reviewed code and migration change.

## What is stored, and what isn't

Kept permanently for a licensed passage (`memory.passages` with `source_kind = 'api'`, enforced by `passages_source`):

- reference, translation, and API.Bible passage ID;
- verse numbers;
- word count;
- a SHA-256 fingerprint of the exact wording. It's one-way and can't be turned back into text.

`verses`, `tokens`, and `segments` are **null**.

Never stored:

- **Passages, sessions, results, attempts, history, export:** no verse text. Typed answers are impossible for these versions.
- **Server:** the text lives only in the existing in-memory cache (`src/lib/bible/source.ts`), for at most `cache_days`, and is never logged. The memory API routes don't log bodies.
- **Browser:**
  - responses are `Cache-Control: private, no-store`;
  - revealed text is held only in the page's memory;
  - nothing goes to `localStorage`, `sessionStorage`, or IndexedDB;
  - no analytics package is installed.
- **Backups:** the database contains no licensed text, so backups don't either.

**Typed-answer audit (stored-text versions only).** Typed recall in public-domain versions stores the member's typed text (up to 20,000 characters) and the expected text in `memory.sessions.result`. `memory.tick` deletes submitted sessions after 30 days and unsubmitted ones 2 days after they expire. Attempts and history keep only scores. This is unchanged, and it can't happen for licensed versions.

## How practice works

1. **Adding a verse.** The member chooses a permitted licensed version. The server fetches the passage through the existing API.Bible integration and shows it unchanged with its copyright and FUMS. When the member adds it, the server fetches again and sends only the fingerprint, verse numbers, word count, and passage ID.
2. **Starting practice.** The server fetches the text and sends its fingerprint, never the browser's. The database refuses the session if:
   - the fingerprint differs from the card's (the wording changed);
   - it's missing (the service is down and the cache has expired);
   - the mode isn't permitted.
3. **Reveal.** The server fetches the text again, checks it against the session's fingerprint, and returns it with copyright and the FUMS id. The browser shows it unchanged and reports the display to FUMS. If the wording changed mid-session, nothing is shown and the member is told.
4. **Changed wording.** API.Bible has no change notification, so the app compares fingerprints whenever it shows or starts a verse. The verse page then says the wording changed and pauses practice. **Practice the new wording** creates a fresh card; the earlier card keeps its history, and awards stay.
5. **Unavailable.** "NIV is temporarily unavailable for memory practice. Try again later; no other version is used instead."
6. **Trust.** A member who calls the database directly could send a wrong fingerprint. That only affects their own card: licensed passages are never marked superseded for everyone.

What's preserved:

- default and per-verse translation choice;
- existing progress;
- all public-domain practice;
- assignments: a licensed version can be chosen for an assignment only when the collection allows a choice, and church collections stay stored-text only.

## Before enabling NIV, NASB, or AMP

For each version, a Bible source manager opens **Administration → Bible sources → (version) → Memory verses**, records what they checked, and ticks *Offer … for memory verses, shown unchanged*. Information still needed from the API.Bible dashboard and license, per version:

1. **Use permitted.** The version's license as shown in the dashboard for this application, and whether it allows display in a "memory verse" or curriculum feature (not only general reading). NIV is published by Biblica; NASB 2020 and AMP by The Lockman Foundation. Each may set its own terms through API.Bible.
2. **Caching.** Any version-specific cache limit stricter than the general 30 days. We use 1 day.
3. **Copyright notice.** The exact notice and where it must appear (we show the API's `copyright` field with every displayed passage), and any short-form or "used by permission" wording.
4. **Verse and quotation limits.** Any per-view or per-application verse limits for the version. Memory passages are capped at 30 verses and 900 words.
5. **Plan and commercial status.** Whether the church's API.Bible plan (Starter or otherwise) permits this use, and whether a visible api.bible link is required.

## Questions to send API.Bible

1. **Storage without text.** For NIV, NASB 2020, and AMP: may our server keep, per member and indefinitely, the passage reference, the API.Bible bible ID and passage ID, verse numbers, a word count, scores and review dates, and a one-way SHA-256 fingerprint of the passage text? We keep no verse text beyond our 1-day cache.
2. **Modes that hide or rearrange words.** The Caching Content article says content integrity must be preserved and modification isn't permitted. For each of these, does the following presentation count as a prohibited modification, for NIV, NASB 2020, and AMP?
   - **(a)** Showing the passage with some words visually hidden, which the member reveals one at a time ("read and repeat").
   - **(b)** Showing the passage with some words replaced by blanks, plus a list of the missing words to choose from ("fill in the blank").
   - **(c)** Showing the passage's words or phrases as shuffled pieces that the member puts back in order ("word order").
   - **(d)** Showing only the first few words of the passage as a hint.

   Please answer separately for each presentation and each translation.
3. **Typed recall.** May a member type the passage from memory and be shown a word-by-word comparison against the API text, with differences marked? May we store the typed answer (which can reproduce the passage) beyond our cache window, or must it be deleted or reduced to a score within it?
4. **FUMS.** Must a FUMS event be sent for every display of a cached passage in a practice session, including a passage revealed only after the member asks? Is one event per reveal correct?
5. **Change detection.** With no content-change notification endpoint, is comparing a fingerprint of the fetched text on each display an acceptable way to detect revised wording?

Until these are answered in writing, the "Off" modes stay off.
