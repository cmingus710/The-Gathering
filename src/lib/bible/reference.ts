import { BOOK_LIST, bookByCode, chapterCount, lastVerse, type BookCode } from "./books";

/**
 * Scripture references for reading plans: "John 3:16–21", "Psalm 23",
 * "Genesis 1–2", "Gen 1:1-2:3", "1 Cor 13; Ps 23", "John 3:16-18, 21".
 *
 * Book names come from a controlled list (full names, USFM codes, and the
 * aliases below). Anything else, or anything that could mean two things, is
 * an error with a reason: nothing is silently reinterpreted. Notably:
 *   - "Jo", "Ju", "Ph", "Ma", "Th", "Ti" aren't accepted (several books);
 *   - in a one-chapter book a bare number is a verse ("Jude 3"), but a bare
 *     "1" ("Jude 1") is ambiguous (verse 1 or the whole book) and refused;
 *   - partial verses ("16a") aren't supported.
 * Validation here uses the reference versification; the database checks
 * again against the plan's translation.
 */
export type Passage = { book: BookCode; sc: number; sv: number | null; ec: number; ev: number | null };

export type ParseResult = { ok: true; passages: Passage[] } | { ok: false; error: string };

const ALIASES: Record<string, BookCode> = {
  gen: "GEN", gn: "GEN", ge: "GEN", ex: "EXO", exod: "EXO", exo: "EXO", lev: "LEV", lv: "LEV", le: "LEV", num: "NUM", nm: "NUM", nu: "NUM",
  deut: "DEU", dt: "DEU", deu: "DEU", josh: "JOS", jos: "JOS", judg: "JDG", jdg: "JDG", jg: "JDG", rth: "RUT", ru: "RUT", rut: "RUT",
  "1sam": "1SA", "1sm": "1SA", "1sa": "1SA", "2sam": "2SA", "2sm": "2SA", "2sa": "2SA", "1kgs": "1KI", "1ki": "1KI", "1kings": "1KI",
  "2kgs": "2KI", "2ki": "2KI", "1chr": "1CH", "1ch": "1CH", "1chron": "1CH", "2chr": "2CH", "2ch": "2CH", "2chron": "2CH",
  ezr: "EZR", neh: "NEH", ne: "NEH", esth: "EST", est: "EST", jb: "JOB", ps: "PSA", psa: "PSA", psalm: "PSA", pss: "PSA", psalms: "PSA",
  prov: "PRO", prv: "PRO", pr: "PRO", pro: "PRO", eccl: "ECC", ecc: "ECC", eccles: "ECC", qoh: "ECC", song: "SNG", sos: "SNG", sng: "SNG",
  songofsolomon: "SNG", songofsongs: "SNG", canticles: "SNG", cant: "SNG", isa: "ISA", is: "ISA", jer: "JER", je: "JER", lam: "LAM", la: "LAM",
  ezek: "EZK", eze: "EZK", ezk: "EZK", dan: "DAN", dn: "DAN", da: "DAN", hos: "HOS", ho: "HOS", jl: "JOL", jol: "JOL", am: "AMO", amo: "AMO",
  obad: "OBA", ob: "OBA", oba: "OBA", jon: "JON", jnh: "JON", mic: "MIC", mi: "MIC", nah: "NAM", nam: "NAM", na: "NAM", hab: "HAB",
  zeph: "ZEP", zep: "ZEP", hag: "HAG", zech: "ZEC", zec: "ZEC", mal: "MAL", matt: "MAT", mt: "MAT", mat: "MAT", mk: "MRK", mrk: "MRK",
  mar: "MRK", lk: "LUK", luk: "LUK", jn: "JHN", jhn: "JHN", ac: "ACT", act: "ACT", rom: "ROM", rm: "ROM", ro: "ROM",
  "1cor": "1CO", "1co": "1CO", "2cor": "2CO", "2co": "2CO", gal: "GAL", ga: "GAL", eph: "EPH", phil: "PHP", php: "PHP", col: "COL",
  "1thess": "1TH", "1th": "1TH", "2thess": "2TH", "2th": "2TH", "1tim": "1TI", "1ti": "1TI", "2tim": "2TI", "2ti": "2TI",
  tit: "TIT", phlm: "PHM", phm: "PHM", philem: "PHM", heb: "HEB", jas: "JAS", jm: "JAS", "1pet": "1PE", "1pt": "1PE", "1pe": "1PE",
  "2pet": "2PE", "2pt": "2PE", "2pe": "2PE", "1jn": "1JN", "1jo": "1JN", "1john": "1JN", "2jn": "2JN", "2jo": "2JN", "3jn": "3JN", "3jo": "3JN",
  jud: "JUD", jude: "JUD", rev: "REV", rv: "REV", re: "REV", revelations: "REV", apocalypse: "REV",
};

