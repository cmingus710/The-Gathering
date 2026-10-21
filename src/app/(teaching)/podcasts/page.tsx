import type { Metadata } from "next";
import Link from "next/link";
import { ShowCard, showArtPaths } from "@/components/media/podcast";
import { PodcastEpisodeCard, ProviderShowCard } from "@/components/media/podcast-episode-card";
import { VisitorNote } from "@/components/media/visitor-note";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { parseProviderRefString } from "@/lib/media/embeds";
import { coverPaths } from "@/lib/media/format";
import { signPaths } from "@/lib/media/storage";
import type { PodcastEpisode, Show } from "@/lib/media/types";
import { teachingViewer } from "@/lib/media/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Podcasts" };

/** Episodes shown at first, and added by each "Show more". */
const STEP = 10;
/** The most the episode list function returns in one call. */
const MAX = 100;

/**
 * Every episode the viewer may see (church and external shows), newest
 * first, each with its player in the card, so a member can press Play
 * straight from Podcasts. The database applies drafts, schedules, expiry,
 * audiences, and file approval; episode and show pages keep working for
 * shared links, bookmarks, and the full notes. Shows are listed below.
 */
export default async function PodcastsPage({ searchParams }: PageProps<"/podcasts">) {
  const sp = await searchParams;
  const show = Math.min(Math.max(Math.floor(Number(sp.show) || STEP), STEP), MAX);
  const [viewer, supabase, { settings }] = await Promise.all([teachingViewer(), requireClient(), getChurchSettings()]);
  const [episodesRes, showsRes] = await Promise.all([
    supabase.rpc("media_podcast_episodes", { p_limit: show, p_offset: 0 }),
    supabase.rpc("media_shows"),
  ]);
  const { episodes, total } = (episodesRes.data ?? { episodes: [], total: 0 }) as { episodes: PodcastEpisode[]; total: number };
  const shows = ((showsRes.data ?? { shows: [] }) as { shows: Show[] }).shows;
  const byId = new Map(shows.map((s) => [s.id, s]));
  const church = episodes.filter((e) => e.type === "church");
  const urls = await signPaths(supabase, [...showArtPaths(shows), ...coverPaths(church)]);
  const origin = getSiteUrl();
  // External shows added by an Apple Podcasts or Spotify link with no feed
  // episodes: their provider player is the episode list, so they follow
  // the dated episodes (featured first, in the administrators' order).
  const providerShows = shows.filter((s) => s.kind === "external" && !s.episode_count && parseProviderRefString(s.provider_ref));
  const providerIds = new Set(providerShows.map((s) => s.id));
  const cards = [
    ...episodes.map((e) => ({ kind: "episode" as const, key: `${e.type}:${e.id}`, entry: e })),
    ...providerShows.map((s) => ({ kind: "show" as const, key: `show:${s.id}`, show: s })),
  ].slice(0, show);
  const more = total + providerShows.length > show && show < MAX;
  const listed = shows.filter((s) => !providerIds.has(s.id));
  const featured = listed.filter((s) => s.featured);
  const others = listed.filter((s) => !s.featured);

  return (
    <>
      <PageHeader title="Podcasts" description="Listen to episodes from our church and shows we recommend." />
      {!viewer.member ? <div className="mb-6"><VisitorNote next="/podcasts" /></div> : null}
      {episodesRes.error ? <Alert tone="error" title="Episodes couldn't be loaded right now." className="mb-6" /> : null}
      {!episodesRes.error && !cards.length ? (
        <EmptyState glyph="podcasts" title="No episodes yet" className="mx-auto mb-8 max-w-3xl">
          Episodes will appear here after they&apos;re published.
        </EmptyState>
      ) : null}

      {cards.length ? (
        <section aria-label="Episodes" className="mx-auto max-w-3xl space-y-6">
          {cards.map((c, i) =>
            c.kind === "episode" ? (
              <PodcastEpisodeCard key={c.key} entry={c.entry} urls={urls} shows={byId} timeZone={settings.timezone} member={viewer.member} origin={origin} />
            ) : (
              <ProviderShowCard key={c.key} show={c.show} urls={urls} eager={i === 0} member={viewer.member} />
            ),
          )}
        </section>
      ) : null}
      {more ? (
        <p className="mt-6 text-center">
          <Link
            href={{ query: { show: show + STEP } }}
            scroll={false}
            className="inline-flex min-h-11 items-center rounded-full border border-border-strong/60 px-5 font-semibold hover:bg-surface-muted"
          >
            Show more episodes
          </Link>
        </p>
      ) : null}
      {total > MAX && episodes.length >= MAX ? (
        <p className="mt-6 text-center text-meta text-text-secondary">Showing the {MAX} most recent episodes. Open a show below for older ones.</p>
      ) : null}

      {showsRes.error ? <Alert tone="error" title="Shows couldn't be loaded right now." className="mx-auto mt-10 max-w-3xl" /> : null}
      {listed.length ? (
        <section aria-labelledby="pod-shows" className="mx-auto mt-10 max-w-3xl">
          <SectionHeading id="pod-shows">Shows</SectionHeading>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[...featured, ...others].map((s) => (
              <li key={s.id}>
                <ShowCard show={s} urls={urls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
