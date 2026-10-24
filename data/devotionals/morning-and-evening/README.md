# Morning & Evening — Charles Spurgeon (pinned source)

`m_e.json` is an unmodified copy of `data/m_e.json` from
[dwahrens/morning-and-evening](https://github.com/dwahrens/morning-and-evening),
pinned for reproducible imports:

| | |
| --- | --- |
| Repository | https://github.com/dwahrens/morning-and-evening |
| Commit | `e05b8e89d67e01808a3384794416aeeca016d65e` (2025-12-30, HEAD of `main` when imported) |
| File | `data/m_e.json`, git blob `b85d23704e8d180b2d977937648500c1ec70473b` (unchanged since commit `bd60a0f7`, 2021-06-25) |
| SHA-256 | `b4fb4f1561ad48617ba9ff9f6a9b02d55f2ede1a4ebaa23e93825a0741c0cf96` |
| Size | 1,609,601 bytes, 732 records |
| Copied | 2026-10-24 |

`node --no-warnings scripts/morning-evening-dry-run.mjs --verify-upstream` downloads the
file at that commit and checks it is byte-for-byte this copy.

## Licences and provenance

- **The devotional text is in the public domain.** Charles Haddon Spurgeon
  (1834–1892) published *Morning by Morning* (1865) and *Evening by Evening*
  (1868). The Christian Classics Ethereal Library publishes the combined
  *Morning and Evening* marked as public domain:
  https://www.ccel.org/s/spurgeon/morn_eve/morn_eve.html
- **The repository is under the Apache License 2.0** (`LICENSE` here is the
  copy from that repository, kept as the licence asks). The licence covers
  dwahrens' software and the file as distributed; it does not make the
  underlying public-domain text anyone's property.
- **Upstream.** dwahrens credits
  [russianryebread/morning-and-evening](https://github.com/russianryebread/morning-and-evening)
  (no licence file), whose README says its HTML was taken from spurgeon.org.
  The dwahrens `m_e.json` is identical, record for record, to the
  russianryebread `m_e.json` at `6caf9386` (which also has 12 `null` entries
  that dwahrens removed).

## Original text, not a modern revision

The text keeps Spurgeon's 19th-century wording ("thou", "thy", "remaineth",
"dishonours"), KJV quotations, and his own hymn quotations (Watts, Hart,
Bunyan). It is not Alistair Begg's or any other modernized revision. See
`docs/morning-evening.md` for the checks made, including those that could
not be made from the build environment.

## Changes

None to this file. The import's normalizer
(`src/lib/devotionals/morning-evening.ts`) makes only the documented,
verified formatting corrections when it reads it.
