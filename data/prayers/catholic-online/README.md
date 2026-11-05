# Catholic Online prayer links (pinned source)

The source files behind the **Catholic Online Prayers** category in the Prayer
Library. They are a catalogue of **links**: a title, the topic labels the
source lists a prayer under, and the address of the page it is on.

**No prayer text is here, and none is imported.** The prayers' words stay on
catholic.org; the church claims no right to reproduce them. Members see a
title, its topics, and an **Open prayer** link that opens the source's own
page in a new tab.

| | |
| --- | --- |
| Source | [Catholic Online prayers](https://www.catholic.org/prayers/) (`catholic.org`) |
| Collected | 2026-11-05, by the catalogue the church owner supplied (`Gathering_Prayer_Catalog.zip`) |
| Contents | 2,304 prayer links across 111 of the source's topic categories; 0 category fetch errors |
| Rights | Titles, topic labels, and links only — see `SOURCE.txt` |

## Files

| File | What it is | SHA-256 |
| --- | --- | --- |
| `prayers.json` | 2,304 records: `source_id`, `title`, `categories`, `source_url`, `source_name`, `content_type`, `rights_status`, `is_published` | `22410d8d8d9bde19b8f0985bab52886da64448b8c7b072a44e97c0bb4f60eb02` |
| `coverage.json` | The 111 source categories with the page each was collected from and how many prayers it held | `a156d718655bb938ee9ca69edeaed25ac9f483289be0c815b74fdfc3b384ba3c` |
| `SOURCE.txt` | The catalogue's own README, as supplied, unchanged | `a518fd42f39ee34a7925044fe3a9a366cf3d6c146e0599e3e09c0e4def1f3b14` |

Both hashes are pinned in `src/lib/prayer/catalog.ts`; the dry run and the
import refuse to run when a file doesn't match. The supplied archive also held
a `prayers.csv` (the same records) and a `schema.sql` suggesting a standalone
table; neither is used — the Prayer Library's own migration
(`supabase/migrations/20261130000100_prayer_link_catalog.sql`) creates the
tables, inside the private `prayer` schema with row level security, and the
app imports from `prayers.json`.

## What the import changes about these files

Nothing is edited here. The normalizer in `src/lib/prayer/catalog.ts` makes
two corrections as it reads, both reported by the dry run
(`npm run prayer:catalog-dry-run`):

- **30 titles re-decoded.** The file's non-ASCII titles were written by
  decoding UTF-8 bytes through Windows code page 1250, so "Ave María" arrived
  as "Ave MarĂ­a". Encoding them back through that code page and reading the
  bytes as strict UTF-8 restores the original letters. It is attempted only
  when a title holds a character standing for a byte a UTF-8 sequence can
  start with, and the result is kept only when the bytes are valid UTF-8, so
  correctly written text (including the category "en Español Prayers") is
  never touched.
- **20 titles re-spaced**, two of them holding a no-break space: runs of
  whitespace become single spaces and the ends are trimmed.

Everything else is kept exactly as the source has it, the topic names
included — they are its taxonomy, not the church's, and they overlap
("Marian (Mary) Prayers", "en Español Prayers", "The Rosary in Irish-Gaelic").

See [docs/prayer-catalog.md](../../../docs/prayer-catalog.md).
