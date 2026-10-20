/**
 * Scripture references entered by editors ("jn 3:16-18", "1 Cor 13") are
 * normalized to a canonical form ("John 3:16–18", "1 Corinthians 13") so
 * the lesson archive can filter by book. Only the reference is stored; no
 * verse text is ever fetched, quoted, or invented.
 */
export const BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Songs", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon",
  "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
] as const;

export type BookName = (typeof BOOKS)[number];

const ALIASES: Record<string, BookName> = {
  gen: "Genesis", gn: "Genesis", ex: "Exodus", exod: "Exodus", lev: "Leviticus", lv: "Leviticus", num: "Numbers", nm: "Numbers",
  deut: "Deuteronomy", dt: "Deuteronomy", josh: "Joshua", jos: "Joshua", judg: "Judges", jdg: "Judges", rth: "Ruth", ru: "Ruth",
  "1sam": "1 Samuel", "1sm": "1 Samuel", "2sam": "2 Samuel", "2sm": "2 Samuel", "1kgs": "1 Kings", "1ki": "1 Kings", "2kgs": "2 Kings", "2ki": "2 Kings",
  "1chr": "1 Chronicles", "1ch": "1 Chronicles", "2chr": "2 Chronicles", "2ch": "2 Chronicles", ezr: "Ezra", neh: "Nehemiah", esth: "Esther", est: "Esther",
  jb: "Job", ps: "Psalms", psa: "Psalms", psalm: "Psalms", pss: "Psalms", prov: "Proverbs", prv: "Proverbs", pr: "Proverbs",
  eccl: "Ecclesiastes", ecc: "Ecclesiastes", qoh: "Ecclesiastes", song: "Song of Songs", sos: "Song of Songs", "songofsolomon": "Song of Songs",
  "songofsongs": "Song of Songs", cant: "Song of Songs", isa: "Isaiah", is: "Isaiah", jer: "Jeremiah", lam: "Lamentations",
  ezek: "Ezekiel", eze: "Ezekiel", dan: "Daniel", dn: "Daniel", hos: "Hosea", jl: "Joel", am: "Amos", obad: "Obadiah", ob: "Obadiah",
  jon: "Jonah", mic: "Micah", nah: "Nahum", hab: "Habakkuk", zeph: "Zephaniah", zep: "Zephaniah", hag: "Haggai", zech: "Zechariah", zec: "Zechariah",
  mal: "Malachi", matt: "Matthew", mt: "Matthew", mk: "Mark", mrk: "Mark", lk: "Luke", luk: "Luke", jn: "John", jhn: "John",
  ac: "Acts", rom: "Romans", rm: "Romans", "1cor": "1 Corinthians", "1co": "1 Corinthians", "2cor": "2 Corinthians", "2co": "2 Corinthians",
  gal: "Galatians", eph: "Ephesians", phil: "Philippians", php: "Philippians", col: "Colossians", "1thess": "1 Thessalonians", "1th": "1 Thessalonians",
  "2thess": "2 Thessalonians", "2th": "2 Thessalonians", "1tim": "1 Timothy", "1ti": "1 Timothy", "2tim": "2 Timothy", "2ti": "2 Timothy",
  tit: "Titus", phlm: "Philemon", phm: "Philemon", heb: "Hebrews", jas: "James", jm: "James", "1pet": "1 Peter", "1pt": "1 Peter",
  "2pet": "2 Peter", "2pt": "2 Peter", "1jn": "1 John", "1jo": "1 John", "2jn": "2 John", "2jo": "2 John", "3jn": "3 John", "3jo": "3 John",
  jud: "Jude", rev: "Revelation", rv: "Revelation", revelations: "Revelation",
};

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(i{1,3})\s+/, (_, r: string) => `${r.length}`) // "II Kings" → "2kings"
    .replace(/^(first|second|third)\s+/, (_, w: string) => ({ first: "1", second: "2", third: "3" })[w as "first"])
    .replace(/[\s.]/g, "");

const LOOKUP = new Map<string, BookName>([
  ...BOOKS.map((b) => [key(b), b] as const),
  ...Object.entries(ALIASES),
]);

export function findBook(name: string): BookName | null {
  return LOOKUP.get(key(name.trim())) ?? null;
}

/**
 * Canonical form, or null when the book isn't recognized or the chapter and
 * verse part isn't a plausible reference.
 */
export function normalizeReference(input: string): string | null {
  const raw = input.trim().replace(/\s+/g, " ").replace(/[–—]/g, "-");
  if (!raw || raw.length > 80) return null;
  const m = /^((?:[1-3]|i{1,3}|first|second|third)?\s*[a-z][a-z .]*?)\.?\s*(\d{1,3}(?:\s*:\s*\d{1,3})?(?:\s*-\s*\d{1,3}(?:\s*:\s*\d{1,3})?)?(?:\s*,\s*\d{1,3}(?:\s*-\s*\d{1,3})?)*)?$/i.exec(raw);
  if (!m) return null;
  const book = findBook(m[1]);
  if (!book) return null;
  if (!m[2]) return book;
  const passage = m[2].replace(/\s+/g, "").replace(/-/g, "–").replace(/,/g, ", ");
  return `${book} ${passage}`;
}

/** Parses a comma/semicolon/newline separated list; returns valid refs and the entries that weren't recognized. */
export function parseReferenceList(input: string): { refs: string[]; invalid: string[] } {
  const refs: string[] = [];
  const invalid: string[] = [];
  for (const part of input.split(/[;\n]+/)) {
    const t = part.trim();
    if (!t) continue;
    const n = normalizeReference(t);
    if (n) {
      if (!refs.includes(n)) refs.push(n);
    } else invalid.push(t);
  }
  return { refs: refs.slice(0, 20), invalid };
}

/** The book of a canonical reference ("1 John 3:1" → "1 John"). */
export function bookOf(ref: string): BookName | null {
  const sorted = [...BOOKS].sort((a, b) => b.length - a.length);
  return sorted.find((b) => ref === b || ref.startsWith(`${b} `)) ?? null;
}
