import { addDays, formatStartShort, formatWhen, localDate, zoneAbbreviation } from "@/lib/events/format";
import type { EventOccurrence } from "@/lib/events/types";

/**
 * The home "Coming up" banner: which event it shows, which image it uses,
 * and the calendar-leaf values. Pure functions so the rules are testable.
 */

/**
 * The next event to feature. events_list has already applied publication,
 * audience, and membership rules for the viewer and sorted by start time;
 * here canceled dates are skipped, and so are timed events already under
 * way. An all-day or multi-day event still counts until its last day ends.
 */
export function nextComingUp(events: EventOccurrence[], now: Date): EventOccurrence | null {
  return (
    events.find((o) => {
      if (o.status === "canceled") return false;
      if (new Date(o.starts_at) > now) return true;
      return o.all_day && new Date(o.ends_at) > now;
    }) ?? null
  );
}

export type BannerSource = "event" | "cover" | "default";
export type BannerCandidate = { source: BannerSource; path: string; alt: string; focusX: number; focusY: number };
export type DefaultBanner = { path: string; alt: string; focus_x: number; focus_y: number } | null;

/**
 * Image candidates in fallback order: the event's homepage banner, its cover
 * image, then the church-wide default. The caller uses the first one it can
 * sign (signing goes through Storage RLS), and a branded background when
 * none is left.
 */
export function bannerCandidates(o: Pick<EventOccurrence, "home_banner" | "cover_path" | "cover_alt">, fallback: DefaultBanner): BannerCandidate[] {
  const out: BannerCandidate[] = [];
  if (o.home_banner?.path) {
    out.push({ source: "event", path: o.home_banner.path, alt: o.home_banner.alt ?? "", focusX: clampFocus(o.home_banner.focus_x), focusY: clampFocus(o.home_banner.focus_y) });
  }
  if (o.cover_path) out.push({ source: "cover", path: o.cover_path, alt: o.cover_alt ?? "", focusX: 50, focusY: 50 });
  if (fallback?.path) out.push({ source: "default", path: fallback.path, alt: fallback.alt ?? "", focusX: clampFocus(fallback.focus_x), focusY: clampFocus(fallback.focus_y) });
  return out;
}

export function pickBanner(candidates: BannerCandidate[], signed: ReadonlyMap<string, string>): (BannerCandidate & { url: string }) | null {
  for (const c of candidates) {
    const url = signed.get(c.path);
    if (url) return { ...c, url };
  }
  return null;
}

function clampFocus(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 50;
}

const leafMonth = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" });
const leafWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const shortDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export type ComingUpDate = {
  month: string;
  day: number;
  weekday: string;
  /** "10:00 AM CDT", "All day", or "All day · through Sun, Nov 8". */
  time: string;
  /** The event's local date (YYYY-MM-DD) for the <time> element. */
  dateTime: string;
  /** Full wording for screen readers. */
  spoken: string;
};

/**
 * Calendar-leaf values, always in the event's own time zone: local_date is
 * computed by the database in that zone (including individually moved
 * dates), so the leaf never shifts with the viewer's device or the server.
 */
export function comingUpDate(o: EventOccurrence, now: Date): ComingUpDate {
  const d = new Date(`${o.local_date}T12:00:00Z`);
  let time: string;
  if (o.all_day) {
    const days = Math.max(1, o.day_count ?? 1);
    const last = addDays(o.local_date, days - 1);
    const under = new Date(o.starts_at) <= now;
    if (days > 1) time = `${under ? "Happening now" : "All day"} · through ${shortDay.format(new Date(`${last}T12:00:00Z`))}`;
    else time = under ? "Today · All day" : "All day";
  } else {
    time = `${formatStartShort(o)} ${zoneAbbreviation(o.starts_at, o.timezone)}`;
    // Overnight retreats get their last day; a late evening that runs past midnight doesn't.
    const endDay = localDate(o.ends_at, o.timezone);
    const long = new Date(o.ends_at).getTime() - new Date(o.starts_at).getTime() > 6 * 3_600_000;
    if (long && endDay !== o.local_date) time += ` · through ${shortDay.format(new Date(`${endDay}T12:00:00Z`))}`;
  }
  return {
    month: leafMonth.format(d).toUpperCase(),
    day: d.getUTCDate(),
    weekday: leafWeekday.format(d).toUpperCase(),
    time,
    dateTime: o.local_date,
    spoken: formatWhen(o),
  };
}
