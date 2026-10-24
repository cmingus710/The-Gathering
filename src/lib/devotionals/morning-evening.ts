/**
 * Charles Spurgeon's "Morning & Evening": the pinned source, its provenance,
 * and the normalizer that turns the source file into readings.
 *
 * Self-contained on purpose (no imports, only erasable TypeScript), so the
 * same code runs in the app's import action, in the unit tests, and in the
 * operator's dry run (`node scripts/morning-evening-dry-run.mjs`).
 *
 * Every change the normalizer makes to the text is one of the verified
 * corrections listed in FIXES and is counted in the report; anything it is
 * not sure about is reported as a warning and left exactly as the source has
 * it. See docs/morning-evening.md.
 */

export const MORNING_EVENING = {
  key: "morning-evening",
  title: "Morning & Evening",
  subtitle: "Daily readings by Charles Spurgeon",
  author: "Charles Spurgeon",
  description:
    "Charles Haddon Spurgeon's daily devotional, first published in 1865 (Morning by Morning) and 1868 (Evening by Evening): a short reading for every morning and every evening of the year, each on one verse of Scripture.",
  /** Where the text itself comes from, and its rights basis. */
  text: {
    rights: "public_domain" as const,
    url: "https://www.ccel.org/s/spurgeon/morn_eve/morn_eve.html",
    statement:
      "Spurgeon's original text (1865–1868) is in the public domain. The Christian Classics Ethereal Library (CCEL) publishes it marked as public domain.",
    upstream: "https://github.com/russianryebread/morning-and-evening",
    upstreamNote: "The dataset's author credits russianryebread/morning-and-evening, whose README says its HTML was taken from spurgeon.org.",
  },
  /** The data file and the software license it is distributed under. */
  source: {
    repository: "https://github.com/dwahrens/morning-and-evening",
    commit: "e05b8e89d67e01808a3384794416aeeca016d65e",
    path: "data/m_e.json",
    /** Git blob of data/m_e.json at that commit (unchanged since bd60a0f7, 2021-06-25). */
    blob: "b85d23704e8d180b2d977937648500c1ec70473b",
    sha256: "b4fb4f1561ad48617ba9ff9f6a9b02d55f2ede1a4ebaa23e93825a0741c0cf96",
    rawUrl: "https://raw.githubusercontent.com/dwahrens/morning-and-evening/e05b8e89d67e01808a3384794416aeeca016d65e/data/m_e.json",
    license: "Apache-2.0",
    licenseNotice:
      "Data file from dwahrens/morning-and-evening (Apache License 2.0; a copy is kept beside the file in data/devotionals/morning-and-evening/LICENSE). The license covers the repository; the devotional text itself is public domain.",
  },
  /** Where the pinned copy lives in this repository. */
  localPath: "data/devotionals/morning-and-evening/m_e.json",
};

export type Slot = "morning" | "evening";

export type Reading = {
  /** Stable identifier from the source: "01-01-morning". Never changes between imports. */
  source_key: string;
  month: number;
  day: number;
  slot: Slot;
  /** The key verse as Spurgeon quoted it, with its quotation marks. */
  key_verse: string;
  /** "Joshua 5:12" */
  scripture_ref: string;
  /** Paragraphs separated by a blank line; lines of a hymn or poem separated by one line break. */
  body: string;
};

export type Issue = { key: string | null; index: number; code: string; message: string };