/** Lowercase, numerals for leading ordinals, no spaces or periods. */
function bookKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^(iii|ii|i)\s+/, (_, r: string) => `${r.length}`)
    .replace(/^(first|second|third)\s+/, (_, w: string) => ({ first: "1", second: "2", third: "3" })[w as "first"])
    .replace(/[\s.]/g, "");
}

const LOOKUP = new Map<string, BookCode>([
  ...BOOK_LIST.map((b) => [bookKey(b.name), b.code] as const),
  ...BOOK_LIST.map((b) => [b.code.toLowerCase(), b.code] as const),
  ...Object.entries(ALIASES),
]);

export function findBookCode(name: string): BookCode | null {
  return LOOKUP.get(bookKey(name)) ?? null;
}

const HEAD = /^((?:[1-3]|iii|ii|i|first|second|third)?\s*[a-z][a-z .]*?)\.?\s*(\d[\d:,\s-]*)?$/i;

function check(p: Passage): string | null {
  const book = bookByCode(p.book)!;
  const chapters = book.verses.length;
  if (p.sc < 1 || p.sc > chapters || p.ec < 1 || p.ec > chapters) {
    return `${book.name} has ${chapters} chapter${chapters === 1 ? "" : "s"}.`;
  }
  if (p.ec < p.sc || (p.ec === p.sc && p.sv !== null && p.ev !== null && p.ev < p.sv)) return "The passage ends before it starts.";
  if (p.sv !== null && (p.sv < 1 || p.sv > lastVerse(p.book, p.sc))) return `${book.name} ${p.sc} has ${lastVerse(p.book, p.sc)} verses.`;
  if (p.ev !== null && (p.ev < 1 || p.ev > lastVerse(p.book, p.ec))) return `${book.name} ${p.ec} has ${lastVerse(p.book, p.ec)} verses.`;
  if (p.ec - p.sc > 40) return "One passage can span at most 40 chapters.";
  return null;
}

/**
 * Parses one or more passages separated by semicolons (or, within a book,
 * commas). Every passage is returned separately, in order, so several
 * passages from the same book never overwrite each other.
 */
