# Book collections

Books on the member **Books** page (`/reading`) are grouped into **collections** using the topics already set on each book. Nothing new is created or assigned: a book's topics are its collections.

## For administrators

- Open a book in **Teaching content**, go to **Organize → Topics**, and type one or more topics separated by commas (for example `Rob's Reads, Classics`). Existing topics are suggested as you type; pick one to reuse its name. Save.
- The book appears in each of those collections on the Books page. Give a book several topics to show it in several collections. It is still one book: progress, notes, and links stay the same wherever it is opened.
- Remove a topic from the book and save to take the book out of that collection. A collection with no books a member can open is hidden from that member.
- Topic names ignore capitalization and extra spaces. `rob's reads` and `Rob's   Reads` both reuse the saved topic **Rob's Reads**. The migration merged existing topics that differed only in spacing, keeping every assignment. To rename a topic everywhere, edit or delete it in **Content library → Topics** (`/admin/content/library`).
- **Tags** stay as extra search words. They don't create collections.
- Topics on lessons, devotionals, videos, and episodes work as before. Only books become collections, and only books are listed in them.

## For members

- **Collections** (near the top of Books): a folder for **All Books**, followed by one folder per collection. Each folder shows its name, how many books it holds, and up to three covers.
- Opening a folder (`/reading/collections/<topic id>`, or `/reading/collections/all`) shows its books as a cover grid with the member's own progress, a **Back to Books** link, and a search box. That search covers the collection, and the landing page's search covers all books. Search matches titles, authors, summaries, tags, topics, and people.
- A book opened from a collection is the usual book page (progress, Kindle/Audible links, reading plan, related resources). Its **Back to …** link returns to that collection, along with the search that was used. Collection links can be shared and bookmarked.

## Privacy and visibility

Everything is decided in the database by `media.item_visible`, the same rule every other read uses: published (or a scheduled time that has passed), not expired, not archived, and the member's audience (approved members, or active membership of the book's group). Collection counts, cover previews, and search results include only books the reader can open. A collection with none (empty, restricted, or unknown) is left out and reads as "not found" if linked directly, so restricted titles, covers, and counts never show.

## Database (20261116000100_media_book_collections.sql)

- `media.topic_name(text)`: trims a name and collapses runs of whitespace (including no-break spaces) to one space. A new check, `topics_name_normalized`, keeps every stored name in that form. The existing unique index on `lower(btrim(name))` then also stops capitalization and spacing duplicates.
- One-time cleanup: topics that collide once normalized are merged into the oldest one (assignments moved, none lost), and the remaining names are normalized.
- `media_admin_topic_save` normalizes names, reuses a matching topic, and handles two saves creating the same topic at once.
- `media_book_collections()` and `media_books(p_collection uuid, p_q text)`: member reads, for signed-in users only (not visitors).

No applied migration was edited. The pages work before the migration is applied: the Collections section is left out, and a collection page shows a loading error.

## Verification

- `tests/db/book-collections.test.ts` (run with `TEST_DATABASE_URL`) covers the following:
  - The merge of existing topics.
  - Normalization and reuse of names.
  - A topic creating a collection, with later books joining it.
  - One book in several collections, and removal when a topic is removed.
  - Untagged books in All Books.
  - Covers limited to books the reader can open.
  - Draft, scheduled, expired, archived, and group-only books absent from collections, counts, and search.
  - Search scope.
  - Anonymous access refused.
  - Topics on lessons unchanged.
- `src/lib/media/book-collections.test.ts` and `src/lib/back-links.test.ts` cover addresses, the back link to a collection, the remembered search, topic parsing, and suggestions.

## Release steps

The migration was first numbered `20261115000100`, but `main` uses that version for the Prayer Library, which is already recorded on hosted. It is now `20261116000100`, with the same body apart from one fix: the temporary merge table is dropped explicitly, so the file also works when run statement by statement.

1. In the hosted SQL editor, run `supabase/manual/2026-11-16-record-media-book-collections.sql`. It checks that the collection functions, the name check, and the grants exist, then records `20261116000100`. It changes nothing else.
2. If it stops with "objects are missing", the migration was never applied. Run `supabase/manual/2026-11-16-apply-media-book-collections.sql` instead. It is the migration verbatim plus the history row, in one transaction.
3. Check: `select version, name from supabase_migrations.schema_migrations where version = '20261116000100';` returns one row, and `select lower(name), count(*) from media.topics group by 1 having count(*) > 1;` returns none.
4. Open Books as a member and confirm that **Rob's Reads** appears with its books.

Either order works: before the migration, the Books page simply leaves out Collections.
