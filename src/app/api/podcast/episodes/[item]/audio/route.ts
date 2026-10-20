import { PLAYBACK_URL_TTL, signPath } from "@/lib/media/storage";
import { allowPublic, notFound, redirectTo, tooMany, validId } from "@/lib/media/routes";
import { getAnonClient } from "@/lib/media/server";

export const dynamic = "force-dynamic";

/**
 * Stable enclosure URL for the public podcast feed. Only episodes that are
 * public, live, in the enabled feed, and whose audio is approved for public
 * use with confirmed rights resolve; everything else is "not found".
 */
export async function GET(request: Request, ctx: RouteContext<"/api/podcast/episodes/[item]/audio">) {
  const { item } = await ctx.params;
  if (!validId(item)) return notFound();
  if (!(await allowPublic(request, "feed_audio", 120, 600))) return tooMany();
  const anon = getAnonClient();
  if (!anon) return notFound();
  const { data, error } = await anon.rpc("media_public_episode_audio", { p_item: item });
  const file = data as { path: string } | null;
  if (error || !file) return notFound();
  const url = await signPath(anon, file.path, "media", PLAYBACK_URL_TTL);
  return url ? redirectTo(url) : notFound();
}
