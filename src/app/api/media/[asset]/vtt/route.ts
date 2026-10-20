import { sanitizeVtt } from "@/lib/media/files";
import { downloadObject } from "@/lib/media/storage";
import { PRIVATE_HEADERS, allowPublic, callerClient, notFound, tooMany, validId } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

/**
 * Captions are served from this site (same origin, so <track> works without
 * cross-origin settings) after the same access check as their video.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[asset]/vtt">) {
  const { asset } = await ctx.params;
  if (!validId(asset)) return notFound();
  const caller = await callerClient();
  if (!caller) return notFound();
  if (!caller.signedIn && !(await allowPublic(request, "vtt", 240, 600))) return tooMany();
  const { data, error } = await caller.supabase.rpc("media_file", { p_asset: asset });
  const file = data as { path: string; kind: string } | null;
  if (error || !file || file.kind !== "captions") return notFound();
  const bytes = await downloadObject(caller.supabase, "media", file.path, 2 * 1024 * 1024);
  if (!bytes) return notFound();
  return new Response(sanitizeVtt(bytes.toString("utf8")), {
    headers: { ...PRIVATE_HEADERS, "Content-Type": "text/vtt; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}
