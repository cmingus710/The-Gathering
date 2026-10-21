import { addDays } from "./format";

/**
 * Soft warnings for the event form's repeat settings: values that save
 * fine but probably aren't what the coordinator meant. Pure so the rules
 * are testable; the database's generator (events.sync_occurrences) is the
 * source of truth for which dates exist.
 */

export type ScheduleInput = {
  recurrence: string;
  interval: string;
  startDate: string;
  weekdays: number[];
};

/** Intervals at or above these are unusual enough to double-check. */
const LARGE_INTERVAL: Record<string, number> = { daily: 4, weekly: 4, monthly: 7 };
const UNIT: Record<string, [string, string]> = { daily: ["day", "days"], weekly: ["week", "weeks"], monthly: ["month", "months"] };

const longDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });
const at = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const dow = (ymd: string) => at(ymd).getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000);

/**
 * The first date a weekly series produces, matching the generator: weeks
 * count from the Sunday of the first date's week, and only every
 * interval-th week is used.
 */
export function firstWeeklyDate(startDate: string, interval: number, weekdays: number[]): string | null {
  if (!weekdays.length || interval < 1) return null;
  const week0 = addDays(startDate, -dow(startDate));
  for (let i = 0; i <= 7 * interval + 7; i++) {
    const day = addDays(startDate, i);
    if (weekdays.includes(dow(day)) && Math.floor(daysBetween(week0, day) / 7) % interval === 0) return day;
  }
  return null;
}

export function scheduleHints(v: ScheduleInput): string[] {
  const hints: string[] = [];
  if (v.recurrence === "none") return hints;
  const interval = /^\d{1,2}$/.test(v.interval) ? Number(v.interval) : NaN;
  const unit = UNIT[v.recurrence];

  if (unit && interval >= LARGE_INTERVAL[v.recurrence]) {
    hints.push(`This repeats only once every ${interval} ${unit[1]}. For an event every ${unit[0]}, enter 1.`);
  }

  if (v.recurrence === "weekly" && /^\d{4}-\d{2}-\d{2}$/.test(v.startDate) && v.weekdays.length && !v.weekdays.includes(dow(v.startDate))) {
    const first = firstWeeklyDate(v.startDate, interval >= 1 ? interval : 1, v.weekdays);
    // The nearest chosen weekday before the first date, which is usually what was meant.
    const earlier = Array.from({ length: 6 }, (_, i) => addDays(v.startDate, -(i + 1))).find((d) => v.weekdays.includes(dow(d)));
    let hint = `The first date is a ${weekdayName.format(at(v.startDate))}, which isn't one of the chosen days`;
    hint += first ? `, so the event first happens on ${longDay.format(at(first))}.` : ".";
    if (earlier) hint += ` To start on ${longDay.format(at(earlier))}, change the first date to that day.`;
    hints.push(hint);
  }
  return hints;
}
