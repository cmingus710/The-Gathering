import { toCsv } from "@/lib/giving/csv";
import { CsvError, headerKey, parseCsv, type CsvRow } from "./csv";
import { isValidYmd } from "./dates";
import { formatPassage, parsePassages, toDb, type Passage } from "./reference";
import { readXlsxTable, writeXlsx } from "./xlsx";

/**
 * Reading plan import from CSV or Excel (.xlsx). Both become the same table
 * and are checked by the same rules. The plan's schedule decides the key
 * column explicitly: dated plans read `date` (YYYY-MM-DD in a CSV, so 03/04
 * can never be misread; in Excel, a date-formatted cell, converted from its
 * stored date rather than its display), numbered plans read `day`. A value in the other
 * column is an error rather than a guess.
 *
 * Columns: date | day, the day's passages, type (reading, rest, catch_up),
 * heading, questions (separated by " | "), notes. Passages can be in one
 * `passages` column (separated by semicolons) and/or in dedicated columns,
 * one reading per cell: Passage 1, Passage 2… (also Reading 1…, Old
 * Testament, New Testament, Psalm, Proverbs, Gospel). A day's passages are
 * every filled passage cell, in column order.
 *
 * Errors block the import (row-level messages); warnings (gaps in dates or
 * day numbers) are shown in the preview and don't block. Rest days are
 * explicit, so they never show as gaps.
 */
export type PlanMode = "calendar" | "personal";

export type ImportRow = {
  row: number;
  day_date: string | null;
  day_number: number | null;
  kind: "reading" | "rest" | "catch_up";
  heading: string | null;
  notes: string;
  questions: string[];
  passages: ReturnType<typeof toDb>[];
  labels: string[];
};

export type RowIssue = { row: number | null; message: string };

export type ImportResult = { rows: ImportRow[]; errors: RowIssue[]; warnings: RowIssue[] };

export const PLAN_IMPORT_LIMITS = { maxBytes: 1024 * 1024, maxRows: 2000, maxCellChars: 4000, maxColumns: 16 } as const;

/** Header keys (after headerKey) that hold passages. */
export function isPassageColumn(key: string): boolean {
  return /^(passages?|readings?)(_?\d{1,2})?$/.test(key) || PASSAGE_NAMES.has(key);
}
const PASSAGE_NAMES = new Set(["old_testament", "ot", "new_testament", "nt", "psalm", "psalms", "proverb", "proverbs", "gospel", "gospels", "epistle"]);

/** How a passage column is named in messages ("Passage 2"), from the file's own header. */
const columnLabel = (raw: string) => raw.trim() || "passages";

const KINDS: Record<string, ImportRow["kind"]> = { reading: "reading", rest: "rest", catch_up: "catch_up", catchup: "catch_up", "catch-up": "catch_up" };

export function parsePlanCsv(text: string, mode: PlanMode): ImportResult {
  return parsePlanFile(() => parseCsv(text, PLAN_IMPORT_LIMITS), mode);
}

/** The first sheet of an Excel workbook; rows are numbered as in Excel. */
export function parsePlanXlsx(bytes: Uint8Array, mode: PlanMode): ImportResult {
  return parsePlanFile(() => readXlsxTable(bytes, PLAN_IMPORT_LIMITS), mode);
}

