import { ExternalLink, Rss } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmbedPlayer } from "@/components/media/embed-player";
import { EpisodeList, ExternalShowNote, ShowArt, showArtPaths } from "@/components/media/podcast";
import { BookmarkButton } from "@/components/media/toggles";
import { EmptyState, SectionHeading } from "@/components/ui/card";
import { parseProviderRefString, providerEmbed, safeHttpsUrl } from "@/lib/media/embeds";
import { coverPaths, isUuid } from "@/lib/media/format";
import { signPaths } from "@/lib/media/storage";
import type { EpisodeEntry, ItemCard, Show } from "@/lib/media/types";
import { teachingViewer } from "@/lib/media/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Podcast" };

const PAGE = 20;

export default async function ShowPage({ params, searchParams }: PageProps<"/podcasts/shows/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const page = Math.max(0, Number(sp.page) || 0);
  const [viewer, supabase, { settings }] = await Promise.all([teachingViewer(), requireClient(), getChurchSettings()]);
  const { data, error } = await supabase.rpc("media_show", { p_id: id, p_q: q, p_limit: PAGE, p_offset: page * PAGE });
  if (error || !data) notFound();
  const show = data as Show & { episodes: EpisodeEntry[]; total: number };
  const church = show.episodes.filter((e): e is ItemCard & { type: "church" } => e.type === "church");
  const urls = await signPaths(supabase, [...showArtPaths([show]), ...coverPaths(church)]);
  const providerRef = parseProviderRefString(show.provider_ref);
  const website = safeHttpsUrl(show.website_url);
  const more = show.total > (page + 1) * PAGE;
  const href = (p: number) => ({ query: { ...(q ? { q } : {}), page: p } });

  return (
    <>
      <p className="mb-4">
        <Link href="/podcasts" className="font-semibold text-primary hover:underline">
          All podcasts
        </Link>
      </p>
      <header className="mb-6 flex flex-wrap gap-5">
        <ShowArt show={show} urls={urls} className="size-32 sm:size-40" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-meta font-semibold text-text-secondary">{show.kind === "church" ? "From our church" : show.author || "Podcast"}</p>
          <h1 className="font-display text-display font-semibold text-text">{show.title}</h1>
          {show.description ? <p className="max-w-[65ch] whitespace-pre-line text-text-secondary">{show.description}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {viewer.member ? <BookmarkButton type="show" id={show.id} saved={show.bookmarked} label={show.title} /> : null}
            {website ? (
              <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-strong/60 px-4 text-meta font-semibold hover:bg-surface-muted">
                Website <ExternalLink className="size-4" aria-hidden="true" />
                <span className="sr-only">(opens a new tab)</span>
              </a>
            ) : null}
            {show.kind === "church" && show.public_feed ? (
              <a href="/podcast/feed.xml" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-strong/60 px-4 text-meta font-semibold hover:bg-surface-muted">
                <Rss className="size-4" aria-hidden="true" /> Public RSS feed
              </a>
            ) : null}
          </div>
        </div>
      </header>

      {show.kind === "external" ? (
        <div className="mb-6 space-y-3">
          <ExternalShowNote />
          {providerRef ? <EmbedPlayer title={`${show.title} on ${providerRef.provider === "spotify" ? "Spotify" : "Apple Podcasts"}`} embed={providerEmbed(providerRef)} /> : null}
        </div>
      ) : null}

      <section aria-labelledby="show-episodes">
        <SectionHeading id="show-episodes">Episodes</SectionHeading>
        {show.total > PAGE || q ? (
          <form role="search" aria-label={`Search ${show.title}`} className="mb-4 flex gap-2">
            <label htmlFor="sq" className="sr-only">
              Search episodes
            </label>
            <input id="sq" name="q" defaultValue={q} placeholder="Search episodes" className="min-h-11 min-w-0 flex-1 rounded-control border border-border-strong bg-surface px-3" />
            <button type="submit" className="min-h-11 rounded-full bg-cta px-5 font-semibold text-on-cta hover:bg-cta-hover">
              Search
            </button>
          </form>
        ) : null}
        {show.episodes.length ? (
          <EpisodeList entries={show.episodes} urls={urls} timeZone={settings.timezone} />
        ) : (
          <EmptyState glyph="podcasts" title={q ? "No episodes match" : "No episodes yet"} />
        )}
        {more || page > 0 ? (
          <nav aria-label="Pages" className="mt-4 flex justify-between">
            {page > 0 ? (
              <Link href={href(page - 1)} className="min-h-11 px-2 font-semibold text-primary">
                Newer
              </Link>
            ) : (
              <span />
            )}
            {more ? (
              <Link href={href(page + 1)} className="min-h-11 px-2 font-semibold text-primary">
                Older
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
