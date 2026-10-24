import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Not found (P0002) covers a collection that's unpublished, hidden, outside the member's audience, or doesn't exist. */
export const isNotFound = (error: { code?: string } | null) => error?.code === "P0002";

/** The member's own reflection on a reading for a date, or null (owner-only; never anyone else's). */
export async function reflectionFor(supabase: SupabaseClient, readingId: string, date: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("journal_reading_reflection", { p_reading: readingId, p_date: date });
  return error ? null : ((data as string | null) ?? null);
}
