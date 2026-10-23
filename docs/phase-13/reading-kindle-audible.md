# Books: Kindle and Audible (Phase 13)

## What members get

**Books** (`/reading`) shows each current book as one card: the book (cover, author, the member's own progress) and, under it, this week's assignment for that book. Both open the same page. Other weeks and books already read follow.

Each book has **one reading page** (`/reading/books/<id>`), in this order:

1. **Book**: the full cover at its own proportions (portrait, beside the details), title, author, the church's reading dates, the related Sunday lesson, a short description with **Read more**, **Save**, and the book's discussion.
2. **Read or listen**: **Listen in Audible** and **Read in Kindle**, only when configured. One line says they open the provider with the member's own account; **How these links work** has the rest.
3. **My reading progress**: **My place in the book** (Want to read / Reading / Finished, plus an optional current place such as "Chapter 4", "page 82", or "3h 10m") and, separately, **Reading-plan assignments completed** ("2 of 6" with a bar). The percentage comes only from the number of assignments, never from the free-text place. Checking off assignments never changes the book status or the place.
4. **This week's assignment** (or **Up next** when none is current): title, dates, the teacher's instructions (chapter/page range), notes, scripture, discussion questions, handouts, the discussion link, **Mark as done** (press again to undo), and **Write privately**.
5. **Reading schedule**: every assignment in date order with its dates, reading, and the member's own done state. Each expands in place with its details and its own **Mark as done**. This week's is highlighted.
6. **My private notes**: the member's My Journal entries about the book or any of its assignments (each says which), and **Write privately**, an inline autosaving editor (the My Journal editor) whose **About** chooses the book or an assignment.

A book without assignments shows 1–3 and 6 only.

**Which assignment is current:** the same rule as the home page and Books: it has started and hasn't ended on today's date in the church's time zone (`media.church_today()`); when several overlap, the latest start wins. Never "the one edited last".

**More than one plan:** a book's assignments for one audience form one plan: church-wide, or one group's. A member who can see more than one gets a **Reading plan** switch. **My place in the book** is one record for the book; done states belong to each assignment, so plans never mix.

**Old addresses:** `/reading/assignments/<id>` (bookmarks, notifications, the home page) first loads the assignment as the member, so the database decides access, then redirects to `/reading/books/<book>?assignment=<id>`, which selects that assignment's plan, opens it, and scrolls to it. When the member can't see the book, the assignment page is shown on its own, as before.

Progress, done states, and journal notes are private to the member. No leader, teacher, guardian, or administrator can read them; there is no staff read path in the database.

## Administrator steps

1. **Teaching content → New → Book.** Title, author, description, cover image, optional Audible link, "current book", optional discussion thread. Save and publish as usual.
2. On the saved book's edit page, **Reading details**: Kindle link, reading start and end dates, and an optional related Sunday lesson. Saved with `content.edit` and recorded in the audit log (that a link or dates changed, never the URL).
3. **Chapter schedule:** add **Reading assignments** for the book (one per week or chapter range, each with its own dates, instructions, and questions). Every assignment must choose its **Book** in the editor (the database requires it), so a book's schedule is always an explicit link, never a title match. To make a group's own plan for the same book, set the assignment's audience to that group.

Accepted links:
- Kindle: `https://www.amazon.<country>/…/dp/<ASIN>` (tracking query and `/ref=…` are removed) or `https://read.amazon.<country>/?asin=<ASIN>`.
- Audible: `https://www.audible.<country>/pd/…` (unchanged from Phase 7).

## Provider capabilities and limits

Researched 2026-10-21. Amazon and Audible hosts are blocked by this build environment's network policy, so their pages and response headers couldn't be loaded directly; the findings below come from Amazon's KDP help and public documentation, and nothing provider-side was verified end to end.

| Question | Finding | What the app does |
| --- | --- | --- |
| Full-book Kindle player that can be embedded? | No. Amazon's only embed is **Kindle Instant Preview**: the free sample, not the book, set up from the book's Amazon page ("Share → Embed"). | Doesn't embed anything. A sample embed could be added later as an optional extra after testing on real devices; it would still be the sample only. |
| Full-book Audible player that can be embedded? | No supported embeddable full-title player was found. Audible's sample player isn't documented for third-party embedding. | Doesn't embed anything. |
| Sign in to Amazon/Audible inside an iframe or WebView? | Not supported, and not safe to rely on (third-party cookie blocking; providers refuse framing). | Links open in a new tab or the provider's app. Members never type an Amazon password inside The Gathering. |
| Does the church's purchase give members access? | No. Kindle and Audible licences are per account (Amazon Household sharing is limited to a household). | Every book page says the member needs their own access. |
| Copy book text or audio into the app? | Not permitted. | Nothing is stored except title, author, description, cover (with confirmed rights), and links. |
| Open the Kindle or Audible app directly? | Amazon and Audible don't publish a supported custom URL scheme for third parties. On phones, the operating system may offer to open the installed app for an `amazon.*` or `audible.*` HTTPS link, but this isn't guaranteed. | HTTPS links only, which work in every browser. No `kindle://` or `audible://` links. |
| Does reading/listening sync back? | No provider API is available to the church for this. | Progress is whatever the member records. |

Sources: [KDP help: Kindle Instant Previews](https://kdp.amazon.com/help/module/200644260); Amazon Kindle Cloud Reader at `read.amazon.com`.

## Data and privacy

| Table | Holds | Who reads it |
| --- | --- | --- |
| `media.book_details` | Kindle link, reading dates, related lesson | Members, through `media_book_extras` (only for books they can see); editors, through `media_admin_book_details` |
| `media.book_progress` | The member's status and place note | Only the member (`media_book_extras`, `media_books_progress`) |
| `journal.entries` (`link_kind = 'book'` or `'book_assignment'`) | The member's private notes about the book or one assignment | Only the member (My Journal, and the book page through `media_reading_plan`) |
| `media.completions` | Which assignments the member marked done | Only the member |

Migration: `20261031000400_media_books_reading.sql` (additive; adds `'book'` to the journal link kinds and re-creates `journal_entry_create` with that one change). Tests: `tests/db/books.test.ts`, `src/lib/media/embeds.test.ts`.

### Unified reading page (2026-11-04)

Migration `20261104000100_media_reading_plan.sql` (additive): `public.media_reading_plan(book)` (the church's date, the book's visible assignments with details and the caller's own done state, and the caller's own notes for the book and its assignments), and journal link kind `'book_assignment'` (`journal_entry_create` re-created with that one change). Operator script: `supabase/manual/2026-11-04-apply-reading-plan.sql`. Before it is applied the page still works: the schedule comes from the book's assignment cards, and assignments open on their own page. Tests: `tests/db/reading-plan.test.ts`, `src/lib/media/reading-plan.test.ts`. Screenshots (synthetic data): `docs/screenshots/reading-plan/`.

This change also fixes **Write privately** on a book, which the journal API refused (its request check didn't list `book`).
