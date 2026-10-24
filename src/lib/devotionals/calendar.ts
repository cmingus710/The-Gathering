import { parsePassages } from "@/lib/bible/reference";
import type { Slot } from "./morning-evening";

/**
 * Calendar rules for a collection that repeats every year (a reading for
 * each month/day and morning/evening, no year). Pure functions on
 * YYYY-MM-DD strings, so nothing shifts across time zones: "today" is
 * computed by the database in the member's time zone and handed in.
 */

export const SLOTS: Slot[] = ["morning", "evening"];
export const SLOT_LABEL: Record<Slot, string> = { morning: "Morning", evening: "Evening" };

/** From this local hour, "Today" opens the evening reading. */
export const EVENING_FROM_HOUR = 17;

export const isSlot = (v: unknown): v is Slot => v === "morning" || v === "evening";

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** A real calendar date (rejects 2027-02-29 and 2026-04-31). */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function monthDay(ymd: string): { year: number; month: number; day: number } {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day };
}

export function defaultSlot(localHour: number): Slot {
  return localHour >= EVENING_FROM_HOUR ? "evening" : "morning";
}

/** Morning → evening of the same day → next morning (across months and years). */
export function nextReading(date: string, slot: Slot): { date: string; slot: Slot } {
  return slot === "morning" ? { date, slot: "evening" } : { date: addDays(date, 1), slot: "morning" };
}

export function previousReading(date: string, slot: Slot): { date: string; slot: Slot } {
  return slot === "evening" ? { date, slot: "morning" } : { date: addDays(date, -1), slot: "evening" };
}

/**
 * February 29 has its own readings. In a year without that date they are
 * offered beside February 28 ("leap-day reading"), never in place of it, and
 * a reflection on one is dated February 28 of that year.
 */
export function leapDayExtra(date: string): boolean {
  const { year, month, day } = monthDay(date);
  return month === 2 && day === 28 && !isLeapYear(year);
}

/** The date a reading (month/day) falls on in a year; February 29 in a common year falls on February 28. */
export function dateInYear(year: number, month: number, day: number): string {
  const d = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Whether a reflection date fits a reading's month/day (see leapDayExtra). */
export function dateFitsReading(date: string, month: number, day: number): boolean {
  if (!isCalendarDate(date)) return false;
  const d = monthDay(date);
  if (d.month === month && d.day === day) return true;
  return month === 2 && day === 29 && leapDayExtra(date);
}

export type Block = { kind: "paragraph"; text: string } | { kind: "lines"; lines: string[] };

/** Paragraphs (blank-line separated); a paragraph with line breaks is a hymn, poem, or list kept line by line. */
export function bodyBlocks(body: string): Block[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.includes("\n") ? { kind: "lines" as const, lines: p.split("\n").map((l) => l.trim()).filter(Boolean) } : { kind: "paragraph" as const, text: p }));
}

/** The first passage of a reference ("Psalm 39:12") for opening the Bible reader, or null when it can't be parsed. */
export function bibleTarget(ref: string | null | undefined): { book: string; chapter: number } | null {
  if (!ref) return null;
  const parsed = parsePassages(ref);
  if (!parsed.ok || !parsed.passages.length) return null;
  return { book: parsed.passages[0].book, chapter: parsed.passages[0].sc };
}
