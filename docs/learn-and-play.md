# Learn & Play (Youth & Families)

The foundation for activities in the Youth & Families area: versioned activity content, illustrated browsing, an editor for authorized youth content staff, and private progress stored on the right child. Two interactive games are built on it: **Put the Story in Order** and **Bible Match** (see "Games" below). Other activity types still use "Mark finished".

Games: migration `20261123000100_youth_activity_games` (operator script `supabase/manual/2026-11-23-apply-youth-activity-games.sql`, **not applied to hosted**). Tests: `tests/db/youth-activity-games.test.ts`, `src/lib/youth/games/games.test.ts`.

Foundation: migration `20261118000200_youth_activities` (operator script `supabase/manual/2026-11-18-apply-youth-activities.sql`, objects applied to hosted 2026-10-24; history row recorded 2026-10-24 by `supabase/manual/2026-11-18-record-youth-activities.sql`). Tests: `tests/db/youth-activities.test.ts`, `src/lib/youth/activities.test.ts`.

## Member experience

`/youth` is organized into three sections:

1. **Learn & Play**: illustrated cards for published activities open to a child the viewer may play for (up to six, lesson-of-the-week first), with a link to browse all.
2. **This Week's Lesson**: activities whose lesson week is the current week (church time zone) and the youth groups' current learning assignments (memory verses, reading plans, lessons).
3. **For Parents**: the family dashboard, linking a child, groups, events and permission forms (per child on the family dashboard), the leader and administration entry points, and youth announcements. Nothing that was reachable before was removed.

Independent youth accounts see Learn & Play and This Week's Lesson first, then their announcements, events, and groups as before.

- `/youth/play` browses every activity open to the viewer, filtered by type (Bible story, Quiz, Matching, Puzzle, Drawing & coloring, Word game) and difficulty (**Beginner, Growing, Challenge**). Filters are plain links (`?type=…&level=…`), so they work without JavaScript and are remembered by "Back to Learn & Play".
- `/youth/play/[id]` shows the activity, its Bible story, Scripture references, and lesson connection. A guardian picks **who's playing** each time (`?child=…`); progress is shown and saved only for that child. A youth always plays as themselves.
- Ages are shown as guidance only ("Suggested for ages 4–7 (a suggestion, not a rule)"); nobody is refused because of age.
- Older-youth activities (suggested from age 11) and everything a youth account sees use a calmer style: a charcoal band with gold line art, the serif title, square-ish corners, and no playful lift.
- Without an uploaded cover, a card shows an original line illustration for its type (drawn in `src/components/youth/activity-art.tsx`, decorative, hidden from screen readers).
- Activities with a game (below) show it on the page; the rest offer **Mark finished / Mark not finished**, which really saves progress for the chosen child. No placeholder buttons are shown.

Empty states: "Activities will appear here when they're published"; adults with no child they may play for are told why (verification, or the *Practice with the child* permission, or the child has their own account).

## Games

Both games are players shipped with the app. A version opts in with `config.player`: `story_order` on a **Puzzle** activity, `bible_match` on a **Matching** activity. The configuration is data only (validated in the app and again in the database); staff never type it. Puzzle and Matching activities without a game keep "Mark finished".

### Put the Story in Order

