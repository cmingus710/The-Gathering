/**
 * Reading plan dates are calendar dates (YYYY-MM-DD), never timestamps, so
 * daylight-saving changes can't move a reading. "Today" is the date in a
 * time zone: the plan's for dated plans, the member's for personal plans
 * (the same rule as bible.enrollment_today in the database).
 */
export function isValidYmd(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, month: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** The calendar date at `now` in an IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(ymd: string, days: number): string {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Day N of a personal plan is read on start + N - 1. */
export function personalDayDate(start: string, dayNumber: number): string {
  return addDays(start, dayNumber - 1);
}

/** The personal plan day scheduled for a date (may be < 1 before the start). */
export function personalDayNumber(start: string, date: string): number {
  return diffDays(start, date) + 1;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "Wednesday, January 6" (the date itself, no time zone shift). */
export function formatYmd(ymd: string, style: "long" | "short" | "full" = "long"): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const opts: Intl.DateTimeFormatOptions =
    style === "full"
      ? { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }
      : style === "long"
        ? { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }
        : { month: "short", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", opts).format(d);
}
