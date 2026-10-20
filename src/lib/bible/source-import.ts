import { isBookCode, type BookCode } from "./books";
import { CsvError, headerKey, parseCsv } from "./csv";
import { findBookCode } from "./reference";

/**
 * Structured scripture files for Admin → Bible sources → Import text. Lines
 * are parsed into staging rows; nothing is published here. A line that
 * can't be read is kept (raw text, truncated) and flagged for review, never
 * repaired or guessed.
 *
 * Supported formats:
 *   csv / tsv  header row with book, chapter, verse, text and optional
 *              heading, paragraph (1/true), poetry (1/true). book is a USFM
 *              code (GEN, 1CO …) or a book name.
 *   vpl        verse per line: "GEN 1:1 In the beginning…" (USFM code,
 *              chapter:verse, text). Lines starting with # are comments.
 */
export type SourceFormat = "csv" | "tsv" | "vpl";

export type StagedRow = {
  line: number;
  ref: string;
  book: BookCode | null;
  chapter: number | null;
  verse: number | null;
  text: string;
  heading: string | null;
  para: boolean;
  poetry: boolean;
  issue: "malformed" | "unknown_book" | null;
};

export const SOURCE_LIMITS = { maxBytes: 50 * 1024 * 1024, maxRows: 60_000, maxCellChars: 4000, maxColumns: 12 } as const;

const truthy = (v: string | undefined) => /^(1|true|yes|y)$/i.test((v ?? "").trim());

function bookFrom(value: string): BookCode | null {
  const v = value.trim();
  if (isBookCode(v.toUpperCase())) return v.toUpperCase() as BookCode;
  return findBookCode(v);
}

function num(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : null;
}

export function parseSourceFile(text: string, format: SourceFormat): StagedRow[] {
  if (format === "vpl") return parseVpl(text);
  const rows = parseCsv(text, { ...SOURCE_LIMITS, delimiter: format === "tsv" ? "\t" : "," });
  if (!rows.length) throw new CsvError("The file is empty.");
  const header = rows[0].cells.map(headerKey);
  const col = (name: string) => header.indexOf(name);
  const [ib, ic, iv, it] = ["book", "chapter", "verse", "text"].map(col);
  if ([ib, ic, iv, it].some((i) => i < 0)) {
    throw new CsvError("The first row must name the columns: book, chapter, verse, text (heading, paragraph, and poetry are optional).", rows[0].line);
  }
  const [ih, ip, iq] = ["heading", "paragraph", "poetry"].map(col);
  return rows.slice(1).map(({ line, cells }) => {
    const rawBook = cells[ib] ?? "";
    const book = bookFrom(rawBook);
    const chapter = num(cells[ic]);
    const verse = num(cells[iv]);
    const textCell = (cells[it] ?? "").trim();
    const issue = !book ? "unknown_book" : chapter === null || verse === null || chapter < 1 || verse < 1 ? "malformed" : null;
    return {
      line,
      ref: `line ${line}`,
      book,
      chapter: issue === "malformed" ? null : chapter,
      verse: issue === "malformed" ? null : verse,
      // Unreadable lines keep what was there, for the reviewer.
      text: issue ? cells.join(" | ").slice(0, 4000) : textCell,
      heading: ih >= 0 ? (cells[ih] ?? "").trim() || null : null,
      para: ip >= 0 && truthy(cells[ip]),
      poetry: iq >= 0 && truthy(cells[iq]),
      issue,
    } satisfies StagedRow;
  });
}

const VPL = /^([1-3]?[A-Z]{2,3}[0-9]?)\s+(\d{1,3}):(\d{1,3})(?:\s+([\s\S]*))?$/;

function parseVpl(text: string): StagedRow[] {
  if (Buffer.byteLength(text, "utf8") > SOURCE_LIMITS.maxBytes) throw new CsvError("The file is larger than 50 MB.");
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.includes("\u0000")) throw new CsvError("This doesn't look like a text file.");
  const out: StagedRow[] = [];
  const lines = body.split(/\r\n|\n|\r/);
  if (lines.length > SOURCE_LIMITS.maxRows) throw new CsvError(`The file has more than ${SOURCE_LIMITS.maxRows} lines.`);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    const m = VPL.exec(t);
    const book = m && isBookCode(m[1]) ? (m[1] as BookCode) : null;
    const issue = !m ? "malformed" : !book ? "unknown_book" : null;
    out.push({
      line,
      ref: `line ${line}`,
      book,
      chapter: m && !issue ? Number(m[2]) : null,
      verse: m && !issue ? Number(m[3]) : null,
      text: (issue ? t : (m?.[4] ?? "").trim()).slice(0, 4000),
      heading: null,
      para: false,
      poetry: false,
      issue,
    });
  });
  return out;
}

/** The format implied by a file name, if supported. */
export function formatFromName(name: string): SourceFormat | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "csv" ? "csv" : ext === "tsv" ? "tsv" : ext === "txt" || ext === "vpl" ? "vpl" : null;
}
