# Statement fonts

Noto Sans fonts used to render annual giving statement PDFs (`src/lib/giving/statement-pdf.ts`), so donor names, fund names, and church details in any common script print correctly instead of being replaced.

| File | Covers |
| --- | --- |
| `NotoSans-Regular/Bold.ttf` | Latin (incl. accents and Vietnamese), Greek, Cyrillic, Devanagari |
| `NotoSansArabic-Regular/Bold.ttf` | Arabic, Persian, Urdu |
| `NotoSansHebrew-Regular/Bold.ttf` | Hebrew |
| `NotoSansThai-Regular/Bold.ttf` | Thai |
| `NotoSansSC-Regular.ttf` | Chinese (simplified and traditional) and Japanese kana |
| `NotoSansKR-Regular.ttf` | Korean |

The CJK fonts are Regular only to limit size; bold CJK text is drawn in Regular. Only the glyphs a statement uses are embedded (subset) in each PDF, and the large fonts are loaded only when a statement contains those scripts.

Licensed under the SIL Open Font License 1.1 (`OFL.txt`). Source: Google Fonts via the `@expo-google-fonts/noto-sans*` packages.
