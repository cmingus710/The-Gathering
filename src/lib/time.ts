/**
 * Time-zone helpers for the church time zone (default America/Chicago).
 * Admins enter local wall-clock times; the database stores UTC instants.
 */
export const DEFAULT_TIMEZONE = "America/Chicago";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function zoneOffset(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Converts a `datetime-local` value ("2026-11-01T09:30") in `tz` to a UTC Date.
 * Returns null for malformed input. Times skipped by a DST jump resolve forward;
 * repeated times resolve to the first occurrence.
 */
export function zonedLocalToUtc(local: string, tz: string): Date | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // Offsets in force on either side of any nearby DST transition.
  const before = zoneOffset(new Date(wall - 12 * 3600_000), tz);
  const after = zoneOffset(new Date(wall + 12 * 3600_000), tz);
  const valid = [wall - before, wall - after].filter((t) => zoneOffset(new Date(t), tz) === wall - t);
  // Ambiguous (repeated) hour → earliest instant; skipped hour → pre-transition
  // offset, which lands just after the jump.
  return new Date(valid.length ? Math.min(...valid) : wall - before);
}

/** Formats a UTC instant as a `datetime-local` value in `tz`. */
export function utcToZonedLocal(instant: Date | string | null | undefined, tz: string): string {
  if (!instant) return "";
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + zoneOffset(date, tz));
  return shifted.toISOString().slice(0, 16);
}

export function formatDateTime(instant: Date | string, tz: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatDate(instant: Date | string, tz: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric", year: "numeric" }).format(date);
}

/** "09:30" → "9:30 AM" without involving any time zone. */
export function formatClockTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

export function timeZoneLabel(tz: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

/** Compact age like "now", "5m", "3h", "2d", or a short date after a week. */
export function formatAge(instant: Date | string, now: Date = new Date(), tz = DEFAULT_TIMEZONE): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(date);
}

/** Upper-case day stamp like "19 OCT 2026" in the church time zone. */
export function formatDayStamp(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric" }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month").toUpperCase()} ${get("year")}`;
}
