/**
 * Day grouping and short times for the bell panel, in the member's effective
 * time zone (their notification time zone, else the church's), so "Today"
 * and "Yesterday" turn over at the member's local midnight, including across
 * daylight-saving changes.
 */
export type DayGroup = "today" | "yesterday" | "earlier";

export const DAY_GROUP_LABEL: Record<DayGroup, string> = { today: "Today", yesterday: "Yesterday", earlier: "Earlier" };

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(ms: number, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

function previousDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function dayGroup(iso: string, timeZone: string, now = Date.now()): DayGroup {
  const day = localDate(Date.parse(iso), timeZone);
  const today = localDate(now, timeZone);
  if (day >= today) return "today";
  return day === previousDate(today) ? "yesterday" : "earlier";
}

/** "Just now", "5m ago", "21h ago" within a day; a date after that. */
export function panelTime(iso: string, timeZone: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  const zone = safeZone(timeZone);
  const sameYear = localDate(ms, zone).slice(0, 4) === localDate(now, zone).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", year: sameYear ? undefined : "numeric" }).format(ms);
}

/** Splits a newest-first list into Today / Yesterday / Earlier, keeping order. */
export function groupByDay<T extends { created_at: string }>(items: T[], timeZone: string, now = Date.now()) {
  const groups: Array<{ group: DayGroup; items: T[] }> = [];
  for (const item of items) {
    const group = dayGroup(item.created_at, timeZone, now);
    const last = groups[groups.length - 1];
    if (last?.group === group) last.items.push(item);
    else groups.push({ group, items: [item] });
  }
  return groups;
}
