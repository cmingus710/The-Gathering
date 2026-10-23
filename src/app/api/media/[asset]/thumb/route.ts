import { allowPublic, callerClient, notFound, PRIVATE_HEADERS, tooMany, validId } from "@/lib/media/routes";
import { videoThumbnail } from "@/lib/media/video-provider";

export const dynamic = "force-dynamic";

/**
 * A YouTube/Vimeo video's still, for the shared player's poster: access is
 * rechecked (the same rule as the video itself), then the app server
 * fetches the provider's image, so the member's browser contacts YouTube or
 * Vimeo only when they press Play. 404 when there is none; the player then
 * shows a plain poster.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[asset]/thumb">) {
  const { asset } = await ctx.params;
  if (!validId(asset)) return notFound();
  const caller = await callerClient();
  if (!caller) return notFound();
  if (!caller.signedIn && !(await allowPublic(request, "thumb", 240, 600))) return tooMany();
  const { data, error } = await caller.supabase.rpc("media_video_thumb", { p_asset: asset });
  const v = data as { provider: "youtube" | "vimeo"; provider_ref: string; provider_thumb_url: string | null } | null;
  if (error || !v) return notFound();
  const thumb = await videoThumbnail(v.provider, v.provider_ref, v.provider_thumb_url);
  if (!thumb) return notFound();
  return new Response(new Uint8Array(thumb.body), {
    status: 200,
    headers: { ...PRIVATE_HEADERS, "Content-Type": thumb.type, "X-Content-Type-Options": "nosniff", "Content-Length": String(thumb.body.length) },
  });
}