export type ImportReport = {
  source: { repository: string; commit: string; path: string; sha256: string | null; sha256_matches: boolean | null };
  records: number;
  readings: number;
  by_slot: Record<Slot, number>;
  /** Days per month that have both readings. */
  days_complete: number;
  expected: number;
  missing: string[];
  duplicates: string[];
  malformed: Issue[];
  feb29: Record<Slot, boolean>;
  /** Verified corrections made, with how many readings each touched. */
  fixes: Array<{ code: string; description: string; readings: number; occurrences: number; examples: string[] }>;
  /** Left unchanged; listed for an editor's review. */
  warnings: Array<{ code: string; description: string; readings: string[] }>;
  ok: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Days in each month in a leap year: the collection repeats every year and includes February 29. */
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const FIXES: Record<string, string> = {
  heading_removed:
    "Removed the first two lines of the body (\"January 1st — Morning Reading\" and the key verse). They repeat the page heading and the key verse, which are shown separately. Each removed heading was checked against the record's month, day, and time.",
  windows_1252:
    "Replaced C1 control characters left by a Windows-1252 decoding error with the characters they stand for: U+0097 → em dash (—), U+0093/U+0094 → \", U+0091/U+0092 → ', U+0096 → hyphen between letters (\"self-forgetting\", \"well-known\"), else en dash.",
  mojibake:
    "Repaired curly quotation marks that had been decoded twice (\"â\\u0080\\u009c\" / \"â\\u0080\\u009d\"); where one sat directly inside a straight quotation mark it was a duplicate and was removed.",
  soft_wraps: "Joined lines the source wrapped in the middle of a paragraph (a line break followed by four spaces) with a single space.",
  verse_lines: "Kept hymn and poem lines (a line break followed by five or more spaces) on their own lines, without the indentation.",
  whitespace: "Normalized line endings, removed the indentation at the start of lines and spaces at the end, and removed a no-break space used as indentation.",
  key_verse_split: "Split the key verse into the quotation and its reference (\"Joshua 5:12\"), joining any line break inside it with a space.",
  capitalized_start:
    "Capitalized the first letter of a reading. The upstream README warns that its conversion left the first letter of each day lowercase.",
  html_removed: "Removed HTML tags and decoded HTML character references.",
};

const WARNINGS: Record<string, string> = {
  space_before_punctuation: "A space before ? ! ; or : (for example \"now ?\"). Possibly a conversion artifact, but not verified against a printed edition, so left as is.",
  hyphen_as_dash: "A hyphen used as a dash between words (\"grace\"-not). This is how the source renders some dashes; left as is.",
  continues_after_verse: "A paragraph starts with a lowercase letter because the sentence continues after a quoted hymn. This is correct; listed for information.",
  heading_in_body: "The words \"Morning Reading\" or \"Evening Reading\" appear again in the body.",
};

const pad = (n: number) => String(n).padStart(2, "0");
export const readingKey = (month: number, day: number, slot: Slot) => `${pad(month)}-${pad(day)}-${slot}`;

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: "…" };

type Counter = Map<string, { readings: Set<string>; occurrences: number }>;

function count(c: Counter, code: string, key: string, n = 1) {
  if (n <= 0) return;
  const entry = c.get(code) ?? { readings: new Set<string>(), occurrences: 0 };
  entry.readings.add(key);
  entry.occurrences += n;
  c.set(code, entry);
}

/** Replaces matches and returns how many there were. */
function replaceCounting(text: string, re: RegExp, by: string | ((m: string, ...rest: string[]) => string)): [string, number] {
  let n = 0;
  const out = text.replace(re, (...args) => {
    n++;
    return typeof by === "string" ? by : by(...(args as [string, ...string[]]));
  });
  return [out, n];
}

/** Character fixes shared by the body and the key verse. */
function repairCharacters(text: string, key: string, fixes: Counter): string {
  let t = text;
  let n: number;
  // Double-decoded curly quotes directly inside a straight quote are duplicates.
  [t, n] = replaceCounting(t, /"â\u0080[\u009c\u009d]|â\u0080[\u009c\u009d]"/g, '"');
  count(fixes, "mojibake", key, n);
  [t, n] = replaceCounting(t, /â\u0080[\u009c\u009d]/g, '"');
  count(fixes, "mojibake", key, n);
  [t, n] = replaceCounting(t, /â\u0080[\u0098\u0099]/g, "'");
  count(fixes, "mojibake", key, n);
  [t, n] = replaceCounting(t, /â\u0080\u0094/g, "—");
  count(fixes, "mojibake", key, n);
  [t, n] = replaceCounting(t, /(\p{L})\u0096(?=\p{L})/gu, (_m, a: string) => `${a}-`);
  count(fixes, "windows_1252", key, n);
  const map: Record<string, string> = { "\u0091": "'", "\u0092": "'", "\u0093": '"', "\u0094": '"', "\u0096": "–", "\u0097": "—" };
  [t, n] = replaceCounting(t, /[\u0091\u0092\u0093\u0094\u0096\u0097]/g, (m) => map[m]);
  count(fixes, "windows_1252", key, n);
  // HTML (none in the pinned file; kept so a different file can't smuggle markup in).
  [t, n] = replaceCounting(t, /<[^>]*>/g, "");
  count(fixes, "html_removed", key, n);
  [t, n] = replaceCounting(t, /&(#\d{1,6}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, name: string) => {
    if (name[0] === "#") {
      const cp = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      // Windows-1252 numbers (&#151;) mean what that code page says.
      const fixed = cp >= 0x80 && cp <= 0x9f ? (map[String.fromCharCode(cp)] ?? "") : cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      return fixed;
    }
    return ENTITIES[name.toLowerCase()] ?? m;
  });
  count(fixes, "html_removed", key, n);
  return t;
}

