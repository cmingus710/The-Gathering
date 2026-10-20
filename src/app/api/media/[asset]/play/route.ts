import { PLAYBACK_URL_TTL, signPath } from "@/lib/media/storage";
import { allowPublic, callerClient, notFound, redirectTo, tooMany, validId } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

/**
 * Church-hosted audio and video. Rechecks access on every request (also
 * the browser's range requests) and redirects to a 30-minute signed link,
 * so revoked access stops new requests at once. Never cached.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[asset]/play">) {
  const { asset } = await ctx.params;
  if (!validId(asset)) return notFound();
  const caller = await callerClient();
  if (!caller) return notFound();
  if (!caller.signedIn && !(await allowPublic(request, "play", 240, 600))) return tooMany();
  const { data, error } = await caller.supabase.rpc("media_file", { p_asset: asset });
  const file = data as { path: string; kind: string } | null;
  if (error || !file || (file.kind !== "audio" && file.kind !== "video")) return notFound();
  const url = await signPath(caller.supabase, file.path, "media", PLAYBACK_URL_TTL);
  return url ? redirectTo(url) : notFound();
}
