import { WEEKDAYS, type GatheringTime } from "@/lib/settings/schema";

export type NextGathering = { gathering: GatheringTime; inDays: number };

/** Local weekday index (0 = Sunday) and minutes since midnight in a time zone. */
function localClock(now: Date, tz: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: WEEKDAYS.indexOf(get("weekday").toLowerCase() as (typeof WEEKDAYS)[number]), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * The next weekly gathering from the church's configured times (a gathering
 * that has already started today counts as next week's).
 */
export function nextGathering(times: GatheringTime[], now: Date, tz: string): NextGathering | null {
  if (!times.length) return null;
  const clock = localClock(now, tz);
  let best: { g: GatheringTime; inDays: number; at: number } | null = null;
  for (const g of times) {
    const [h, m] = g.time.split(":").map(Number);
    const minutes = h * 60 + m;
    let inDays = (WEEKDAYS.indexOf(g.day) - clock.day + 7) % 7;
    if (inDays === 0 && minutes <= clock.minutes) inDays = 7;
    const at = inDays * 1440 + minutes;
    if (!best || at < best.at) best = { g, inDays, at };
  }
  return best ? { gathering: best.g, inDays: best.inDays } : null;
}

export function relativeDayLabel(inDays: number, day: GatheringTime["day"]): string {
  if (inDays === 0) return "Today";
  if (inDays === 1) return "Tomorrow";
  return day.charAt(0).toUpperCase() + day.slice(1);
}
