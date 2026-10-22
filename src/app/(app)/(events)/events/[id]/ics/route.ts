import { buildCalendar, ICS_HEADERS, occurrenceToIcs } from "@/lib/events/ics";
import { getOccurrence } from "@/lib/events/queries";
import { getChurchSettings } from "@/lib/settings/queries";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One occurrence as an .ics download (a snapshot). Visibility is decided by
 * the database for the caller, exactly as on the event page.
 */
export async function GET(_request: Request, ctx: RouteContext<"/events/[id]/ics">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  if (!supabase) return new Response("Unavailable", { status: 503 });
  const result = await getOccurrence(supabase, id);
  if (!result.ok) return new Response("Unavailable", { status: 503 });
  if (!result.data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const { settings } = await getChurchSettings();
  const body = buildCalendar({ name: settings.churchName, events: [occurrenceToIcs(result.data, getSiteUrl())] });
  const slug = result.data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";
  return new Response(body, { headers: { ...ICS_HEADERS, "Content-Disposition": `attachment; filename="${slug}.ics"` } });
}
