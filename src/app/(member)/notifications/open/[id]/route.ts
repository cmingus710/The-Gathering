import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Click-through for a notification (in-app list, email, or push). Marks it
 * read and goes to the content only if the member can still see it;
 * otherwise to the list with a "no longer available" note. Push and email
 * links point here, so they never carry anything but an id.
 */
export async function GET(request: Request, ctx: RouteContext<"/notifications/open/[id]">) {
  const { id } = await ctx.params;
  const base = new URL(request.url);
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, base.origin), 303);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  };
  if (!/^[0-9a-f-]{36}$/.test(id)) return go("/notifications?gone=1");
  const supabase = await createClient();
  if (!supabase) return go("/notifications");
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return go(`/sign-in?next=${encodeURIComponent(`/notifications/open/${id}`)}`);
  const { data, error } = await supabase.rpc("community_notification_open", { p_id: id });
  if (error) return go("/account-status");
  const url = typeof data === "string" && /^\/[A-Za-z0-9/_-]*$/.test(data) && !data.startsWith("//") ? data : null;
  return go(url ?? "/notifications?gone=1");
}
