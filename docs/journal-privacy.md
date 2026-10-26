# Journals and reading data: privacy, export, and retention

## What is stored

| Data | Table | Who can read it |
| --- | --- | --- |
| Journal entries (title, text, optional link, version), including Sunday lesson answers and notes | `journal.entries` | The owner only |
| Plan enrollments, completions (with the revision read), reminder settings | `bible.enrollments`, `bible.completions` | The owner only (staff see counts per plan) |
| Bookmarks, highlights (references, colors, timestamps, revisions; never scripture text) | `bible.bookmarks`, `bible.highlights` | The owner only |
| Reader settings | `bible.reader_prefs` | The owner only |

## How it is protected

- The `bible` and `journal` schemas aren't exposed by the Data API and grant nothing to `anon`/`authenticated`; RLS is on with no policies. Access is only through `SECURITY DEFINER` functions that filter on `auth.uid()` and recheck approved membership on every call.
- No function returns another person's journal, progress, bookmarks, or highlights: there is no staff, moderator, group-leader, household, or guardian path, and capabilities (including a super administrator's) don't open them. Someone else's entry and a nonexistent one both answer "not found". Database tests check this for administrators, plan and source staff, content editors, group leaders, and household members.
- **Not end-to-end encrypted.** The database operator (Supabase project owners with direct SQL access) can technically read rows. The app never describes journals as encrypted.
- Suspended or pending accounts can't open their journal; data is kept and access returns on reinstatement.

### Keeping journal text out of other places

- **Search indexes:** none. Search is a per-owner `ILIKE` inside `journal_entries`, sent by POST so words don't appear in URLs.
- **Admin lists and change logs:** never include journal text; plan impact previews don't even count journal entries.
- **Community feeds:** nothing is posted automatically. "Write privately" and "Join discussion" are separate actions.
- **Notifications, email, push:** reading reminders carry no journal content; email/push wording is generic.
- **Audit log:** journal actions aren't audited (so text can't leak there); tests check no journal text reaches `audit_log` or notifications.
- **Error logs:** the journal API routes and actions never log request bodies; errors map to fixed messages.
- **Analytics:** none in the app.
- **Caching:** `/journal`, `/bible`, and `/api/journal/*` are `private, no-store`; the service worker caches no pages; page titles are generic ("Journal entry"), never an entry title.
- **Browser storage:** journal text is held in memory only. No local storage, no on-device recovery (so nothing lingers on shared devices). Sign-out clears the site cache as before.
- **Notes on discussion questions:** devotionals, lessons, and church reading assignments show a "Your notes" box under each question. Notes are held in memory only (the page warns before leaving with unsent notes) and are saved only when the member presses **Send to My Journal**, which creates one private entry (through `/api/journal/entries`) linked to that item, with each question quoted and the member's note under it. Visitors and admin previews see the questions without note boxes.
- **Sunday lesson answers and notes** (since `20261122000100`): written on the lesson page (`/lessons/<id>/workbook`) and saved as entries with link kind `lesson_answer` (one per question, with the question's block, revision, and wording as answered) or `lesson_notes` (one per lesson). Only approved adult members can write them (the lesson functions use `media.require_member`; youth, pending, and visitors are refused); `journal_entry_create` refuses these kinds, so they're only made from a lesson. In My Journal they can be read, edited (10,000 characters at most), archived, unlinked, searched, exported, and deleted like any entry; the link names the lesson only while the owner can open it. Teachers and administrators have no view of them, not even counts. **Browser storage:** unlike the journal editor, the lesson page keeps an unsaved answer on the device until the server confirms it (as it always did), then removes it. Lesson boxes never written in aren't listed. Before `20261122000100` these were `media.workbook_answers` / `media.workbook_notes`; see [migration-history.md](migration-history.md#my-journal-lesson-answers-and-notes-2026-11-22).
- **Scripture Highlights** (since `20261126000100`): a My Journal view of the member's own `bible.highlights` rows, grouped into passages. Nothing is copied into `journal.entries`, so highlights never duplicate or replace notes; removing a highlight never removes a journal entry or a memory verse. Same owner-only functions and membership recheck as the reader; no staff, administrator, group-leader, household, or guardian path. Passage text is fetched when shown (stored text, or the licensed provider's existing in-memory cache) and held only in the page's memory. The reference search is sent by POST. See [scripture-highlights.md](scripture-highlights.md).
- **Reflections on collection readings** (Morning & Evening): "Reflect in My Journal" links an entry to the reading and the calendar date read (`collection_reading_id`, `reading_date`). One reflection per reading and date (unique index; a second "Reflect" opens the first). Administrators see no counts or content of reflections; hiding or removing the collection keeps the entry text. See [morning-evening.md](morning-evening.md).

## Export

- **My Journal → Download (Markdown)**: every entry with dates, status, and link context (content no longer available is withheld).
- **Download everything (JSON)**: journal plus reading data (plans, completions with dates and revisions, bookmarks, highlights, reader settings).
- **Bible reading → Bookmarks → Download my reading data (JSON)**: reading data only.
- Exports are generated per request for the signed-in owner, rate-limited (10 an hour), sent `private, no-store` as attachments.

## Deletion

| Action | Effect |
| --- | --- |
| Delete an entry | Permanently removed (no trash) |
| Delete my whole journal (type DELETE) | Every entry removed |
| Leave a plan | Stops it and reminders; history kept |
| Delete my history (plan) | Enrollment and completions removed; journal entries stay |
| Remove all bookmarks / highlights | Removed |
| **Account deletion** (removing the auth user) | Cascades: journal entries, enrollments, completions, bookmarks, highlights, reader settings are deleted (tested) |

Plan changes never delete members' data: days are retired, not deleted; completions point at days that can't be deleted while referenced; journal links survive (`on delete set null`, with the plan/day shown as no longer available).

## Retention

No automatic retention or purge runs for journals or reading data; they are kept until the member deletes them or the account is deleted. Housekeeping only expires unused CSV import previews after a day and reuses the existing notification retention (read notifications after 180 days). Any future retention job needs a reviewed, approved policy first.

Archived plans keep their days, revisions, and members' completion history; members who joined can still open them.
