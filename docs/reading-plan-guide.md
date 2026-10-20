# Reading plans: administration and import

Where: **Admin → Reading plans** (`/admin/bible`). Bible translations are configured separately ([bible-sources.md](bible-sources.md)).

## Who can do what

| Role (capability) | Can | Can't |
| --- | --- | --- |
| Reading plan editor (`reading.edit`) | Create drafts, edit draft days, import CSV into drafts, duplicate plans, delete unused drafts, preview | Publish, change published plans, change sources |
| Reading plan publisher (`reading.edit`, `reading.publish`) | All of the above, plus publish, archive, restore, feature, edit published plans' presentation, revise/add/retire published days | Change sources |
| Bible source manager (`bible.manage`) | Translations, text imports and their publication, reference PDFs | Plans (unless also granted a plan role) |
| Content editor (Phase 1/7 role) | Nothing here unless a plan role is also granted | |
| Super administrator | All of the above implicitly | |

No role can see members' progress, bookmarks, highlights, notes, or journals. Plan pages show only aggregate counts (for example "12 reading now").

## Plan types

- **Dated church plan** (`calendar`): every day has a date (YYYY-MM-DD). "Today" is the date in the plan's time zone (the church's by default). Members who join after it began choose **Start from today** (earlier readings don't count toward their progress) or **Include the earlier readings**.
- **Numbered days** (`personal`): Day 1, Day 2… Each member picks a start date and their time zone; Day N is read on start + N − 1.

Plans can have any number of days (they needn't be 365). February 29 is accepted only in leap years. Dates are calendar dates, so daylight-saving changes never move a reading.

Each day is a **reading** (one or more passages), a **catch-up** day (passages optional), or a **rest** day (no passages, never counted as missed, no reminder). Days can have a heading, up to 5 reflection questions, supporting notes (bold, italic, lists, links), a linked discussion, and related published devotionals or lessons.

## Creating a plan

1. **New plan** → title, description, who it's for, schedule type, translation, time zone, audience (all members or one group). It starts as a draft.
2. Add days one at a time (**Add a day**) or **Import from a spreadsheet** (Excel or CSV, below). Passages are typed the usual way and checked against the plan's translation: `Genesis 1–2; Psalm 23`, `John 3:16–21`, `Matthew 5:1–12, 43–48`.
3. Optional cover (PNG/JPEG/WebP ≤ 4 MB, re-encoded without location data) with a description.
4. **Preview** shows the day list and each day's passages as members will see them (once the translation is active).
5. A publisher **publishes** after confirming. Publishing checks that the translation is active, the group is active, every reading day has passages, and every passage exists in the translation.
6. Optionally **Make the featured church plan** (one at a time; all-member plans only). It's shown first on members' Bible page.

### Discussions

A day can link one community discussion, never broader than the plan: all-member plans link church-wide discussions; group plans link their own group's discussions. Members see **Write privately** (their journal) and **Join discussion** as separate actions; nothing they write privately is ever posted.

## Spreadsheet import (Excel or CSV)

Upload an **Excel workbook (.xlsx)** or a **CSV** file. From Google Sheets use **File → Download → Microsoft Excel (.xlsx)**; from Numbers, **File → Export To → Excel**. Older `.xls` files need saving as `.xlsx` first.

Start from a template on the plan page (**Excel template** or **CSV template**), or use [samples/reading-plan-dated.csv](samples/reading-plan-dated.csv) / [samples/reading-plan-numbered.csv](samples/reading-plan-numbered.csv). The templates have a column for the date (or day) and dedicated passage columns, **Passage 1** to **Passage 4**, one reading per cell (for example Old Testament, New Testament, Psalm, Proverbs). The simplest dated plan is two columns, `date` and `Passage 1`, one row per date.

In an Excel file:

- Only the **first sheet** is read (others are ignored); row numbers in messages match Excel's.
- **Dates** can be typed and shown any way Excel accepts (`11/1/2027`, `1-Nov-27`, `2027-11-01`): the app reads the date Excel stored, not how it's displayed, so day and month can't be swapped. A date stored as plain text must be written `YYYY-MM-DD`.
- Formulas aren't run; the value Excel last saved is used. Blank rows are skipped.
- Same limits as CSV (1 MB, 2,000 days, 16 columns).

| Column | Required | Notes |
| --- | --- | --- |
| `date` | dated plans | In CSV, `YYYY-MM-DD` only (so `03/04` can never be misread). In Excel, a date cell. Must be empty for numbered plans |
| `day` | numbered plans | 1–2000. Must be empty for dated plans |
| `type` | no | `reading` (default when passages are given), `rest`, `catch_up` |
| Passage columns | reading days | Any number of columns named `Passage 1`, `Passage 2`… (or `Reading 1`…, `Old Testament`, `New Testament`, `Psalm`, `Proverbs`, `Gospel`), and/or one `passages` column. Each cell holds one reading, or several separated by `;`. The day's passages are every filled cell, in column order; empty cells are skipped. A problem names its column. Same-book passages stay separate. At most 20 per day |
| `heading` | no | Up to 160 characters |
| `questions` | no | Up to 5, separated by ` \| ` |
| `notes` | no | Up to 4,000 characters |

Book names: full names (`1 Corinthians`, `Song of Songs`, `Psalm`/`Psalms`), USFM codes (`1CO`), and standard abbreviations (`Gn`, `Ps`, `1 Cor`, `1Ch`, `Jn`, `He`, `Jsh`, `Zph`, `Rev`…). Ambiguous abbreviations (`Jo`, `Ju`, `Ph`, `Ma`, `Th`, `Ti`) are refused with a message. In one-chapter books a bare number is a verse (`Jude 3`), except `1`: `Jude 1` or `2 John 1` means the whole book, as reading schedules write it (write `Jude 1:1` for the first verse). Partial verses (`16a`) aren't supported.

Flow:

1. **Preview import**: the file (≤ 1 MB, ≤ 2,000 days) is parsed safely (strict CSV, nothing evaluated), every passage is checked against the translation in the database, and the result is stored as a preview. Nothing changes yet.
2. The preview lists **problems by row** (bad dates, wrong key column, duplicate dates/days, unknown or ambiguous books, chapters or verses that don't exist, rest days with passages, reading days without passages) and **warnings** (gaps between dates or day numbers that aren't explicit rest days; ignored columns). Any problem blocks the import.
3. Choose **Add to the draft** (stops without changing anything if a date or day number already exists) or **Replace the draft's days**, confirm, and apply. All days are written in one transaction, revalidated in the database; if any row fails, nothing is written and the message names the row.

Imports only go into **drafts**. Previews expire after a day.

## Changing a published plan (correction and versioning policy)

Members' history is never rewritten silently.

- **Title, description, cover, "who it's for"**: publishers can edit them; progress and notes are unaffected.
- **Translation, schedule type, time zone, audience** are fixed once published. Use **Duplicate → next version** (optionally moving dates, e.g. +365/+366 for next year), rework the draft, publish it, and archive the old plan.
- **A day's passages, kind, heading, questions, notes, date/number** are changed one day at a time with **Revise** on that day's page:
  - the page shows the **impact**: whether the date has passed, how many marked it read, how many current readers haven't reached it;
  - a **reason** is required and kept in the change log;
  - future days need "I've reviewed the impact"; **past days need the explicit correction checkbox**;
  - the day keeps its id; its earlier content is saved as revision N; the day becomes revision N+1;
  - completions and journal entries stay tied to the revision they were made for. Members who read the earlier version keep it marked read and see "This reading changed after you read it" with what they read;
  - when passages, kind, or date change, members whose day is still ahead (and unread) get **one in-app notice per plan** ("Upcoming readings changed in …"; generic in email/push).
- **Add a day** to a published plan: today or later for dated plans.
- **Retire a day**: removed from the schedule, never deleted; completions and notes are kept. Past days need the correction checkbox.
- Published days and plans with readers are **never deleted**. Plans are archived; members who joined can still open their history.

Every change is in the plan's **change log** (who, when, reason, before/after passages) and in the audit log (no member data).

## Reminders and notices

Members opt in per plan (time and time zone). See [bible-reading-guide.md](bible-reading-guide.md#reminders). The scheduler is the existing database job (`pg_cron` → `community.tick` → `bible.tick`), so nothing new needs to be scheduled.
