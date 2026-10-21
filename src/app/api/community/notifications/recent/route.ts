import type { NotificationItem } from "@/lib/community/types";
import { panelFilter, toPreview } from "@/lib/community/notification-preview";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

const PAGE = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PanelData = { items?: NotificationItem[]; has_more?: boolean; timezone?: string; has_read?: boolean };

/**
 * The bell panel's list: one page of the signed-in member's notifications,
 * re-filtered by the database against current access (drops anything the
 * reader can no longer see, and anything they cleared), then reduced to
 * glance-safe previews (see notification-preview.ts). Never cached; reading
 * it changes nothing, so opening the panel doesn't mark anything read.
 *
 * Query: filter=<panel filter key>, before=<time>&before_id=<id> for the next
 * page. 401 = signed out; 403 = no longer an approved member.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  if (!supabase) return json({ error: "unavailable" }, 503);
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return json({ error: "signed_out" }, 401);
  const { data: approved } = await supabase.rpc("is_approved_member");
  if (!approved) return json({ error: "not_approved" }, 403);

  const params = new URL(request.url).searchParams;
  const filter = panelFilter(params.get("filter"));
  const rawBefore = params.get("before");
  const before = rawBefore && !Number.isNaN(Date.parse(rawBefore)) ? rawBefore : null;
  const rawId = params.get("before_id");
  const beforeId = before && rawId && UUID.test(rawId) ? rawId : null;

  const { data, error } = await supabase.rpc("community_notification_panel", {
    p_categories: "categories" in filter ? [...filter.categories] : null,
    p_unread: filter.key === "unread",
    p_before: before,
    p_before_id: beforeId,
    p_limit: PAGE,
  });
  if (error) return json({ error: "failed" }, 500);
  const page = (data as PanelData | null) ?? {};
  return json({
    items: (page.items ?? []).map(toPreview),
    has_more: !!page.has_more,
    timezone: page.timezone ?? "UTC",
    has_read: !!page.has_read,
  });
}
