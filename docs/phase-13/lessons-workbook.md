# Lesson builder and member workbooks (Phase 13)

> **Since `20261122000100` (My Journal consolidation):** members' answers and notes are My Journal entries (`journal.entries`, link kinds `lesson_answer` and `lesson_notes`), not rows in `media.workbook_answers` / `media.workbook_notes`. The lesson page still edits them in place, with the same autosave, conflict, and privacy rules, and the function names below are unchanged. "My workbooks" (`/lessons/workbooks`) redirects to My Journal. See [migration-history.md](../migration-history.md#my-journal-lesson-answers-and-notes-2026-11-22). The teacher's builder and preview are unchanged.

Sunday lessons can be built from ordered blocks that approved members open as a private workbook: they read the scripture, teaching, and media in order and write answers to the lesson's questions, plus free notes. This extends the existing lessons module (`media.items`, kind `lesson`); nothing about existing lessons changes unless a teacher adds blocks.

- Migration: `supabase/migrations/20261031000300_media_lesson_workbooks.sql` (additive).
- Hosted apply script: `supabase/manual/2026-10-31-apply-lesson-workbooks.sql` (needs `20261030000100` recorded; independent of the other Phase 13 steps; records `created_by = 'phase-13'`).
- Tests: `tests/db/lesson-workbooks.test.ts`, `src/lib/media/workbook.test.ts`.

## Teacher guide

**Open the builder.** Admin → Teaching content → a lesson → **Lesson builder** card → **Open the lesson builder** (`/admin/content/<id>/builder`). Create the lesson first (title, Sunday date) in the normal editor.

**Who can do what.** The same rules as the lesson itself:

| | Draft lesson | Scheduled, published, or archived lesson |
| --- | --- | --- |
| Content editor (`content.edit`) | Add, edit, reorder, remove, restore blocks; preview | Preview only |
| Content publisher (`content.publish`) | Everything | Everything (changes reach members at once) |
| Publishing | — | Still done in the lesson editor's **Publishing** panel |

**Blocks.** Choose a kind in **Add a block**, fill it in, and choose **Save new block**. Each block saves on its own.

| Kind | Fields |
| --- | --- |
| Introduction | Heading, text |
| Scripture | Reference (validated and normalized as you leave the field, e.g. `jn 3:16-18` → `John 3:16–18`), optional text |
| Teaching, Illustration, Closing | Heading, text (Markdown: bold, italic, headings, lists, links; no HTML) |
| Discussion question, Response question, Reflection | **Question members answer** (required), optional text before it |
| Image | A ready image from the media library, description for screen readers, caption |
| Audio, video, or document | A ready file from the media library (audio, church-hosted video, a YouTube/Vimeo video added to the library, or a PDF/PPTX), caption |

**Teacher-only content.** Every block has a box marked **Teacher only — never shown to members** with:

- **Teacher note**: leader prompts, timing, background, answers to expect.
- **Hide this whole block from members**: a block only teachers see (for example a leader-only illustration).

Neither is ever part of what members receive. The **Preview the member workbook** page uses the same database call members use, so if it isn't in the preview, members don't get it.

**The lesson's "Notes shown to members".** The lesson editor's notes field (previously labelled "Notes") is unchanged and **is shown to members** (and to visitors for a public lesson) under "Lesson notes" on the lesson page. Don't put teacher-only material there; use teacher notes in the builder.

**Order.** Use **Up** and **Down** on each block (keyboard accessible; the moved block keeps focus and the new position is announced). Moving a block never changes what it is, and members' answers stay with it. Save a new block before moving it.

**Unsaved changes.** A block with unsaved edits is outlined and labelled **Unsaved changes**; the page warns before you leave with any unsaved block. **Discard changes** returns a block to its saved version.

**Someone else edited the block.** Each save is checked against the version you started from. If another teacher saved the block in the meantime, nothing is overwritten: the builder shows their version and offers **Keep mine (save over theirs)** or **Use their version**. If blocks were added or removed elsewhere while you reorder, the new order isn't saved and you're asked to reload.

**Removing a block.** **Remove** takes it out of the lesson for members. It's listed under **Removed blocks** with **Restore** (same block, same identity, back at the end). Members' answers to a removed question are kept for them.

**Editing a live lesson.** Saved changes reach members at once. Changing a question's wording marks it changed for members who already answered (see [Version behavior](#version-behavior)); editing text, teacher notes, headings, or files doesn't.

**Teachers can't see answers.** There is no view of members' answers, notes, or even how many people answered, for any role (including super administrators). This matches the journal.

## Member guide

