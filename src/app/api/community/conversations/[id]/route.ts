import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

const UUID = /^[0-9a-f-]{36}$/;

/**
 * One page of a conversation for the signed-in participant (newest first,
 * or older than the before_* cursor). The database returns nothing to
 * anyone else, so this answers 404 for non-participants, 401 when the
 * session has expired, and 403 when the member is no longer approved.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/community/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return json({ error: "not_found" }, 404);
  const url = new URL(request.url);
  const beforeAt = url.searchParams.get("before_at");
  const beforeId = url.searchParams.get("before_id");
  const supabase = await createClient();
  if (!supabase) return json({ error: "unavailable" }, 503);
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return json({ error: "signed_out" }, 401);
  const { data, error } = await supabase.rpc("community_dm_messages", {
    p_conversation: id,
    p_before_at: beforeAt && !Number.isNaN(Date.parse(beforeAt)) ? beforeAt : null,
    p_before_id: beforeId && UUID.test(beforeId) ? beforeId : null,
    p_limit: 40,
  });
  if (error) return json({ error: error.code === "42501" ? "not_approved" : "failed" }, error.code === "42501" ? 403 : 500);
  if (!data) return json({ error: "not_found" }, 404);
  return json(data);
}
