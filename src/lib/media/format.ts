import type { Audience, ItemCard, ItemKind, ItemState } from "./types";

/** Storage paths of card covers, to sign in one request (Storage RLS decides). */
export function coverPaths(items: Array<Pick<ItemCard, "cover">>, prefer: "small" | "large" = "small"): string[] {
  return items.flatMap((i) => (i.cover ? [prefer === "small" ? (i.cover.variant_path ?? i.cover.path) : i.cover.path] : []));
}

/** Member-facing routes for each kind of content. */
export function itemHref(item: Pick<ItemCard, "id" | "kind">): string {
  switch (item.kind) {
    case "devotional":
      return `/devotionals/${item.id}`;
    case "lesson":
      return `/lessons/${item.id}`;
    case "episode":
      return `/podcasts/episodes/${item.id}`;
    case "book":
      return `/reading/books/${item.id}`;
    case "assignment":
      return `/reading/assignments/${item.id}`;
    case "playlist":
      return `/music/${item.id}`;
  }
}

export const KIND_LABEL: Record<ItemKind, string> = {
  devotional: "Devotional",
  lesson: "Sunday lesson",
  episode: "Podcast episode",
  book: "Church book",
  assignment: "Reading assignment",
  playlist: "Playlist",
};

export const KIND_PLURAL: Record<ItemKind, string> = {
  devotional: "Devotionals",
  lesson: "Sunday lessons",
  episode: "Church podcast episodes",
  book: "Church books",
  assignment: "Reading assignments",
  playlist: "Playlists",
};

export const STATE_LABEL: Record<ItemState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Published",
  expired: "Expired",
  archived: "Archived",
};

export function audienceLabel(audience: Audience, groupName?: string | null): string {
  if (audience === "public") return "Public";
  if (audience === "group") return groupName ? `Group: ${groupName}` : "One group";
  return "Approved members";
}

/** 0:42, 12:03, 1:02:03 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "–:––";
  const t = Math.floor(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "42 min", "1 hr 5 min" (for cards) */
export function durationLabel(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** Formats a calendar date (YYYY-MM-DD) without shifting it across time zones. */
export function formatDay(ymd: string | null | undefined, style: "long" | "short" | "weekday" = "long"): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
      : style === "weekday"
        ? { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }
        : { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

export function formatInstant(iso: string | null | undefined, timeZone: string, withTime = false): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(iso));
}

/** The date an item is "about": the devotional day, lesson Sunday, assignment start, or publish date. */
export function itemDate(item: Pick<ItemCard, "devotional_on" | "delivered_on" | "starts_on" | "publish_at">): string | null {
  return item.devotional_on ?? item.delivered_on ?? item.starts_on ?? item.publish_at?.slice(0, 10) ?? null;
}

export function speakers(item: Pick<ItemCard, "people">, roles: string[] = ["speaker", "author", "host"]): string {
  return item.people
    .filter((p) => roles.includes(p.role))
    .map((p) => p.name)
    .join(", ");
}

/** YYYY-MM-DD for "today" in a time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function shiftDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function monthBounds(ym: string): { from: string; to: string; label: string; prev: string; next: string } {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return { from: fmt(first), to: fmt(last), label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(first), prev, next };
}

export const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const isYm = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
