import { IMAGE_URL_TTL, signPath } from "@/lib/media/storage";
import { allowPublic, notFound, redirectTo, tooMany, validId } from "@/lib/media/routes";
import { getAnonClient } from "@/lib/media/server";

export const dynamic = "force-dynamic";

/** Artwork of the public podcast feed (only when approved for public use). */
export async function GET(request: Request, ctx: RouteContext<"/api/podcast/artwork/[asset]">) {
  const { asset } = await ctx.params;
  if (!validId(asset)) return notFound();
  if (!(await allowPublic(request, "feed_art", 120, 600))) return tooMany();
  const anon = getAnonClient();
  if (!anon) return notFound();
  const { data } = await anon.rpc("media_public_artwork");
  const art = data as { path: string } | null;
  if (!art || !art.path.startsWith(`assets/${asset}/`)) return notFound();
  const url = await signPath(anon, art.path, "media", IMAGE_URL_TTL);
  return url ? redirectTo(url) : notFound();
}
