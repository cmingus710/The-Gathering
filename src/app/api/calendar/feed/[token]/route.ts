import { anonClient, calendarResponse, NOT_FOUND } from "@/lib/events/feeds";
import type { EventOccurrence } from "@/lib/events/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const dynamic = "force-dynamic";

/**
 * A member's private calendar subscription. The token is a bearer secret:
 * only its hash is stored, it is never logged here, and every request
 * rechecks the member's current status and event access. Unknown, revoked,
 * and suspended-member tokens all get the same 404.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/calendar/feed/[token]">) {
  const { token } = await ctx.params;
  const clean = token.replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(clean)) return NOT_FOUND();
  const db = anonClient();
  if (!db) return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  const { data, error } = await db.rpc("events_feed_private", { p_token: clean });
  if (error) {
    console.error("[events] private feed failed", { code: error.code });
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!data) return NOT_FOUND();
  const { settings } = await getChurchSettings();
  return calendarResponse(`${settings.churchName}: my events`, data as EventOccurrence[]);
}
