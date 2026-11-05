# Prayer link catalogues — "Catholic Online Prayers"

A **prayer link catalogue** is a prayer category in the Prayer Library whose
prayers are published on someone else's site. The church keeps each prayer's
title, the topic labels the source lists it under, and the address of the page
it is on. Members browse and search those, and open a prayer on the source's
own site.

**No prayer text is stored, shown, or copied.** That is the point: the church
has no right to reproduce these prayers, so a catalogue carries a rights
statement saying titles, labels, and links only, and every row offers an
**Open prayer** link out rather than words on our page.

The first catalogue is **Catholic Online Prayers**: 2,304 prayers in 111 of
[Catholic Online](https://www.catholic.org/prayers/)'s own topics, from the
files pinned under [`data/prayers/catholic-online/`](../data/prayers/catholic-online/README.md).

- Migration: `supabase/migrations/20261130000100_prayer_link_catalog.sql` (schema only; it imports nothing)
- Hosted apply script: `supabase/manual/2026-11-30-apply-prayer-link-catalog.sql`
- Normalizer, provenance, and page helpers: `src/lib/prayer/catalog.ts` (plus `catalog-source.ts`, which reads the pinned files on the server)
- Dry run: `npm run prayer:catalog-dry-run` (add `--coverage` for the per-topic table, `--titles 20` for the first links, `--json` for everything)

## Not the Prayer Library's own prayers

A catalogue is kept apart from members' contributions on purpose:

| | Prayer Library prayers | Catalogue links |
| --- | --- | --- |
| Holds the prayer's words | Yes | **No** — a title, labels, and a link |
| Who adds them | Any approved adult member | A settings manager, by importing a pinned file |
| Filed in | One collection, with topics / purposes / uses | One catalogue, with the source's own topics |
| Bookmarks, reports, moderation | Yes | No |
| In the library's own lists and search | Yes | No — catalogues have their own pages |

Nothing in this feature creates, moves, relabels, or reads a library prayer, a
collection, a category, a prayer request, or practical care.

## For members

- The Prayer Library's **Collections** view (`/prayer/library`) ends with
  **Prayers from other sources**: a card for each published catalogue, with
  how many prayers it holds and which site they open on.
- A catalogue's page (`/prayer/library/catalogs/<id>`) shows its description,
  the rights statement, how many prayers and topics it holds, and the prayers
  by title — 50 to a page, with **More prayers** / **Previous prayers**.
- **Search these prayers** matches words as prefixes against titles, the
  source's topic labels, and the source's name. **Topic** narrows to one of
  its topics, with that topic's count beside its name. Both combine, and
  **Clear** resets them. It is a plain GET form: there is nothing private
  here, so a reader can bookmark or share the page they are on, and it works
  without JavaScript.
- Every prayer's **Open prayer** link opens the source's page in a new tab, so
  the reader keeps their place in the library. The heading, the card, and the
  link all say where it opens.
- A catalogue members can see is one that is published and holds at least one
  published link; a link to any other reads as not found. Youth, pending,
  suspended, and signed-out accounts are refused everywhere, as everywhere in
  prayer.

## For settings managers (`settings.manage`)

**Admin → Prayer link catalogues** (`/admin/prayer/library/catalogs`):

- The **dry run** is computed from the pinned files on every visit and writes
  nothing: the counts, the titles the import repairs (before and after), any
  warnings, and whether the files match their pinned SHA-256. **Import** is
  disabled until it passes.
- **Import the catalogue** stages everything and applies it in one
  transaction: open, stage the 111 topics, stage the 2,304 links in batches of
  200, then one all-or-nothing apply. If anything is refused, nothing is
  imported and the import is recorded as failed with the reason.
- Imported links arrive **unpublished** and the catalogue arrives as a
  **draft** (the source catalogue's own README asks for review first), so
  members see nothing until someone publishes.

A catalogue's own page (`/admin/prayer/library/catalogs/<id>`):

- **Review prayer links**: the links by title, filtered to **Not published**
  (the default), **Published**, **No longer listed**, or **All**, with search
  and a topic filter. Tick any of them to **Publish** or **Unpublish**; each
  row links out so a reviewer can read the prayer before publishing the link.
- **Publish all** / **Unpublish all** for the whole catalogue, or for the one
  topic being filtered — the bulk step after an import.
- **Who can see it**: publish the catalogue to members, put it back to a
  draft, or archive it. Publishing one with no published link is refused
  (members would see an empty category).
- **Details**: name, short description, and the order catalogues appear in.
  The name is the prayer category members see.
- **Topics**: the source's own topics with their counts. Archiving one removes
  it from the member filters and from the labels shown on each prayer; the
  links themselves stay, and it can be restored.
- **Imports**: the last ten, with counts only — never a prayer's text.

Every action above is in the audit log (`prayer.link_catalog_created`,
`prayer.link_catalog_saved`, `prayer.link_catalog_status`,
`prayer.link_published`, `prayer.link_unpublished`,
`prayer.link_topic_archived`, `prayer.link_topic_restored`,
`prayer.link_imported`). An import writes **one** entry with its counts, never
one per link. Nothing here sends emails, push messages, or in-app notices.

## Re-importing

Running the import again (after a newer catalogue file is pinned) is safe and
designed for it:

- **Publishing decisions are kept.** A link that was published stays
  published; one that was held back stays held back.
- A title or address the source changed is updated; a link's labels become
  exactly what the source lists now.
- A **new** link arrives unpublished, for review.
- A link the source no longer lists is marked **retired**: members stop seeing
  it, it is counted and listed as "No longer listed", and it can't be
  published. Nothing is deleted. If a later import lists it again, it comes
  back with the publishing decision it had.
- A topic the source dropped is **archived**, never deleted, so a link keeps
  its label if the topic returns.
- At most one import can be in progress per catalogue; an unfinished one is
  shown with a **Discard it** button, and starting a new import discards it.

## Rules and where they're enforced

Migration `20261130000100_prayer_link_catalog.sql`. Everything is in the
private `prayer` schema (RLS on, no grant to `anon`, `authenticated`, or
`service_role`); the app reaches it only through `public.prayer_link_*`
functions granted to `authenticated`, which recheck on every call.

| Rule | Enforced by |
| --- | --- |
| Approved **adult** members only; youth, pending, suspended, and signed-out accounts are refused | `prayer.require_member()` in every read function; `requireApprovedMember()` on the member page |
| Members see a catalogue only while it is published, not archived, and holds a published link | `prayer.link_visible_catalog`, `prayer.link_count`, used by `prayer_link_catalogs`, `prayer_link_catalog`, and `prayer_link_list` |
| Members see a topic only while it is active and holds a published link; a filter naming any other reads as not found | `prayer_link_catalog`, `prayer_link_list` |
| Members see a link only while it is published and not retired | `prayer_link_list` |
| Importing, naming, ordering, publishing, archiving, and topic changes need `settings.manage` | `prayer.require_settings_manager()` in every management and import function; `requireCapability(CAPABILITIES.settingsManage)` on both admin pages and in every action |
| A catalogue can't be published with no published link | `prayer_link_catalog_status` |
| A retired link can't be published | `prayer_link_set_published`, `prayer_link_publish_all` |
| An import is all or nothing, and only its own author can continue it | `prayer_link_import_rows` / `_apply` (the staged count must equal the expected count, and every label a link names must have been staged) |
| At most one import in progress per catalogue; at most 10 started an hour | `link_imports_one_staging_idx`, `community.rate_limit` |
| A dry run that reported problems can't be imported | `prayer_link_import_begin` (and the server action refuses before it) |
| Names stay unique, case- and space-insensitively | `link_catalogs_name_idx`, `prayer_link_catalog_save` |
| No prayer text anywhere | there is no column for it: `prayer.link_prayers` holds `title`, `source_url`, `source_id`, and flags, and `prayer.link_import_rows` the same |

Search uses a weighted `tsvector` (title; topic labels and the source's name)
with a GIN index, rebuilt for the whole catalogue by the apply. Lists are
ordered by `lower(title)` and paged with limit/offset over a stable
alphabetical list (`link_prayers_list_idx`), and each list returns its total,
so a page can say "Showing 51–100 of 2,304".

## Verification

- `tests/db/prayer-link-catalog.test.ts` (real PostgreSQL, every migration): the staged import and its refusals; links arriving unpublished and members seeing nothing until published; what members may read; search, topic filters, and paging; who may manage and import (members, prayer moderators, youth, pending, suspended, and signed-out refused); tables closed to every API role with RLS on; a re-import keeping publishing decisions, archiving dropped topics, retiring and restoring links; the audit records; and members' own prayers, collections, and requests untouched.
- `tests/db/prayer-catholic-online-import.test.ts`: the **real pinned catalogue** imported end to end — 2,304 links into 111 topics, every one unpublished, then published and browsed, searched, filtered, and paged at that size (every page together is every prayer, once), and imported a second time with nothing changed.
- `src/lib/prayer/catalog.test.ts`: the code-page repair (and that it leaves correctly written text alone, in any alphabet, and is a no-op twice), whitespace tidying, every refusal, the warnings, the stored report, the page helpers, and the pinned files themselves (hashes, 2,304 links, 111 topics, no problems, no warnings, 30 titles repaired, no prayer text in any row).

## Release steps

1. Apply `supabase/manual/2026-11-30-apply-prayer-link-catalog.sql` in the
   hosted project's SQL editor **before** deploying the app. It is additive
   (seven new tables, seven internal helpers, sixteen new functions granted to
   `authenticated` only), creates no content, records
   `20261130000100` only after its post-checks pass, and refuses a second run.
   If the migration's SQL was already pasted and run on its own, use
   `supabase/manual/2026-11-30-record-prayer-link-catalog.sql` to add the
   history row instead. Without it, the Prayer Library keeps working: the
   Collections view simply shows no "Prayers from other sources" section, and
   the admin page reports that catalogues couldn't be loaded.
2. Deploy the app.
3. As a settings manager, open **Admin → Prayer link catalogues**, check the
   dry run, and **Import the catalogue**.
4. Review the links (spot-check a few by opening them), then **Publish all**
   and **Publish to members**. Nothing is visible to members until both are
   done, and nobody is notified when they are.

See also [prayer-library.md](prayer-library.md) and
[migration-history.md](migration-history.md).
