import { IMAGE_URL_TTL, PLAYBACK_URL_TTL, signPath } from "@/lib/media/storage";
import { callerClient, notFound, redirectTo, validId } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

const VARIANTS = new Set(["thumb", "display", "video"]);

/**
 * One discussion photo or video. Access is rechecked on every request
 * (signed-in member who can read the thread, item visible, or a moderator
 * of it), then the browser is sent to a short-lived signed URL created with
 * the member's own session, so Storage RLS checks it once more. Knowing an
 * id grants nothing. Photos: 5 minutes; video: 30 minutes. Never cached.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/community/attachments/[id]">) {
  const { id } = await ctx.params;
  const variant = new URL(request.url).searchParams.get("variant") ?? "display";
  if (!validId(id) || !VARIANTS.has(variant)) return notFound();
  const caller = await callerClient();
  if (!caller?.signedIn) return notFound();
  const { data, error } = await caller.supabase.rpc("community_attachment_file", { p_id: id, p_variant: variant });
  const file = data as { bucket: "media"; path: string; kind: "image" | "video" } | null;
  if (error || !file?.path) return notFound();
  const url = await signPath(caller.supabase, file.path, file.bucket, file.kind === "video" ? PLAYBACK_URL_TTL : IMAGE_URL_TTL);
  return url ? redirectTo(url) : notFound();
}
