import { anonClient, calendarResponse, NOT_FOUND } from "@/lib/events/feeds";
import type { EventOccurrence } from "@/lib/events/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const dynamic = "force-dynamic";

/** The church's public calendar: public events only, when an administrator enables it. */
export async function GET() {
  const db = anonClient();
  if (!db) return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  const { data, error } = await db.rpc("events_feed_public");
  if (error) return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!data) return NOT_FOUND();
  const { settings } = await getChurchSettings();
  return calendarResponse(`${settings.churchName} events`, data as EventOccurrence[]);
}