export function parsePassages(input: string): ParseResult {
  const raw = input.replace(/[–—‒−]/g, "-").replace(/\s+/g, " ").trim();
  if (!raw) return { ok: false, error: "Enter a passage." };
  if (raw.length > 300) return { ok: false, error: "That's too long for one day's passages." };
  const passages: Passage[] = [];
  for (const group of raw.split(";").map((g) => g.trim()).filter(Boolean)) {
    const m = HEAD.exec(group);
    if (!m) return { ok: false, error: `“${group}” isn't a reference we can read (for example “John 3:16–21”).` };
    const book = findBookCode(m[1]);
    if (!book) return { ok: false, error: `“${m[1].trim()}” isn't a book name we recognize. Use the full name or a standard abbreviation.` };
    const single = chapterCount(book) === 1;
    const rest = (m[2] ?? "").replace(/\s+/g, "");
    if (!rest) {
      const n = chapterCount(book);
      if (n > 40) return { ok: false, error: `Choose chapters of ${bookByCode(book)!.name} (a whole book of ${n} chapters is too long for one passage).` };
      passages.push({ book, sc: 1, sv: null, ec: n, ev: null });
      continue;
    }
    // Context for comma continuations: the chapter of the previous segment,
    // and whether it named verses.
    let chapter: number | null = null;
    let versesMode = false;
    for (const seg of rest.split(",")) {
      if (!seg) return { ok: false, error: `“${group}” has an empty part.` };
      let p: Passage | null = null;
      let mm: RegExpExecArray | null;
      if ((mm = /^(\d{1,3}):(\d{1,3})-(\d{1,3}):(\d{1,3})$/.exec(seg))) {
        p = { book, sc: +mm[1], sv: +mm[2], ec: +mm[3], ev: +mm[4] };
      } else if ((mm = /^(\d{1,3}):(\d{1,3})-(\d{1,3})$/.exec(seg))) {
        p = { book, sc: +mm[1], sv: +mm[2], ec: +mm[1], ev: +mm[3] };
      } else if ((mm = /^(\d{1,3}):(\d{1,3})$/.exec(seg))) {
        p = { book, sc: +mm[1], sv: +mm[2], ec: +mm[1], ev: +mm[2] };
      } else if ((mm = /^(\d{1,3})-(\d{1,3}):(\d{1,3})$/.exec(seg))) {
        if (single) return { ok: false, error: `Write verses of ${bookByCode(book)!.name} as “1:3–5”.` };
        p = { book, sc: +mm[1], sv: null, ec: +mm[2], ev: +mm[3] };
      } else if ((mm = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(seg))) {
        const a = +mm[1];
        const b = mm[2] ? +mm[2] : a;
        if (versesMode && chapter !== null) {
          p = { book, sc: chapter, sv: a, ec: chapter, ev: b };
        } else if (single) {
          if (!mm[2] && a === 1) {
            const name = bookByCode(book)!.name;
            return { ok: false, error: `“${name} 1” could mean verse 1 or the whole book. Write “${name} 1:1” or “${name}”.` };
          }
          p = { book, sc: 1, sv: a, ec: 1, ev: b };
        } else {
          p = { book, sc: a, sv: null, ec: b, ev: null };
        }
      } else {
        return { ok: false, error: `“${seg}” in “${group}” isn't a chapter or verse we can read.` };
      }
      const problem = check(p);
      if (problem) return { ok: false, error: `${formatPassage(p, true)}: ${problem}` };
      passages.push(p);
      chapter = p.ec;
      versesMode = p.ev !== null;
    }
  }
  if (passages.length > 20) return { ok: false, error: "A day can have at most 20 passages." };
  return { ok: true, passages };
}

/** "John 3:16–21", "Genesis 1–2", "Psalm 23", "Genesis 1:1–2:3" (same rules as bible.passage_label). */
export function formatPassage(p: Passage, loose = false): string {
  const book = bookByCode(p.book);
  const name = p.book === "PSA" && p.ec === p.sc ? "Psalm" : (book?.name ?? p.book);
  const range = (() => {
    if (p.sv === null && p.ec === p.sc) return `${p.sc}`;
    if (p.sv === null) return p.ev === null ? `${p.sc}–${p.ec}` : `${p.sc}–${p.ec}:${p.ev}`;
    if (p.ec === p.sc && p.ev === p.sv) return `${p.sc}:${p.sv}`;
    if (p.ec === p.sc) return `${p.sc}:${p.sv}–${p.ev}`;
    if (p.ev === null) return `${p.sc}:${p.sv}–${p.ec}`;
    return `${p.sc}:${p.sv}–${p.ec}:${p.ev}`;
  })();
  return loose && !book ? `${p.book} ${range}` : `${name} ${range}`;
}

/** Canonical text for several passages ("Genesis 1–2; Psalm 23"). */
export function formatPassages(list: Passage[]): string {
  return list.map((p) => formatPassage(p)).join("; ");
}

/** Database shape used by the RPCs ({book, sc, sv, ec, ev}). */
export function toDb(p: Passage) {
  return { book: p.book, sc: p.sc, sv: p.sv, ec: p.ec, ev: p.ev };
}
