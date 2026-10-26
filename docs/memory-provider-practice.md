# Memory verses in licensed API versions (NIV, NASB, AMP)

Migrations `20261106000100_memory_provider_practice` (members' own verses), `20261111000100_memory_licensed_collections` (church and group collections), and `20261125000100_memory_provider_exercises` (all six exercises). Status: **built and gated**, in two steps per version, each recorded by a Bible source manager:

1. **Unchanged-text practice:** the verse page, flashcards, and self-check.
2. **All six exercises,** on screen only, after API.Bible support's written clarification (below). NIV also needs Biblica's feature approval recorded first.

Nothing is turned on by any migration.

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

## Written clarification from API.Bible support (2026-10-26)

**Record:**

- Sender: DJ Chuang, API.Bible support (support@api.bible).
- Recipient: the church's account holder.
- Date: 2026-10-26.
- Subject: "Re: Permission clarification—NIV, NASB and AMP Scripture memory exercises".
- The email itself isn't committed. Keep it with the church's license records, and name it in the source manager's note when you turn the exercises on.

**What it says, in summary:**

- **Mechanics permitted.** All six exercises are permitted for NIV, NASB, and AMP under the church's existing licenses. No separate publisher approval is needed for the exercise mechanics.
- **Masking and rearranging allowed.** Masking, revealing, tokenizing, and reordering the verbatim text are learning interactions on the real text, not changes to it.

**Conditions that apply to every version:**

1. **Verbatim and nothing altered kept.** The underlying text is always the verbatim licensed text. Any change happens only in the interface; nothing altered is stored or shared. Keeping only references and scores, not text or typed answers, "satisfies this exactly".
2. **Attribution on screen.** The abbreviation and a tappable link to the full copyright notice stay on every exercise screen during the exercise itself, not just before or after (ToS §7.2).
3. **FUMS for every display.** Report a FUMS view each time a passage is displayed to a member, including partly hidden text: once per display event per user, with the cached passage's token.

**NIV:** the church's NIV license is a direct Biblica agreement with a feature-approval clause (§V.K) for significantly new or enhanced product editions (ToS §9.4). That clause must be checked with Biblica before NIV's exercises are turned on. Nothing further is needed from API.Bible.

This resolves the earlier "Off" decisions about mechanics, and answers questions 2–4 of the list at the end of this page.

## The six exercises and the authorization

The app's six activities, as the code names them (`memory.activity`), are all reused unchanged for licensed versions. The same database functions build, hint, and score them: `memory.build_setup`, `memory.public_setup`, `memory_session_hint`, `memory.score_*`.

| # | Activity (code) | What's shown or done with the text | Unchanged-text step | All six step | Covered by the clarification |
| --- | --- | --- | --- | --- | --- |
| 1 | Read & repeat (`read_repeat`) | Whole passage, words hidden step by step, revealable | No | Yes | Masking and revealing |
| 2 | Flashcards (`flashcards`) | Reference → passage, or passage → reference | Reference → passage only | Both directions | Unchanged display |
| 3 | Missing words (`missing_words`) | Passage with blanks and a word bank (or typed blanks); hints give a blank's word | No | Yes | Masking and tokenizing |
| 4 | Word order (`word_order`) | Passage as shuffled pieces to put in order; hints place a piece | No | Yes | Tokenizing and reordering |
| 5 | Typed recall (`type_verse`) | Member types it; next-word hints; word-by-word comparison | No | Yes | Answer comparison in the interface, nothing kept |
| 6 | Self-check (`self_check`) | Reference only, recite, reveal; "it begins…" hints | No hints | With hints | Unchanged display; excerpt as a hint |

All of this is enforced in the database (`memory.translation_modes`, `memory.provider_session_start_text`, `memory_session_hint`, `memory_session_submit`) as well as in the interface. A collection, assignment, challenge, or award never unlocks a mode the version's permissions don't.

## What is stored, and what isn't

Kept permanently for a licensed passage (`memory.passages` with `source_kind = 'api'`, enforced by `passages_source`):

- reference, translation, and API.Bible passage ID;
- verse numbers;
- word count;
- a SHA-256 fingerprint of the exact wording. It's one-way and can't be turned back into text.

`verses`, `tokens`, and `segments` are **null**. Cards, attempts, history, progress, awards, and the export hold scores and dates only.

**During an exercise (20261125000100):**

- **Text for one call only.** The app's server fetches the passage through the existing integration (`fetchMemoryText`: in-memory cache, at most `cache_days`, 1 day; unchanged by this work). It passes the verses to the database for that one call only, under the key `source`.
- **Checked against the fingerprint.** `memory.provider_text` recomputes the fingerprint (NFC, then `c:v<TAB>text<NEWLINE>`, SHA-256, the same as `src/lib/memory/provider.ts`). A mismatch means the published wording changed (SQLSTATE `P0010`), and nothing is recorded.
- **Tokenized in memory.** Tokens, parts, and words are built in memory, the same way as for stored text. The returned row is never written.
- **What the session row keeps:** positions only. That means blank positions, piece ranges and ids, the flashcard direction, and the comparison settings. The word bank is dropped before the row is written.
- **What goes back to the browser only:** the session's text, word bank, pieces, hints, and answer feedback.
- **Results:** `memory.provider_result` keeps scores and counts only. Typed recall drops `your_text`, `text`, and the word-by-word `ops`. Missing words keeps right or wrong per blank and drops the expected and given words. The full feedback is returned once to the member's page.
- **No typed answer is stored.** It is sent to the server, scored, returned once, and discarded.

**Audit of other places text could end up (2026-10-26):**

| Place | Finding |
| --- | --- |
| Database rows | Session setup and results, attempts, cards, awards, passages, and the audit log are checked for the fixture wording in `tests/db/memory-provider-exercises.test.ts` and in the walkthrough. None found. |
| Server responses | `/api/memory/*` responses are `Cache-Control: private, no-store`. Pages are dynamic and private. |
| Server logs | The memory routes and `src/lib/bible/source.ts` never log bodies, URLs, or keys. Next.js logs only errors without request bodies. |
| Database logs | The text reaches Postgres as a bound parameter of a function call, which isn't logged by default. The hosted settings (`log_statement`, `log_min_duration_statement`, `log_parameter_max_length*`) couldn't be read from here (permission denied), so check them once: see the activation steps. |
| Browser storage | Nothing in `localStorage`, `sessionStorage`, or IndexedDB (checked by the walkthrough). The page keeps answers in memory only. |
| Service worker | Caches only `/_next/static/`, `/brand/`, `/icons/`, and the offline page. It never intercepts API routes or caches pages (`public/sw.js`). Checked by the walkthrough. |
| Analytics and error reporting | No analytics or error-reporting package is installed. "Report a problem" stores only a category, the member's own description, and a sanitized path (`src/lib/feedback/report.ts`). |
| Backups | The database holds no licensed text, so backups don't either. |

**Typed answers for stored-text versions.** Public-domain typed recall stores the typed and expected text in `memory.sessions.result`, as before. `memory.tick` deletes submitted sessions after 30 days. That is unchanged and never applies to licensed versions.

## How practice works

1. **Adding a verse.** The member chooses a permitted licensed version. The server fetches the passage through the existing API.Bible integration and shows it unchanged with its copyright and FUMS. When the member adds it, the server fetches again and sends only the fingerprint, verse numbers, word count, and passage ID.
2. **Starting practice.** The server fetches the text and sends its fingerprint, never the browser's. The database refuses the session if:
   - the fingerprint differs from the card's (the wording changed);
   - it's missing (the service is down and the cache has expired);
   - the mode isn't permitted.
3. **Reveal.** The server fetches the text again, checks it against the session's fingerprint, and returns it with copyright and the FUMS id. The browser shows it unchanged and reports the display to FUMS. If the wording changed mid-session, nothing is shown and the member is told.
4. **Changed wording.** API.Bible has no change notification, so the app compares fingerprints whenever it shows or starts a verse. The verse page then says the wording changed and pauses practice. **Practice the new wording** creates a fresh card; the earlier card keeps its history, and awards stay.
5. **Unavailable.** "NIV is temporarily unavailable for memory practice. Try again later; no other version is used instead."
6. **Trust.** A member who calls the database directly could send a wrong fingerprint. That only affects their own card: licensed passages are never marked superseded for everyone. A member who sends their own `source` text can only practice and score against wording whose fingerprint matches their card.
7. **All six exercises (once permitted).**
   - **Start:** the start route fetches the passage and passes it as `source`. The database checks it, builds the activity, and keeps positions only.
   - **Hints and checks:** the session route looks up the session's passage (`memory_session_source`), fetches it again, and passes it for that call.
   - **Changed wording mid-activity:** nothing is recorded and the activity closes. The member is told to open the verse and start the new wording, which gets a fresh card; history and awards stay.
   - **Permission withdrawn mid-activity:** nothing is recorded, and flashcards and self-check remain.
   - **Long passages:** practice parts are worked out from the fetch (`memory_card_parts`, no text).
8. **Attribution.** During every licensed exercise, the abbreviation and a **Copyright notice** link stay on screen:
   - **Content:** the link opens the provider's notice for that passage, with the version's recorded attribution and copyright.
   - **Placement:** the strip sticks just below the app's header, measured live, so it isn't covered when the header grows with large text. It stays out of the bottom dock's way, and keeps to one line on a phone.
   - **Typing:** focus scrolling stops below it (`scroll-padding-top`), so the typing box and buttons aren't covered with the keyboard open.
9. **FUMS display events** (`src/lib/memory/fums-events.ts`). One practice activity is one display event.
   - **When it's reported:** the first time any of its text is on screen. That's when it opens for read & repeat, missing words, word order, and passage → reference flashcards. For the others, it's the first hint, reveal, or checked result.
   - **What doesn't count again:** rerenders, moving pieces, more hints, and the result screen. These don't report again for the same activity.
   - **New events:** *Practice again*, another activity, or another verse is a new event.
   - **Never reported:** server fetches and cache refreshes. Only the member's browser reports, with the token API.Bible returned for the cached passage (`meta.fumsToken`, or the older `meta.fumsId`).
   - **Other displays:** the verse page, previews, collections, and staff previews keep reporting once per page view, as before.
   - **Open check:** the current FUMS guide (docs.api.bible) couldn't be reached from here to recheck the script call; the existing `fumsv2` integration is unchanged.

What's preserved:

- default and per-verse translation choice;
- existing progress;
- all public-domain practice;
- assignments: a licensed version can be chosen for an assigned verse when the collection allows a choice; since `20261111000100` a church or group collection can also use one (below).

## Church and group collections

Migration `20261111000100_memory_licensed_collections`. It reuses everything above: the same passages without text, fingerprints, permission table, practice modes, server-side fetches, cache, and FUMS reporting. There's no second integration.

**One eligibility rule** for every memory selector (`memory.translation_eligibility` in the database, `src/lib/memory/eligibility.ts` in the app):

| Version | Offered? |
| --- | --- |
| Published, text stored here | Yes |
| Published, licensed, memory permission recorded, API key set on the server | Yes, marked *licensed, flashcards and self-check only* |
| Published, licensed, no permission recorded | Disabled: *not confirmed for memory verses* |
| Published, licensed, permission recorded, key setting missing | Disabled: *not connected on this server* |
| Draft or retired | Not listed |

Being published never stands in for the memory permission. The database can't see the server's environment, so the app adds the key check before it offers a version or saves or publishes a collection. The database enforces the rest.

**What's stored per assigned licensed verse:** the same as a member's own licensed verse (reference, passage ID, verse numbers, word count, fingerprint), plus the editorial title, note, hint, and dates. The text never is, so admin and member pages fetch it through `fetchMemoryText` whenever they show it (1-day in-memory cache, copyright from the API, FUMS on every display). Staff see a verse's text on request (*Show the text*), not every verse at once.

**Practice:** an assigned licensed verse becomes a card on the existing licensed path (`memory.provider_session_start`). Only flashcards and self-check exist, and they're refused in the database otherwise. A collection, assignment, challenge, or award unlocks no other mode. Assignment windows, reminders, challenges, and the *collection explored* award read attempts and cards as before. Each attempt counts once; replayed submits count nothing.

**Fixed version or member choice:** unchanged. Off, the collection's version is required (`memory_card_add` and `memory_card_change_translation` refuse others). On, each member may add or move an assigned verse to another eligible version for themselves. The collection, its passages, and other members never change.

**Wording changes:** the fingerprint shows staff that the published wording changed. *Use the current wording* calls `memory_admin_item_update_text(item, reason, provider)` and records the change in `memory.item_versions`. Members on the earlier wording are asked to switch, as for stored text. A member who already started the new wording on their own isn't asked again.

**Permission withdrawn or key removed:** no new collections, verses, publishing, duplicates, or cards in that version, and sessions are refused. Collections stay visible with their verses, and cards, progress, and history are kept. Pages explain the state. Nothing is switched to another version.

**Youth:** licensed collections are hidden from youth accounts (`memory.collection_visible`). They're excluded from youth learning assignments and guardian-led practice. Stored-text collections are unchanged. Opening licensed collections to youth is a separate decision.

**Setup, per version, once approved:**

1. A Bible source manager records the version's terms under **Administration → Bible sources → (version) → Memory verses** (see the next section for what to check). This PR changes no permission.
2. The version's API key setting (for example `API_BIBLE_KEY`) is set in Vercel for the environment, and `API_BIBLE_BASE_URL` is unset or an API.Bible address.
3. The version then appears enabled in **Administration → Memory verses → New collection → Bible version**.

**Verification (2026-10-23, local only):**

- **Database** (`tests/db/memory-licensed-collections.test.ts`, 18 tests, PostgreSQL 16 from every migration). Covers: eligibility (published-only, draft never listed, permission required); creating NIV, NASB, and AMP collections; group leaders; adding verses from the app's fetch; publishing; duplicating; restricted modes refused; fixed version vs member choice; challenge counts with replays; the *collection explored* award once; no licensed wording in any memory table or the audit log; staff wording updates; permission withdrawn and restored; youth accounts; public-domain collections.
- **Full suite:** `npm test` with `TEST_DATABASE_URL`, serial: 1172 passed. Lint and typecheck pass.
- **Browser** (`tests/e2e-local/10-memory-licensed-collections.spec.ts`, local `supabase start` with every migration and the seed, production build, Chromium, desktop and Pixel 7): 6 passed. The two administrator flows run on desktop only. The server had a synthetic `API_BIBLE_KEY`, and API.Bible wasn't reachable, so every licensed fetch shows the outage state. No real NIV, NASB, or AMP text was fetched or shown. Set `MEMORY_SHOTS=<folder>` to save screenshots.
- **Screenshots** (synthetic data): [docs/screenshots/memory-licensed-collections/](screenshots/memory-licensed-collections/).
- **Not verified:** a successful fetch with the church's real key (needs a deployment with the key, after approval).

## Verification of the six exercises (2026-10-26, local only)

**Fixture tests**

- **Committed text:** synthetic stand-ins only (`tests/fixtures/memory/api-bible-synthetic.json`, and inline in the DB tests). No licensed wording is committed.
- **Database** (`tests/db/memory-provider-exercises.test.ts`, 25 tests, PostgreSQL 16 from every migration):
  - **Controls:** both permission steps, the note, and the audit record; NIV's publisher approval, and its unchanged-text practice intact.
  - **Activities:** each of the six in NASB- and AMP-shaped fixtures, including hints and correct answers; the *explorer* award once.
  - **Storage:** no fixture wording in any stored row.
  - **Failures:** changed and missing wording, expiry, and permission withdrawn mid-activity.
  - **Helpers and old paths:** staff preview, practice parts, and public-domain practice unchanged.
  - **Hashing:** fingerprints come from the app's own `providerPayload`, so app and database hashing are checked to agree, including a decomposed é (NFC).
- **Unit:** FUMS display-event boundaries (`src/lib/memory/fums-events.test.ts`), and the local fixture fetcher, which is refused for any non-loopback Supabase (`src/lib/bible/local-fixture.test.ts`).
- **Full suite:** `npm test` with `TEST_DATABASE_URL`, serial: 1578 passed. Lint and typecheck pass.

**Browser walkthrough** (`tests/e2e-local/11-memory-provider-exercises.spec.ts`)

Run against a local `supabase start` with every migration and the seed, a production build, Chromium, desktop and Pixel 7. The server used `API_BIBLE_FIXTURE_FILE` and a synthetic key: 9 passed, plus spec 10 alongside it (15 passed in all, 5 single-device skips). It checked:

- adding a licensed verse and all six activities on the fixture;
- the strip on screen, below the header and clear of the dock, during each activity and its result;
- the copyright dialog;
- exactly one FUMS report per activity, with none for rerenders, moved pieces, more hints, or results, and a new one for *Practice again* (a stubbed tracker counts the reports);
- a 360×400 viewport with 150% text and the typing box focused, to stand in for a small phone with the keyboard open;
- no fixture text in `localStorage`, `sessionStorage`, IndexedDB, the service-worker cache, or practice records;
- NIV limited to two activities, with its admin control disabled pending approval;
- outage and changed-wording states;
- axe accessibility checks.

**Screenshots:** [docs/screenshots/memory-provider-exercises/](screenshots/memory-provider-exercises/), synthetic text.

**Not verified here (live provider)**

- the church's real key and API.Bible responses for NIV, NASB, and AMP;
- the live FUMS script and its reports;
- the current FUMS guide (unreachable);
- a physical phone's keyboard;
- hosted database log settings.

## Activation steps (manual, per version)

Nothing is turned on by any migration. In order:

1. **Apply the migrations** in order (operator scripts in `supabase/manual/`), after approval.
2. **Unchanged-text practice:** a Bible source manager opens **Administration → Bible sources → (version) → Memory verses**, records what they checked, and ticks *Offer … for memory verses, shown unchanged*. NIV, NASB, and AMP already have this on hosted.
3. **All six exercises, NASB and AMP:** on the same page, under **All six exercises**, enter the written permission relied on (API.Bible support, DJ Chuang, 2026-10-26), tick *Offer all six memory exercises for …*, and save. This is audited (`memory.provider_exercises`).
4. **All six exercises, NIV:** first check the direct Biblica agreement's feature-approval clause (§V.K) with Biblica. When written approval is in hand, record it under **NIV: publisher feature approval**: tick the box, note who approved it, when, and where it's kept, then save. Then tick *Offer all six memory exercises for NIV*. Until then, NIV stays on flashcards and self-check, exactly as now.
5. **Server settings:** make sure the version's API key setting (`API_BIBLE_KEY`) is set in Vercel. Never set `API_BIBLE_FIXTURE_FILE` there: it's only honoured with a loopback Supabase, but it has no place in a deployment.
6. **Database log settings (once):** confirm the hosted settings don't log function parameters: `log_statement = none`, `log_min_duration_statement = -1`, and `log_parameter_max_length_on_error = 0`.
7. **Live check:** on a protected preview with the church's key, run one activity per version. Confirm that the strip and notice show the provider's copyright, and that FUMS reports once per activity in the browser's network panel. The fixture tests can't confirm this.

Turning a version's exercises off returns it to flashcards and self-check. Turning unchanged-text practice off pauses everything. Members' verses, progress, and history are kept either way.

### Per-version information to keep on file

1. **Use permitted.** The version's license as shown in the dashboard for this application, and whether it allows display in a "memory verse" or curriculum feature (not only general reading). NIV is published by Biblica; NASB 2020 and AMP by The Lockman Foundation. Each may set its own terms through API.Bible.
2. **Caching.** Any version-specific cache limit stricter than the general 30 days. We use 1 day.
3. **Copyright notice.** The exact notice and where it must appear (we show the API's `copyright` field with every displayed passage), and any short-form or "used by permission" wording.
4. **Verse and quotation limits.** Any per-view or per-application verse limits for the version. Memory passages are capped at 30 verses and 900 words.
5. **Plan and commercial status.** Whether the church's API.Bible plan (Starter or otherwise) permits this use, and whether a visible api.bible link is required.

## Questions sent to API.Bible (answered 2026-10-26)

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

Answered in writing on 2026-10-26 (above):

- **Questions 2–3:** all six mechanics are permitted, with nothing altered stored. Typed answers are reduced to scores.
- **Question 4:** report every display, including partly hidden text, once per display event per user.
- **Question 1:** the reply says that keeping references and scores, not text, satisfies the storage condition.
- **Question 5:** not addressed; fingerprint comparison stays as built.
