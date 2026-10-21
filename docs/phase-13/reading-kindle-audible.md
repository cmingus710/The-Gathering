# Church reading: Kindle and Audible (Phase 13)

## What members get

On **Church reading** (`/reading`) members browse the current book(s), this week's assignment, other weeks, and books already read. A book page (`/reading/books/<id>`) shows:

- Title, author, cover image (only an image whose rights an administrator confirmed in the media library), and description.
- **Read or listen**: **Read in Kindle** and **Listen in Audible** buttons, when the book has those links.
- **My reading**: the church's reading dates, the related Sunday lesson (if the member can see it), and the member's own progress (Want to read / Reading / Finished, plus an optional place note such as "Chapter 4").
- **Save** (bookmark), **Write privately** (a My Journal entry linked to the book), the discussion thread when one is attached, and the book's reading assignments (the chapter schedule).

Progress and journal notes are private to the member. No leader, teacher, or administrator can read them; there is no staff read path in the database.

## Administrator steps

1. **Teaching content → New → Book.** Title, author, description, cover image, optional Audible link, "current book", optional discussion thread. Save and publish as usual.
2. On the saved book's edit page, **Reading details**: Kindle link, reading start and end dates, and an optional related Sunday lesson. Saved with `content.edit` and recorded in the audit log (that a link or dates changed, never the URL).
3. **Chapter schedule:** add **Reading assignments** for the book (one per week or chapter range, each with its own dates and questions). These already existed; Phase 13 doesn't add a second schedule.

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
| `journal.entries` (`link_kind = 'book'`) | The member's private notes | Only the member |

Migration: `20261031000400_media_books_reading.sql` (additive; adds `'book'` to the journal link kinds and re-creates `journal_entry_create` with that one change). Tests: `tests/db/books.test.ts`, `src/lib/media/embeds.test.ts`.
