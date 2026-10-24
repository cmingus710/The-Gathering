# Learn & Play (Youth & Families)

The foundation for activities in the Youth & Families area: versioned activity content, illustrated browsing, an editor for authorized youth content staff, and private progress stored on the right child. The interactive games themselves are not built yet; each activity type gets its player later, on top of this.

Migration: `20261118000100_youth_activities` (operator script `supabase/manual/2026-11-18-apply-youth-activities.sql`, applied to hosted 2026-10-24 by the owner). Tests: `tests/db/youth-activities.test.ts`, `src/lib/youth/activities.test.ts`.

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
- Until a type's player exists, the only control is **Mark finished / Mark not finished**, which really saves progress for the chosen child. No placeholder buttons are shown.

Empty states: "Activities will appear here when they're published"; adults with no child they may play for are told why (verification, or the *Practice with the child* permission, or the child has their own account).

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

## Schema changes (20261118000100)

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

## Limits

- No activity players yet: every type offers only "Mark finished". Players will read `config` and save `data` through the same functions.
- Only the cover image is shown to members; additional artwork can be uploaded and kept for future players.
- Progress on a retired version is kept but can't be continued.