/** The body's paragraphs and verse lines from the source layout (after the heading lines are removed). */
function layoutBody(raw: string, key: string, fixes: Counter): string {
  const text = raw.replace(/\r\n?/g, "\n");
  const paragraphs: string[] = [];
  for (const block of text.split(/\n[ \t\u00a0]*\n/)) {
    if (!block.trim()) continue;
    const [p, n] = replaceCounting(block.replace(/^\n+|\n+$/g, ""), /[ \t]*\n {4}(?=[^ \t\n])/g, " ");
    count(fixes, "soft_wraps", key, n);
    const lines = p.split("\n");
    if (lines.length > 1) count(fixes, "verse_lines", key, lines.length - 1);
    const cleaned = lines.map((l) => {
      const c = l.replace(/^[ \t\u00a0]+|[ \t\u00a0]+$/g, "");
      if (c !== l) count(fixes, "whitespace", key);
      return c;
    });
    paragraphs.push(cleaned.filter((l) => l.length > 0).join("\n"));
  }
  return paragraphs.filter(Boolean).join("\n\n");
}

// Matched after whitespace (line breaks included) is collapsed to single spaces.
const KEY_VERSE = /^(.+?)\s*—[\s\u2009]*(\S.*)$/u;

/**
 * Validates and normalizes the source file. Never throws on bad records:
 * they're excluded and reported, and `report.ok` is false, so the import
 * refuses to run until the file is fixed.
 */
