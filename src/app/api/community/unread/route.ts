import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

/**
 * Badge counts for the signed-in member (notifications and unread
 * conversations), recomputed by the database with current access rules.
 * Polled as a fallback and after every Realtime signal or reconnect.
 * 401 = signed out (session expired); 403 = no longer an approved member.
 */
export async function GET() {
  const supabase = await createClient();
  if (!supabase) return json({ error: "unavailable" }, 503);
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return json({ error: "signed_out" }, 401);
  const { data: approved } = await supabase.rpc("is_approved_member");
  if (!approved) return json({ error: "not_approved" }, 403);
  const { data, error } = await supabase.rpc("community_unread_counts");
  if (error) return json({ error: "failed" }, 500);
  return json(data);
}
