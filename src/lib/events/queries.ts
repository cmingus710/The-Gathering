import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zonedLocalToUtc } from "@/lib/time";
import { addDays } from "./format";
import type { Category, EventOccurrence } from "./types";

/**
 * Reads go through the events_* database functions, which apply membership,
 * audience, and publication rules for the signed-in (or anonymous) caller.
 */
export type QueryResult<T> = { ok: true; data: T } | { ok: false };

export async function listOccurrences(
  supabase: SupabaseClient,
  from: Date,
  to: Date,
  opts: { category?: string | null; limit?: number } = {},
): Promise<QueryResult<EventOccurrence[]>> {
  const { data, error } = await supabase.rpc("events_list", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_category: opts.category || null,
    p_limit: opts.limit ?? 300,
  });
  if (error) return { ok: false };
  return { ok: true, data: (data ?? []) as EventOccurrence[] };
}

export async function getOccurrence(supabase: SupabaseClient, id: string): Promise<QueryResult<EventOccurrence | null>> {
  const { data, error } = await supabase.rpc("events_occurrence", { p_id: id });
  if (error) return { ok: false };
  return { ok: true, data: (data as EventOccurrence | null) ?? null };
}

export async function getCategories(supabase: SupabaseClient): Promise<Category[]> {
  const { data } = await supabase.rpc("events_categories");
  return (data ?? []) as Category[];
}

export async function getMyRegistrations(supabase: SupabaseClient): Promise<QueryResult<EventOccurrence[]>> {
  const { data, error } = await supabase.rpc("events_my_registrations");
  if (error) return { ok: false };
  return { ok: true, data: (data ?? []) as EventOccurrence[] };
}

export async function getMyPrefs(supabase: SupabaseClient): Promise<{ reminders: boolean; feed_created_at: string | null }> {
  const { data } = await supabase.rpc("events_my_prefs");
  return (data as { reminders: boolean; feed_created_at: string | null } | null) ?? { reminders: true, feed_created_at: null };
}

export async function publicFeedEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.rpc("events_public_feed_enabled");
  return data === true;
}

/** UTC bounds of local calendar days [startYmd, endYmd) in a time zone. */
export function localRange(startYmd: string, endYmdExclusive: string, tz: string): { from: Date; to: Date } {
  return { from: zonedLocalToUtc(`${startYmd}T00:00`, tz)!, to: zonedLocalToUtc(`${endYmdExclusive}T00:00`, tz)! };
}

/** The 6-week grid (Sunday first) that contains a month (YYYY-MM). */
export function monthGrid(month: string): { start: string; end: string; days: string[] } {
  const first = `${month}-01`;
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = addDays(first, -dow);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return { start, end: addDays(start, 42), days };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function isMonth(value: string | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2000-01" && value <= "2100-12";
}

/** Group occurrences by the day they fall on in their own time zone. */
export function byLocalDay(items: EventOccurrence[]): Map<string, EventOccurrence[]> {
  const out = new Map<string, EventOccurrence[]>();
  for (const o of items) {
    const span = o.all_day ? Math.max(1, o.day_count ?? 1) : 1;
    for (let i = 0; i < span; i++) {
      const day = addDays(o.local_date, i);
      out.set(day, [...(out.get(day) ?? []), o]);
    }
  }
  return out;
}
