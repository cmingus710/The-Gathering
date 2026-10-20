# ASV source cross-check

The American Standard Version (1901) is in the public domain, but digital copies differ. Before choosing one, three independent copies were compared verse by verse (2026-10-20):

| Copy | Where it comes from | Verses |
| --- | --- | --- |
| **A. Zefania XML (used)** | `eng-asv.zefania.xml` in [seven1m/open-bibles](https://github.com/seven1m/open-bibles) at commit `f257a3559025c3f873b48a75019f53a9354ed7de` (SHA-256 `ef20ebf6…914bf`); published by the Free Bible Software Group, which names **Biola University's Unbound Bible ASV** as its source | 31,102 |
| B. `holy-bible@1.3.0` (npm) | JSON bundled in the package; source not documented | 31,103 |
| C. midvash/bible-data | `versions/en/asv/asv.json` at commit `d9fe1779447717bbfcb578e505b893125cad581c`; source not documented | 31,086 |

Comparison ignores only typography (apostrophe styles, how supplied words are marked, letter case, punctuation, spacing) and compares the words of each verse.

| Result | Verses |
| --- | --- |
| All three copies agree | 30,262 |
| A agrees with B | 734 |
| A agrees with C | 27 |
| B and C agree, A differs | 60 |
| No two agree | 3 |
| Only in A and B (verses the ASV prints in its margin, e.g. Matthew 17:21, Acts 8:37; C omits them) | 16 |

**Copy A is used, and only copy A:** no verse is taken from another copy. It is the only one with a named source, and where the copies differ it agrees with at least one other copy in all but 63 verses. Spot-check these 63 against a printed ASV or [eBible.org](https://ebible.org/asv/) (blocked from the environment that prepared this) during the import review; correct the source file if needed rather than editing verses in the app.

What copy A does and doesn't contain:

- `[and]`: words the translators supplied (italic in the 1901 printing), kept as brackets.
- A wholly bracketed verse (Matthew 17:21, 18:11; Mark 7:16, 9:44, 9:46, 11:26, 15:28; Luke 17:36, 23:17; John 5:4; Acts 8:37, 15:34, 24:7, 28:29; Romans 16:24) is one the ASV prints only in its margin. Kept as in the source. Exception to check: in this copy Matthew 23:14 is present without brackets, and 23:13 ends with `[.]`.
- Romans: the closing doxology is at 16:25–27 (the WEB has it at 14:24–26), so the import review shows 16:26–27 as beyond the usual numbering (accept them) and 14:24–26 as missing (acknowledge).
- No Psalm superscriptions, section headings, or poetry line breaks (the source has none; none are added).
- Apostrophes are written as backticks in the source (``wife`s``); the preparation script turns them into ’.

## Verses to spot-check

Also check Matthew 23:13–14 (bracketing, see above).

B and C agree with each other but not with A (60):

Genesis 27:28, 1 Samuel 17:20, Job 42:17, Psalms 1:6, Psalms 9:20, Psalms 32:11, Psalms 42:11, Psalms 70:5, Psalms 85:13, Psalms 90:17, Psalms 92:15, Psalms 93:5, Psalms 94:23, Psalms 95:11, Psalms 96:13, Psalms 98:9, Psalms 103:22, Psalms 104:35, Psalms 105:45, Psalms 106:48, Psalms 110:7, Psalms 111:10, Psalms 112:10, Psalms 113:9, Psalms 114:8, Psalms 115:18, Psalms 116:19, Psalms 118:29, Psalms 119:8, Psalms 119:16, Psalms 119:24, Psalms 119:32, Psalms 119:40, Psalms 119:48, Psalms 119:56, Psalms 119:64, Psalms 119:72, Psalms 119:80, Psalms 119:87, Psalms 119:95, Psalms 119:104, Psalms 119:112, Psalms 119:120, Psalms 119:128, Psalms 119:136, Psalms 119:144, Psalms 119:152, Psalms 119:160, Psalms 119:168, Psalms 134:3, Psalms 135:21, Psalms 136:26, Psalms 145:21, Psalms 146:10, Psalms 147:20, Psalms 148:14, Psalms 149:9, Romans 3:21, Revelation 12:2, Revelation 22:14

No two copies agree (3):

Psalms 41:13, Psalms 72:20, Psalms 89:52