function parsePlanFile(read: () => CsvRow[], mode: PlanMode): ImportResult {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  let table;
  try {
    table = read();
  } catch (e) {
    if (e instanceof CsvError) return { rows: [], errors: [{ row: e.line, message: e.message }], warnings };
    throw e;
  }
  if (!table.length) return { rows: [], errors: [{ row: null, message: "The file is empty." }], warnings };
  const header = table[0].cells.map(headerKey);
  const idx = (n: string) => header.indexOf(n);
  const keyCol = mode === "calendar" ? "date" : "day";
  const otherCol = mode === "calendar" ? "day" : "date";
  if (idx(keyCol) < 0) {
    return { rows: [], errors: [{ row: 1, message: `This plan uses ${mode === "calendar" ? "dates" : "numbered days"}, so the file needs a “${keyCol}” column.` }], warnings };
  }
  const passageCols = header.flatMap((h, i) => (isPassageColumn(h) ? [i] : []));
  if (!passageCols.length) {
    return { rows: [], errors: [{ row: 1, message: "The file needs a passages column: “passages”, or one passage per column as “Passage 1”, “Passage 2”…" }], warnings };
  }
  const known = new Set(["date", "day", "type", "heading", "questions", "notes"]);
  const unknown = header.filter((h) => h && !known.has(h) && !isPassageColumn(h));
  if (unknown.length) warnings.push({ row: 1, message: `Ignored column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.` });

  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();
  for (const { line, cells } of table.slice(1)) {
    const get = (n: string) => (idx(n) >= 0 ? (cells[idx(n)] ?? "").trim() : "");
    const rowErrors: string[] = [];
    const key = get(keyCol);
    let day_date: string | null = null;
    let day_number: number | null = null;
    if (get(otherCol)) rowErrors.push(`This plan uses ${mode === "calendar" ? "dates" : "day numbers"}; leave “${otherCol}” empty.`);
    if (mode === "calendar") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) rowErrors.push(`Write the date as YYYY-MM-DD (for example 2027-01-01), not “${key || "empty"}”.`);
      else if (!isValidYmd(key)) rowErrors.push(`${key} isn't a real date${key.endsWith("-02-29") ? " (that year has no February 29)" : ""}.`);
      else day_date = key;
    } else if (!/^\d{1,4}$/.test(key) || +key < 1 || +key > 2000) {
      rowErrors.push(`Day must be a whole number from 1 to 2000, not “${key || "empty"}”.`);
    } else {
      day_number = +key;
    }
    const typeRaw = get("type").toLowerCase();
    const passageCells = passageCols.map((i) => ({ column: columnLabel(table[0].cells[i] ?? ""), text: (cells[i] ?? "").trim() })).filter((c) => c.text);
    const passagesText = passageCells.map((c) => c.text).join("; ");
    let kind: ImportRow["kind"] | undefined = typeRaw ? KINDS[typeRaw] : passagesText ? "reading" : undefined;
    if (typeRaw && !kind) rowErrors.push(`Type must be reading, rest, or catch_up, not “${typeRaw}”.`);
    if (!typeRaw && !passagesText) {
      rowErrors.push("Add passages, or set type to rest for an intentional rest day.");
      kind = undefined;
    }
    let passages: Passage[] = [];
    if (kind === "rest" && passagesText) rowErrors.push("A rest day has no passages.");
    if (passagesText && kind !== "rest") {
      // Each cell on its own, so a problem names its column.
      for (const c of passageCells) {
        const parsed = parsePassages(c.text);
        if (parsed.ok) passages.push(...parsed.passages);
        else rowErrors.push(passageCells.length > 1 ? `${c.column}: ${parsed.error}` : parsed.error);
      }
      if (passages.length > 20) rowErrors.push("A day can have at most 20 passages.");
    }
    if (kind === "reading" && !passagesText) rowErrors.push("A reading day needs passages.");
    const questions = get("questions") ? get("questions").split("|").map((q) => q.trim()).filter(Boolean) : [];
    if (questions.length > 5) rowErrors.push("At most 5 reflection questions per day.");
    if (questions.some((q) => q.length > 500)) rowErrors.push("Each question must be 500 characters or fewer.");
    const heading = get("heading") || null;
    if (heading && heading.length > 160) rowErrors.push("Headings must be 160 characters or fewer.");
    const notes = get("notes");
    const dupKey = day_date ?? (day_number !== null ? String(day_number) : null);
    if (dupKey) {
      const first = seen.get(dupKey);
      if (first) rowErrors.push(`${mode === "calendar" ? dupKey : `Day ${dupKey}`} is also on row ${first}. Each ${mode === "calendar" ? "date" : "day"} can appear once (put several passages in one cell, separated by semicolons).`);
      else seen.set(dupKey, line);
    }
    for (const message of rowErrors) errors.push({ row: line, message });
    if (!rowErrors.length && kind) {
      rows.push({ row: line, day_date, day_number, kind, heading, notes, questions, passages: passages.map(toDb), labels: passages.map((p) => formatPassage(p)) });
    }
  }
  if (!rows.length && !errors.length) errors.push({ row: null, message: "The file has no days." });
  warnings.push(...gapWarnings(rows, mode));
  return { rows, errors, warnings };
}

/** Missing dates or day numbers between the first and last (not errors). */
export function gapWarnings(rows: Pick<ImportRow, "day_date" | "day_number">[], mode: PlanMode): RowIssue[] {
  const out: RowIssue[] = [];
  if (mode === "calendar") {
    const dates = rows.map((r) => r.day_date!).filter(Boolean).sort();
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]) - 1;
      if (gap > 0) out.push({ row: null, message: `No day between ${dates[i - 1]} and ${dates[i]} (${gap} date${gap > 1 ? "s" : ""} missing). Add rest days if that's intended.` });
    }
  } else {
    const nums = rows.map((r) => r.day_number!).filter((n) => n !== null).sort((a, b) => a - b);
    if (nums.length && nums[0] !== 1) out.push({ row: null, message: `The plan starts at day ${nums[0]}, not day 1.` });
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] - nums[i - 1] > 1) out.push({ row: null, message: `Days ${nums[i - 1] + 1}–${nums[i] - 1} are missing. Add rest days if that's intended.` });
    }
  }
  return out.slice(0, 50);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
}

/** A downloadable template with examples of every supported form. */
export function planTemplate(mode: PlanMode): string {
  const { header, rows } = templateRows(mode);
  return toCsv(header, rows);
}

/** The same template as an Excel workbook (dates as real date cells). */
export function planTemplateXlsx(mode: PlanMode): Uint8Array {
  const { header, rows } = templateRows(mode);
  return writeXlsx("Reading plan", header, rows, { ...(mode === "calendar" ? { dateColumn: 0 } : { numberColumn: 0 }), widths: [12, 22, 22, 18, 18, 10, 22, 44, 40] });
}

function templateRows(mode: PlanMode): { header: string[]; rows: string[][] } {
  const key = mode === "calendar" ? "date" : "day";
  const k = (i: number) => (mode === "calendar" ? `2027-01-0${i}` : String(i));
  return {
    header: [key, "Passage 1", "Passage 2", "Passage 3", "Passage 4", "type", "heading", "questions", "notes"],
    rows: [
      [k(1), "Genesis 1–2", "Matthew 1", "Psalm 1", "Proverbs 1:1–6", "", "In the beginning", "What does Genesis 1 show about God? | Which verse stood out to you?", ""],
      [k(2), "Genesis 3", "Matthew 2", "Psalm 2", "", "", "", "", "Leave a passage column empty when there are fewer readings."],
      [k(3), "Genesis 4:1–16; Genesis 4:25–26", "Matthew 3", "", "", "", "", "", "Two passages in one cell: separate them with a semicolon."],
      [k(4), "John 3:16–21", "", "", "", "", "God so loved the world", "", "Read slowly; consider reading it aloud."],
      [k(5), "", "", "", "", "catch_up", "Catch-up day", "", "Finish anything you missed this week."],
      [k(6), "", "", "", "", "rest", "Rest", "", ""],
      [k(7), "Matthew 5:1–12, 43–48", "Psalm 23", "", "", "", "", "", ""],
    ],
  };
}
