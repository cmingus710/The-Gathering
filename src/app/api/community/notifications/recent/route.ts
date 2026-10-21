import type { NotificationItem } from "@/lib/community/types";
import { toPreview } from "@/lib/community/notification-preview";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

/**
 * The bell panel's list: the signed-in member's most recent notifications,
 * re-filtered by the database against current access (community_notifications
 * drops anything the reader can no longer see), then reduced to glance-safe
 * previews (see notification-preview.ts). Never cached; reading it changes
 * nothing, so opening the panel doesn't mark anything read.
 * 401 = signed out; 403 = no longer an approved member.
 */
export async function GET() {
  const supabase = await createClient();
  if (!supabase) return json({ error: "unavailable" }, 503);
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return json({ error: "signed_out" }, 401);
  const { data: approved } = await supabase.rpc("is_approved_member");
  if (!approved) return json({ error: "not_approved" }, 403);
  const { data, error } = await supabase.rpc("community_notifications", { p_before: null, p_limit: 8 });
  if (error) return json({ error: "failed" }, 500);
  const list = (data as { items?: NotificationItem[]; has_more?: boolean } | null) ?? {};
  return json({ items: (list.items ?? []).map(toPreview), has_more: !!list.has_more });
}
