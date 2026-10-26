import { formatYmd } from "./dates";
import type { PlanCard, Progress } from "./types";

/**
 * Wording for reading plans. Encouraging and private: progress is only ever
 * shown to the reader, never compared with anyone, and earlier unread days
 * are an invitation ("waiting for you"), not a debt.
 */
export function scheduleLabel(p: Pick<PlanCard, "mode" | "first_date" | "last_date" | "last_day_number" | "reading_days">): string {
  if (p.mode === "calendar") {
    if (p.first_date && p.last_date) return `${formatYmd(p.first_date, "short")}, ${p.first_date.slice(0, 4)} – ${formatYmd(p.last_date, "short")}, ${p.last_date.slice(0, 4)}`;
    return "Dated plan";
  }
  const days = p.last_day_number ?? 0;
  return `${days} day${days === 1 ? "" : "s"} · start any day`;
}

export function percent(p: Pick<Progress, "completed" | "total">): number {
  return p.total ? Math.round((p.completed / p.total) * 100) : 0;
}

export function progressSentence(p: Progress): string {
  if (p.finished) return `You've read all ${p.total} readings. Well done.`;
  if (!p.completed) return p.started ? `${p.total} readings in this plan. Start whenever you're ready.` : `${p.total} readings in this plan.`;
  return `You've read ${p.completed} of ${p.total} readings.`;
}

export function waitingSentence(p: Progress): string | null {
  if (!p.behind) return null;
  return p.behind === 1 ? "One earlier reading is waiting for you." : `${p.behind} earlier readings are waiting for you.`;
}

export function kindLabel(kind: "reading" | "rest" | "catch_up"): string {
  return kind === "rest" ? "Rest day" : kind === "catch_up" ? "Catch-up day" : "Reading";
}

/** "7:00 AM" from "07:00". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d);
}

/** Highlight colors, in toolbar order (bible.highlight_color; purple and orange since 20261125000100). */
export const HIGHLIGHT_COLORS = [
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "pink", label: "Pink" },
  { value: "purple", label: "Purple" },
  { value: "orange", label: "Orange" },
] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]["value"];
