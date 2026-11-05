# Prayer Library

A searchable collection of reusable prayers contributed by approved members, on the Prayer page as the second section beside **Requests** (**Prayer → Prayer Library**, `/prayer/library`). It's separate from prayer requests and practical care: its own tables, its own reports, and no request is ever copied into it.

## For members

- **Add a prayer** (`/prayer/library/new`): title and prayer text (required, and the prayer itself has no length limit — a one-line blessing or a long liturgy both fit; bold, italic, lists, and links with the same safe link editor as announcements), its collection (required to publish, and one can be started here — see [Collections](#collections)), topics, purposes, and intended uses (several of each), optional Scripture references (checked with the same reference parser as lessons; only the reference is stored), and who wrote it: *My own prayer* or *Shared from another author or source*, with an optional author/source name and link.
- A reminder above the form asks members to share only prayers they wrote or have permission to share, to name the source, and to leave out other people's private information.
- **Save draft** keeps it private. **Publish** shares it with approved adult members at once; there's no approval step. The live preview shows exactly what readers will see, attribution included.
- Contributors can edit (the first publication date is kept and the prayer is marked edited), move a prayer back to drafts, archive it, and restore it. A member whose community posting is paused by a moderator can keep drafts but can't publish.
- **Search** (title, text, topics, purposes, uses, author/source, who shared it, Scripture) runs as a POST, so search words never appear in the address bar. **Filters** for topic, purpose, and intended use combine with each other and with search; **Reset filters** clears them. Lists show newest published first and page with "Show older prayers".
- **My prayers** lists everything you contributed (drafts and archived included). **Saved prayers** lists your bookmarks; they're private, and no one (contributors and administrators included) sees who saved what or how many times.
- A prayer's page shows the full text, labels, Scripture, and attribution: **By** the original author or source, and **Shared by** the member who added it. **Copy prayer** copies the title, text, attribution, and Scripture together.
- **Report** a prayer for being unkind, shared without permission, sharing private information, harassment, spam, or something else.

## Collections

Every published prayer is filed in exactly one collection — the shelves members browse on `/prayer/library` (migration `20261124000100`). A collection is visible to the church only while it is active and holds at least one published, unhidden prayer; its count and cover come from those prayers alone, and a link to any other collection reads as not found. One **General prayers** collection always exists for prayers that fit nowhere else and can't be archived.

### For members

- **Choosing one**: the editor's Collection field lists the active collections (searchable once there are more than five). It's required to publish; a draft can wait.
- **Starting one** (migration `20261129000100`): when none fits, a member can start a collection with a name and an optional short description — from **Start a collection** on the Collections view, or from **Start a new collection** inside the editor's Collection field, which creates it on its own and chooses it without disturbing the prayer being written. A name another collection already has (whatever the case or spacing, archived ones included) is refused and the existing one is offered instead.
- A new collection holds nothing yet, so only the member who started it sees it (marked *Only you can see this yet*, and they alone can open its page) until a prayer is published in it. From then on everyone sees it, and anyone may add prayers to it.
- Starting a collection grants nothing else: members can't rename, describe, reorder, cover, archive, or restore any collection, and can't move anyone else's prayer. A member whose community posting is paused by a moderator can't start one. At most 3 of a member's collections may wait without a published prayer, and at most 5 are created an hour.
- Browsing a collection has the same search (within it, or all prayers) and topic/purpose/use filters as the library, and a prayer opened from a collection goes back to it.

### For settings managers (`settings.manage`)

**Admin → Prayer Library collections** (`/admin/prayer/library/collections`): create, rename, describe, reorder (the order members see), set or remove a 3:2 cover, archive and restore, and move prayers between collections one at a time or in bulk. The list says how many prayers each holds, which ones members don't see yet, and who started each collection, so member-started ones are easy to find; each creation is also in the audit log (`prayer.library_collection_created`, with `{"by": "member"}` for a member's). Moving a prayer keeps its owner, dates, labels, and bookmarks, and nobody is notified. Nobody's private drafts are ever listed or moved. Covers live in the private `prayer-library` bucket, and storage only serves a cover to members who can see its collection.

## For prayer moderators (`prayer.moderate`)

**Admin → Prayer Library** (`/admin/prayer/library`, also linked from Prayer reports):

- Library reports (open and closed). Opening one is recorded; it shows a copy of the prayer as it was when reported.
- **Hide**: gone from the library, search, and saved lists, and its link reads "not found" for members. The contributor still sees it, marked hidden, and editing never unhides it.
- **Archive**: like hide, and the contributor can't republish it (for duplicates or prayers that no longer belong).
- **Restore**: undoes a moderator's hide or archive.
- Every action needs a reason, is recorded in the prayer moderation log (`library_prayer.*`, `library_report.*`) and the audit log (`prayer.library_*`), and never stores the prayer's text. Moderators can't act on drafts or their own contributions. Moderators can also hide or archive from a prayer's own page.
- Nobody is notified; the contributor sees the state on their prayer.

## For settings managers (`settings.manage`)

**Admin → Prayer Library categories** (`/admin/prayer/library/categories`): add, rename, reorder, archive, and restore topics, purposes, and intended uses. Archived ones leave the form and filters; prayers that have them keep the label. Changes are audited (`prayer.library_category_*`).

Initial categories (no prayers are seeded):

- Topics: Church and community, Family and children, Healing and health, Grief and loss, Peace and anxiety, Work and provision, Relationships, Faith and growth, Mission and outreach, Nation and world, Seasons and holidays.
- Purposes: Gratitude, Comfort, Guidance, Confession, Intercession, Praise, Blessing, Lament.
- Intended uses: Personal prayer, Family prayer, Meals, Small groups, Worship services, Opening a gathering, Closing a gathering.

## Rules and where they're enforced

Migration `20261115000100_prayer_library.sql`. Everything is in the private `prayer` schema (RLS on, no client grants); members reach it only through `public.prayer_library_*` functions granted to `authenticated` (never `anon`), which recheck on every call:

| Rule | Enforced by |
| --- | --- |
| Approved **adult** members only; youth, pending, suspended, and signed-out accounts are refused | `prayer.require_member()` in every function; `requireApprovedMember()` on every page and action (youth accounts are sent to `/youth`) |
| Published, unhidden prayers readable by members; drafts, archived, and hidden ones by their contributor only | `prayer.library_can_read`, used by the list, detail, save, bookmark, and report functions |
| Only the contributor edits or changes status; moderator-archived prayers can't be republished | `prayer_library_save`, `prayer_library_status` |
| Bookmarks private | `prayer.library_saves` read only for the caller's own `saved` view and flag; no counts returned |
| Moderation needs `prayer.moderate` (super administrators get it only from an explicit prayer role), a reason, and is logged | `prayer_library_mod_*` |
| Categories need `settings.manage` | `prayer_library_category_*`, `prayer_library_admin_categories` |
| Managing collections (rename, describe, reorder, cover, archive, reassign) needs `settings.manage` | `prayer_library_collection_save`, `prayer_library_collection_move`, `prayer_library_collection_cover`, `prayer_library_collection_archive`, `prayer_library_reassign` |
| Publishing needs an active collection; a member starting one needs approved adult membership, unpaused posting, a free name, at most 3 of theirs waiting, and ≤ 5 an hour | `prayer_library_save`, `prayer_library_status`, `prayer_library_collection_add` |
| A collection is public only while active with a published, unhidden prayer; its creator also sees their own while it's empty | `prayer.library_collection_count`, `prayer.library_visible_collection`, `prayer_library_collections`, `prayer_library_collection` |
| Text limits (the prayer itself has none; the title, author or source, and link do), safe links, no @mentions, source link `http(s)` only, ≤ 20 Scripture references, category limits, rate limits | the save function (and the server action, which also checks links with the shared link policy) |

Search uses a weighted `tsvector` (title; categories, attribution, Scripture; text) with a GIN index, kept current when a prayer is saved, a category renamed, or a contributor's name changes. The prayer text has no length limit (since `20261127000100`), so only its first 100,000 characters are indexed — far past any prayer, and short of PostgreSQL's 1 MB `tsvector` limit; the whole text is still stored, shown, and copied. Lists are keyset-paged on `(published_at, id)` (`(updated_at, id)` for My prayers) using `library_prayers_feed_idx` / `library_prayers_contributor_idx`.

Library activity sends no emails, push messages, or in-app notifications.

## Verification

- `tests/db/prayer-library.test.ts` (real PostgreSQL, every migration): contributor lifecycle; drafts, hidden, and archived prayers invisible to others in lists and by id; search across every field, prefix matching, query syntax ignored; combined filters; keyset paging; private bookmarks; reports; hide/restore/archive with log and audit records; categories; youth, pending, suspended, and anon refused; prayer requests untouched.
- `src/lib/prayer/library.test.ts`: cursor, filter parsing, copy text and attribution, collection name matching.
- `tests/db/prayer-library-collections.test.ts`: existing prayers placed in General prayers with nothing else changed; publishing needs a collection; who may manage collections; counts, covers, search, reassignment, ordering, archiving.
- `tests/db/prayer-member-collections.test.ts`: a member starts a collection and it stays theirs alone until a prayer is published in it; duplicate names, youth, signed-out, and paused accounts refused; the waiting and hourly limits; no management granted; the audit record and `started_by`; nothing notified.
- `tests/e2e-local/14-prayer-collections.spec.ts` (local stack): a settings manager creates a collection with a cropped cover; members start collections from the Collections view and from inside the editor; browsing, searching within a collection, moving prayers out, archiving; axe in both themes.
- `tests/e2e-local/11-prayer-library.spec.ts` (local stack, production build, desktop and Pixel 7): the whole journey in a browser, the Requests/Prayer Library sections, View menu, and Filters panel on a phone, no horizontal scroll, keyboard search, axe in light and dark themes, prayer requests still loading. Set `LIBRARY_SHOTS=<folder>` for screenshots.

## Release steps

1. Apply `supabase/migrations/20261115000100_prayer_library.sql` to the hosted project **before** deploying the app (without it, the library shows "couldn't be loaded"; prayer requests and care are unaffected). It's additive: new tables, one new nullable column (`prayer.moderation_log.library_report_id`), new functions, seed categories, and one trigger on `public.profiles` name changes. It edits no applied migration and leaves the anon function baseline unchanged.
2. Record the version: `supabase/manual/2026-11-15-record-prayer-library.sql` checks the objects and adds the history row (done this way because the SQL was first applied before the migration was renumbered). Done on hosted on 2026-10-23; see [migration-history.md](migration-history.md#prayer-library-2026-11-15).
3. Apply `supabase/migrations/20261124000100_prayer_library_collections.sql` and then `20261129000100_prayer_member_collections.sql`, in that order, before deploying the app. Both are additive. Without the second one, **Start a collection** and **Start a new collection** report that the collection couldn't be created; everything else in the library keeps working, and the currently deployed app keeps working after it (no signature changes).
4. Optionally assign the **Prayer moderator** (or **Prayer and care lead**) role to whoever should review library reports; super administrators need one of these roles to moderate.