- Staff add illustrated scenes **in the correct order**: a picture, a short caption, and optionally a picture description (for people who can't see it), a hint clue, and "what happened" (shown at the end, with the verse). An optional closing explanation follows the story.
- Children see the scenes shuffled (never already in order) and arrange them three equal ways: **drag** a scene by its handle (mouse, touch, or pen; pointer events, so it works on phones), **tap** a scene then tap the place it goes, or the **Move earlier / Move later** buttons (keyboard and switch access). Every move is announced to screen readers.
- **Check my order** says how many are in the right place and marks them; nothing is taken away. **Try again** clears the message. **Hint** puts the first misplaced scene in its place, pins it, and shows its clue. **Start over** reshuffles.
- Difficulty sets the scenes and hints: **Beginner** 3–4 scenes and 3 hints per try; **Growing** 4–6 and 2; **Challenge** 5–8 and 1.
- When the order is right: the story in order with each scene's explanation and the closing text, focus moves to the "You put the story in order!" heading, and **Play again** reshuffles.

### Bible Match

- Staff choose **identical pairs** (two cards with the same picture) or **related pairs** (two different cards, like a person and an object from their story, each with a picture, a name, or both, and a required short explanation shown when matched). Identical pairs may have an optional note too.
- Staff choose the **board sizes** children can pick (3, 4, 6, 8, 10, or 12 pairs; the smallest is the starting board) and whether to show a **turn counter**. The counter is only a count: no timer, score, or ranking.
- Cards are buttons in a grid. Tap or click to turn one over; **arrow keys** (and Home/End) move between cards and **Enter or Space** turns one over.
- A miss stays face up until the next tap ("Fish and Dove aren't a pair this time"), or **Turn them back**; nothing is timed.
- Every tap is applied one at a time to the latest board (`matchReducer`), so rapid tapping can't turn a third card, match a pair twice, or count a turn twice.
- The board (which pairs, in which places) comes from a seed saved with progress, so it stays the same through the session, a reload, or a resume on another device.

### Pictures

Each scene or card picture is one of:

- a **built-in illustration**: 20 original line drawings shipped with the app (`src/components/youth/games/game-art.tsx`; ark, animals, rain, dove, rainbow, crowd, loaves and fish, bread lifted in thanks, baskets, fish, bread, star, sling, stone tablets, big fish, person, lamb, crown, oil lamp, sheep), checked against `youth.game_art_keys()`;
- **artwork uploaded for the activity**, chosen in the editor; or
- a **new upload made right in the scene or card** (same pipeline, rights confirmation, and source record as the artwork form).

Members can read an uploaded game picture only when the published version's game uses it and the activity is open to them. Pictures used by a published version are kept; pictures used by the draft's game can't be removed until the draft stops using them.

### Administration

- In the editor, choosing **Puzzle** or **Matching** shows the game form: add, reorder (Up/Down), and remove scenes or pairs, pick pictures, and fill in the text. "No game" keeps the activity as "Mark finished".
- While editing, **Before this can be published** lists what's missing: scene counts for the difficulty, scenes without a picture or caption, fewer than 3 pairs, cards without a picture (identical) or without a picture or name (related), related pairs without an explanation, cards in different pairs that look the same, board sizes larger than the pairs. The database checks the same rules (`youth.game_config_issues`) and refuses to publish until they're met; the Publishing panel lists them too. A draft can be saved incomplete.
- On save the database refuses malformed games: the wrong activity type, missing or duplicate identifiers, unknown built-in pictures, pictures from another activity, too many scenes (8) or pairs (12), unsupported board sizes, text that's too long, and anything that looks like markup.
- **Preview** shows the game playable, exactly as members get it, without saving.
- **Publishing** now also asks the editor to confirm they've checked the story, scenes, and pairs against the Scripture references and previewed it.
- **Demonstration games:** "Add demonstration drafts" on the activities page creates four original examples as private drafts (skipping any already in the list): *Noah and the Rainbow Promise* (story, Growing, Genesis 6–9), *Jesus Feeds a Big Crowd* (story, Beginner, John 6:1-13), *Bible Picture Pairs* (identical, Beginner), and *Who Had What?* (related, Growing: Noah/ark, Moses/tablets, David/sling, Jonah/big fish, the wise men/star, the boy/loaves and fish). Every scene and pair names its Scripture; the change note asks for review before publishing. Nothing is published automatically.

### Progress

- Saved privately through `youth_activity_progress_save`, on the chosen child and the exact version, with the same checks as before. Saved data: Story `{game, seed, order, pinned, hints_used, checks, solved, completions}`; Match `{game, size, seed, matched, moves, solved, completions}`.
- Moves are saved shortly after they happen (one save at a time, always the latest), checks and finishing at once, and anything waiting when the page is hidden. Pages are refreshed only when the status can change (first save, finishing), so cards stay right without a reload on every move.
- **Resume:** opening the activity again restores the board, the pinned scenes, hints used, and pairs found. Saved data that doesn't fit the version (or was tampered with) starts a fresh board.
- **Replay:** once a version is finished it stays finished; **Play again** starts a new board without erasing it (the database keeps the completion unless "Mark not finished" sends `reset`). The page says "finished this. Play again any time; it stays finished."
- **New versions:** a page still showing the old version gets a conflict ("This activity was updated…") and nothing is written; earlier progress stays with its version and the child starts the new one fresh. A save from another tab or device asks to reload rather than overwrite.
- No scores, rankings, or comparisons are stored or shown; the optional turn count is the child's own and only visible to them and their guardians.

## Who can do what

| | Activity editor (`youth.activities`) | Verified guardian with *Practice with the child* | Guardian with *See learning progress* only | Independent youth | Youth leader | Super administrator, other staff |
| --- | --- | --- | --- | --- | --- | --- |
| Create, edit, preview, publish, archive, upload artwork | ✓ | — | — | — | — | — (unless also given the role) |
| See published activities | in preview | open to one of their playable children | — | open to them | — | — |
| Play and save progress | — | for a child profile without its own account, chosen explicitly | — | for themselves | — | — |
| See a child's progress (status and saved work) | — | that child | counts only (`youth_activity_progress_summary`); for an independent youth only if they share | their own | — | — |
| Aggregate counts | how many children have progress on the published version (never who) | — | — | — | — | — |

- `youth.activities` is granted only through the **Youth activity editor** role. Like every `youth.*` capability, super administrators don't get it implicitly.
- "Open to a child": the activity is published, inside its availability window, not archived, and either assigned to no groups or to a group the child is actively enrolled in. The child must be active, unrestricted, and participating.
- Every rule is checked on every call in the database (`youth.activity_players`, `youth.activity_open_to_child`, `youth.activity_plays_for`), so a paused guardianship, a removed permission, a restriction, or leaving a group takes effect at once.
- Anything someone may not see reads as "not found", including a child they may not play for.
- No public profiles, rankings, leaderboards, messages, notifications, or automatic sharing exist for activities.

## Progress and versions

- Progress (`youth.activity_progress`) is always keyed by **child profile and activity version**. It is never written to an adult's profile, journal, or memory history, and `last_operator_id` records who was at the device.
- Each save names the version and the revision it was based on. A page still showing an older version, or a save made meanwhile on another device or tab, gets a conflict and nothing is written ("Reload to continue").
- Publishing a new version retires the old one but keeps it (published versions are immutable, enforced by a trigger, and can't be deleted while progress points at them). Earlier progress stays attached, read-only, to the version it was made on; the child starts the new version fresh, and the activity page says so.
- Switching children on a shared device changes the `child` in the URL; the server loads that child's progress and the progress control is keyed by child and version, so nothing carries over between children.

## Content safety

- Text fields are plain text (control characters and tags stripped in the app, refused in the database). The description is the announcement Markdown subset, rendered with raw HTML escaped and links checked by the shared link policy; HTML tags and `javascript:` links are refused when saving.
- Activity types are a fixed list whose players ship with the app. The per-version `config` (reserved for those players) and saved progress are **data only**: JSON objects with simple keys, bounded size and depth, and no strings that look like markup, script URLs, or event handlers (`youth.activity_json_problem`). No uploaded code is ever run.
- Artwork goes through the media library's image pipeline (`processImage`): the real format is read from the bytes (JPEG, PNG, WebP, HEIC), decompression bombs and animated images are refused, orientation is applied, all metadata (including GPS) is removed, and only a re-encoded WebP of at most 1 MB is stored. SVG is never accepted.
- Each artwork records its source (original, licensed, public domain, used with permission), the artist or source (required unless original), the license or permission, an optional `https://` source link, and the editor's rights confirmation. Each version records where its written content came from; anything other than original needs a credit.
- A cover needs a description before publishing, unless it is marked decorative.

## Storage

Artwork lives in the existing private `youth` bucket at `activities/<activity id>/<asset id>.webp`. The bucket's storage policies are unchanged; their check functions were extended:

- **Write (upload and delete):** only `youth.activities` holders, and only at a path reserved by `youth_admin_activity_asset_begin` (pending) or released by `youth_admin_activity_asset_remove`. Active artwork can't be overwritten.
- **Read:** editors (any artwork of any activity), and members only for the cover of the published version of an activity open to them. Signed URLs last five minutes and are always created with the viewer's own session.

## Administration

Admin → Youth & families → **Learn & Play activities** (`/admin/youth/activities`):

1. **New activity** creates a private draft (version 1).
2. In the editor, upload artwork directly (with its description, source, license, and rights confirmation); it can become the draft's cover in the same step. Choose the cover, groups, availability window (church time), and lesson week.
3. **Mark ready for preview** (optional) and **Preview** to see the card and page exactly as members will.
4. **Publish** (type `publish`). Editing a published activity starts a new draft version; members keep the published one until you publish again. **Discard unpublished changes** drops that draft.
5. **Archive** (type `archive`) hides it; versions, artwork, and progress are kept. **Restore** brings it back as it was.

Artwork used by any published version can't be removed.

## Schema changes (20261118000200)

| Object | Purpose |
| --- | --- |
| capability `youth.activities`, role `youth_activity_editor` | Explicit editor role (assigned to nobody by the migration) |
| `youth.activities` | Stable id, status (`draft`, `preview`, `published`, `archived`), published version, availability window |
| `youth.activity_versions` | Versioned content; one draft and one published per activity; immutable once published |
| `youth.activity_assets` | Uploaded artwork with description, source, license, rights confirmation |
| `youth.activity_groups` | Optional group assignment |
| `youth.activity_progress` | Per child and version: status, data, revision |
| `youth_activities_home`, `youth_activity`, `youth_activity_progress_save`, `youth_activity_progress_summary` | Member functions |
| `youth_admin_activit*` | Editor functions (list, read, save, status, groups, artwork, preview) |
| `youth_can_read_object`, `youth_can_write_object` (replaced, same signatures) | Storage checks extended for activity artwork; avatar rules unchanged |
| `youth_me` (replaced, same signature) | Also reports `youth.activities` |

All tables are in the closed `youth` schema (RLS on, no policies, no client privileges). New public functions are executable by `authenticated` only; the anon EXECUTE baseline is unchanged.

The *Practice with the child* guardian permission now also covers Learn & Play (its hint was updated), and *See learning progress* summaries include activities finished.

## Setup and release steps

1. Owner approval, then run `supabase/manual/2026-11-18-apply-youth-activities.sql` once in the SQL editor (one transaction; refuses out-of-order or repeat runs). Rehearsed locally on PostgreSQL 16: applied and recorded on a database built from every earlier migration; a rerun stopped at the preflight.
2. Deploy the app **after** the migration: before it, `/youth` shows "Activities couldn't be loaded right now" in Learn & Play (everything else on the page still works) and the admin pages fail to load.
3. Assign the **Youth activity editor** role to the people who will prepare activities.
4. Confirm guardians who should play with their children have *Practice with the child* (Family administrators set it per child).

No new environment variables, buckets, or scheduled jobs are needed.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test` (unit), and the full DB suite with `TEST_DATABASE_URL` (`--no-file-parallelism`), all passing.
- `tests/db/youth-activities.test.ts` (17 tests): closed schema, no implicit super administrator access, draft/preview invisibility, sanitization and data-only config, artwork rights and storage paths, immutability, group and window access, explicit child selection, isolation between siblings, families, guardians, and youth accounts, stale-save and version-change behavior, summary-only guardians, immediate loss of access, and no leader or staff access to individual progress.
- Cards, filters, empty state, and the activity page were checked in a temporary local preview at 390 px and 1280 px, light and dark: no horizontal scrolling, the card's title link is reached with Tab and shows a visible focus ring, and axe reported no violations in either theme. Signed-in pages need a Supabase stack, so they weren't exercised end to end here.
- **Games (20261123000100):** `npm run lint`, `npm run typecheck`, `npm run build`, and the full Vitest suite with `TEST_DATABASE_URL` (`--no-file-parallelism`): 126 files, 1490 tests, all passing.
  - `src/lib/youth/games/games.test.ts` (unit): seeded shuffles (stable per seed, never already solved), correct and incorrect checks, hints up to the difficulty limit with pinning, drag/step moves and pinned slots, start over and replay keeping completions, resume (exact, after content changes, and tampered data), match/miss/turn-back, rapid repeated taps (no third card, no double match, no extra turns), board sizes, keyboard grid movement, configuration parsing and issues, the built-in picture list matching the database, and the demonstration drafts being complete.
  - `tests/db/youth-activity-games.test.ts` (13): refusals on save, issues listed and enforced on publish by difficulty, pairs and board sizes, activities without games unaffected, demonstration drafts complete and unpublished, game pictures readable only by members the published version is open to, pictures in use kept, game progress saved and resumed per child, sibling and other-family isolation, no access for strangers, leaders, or editors, stale-tab and new-version conflicts, completion kept through replay and cleared only by reset, and immediate loss of access when the practice permission is removed.
  - In Chromium (a temporary local page rendering the players and the editor, removed afterwards; signed-in pages need a Supabase stack): the story was shuffled and stable per seed, checked gently, moved by keyboard (Enter on Move later), tap-to-move, and pointer drag, hinted, solved with the explanation shown and focus on the result, and replayed; Bible Match turned cards by tap and keyboard (arrows, Home/End, Enter, Space), survived rapid repeated taps with exactly one pair matched, explained related pairs, finished, replayed, and changed board size; the editor showed live issues as difficulty, scenes, and pairs changed, picked built-in pictures, reordered, and never submitted the inline upload. axe reported no violations (phone and desktop widths, light and dark), no horizontal scrolling at 390 px, and no console or hydration errors.


## Limits

- Only Puzzle (Put the Story in Order) and Matching (Bible Match) have players; the other types offer "Mark finished".
- Members see the cover and the pictures the published version's game uses; other uploaded artwork stays editor-only.
- The demonstration drafts' wording was written for the church and cites Scripture, but it has not been reviewed by church staff; review it before publishing.
- Progress on a retired version is kept but can't be continued.