**Following a lesson.** On a Sunday lesson that has blocks, choose **Follow along and answer the questions** (`/lessons/<id>/workbook`). Everything you write there is saved in **My Journal** (linked from the Sunday lessons page and each lesson), with your other entries; each answer is its own entry, named by its question, and links back to that question in the lesson. Workbooks are for approved adult members; visitors, pending accounts, and youth accounts don't have them (youth still see public lessons as before).

**Privacy.** "Your answers are private. Teachers and administrators can't see them." Answers and notes are stored in your account, readable only by you. Nobody else, including teachers, publishers, administrators, group leaders, and guardians, can read them. They're never posted anywhere or included in notifications or the audit log. (This is access control, not encryption.)

**Reading.** Blocks appear in the teacher's order. Scripture blocks open with **Read …** and show the passage in your Bible version (your preference in Bible settings, else the church's default), with the translation's attribution at the end. If the passage is longer than the translation allows on one page, or the source is unavailable, you see the reference and a link to open it in the Bible reader instead. Audio, video, and documents open with the same players and links as elsewhere in the app.

**Writing and saving.** Answers and **My notes** save as you type. The status under each box says **Saving…**, **Saved**, or **Couldn't save — your text is kept here, retrying** (it retries automatically, and when you're back online; **Retry now** is there too). Until a save is confirmed, a copy of your text is kept in this browser (on this device, for your account and that question only) and removed as soon as it's saved, so a dropped connection or closed tab doesn't lose it. Coming back, unsaved text from this device is restored and saved.

**Another tab or device saved newer text.** Nothing is overwritten silently. You see both versions and choose **Keep mine**, **Use the saved one**, or **Keep both** (both texts, one after the other). The same choice appears if this device has unsaved text and the saved answer changed since.

**A question changed after you answered.** You'll see "The question changed after you answered" with the question you originally answered. Your answer is untouched. **Keep my answer for the new question** clears the notice.

**Removed questions.** If the teacher removes a question you answered, your answer is listed under **Removed questions** with the question as you saw it. You can delete it there.

**A lesson that's no longer available** (unpublished, archived, or deleted): your own answers and notes stay in **My Journal**, readable by you, without the lesson's content.

**Deleting.** **Delete my answers** at the bottom of the lesson removes every answer and note you wrote for that lesson (from My Journal too). One entry can also be deleted from My Journal. It can't be undone.

**Signing out on a shared device.** Unsaved text can remain in that browser until it saves. If you used someone else's device, wait for **Saved** before closing.

## Version behavior

Blocks have stable identities; answers are never moved to a different block.

