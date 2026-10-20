import type { EventOccurrence } from "./types";

/**
 * Event dates are shown in the event's own time zone, always with the zone
 * abbreviation for timed events, so attendance isn't affected by the
 * viewer's device settings.
 */
type When = Pick<EventOccurrence, "starts_at" | "ends_at" | "timezone" | "all_day" | "local_date" | "day_count">;

const dayFmt = (tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeFmt = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
const zoneFmt = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" });

/** Calendar date (YYYY-MM-DD) as a Date at noon UTC, safe to format in UTC. */
function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

export function addDays(ymd: string, days: number): string {
  const d = dateOnly(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD of an instant in a time zone. */
export function localDate(instant: Date | string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    typeof instant === "string" ? new Date(instant) : instant,
  );
  return parts;
}

/** HH:MM (24h) of an instant in a time zone. */
export function localTime(instant: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    typeof instant === "string" ? new Date(instant) : instant,
  );
}

export function zoneAbbreviation(instant: Date | string, tz: string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return zoneFmt(tz).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? tz;
}

export function formatDayLong(ymd: string): string {
  return dayFmt("UTC").format(dateOnly(ymd));
}

/**
 * "Sunday, November 1, 2026 · 9:00 AM – 10:30 AM CST"
 * "Saturday, November 7, 2026 · All day"
 * "Friday, November 6 – Sunday, November 8, 2026 · All day"
 */
export function formatWhen(o: When): string {
  if (o.all_day) {
    const days = o.day_count ?? 1;
    if (days <= 1) return `${formatDayLong(o.local_date)} · All day`;
    return `${formatDayLong(o.local_date)} – ${formatDayLong(addDays(o.local_date, days - 1))} · All day`;
  }
  const tz = o.timezone;
  const start = new Date(o.starts_at);
  const end = new Date(o.ends_at);
  const sameDay = localDate(start, tz) === localDate(end, tz);
  const zone = zoneAbbreviation(start, tz);
  if (sameDay) return `${dayFmt(tz).format(start)} · ${timeFmt(tz).format(start)} – ${timeFmt(tz).format(end)} ${zone}`;
  return `${dayFmt(tz).format(start)}, ${timeFmt(tz).format(start)} – ${dayFmt(tz).format(end)}, ${timeFmt(tz).format(end)} ${zone}`;
}

/** Short time label for calendar cells and lists: "9:00 AM" or "All day". */
export function formatStartShort(o: When): string {
  return o.all_day ? "All day" : timeFmt(o.timezone).format(new Date(o.starts_at));
}

export function formatDeadline(instant: string, tz: string): string {
  const d = new Date(instant);
  return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d)}, ${timeFmt(tz).format(d)} ${zoneAbbreviation(d, tz)}`;
}

export const REMINDER_CHOICES: Array<{ minutes: number; label: string }> = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 2880, label: "2 days before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 180, label: "3 hours before" },
  { minutes: 60, label: "1 hour before" },
];

export function reminderLabel(minutes: number): string {
  return REMINDER_CHOICES.find((c) => c.minutes === minutes)?.label ?? `${minutes} minutes before`;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const ORDINALS: Record<string, string> = { "1": "first", "2": "second", "3": "third", "4": "fourth", "-1": "last" };
