import { buildPodcastFeed, type PublicFeedData } from "@/lib/media/podcast-feed";
import { getAnonClient } from "@/lib/media/server";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * The church's optional public podcast feed. Built from visitor-level data
 * only (media_public_feed), so it can be cached publicly for a few minutes.
 * Turning the feed off, unpublishing, or narrowing an episode removes it
 * within that time; podcast apps that already downloaded an episode keep it.
 */
export async function GET() {
  const anon = getAnonClient();
  if (!anon) return new Response("Not found", { status: 404 });
  const { data, error } = await anon.rpc("media_public_feed");
  if (error || !data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  return new Response(buildPodcastFeed(data as PublicFeedData, getSiteUrl()), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
