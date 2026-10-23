# Prayer Library

A searchable collection of reusable prayers contributed by approved members, on the Prayer page next to the request views (**Prayer → Prayer Library**, `/prayer/library`). It's separate from prayer requests and practical care: its own tables, its own reports, and no request is ever copied into it.

## For members

- **Add a prayer** (`/prayer/library/new`): title and prayer text (required; bold, italic, lists, and links with the same safe link editor as announcements), topics, purposes, and intended uses (several of each), optional Scripture references (checked with the same reference parser as lessons; only the reference is stored), and who wrote it: *My own prayer* or *Shared from another author or source*, with an optional author/source name and link.
- A reminder above the form asks members to share only prayers they wrote or have permission to share, to name the source, and to leave out other people's private information.
- **Save draft** keeps it private. **Publish** shares it with approved adult members at once; there's no approval step. The live preview shows exactly what readers will see, attribution included.
- Contributors can edit (the first publication date is kept and the prayer is marked edited), move a prayer back to drafts, archive it, and restore it. A member whose community posting is paused by a moderator can keep drafts but can't publish.
- **Search** (title, text, topics, purposes, uses, author/source, who shared it, Scripture) runs as a POST, so search words never appear in the address bar. **Filters** for topic, purpose, and intended use combine with each other and with search; **Reset filters** clears them. Lists show newest published first and page with "Show older prayers".
- **My prayers** lists everything you contributed (drafts and archived included). **Saved prayers** lists your bookmarks; they're private, and no one (contributors and administrators included) sees who saved what or how many times.
- A prayer's page shows the full text, labels, Scripture, and attribution: **By** the original author or source, and **Shared by** the member who added it. **Copy prayer** copies the title, text, attribution, and Scripture together.
- **Report** a prayer for being unkind, shared without permission, sharing private information, harassment, spam, or something else.

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
| Text limits, safe links, no @mentions, source link `http(s)` only, ≤ 20 Scripture references, category limits, rate limits | the save function (and the server action, which also checks links with the shared link policy) |

Search uses a weighted `tsvector` (title; categories, attribution, Scripture; text) with a GIN index, kept current when a prayer is saved, a category renamed, or a contributor's name changes. Lists are keyset-paged on `(published_at, id)` (`(updated_at, id)` for My prayers) using `library_prayers_feed_idx` / `library_prayers_contributor_idx`.

Library activity sends no emails, push messages, or in-app notifications.

## Verification

- `tests/db/prayer-library.test.ts` (real PostgreSQL, every migration): contributor lifecycle; drafts, hidden, and archived prayers invisible to others in lists and by id; search across every field, prefix matching, query syntax ignored; combined filters; keyset paging; private bookmarks; reports; hide/restore/archive with log and audit records; categories; youth, pending, suspended, and anon refused; prayer requests untouched.
- `src/lib/prayer/library.test.ts`: cursor, filter parsing, copy text and attribution.
- `tests/e2e-local/11-prayer-library.spec.ts` (local stack, production build, desktop and Pixel 7): the whole journey in a browser, tabs scrolling on a phone, no horizontal scroll, keyboard search, axe in light and dark themes, prayer requests still loading. Set `LIBRARY_SHOTS=<folder>` for screenshots.

## Release steps

1. Apply `supabase/migrations/20261115000100_prayer_library.sql` to the hosted project **before** deploying the app (without it, the library shows "couldn't be loaded"; prayer requests and care are unaffected). It's additive: new tables, one new nullable column (`prayer.moderation_log.library_report_id`), new functions, seed categories, and one trigger on `public.profiles` name changes. It edits no applied migration and leaves the anon function baseline unchanged.
2. Record the version: `supabase/manual/2026-11-15-record-prayer-library.sql` checks the objects and adds the history row (done this way because the SQL was first applied before the migration was renumbered). Done on hosted on 2026-10-23; see [migration-history.md](migration-history.md#prayer-library-2026-11-15).
3. Optionally assign the **Prayer moderator** (or **Prayer and care lead**) role to whoever should review library reports; super administrators need one of these roles to moderate.