| Change | Block id | `revision` | `prompt_revision` | Effect on existing answers |
| --- | --- | --- | --- | --- |
| Reorder | same | unchanged | unchanged | none (position only) |
| Edit heading, text, reference, file, caption, teacher note, teacher-only flag | same | +1 | unchanged | none |
| Change a question's wording | same | +1 | +1 | shown as **The question changed after you answered**, with the original wording |
| Remove (soft: `removed_at`) | same | +1 | unchanged | kept, shown to their author under **Removed questions** |
| Restore | same | +1 | unchanged | shown with the question again |
| Mark a question teacher-only | same | +1 | unchanged | shown to their author under **Removed questions** (with the member's own copy of the wording only) |

- `revision` is the teachers' optimistic-concurrency counter: a save or removal names the revision it was edited from and returns a conflict (with the current block) if it moved.
- `prompt_revision` changes only when a question's text changes. Each answer stores `block_id`, `block_revision` (the `prompt_revision` it was written against), and `prompt_snapshot` (the question as the member saw it). The workbook reports each answer's `state`: `current`, `changed` (revisions differ), or `removed` (block removed, teacher-only, or no longer a question). Editing an answer keeps its original snapshot; **Keep my answer for the new question** (`media_workbook_answer_accept`) moves it to the current revision and wording.
- A block's kind can't change after it's created (make a new block instead), so a question never turns into something else under existing answers.
- Answers and notes autosave with the journal's contract: each save sends the version it was based on (0 for a new answer); a different stored version returns `conflict` with the current text and version; `force` overwrites after the member chose; a retried save that already landed returns `saved`. Saves are rate limited (600 per 10 minutes per member, shared by answers and notes). Answers and notes are at most 10,000 characters.

## Database reference

Private `media` schema; RLS on with no policies; no table grants. All access is through these functions (granted to `authenticated` only; none to `anon`).

| Table | Purpose |
| --- | --- |
| `media.lesson_blocks` | `id`, `item_id` (lesson), `kind`, `position`, `heading`, `body`, `prompt`, `scripture_ref`, `asset_id`, `caption`, `alt_text`, **`teacher_only`**, **`teacher_note`**, `revision`, `prompt_revision`, `client_key`, `created_by`/`updated_by`, timestamps, `removed_at` |
| `journal.entries` (`link_kind = 'lesson_answer'`) | Since `20261122000100`: one per member per question. `media_item_id` (lesson), `lesson_block_id`, `block_revision`, `question` (the wording the member saw, formerly `prompt_snapshot`), `body` (≤ 10,000), `version`, timestamps. Owner only. |
| `journal.entries` (`link_kind = 'lesson_notes'`) | Since `20261122000100`: one per member per lesson. `media_item_id`, `body` (≤ 10,000), `version`, timestamps. Owner only. |
| `media.workbook_answers`, `media.workbook_notes` | The original tables. Kept unchanged as the pre-migration copy; nothing reads or writes them since `20261122000100`. |

| Function | Who | Notes |
| --- | --- | --- |
| `media_admin_lesson_blocks(p_item)` | `content.edit` | Blocks with teacher fields, removed blocks, `can_edit`, `can_publish`, lesson state. Never answers. |
| `media_admin_lesson_block_save(p_item, p_block jsonb, p_base_revision)` | `content.edit`; live lesson needs `content.publish` | Create (no `id`; idempotent per `client_key`) or update; `{status: saved, block}` or `{status: conflict, current}` |
| `media_admin_lesson_block_remove(p_item, p_block, p_base_revision)` | same | Soft removal; conflict when the revision moved |
| `media_admin_lesson_block_restore(p_item, p_block)` | same | Back at the end, same id |
| `media_admin_lesson_blocks_reorder(p_item, p_ids uuid[])` | same | Must list exactly the current blocks, else `{status: conflict}` |
| `media_lesson_workbook(p_item, p_preview default false)` | Approved adult members who can see the lesson (`media.item_visible`); preview: `content.edit` | Member projection of blocks (never teacher fields) + the caller's answers and note. Preview returns the same projection with no answers, drafts included. A member who wrote in a lesson that's no longer visible gets `available: false` with only their own text. |
| `media_workbook_answer_save(p_item, p_block, p_text, p_base_version, p_force)` | Approved adult members | `saved` / `conflict` |
| `media_workbook_answer_accept(p_item, p_block)` | same | Answer now refers to the current wording |
| `media_workbook_note_save(p_item, p_text, p_base_version, p_force)` | same | `saved` / `conflict` |
| `media_workbooks()` | same | The caller's workbooks (title only while the lesson is visible) |
| `media_workbook_delete(p_item, p_block default null)` | same | One answer, or all of the caller's answers and the note for the lesson |

Also changed, additively: `media.asset_used_visibly` gains one clause (a file shown by a member-visible block of a lesson the person can see, approved members only), `media.asset_usage` lists lesson blocks as uses, and a trigger on `media.assets` moves blocks to a file's replacement. `media.item_detail` and `media_item` are **not** redefined.

App routes: `PUT /api/workbook/<item>/answers/<block>` and `PUT /api/workbook/<item>/note` (autosave; 200 saved, 409 conflict with the current text, 401 signed out; `private, no-store`).

## The lesson notes decision

Before this phase, `media.item_detail` returned a lesson's `notes` to every viewer who could see the lesson (including visitors, through the anonymous `media_item` call, for a public lesson), and the lesson page showed them as "Notes". Teachers may have expected these to be private, but members could already read every published lesson's notes, so hiding them now would silently remove content members already see.

Decision:

- `notes` keeps its meaning: **member-visible lesson notes**. The member page heads them "Lesson notes"; the editor labels the field **Notes shown to members** with a hint that visitors see them on public lessons. `media.item_detail` and `media_item` are unchanged.
- Teacher-only material lives in the new block model (`teacher_note` on any block, or a `teacher_only` block), which no member or anonymous function selects. The member projection (`media.lesson_block_member_json`) names each column it returns, and the tests check that the full JSON of `media_item` (member, youth, and anonymous), `media_lesson_workbook`, and the teacher preview never contains teacher text or the teacher field names.
- Teachers who put private material in the old notes field should move it to a block's teacher note. Nothing was moved automatically.

## Not included

- **Printable export of a workbook as a handout.** Since `20261122000100` answers and notes are included in the My Journal downloads (Markdown and JSON), each with its lesson and question.
- **Linking a lesson to an event occurrence.** The lesson's Sunday date (`delivered_on`) is the service date.
- **Bible text in the builder.** The builder validates and normalizes references only; members see text from their own translation, within its license limits (`max_verses_per_view`, attribution, API.Bible FUMS tracking).
- **Answer counts or completion statistics for teachers.** Deliberately absent (privacy).
- Not verified in a browser in this change: the pages were type-checked and linted, and the database behavior is covered by tests.
