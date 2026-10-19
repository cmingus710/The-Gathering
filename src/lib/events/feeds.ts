import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";
import { getSiteUrl } from "@/lib/site-url";
import { buildCalendar, ICS_HEADERS, occurrenceToIcs } from "./ics";
import type { EventOccurrence } from "./types";

/** Anonymous database client: feeds are authorized by their token alone. */
export function anonClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createSupabaseClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function calendarResponse(name: string, items: EventOccurrence[]): Response {
  const siteUrl = getSiteUrl();
  const body = buildCalendar({ name, events: items.map((o) => occurrenceToIcs(o, siteUrl)), refreshMinutes: 60 });
  // Never cached by shared caches; no referrer leaves with the URL.
  return new Response(body, { headers: { ...ICS_HEADERS, "Referrer-Policy": "no-referrer", "Content-Disposition": 'inline; filename="events.ics"' } });
}

export const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