export function normalizeMorningEvening(input: unknown, opts: { sha256?: string | null } = {}): { readings: Reading[]; report: ImportReport } {
  const fixes: Counter = new Map();
  const warnings: Counter = new Map();
  const malformed: Issue[] = [];
  const readings: Reading[] = [];
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const records = Array.isArray(input) ? input : [];
  if (!Array.isArray(input)) malformed.push({ key: null, index: -1, code: "not_a_list", message: "The file is not a JSON list of readings." });

  records.forEach((rec: unknown, index: number) => {
    const bad = (code: string, message: string, key: string | null = null) => malformed.push({ key, index, code, message });
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return bad("not_an_object", `Record ${index + 1} is ${rec === null ? "null" : "not an object"}.`);
    const r = rec as Record<string, unknown>;
    const month = r.month;
    const day = r.day;
    const time = r.time;
    if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) return bad("bad_month", `Record ${index + 1} has no valid month.`);
    if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > DAYS[month - 1]) return bad("bad_day", `Record ${index + 1} has no valid day for month ${month}.`);
    if (time !== "am" && time !== "pm") return bad("bad_time", `Record ${index + 1} has a time other than "am" or "pm".`);
    const slot: Slot = time === "am" ? "morning" : "evening";
    const key = readingKey(month, day, slot);
    if (r.date !== `${month}-${day}`) return bad("date_mismatch", `${key}: "date" is ${JSON.stringify(r.date)}, expected "${month}-${day}".`, key);
    if (typeof r.keyverse !== "string" || !r.keyverse.trim()) return bad("no_key_verse", `${key}: no key verse.`, key);
    if (typeof r.body !== "string" || !r.body.trim()) return bad("no_body", `${key}: no text.`, key);
    if (/\ufffd/.test(r.body + r.keyverse)) return bad("replacement_character", `${key}: contains U+FFFD (text lost in an earlier conversion).`, key);
    if (seen.has(key)) {
      duplicates.push(key);
      return bad("duplicate", `${key}: a second record for the same day and time (records ${seen.get(key)! + 1} and ${index + 1}).`, key);
    }
    seen.set(key, index);

    // Key verse: quotation + reference.
    const kvText = repairCharacters(r.keyverse, key, fixes).replace(/\s+/g, " ").trim();
    const kv = KEY_VERSE.exec(kvText);
    if (!kv) return bad("key_verse_format", `${key}: the key verse has no "— Reference" part.`, key);
    count(fixes, "key_verse_split", key);
    const keyVerse = kv[1].trim();
    const ref = kv[2].trim().replace(/\.$/, "");

    // Heading lines.
    const body = r.body.replace(/\r\n?/g, "\n");
    const lines = body.split("\n");
    const heading = `${MONTHS[month - 1]} ${ordinal(day)}\u2009—\u2009${slot === "morning" ? "Morning" : "Evening"} Reading`;
    if (lines[0].trim() !== heading) return bad("heading_mismatch", `${key}: the first line is ${JSON.stringify(lines[0].slice(0, 60))}, expected "${heading}".`, key);
    const kvLine = repairCharacters(lines[1] ?? "", key, new Map()).replace(/\s+/g, " ").trim();
    if (kvLine !== kvText) return bad("key_verse_mismatch", `${key}: the second line of the text doesn't match the key verse.`, key);
    count(fixes, "heading_removed", key);

    let text = layoutBody(repairCharacters(lines.slice(2).join("\n"), key, fixes), key, fixes);
    if (!text) return bad("no_body", `${key}: no text after the heading.`, key);
    const first = /^(["'(]?)(\p{Ll})/u.exec(text);
    if (first) {
      text = first[1] + first[2].toUpperCase() + text.slice(first[0].length);
      count(fixes, "capitalized_start", key);
    }

    // Reported only.
    const flat = text.replace(/\n/g, " ");
    if (/\s[?!;:](\s|$)/.test(flat)) count(warnings, "space_before_punctuation", key);
    if (/"-\p{L}|\p{L}-"|\p{L}-(\s|$)/u.test(flat)) count(warnings, "hyphen_as_dash", key);
    if (/\n\n\p{Ll}/u.test(text)) count(warnings, "continues_after_verse", key);
    if (/(Morning|Evening) Reading/.test(text)) count(warnings, "heading_in_body", key);

    readings.push({ source_key: key, month, day, slot, key_verse: keyVerse, scripture_ref: ref, body: text });
  });

  readings.sort((a, b) => a.source_key.localeCompare(b.source_key));
  // Coverage counts only readings that passed every check.
  const valid = new Set(readings.map((r) => r.source_key));
  const missing: string[] = [];
  let daysComplete = 0;
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= DAYS[m - 1]; d++) {
      const both = (["morning", "evening"] as const).filter((s) => valid.has(readingKey(m, d, s)));
      for (const s of ["morning", "evening"] as const) if (!valid.has(readingKey(m, d, s))) missing.push(readingKey(m, d, s));
      if (both.length === 2) daysComplete++;
    }
  }
  const sha = opts.sha256 ?? null;
  const report: ImportReport = {
    source: {
      repository: MORNING_EVENING.source.repository,
      commit: MORNING_EVENING.source.commit,
      path: MORNING_EVENING.source.path,
      sha256: sha,
      sha256_matches: sha === null ? null : sha === MORNING_EVENING.source.sha256,
    },
    records: records.length,
    readings: readings.length,
    by_slot: { morning: readings.filter((r) => r.slot === "morning").length, evening: readings.filter((r) => r.slot === "evening").length },
    days_complete: daysComplete,
    expected: DAYS.reduce((a, b) => a + b, 0) * 2,
    missing,
    duplicates,
    malformed,
    feb29: { morning: valid.has("02-29-morning"), evening: valid.has("02-29-evening") },
    fixes: Object.keys(FIXES)
      .filter((code) => fixes.has(code))
      .map((code) => {
        const f = fixes.get(code)!;
        return { code, description: FIXES[code], readings: f.readings.size, occurrences: f.occurrences, examples: [...f.readings].sort().slice(0, 8) };
      }),
    warnings: Object.keys(WARNINGS)
      .filter((code) => warnings.has(code))
      .map((code) => ({ code, description: WARNINGS[code], readings: [...warnings.get(code)!.readings].sort() })),
    ok: false,
  };
  report.ok = malformed.length === 0 && duplicates.length === 0 && missing.length === 0 && report.source.sha256_matches !== false;
  return { readings, report };
}

/** The display label for a reading: "January 1 · Morning". */
export function readingLabel(month: number, day: number, slot: Slot): string {
  return `${MONTHS[month - 1]} ${day} · ${slot === "morning" ? "Morning" : "Evening"}`;
}
