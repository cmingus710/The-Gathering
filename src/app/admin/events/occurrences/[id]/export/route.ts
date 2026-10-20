import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getViewer } from "@/lib/auth/viewer";
import { toCsv } from "@/lib/giving/csv";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { name: string; email: string; status: string; position: number | null; queued_at: string; confirmed_at: string | null; canceled_at: string | null; cancel_reason: string | null; source: string };

/** Attendee CSV for one date (events.manage). Audited; cells protected against formula injection. */
export async function GET(_request: Request, ctx: RouteContext<"/admin/events/occurrences/[id]/export">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await getViewer();
  if (viewer.state !== "signed-in" || !viewer.viewer.capabilities.has(CAPABILITIES.eventsManage)) return new Response("Not authorized", { status: 403 });
  const supabase = await createClient();
  if (!supabase) return new Response("Unavailable", { status: 503 });
  const { data, error } = await supabase.rpc("events_admin_export", { p_occurrence: id });
  if (error || !data) return new Response("Not authorized", { status: 403 });
  const csv = toCsv(
    ["name", "email", "status", "waitlist_position", "registered_or_queued_at", "confirmed_at", "canceled_at", "cancel_reason", "added_by"],
    (data as Row[]).map((r) => [r.name, r.email, r.status, r.position ?? "", r.queued_at, r.confirmed_at ?? "", r.canceled_at ?? "", r.cancel_reason ?? "", r.source === "admin" ? "organizer" : "member"]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendees-${id.slice(0, 8)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
