/* eslint-disable @next/next/no-img-element -- short-lived signed URLs or the publisher's own artwork, never through the image optimizer */
import { ExternalLink, Headphones } from "lucide-react";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";
import { safeHttpsUrl } from "@/lib/media/embeds";
import { durationLabel, formatInstant } from "@/lib/media/format";
import type { EpisodeEntry, ExternalEpisode, Show } from "@/lib/media/types";
import { ItemCard } from "./item-card";

/** Storage paths of church show artwork, to sign in one request. */
export function showArtPaths(shows: Array<Pick<Show, "artwork">>): string[] {
  return shows.flatMap((s) => (s.artwork ? [s.artwork.variant_path ?? s.artwork.path] : []));
}

/**
 * Show artwork: the church's own file (signed link), or the external
 * publisher's https image (loaded from the publisher without a referrer;
 * never copied to the church's storage).
 */
export function ShowArt({ show, urls, className }: { show: Pick<Show, "artwork" | "artwork_url">; urls: Map<string, string>; className?: string }) {
  const own = show.artwork ? urls.get(show.artwork.variant_path ?? show.artwork.path) : null;
  const external = !own ? safeHttpsUrl(show.artwork_url) : null;
  const src = own ?? external;
  return src ? (
    <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className={cn("shrink-0 rounded-tile object-cover", className)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center rounded-tile bg-surface-muted", className)} aria-hidden="true">
      <TileIcon name="podcasts" className="size-12" />
    </span>
  );
}

export function ShowCard({ show, urls }: { show: Show; urls: Map<string, string> }) {
  return (
    <Link href={`/podcasts/shows/${show.id}`} className="interactive flex gap-3.5 rounded-card border border-border bg-surface p-3 hover:bg-surface-muted/60">
      <ShowArt show={show} urls={urls} className="size-20 sm:size-24" />
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block truncate text-[0.8125rem] font-semibold text-text-secondary">
          {[show.kind === "church" ? "From our church" : show.author || "Podcast", show.episode_count ? `${show.episode_count} episodes` : null].filter(Boolean).join(" · ")}
        </span>
        <span className="mt-0.5 block font-semibold leading-snug text-text line-clamp-2">{show.title}</span>
        {show.description ? <span className="mt-0.5 block text-meta text-text-secondary line-clamp-2">{show.description}</span> : null}
      </span>
    </Link>
  );
}

export function ExternalEpisodeCard({ episode, timeZone }: { episode: ExternalEpisode; timeZone: string }) {
  const art = safeHttpsUrl(episode.artwork_url);
  return (
    <Link href={`/podcasts/external/${episode.id}`} className="interactive flex gap-3.5 rounded-card border border-border bg-surface p-3 hover:bg-surface-muted/60">
      {art ? (
        <img src={art} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-20 shrink-0 rounded-tile object-cover sm:size-24" />
      ) : (
        <span className="flex size-20 shrink-0 items-center justify-center rounded-tile bg-surface-muted sm:size-24" aria-hidden="true">
          <TileIcon name="podcasts" className="size-12" />
        </span>
      )}
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block truncate text-[0.8125rem] font-semibold text-text-secondary">
          {[episode.show_title, episode.published_at ? formatInstant(episode.published_at, timeZone) : null].filter(Boolean).join(" · ")}
        </span>
        <span className="mt-0.5 block font-semibold leading-snug text-text line-clamp-2">{episode.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[0.8125rem] text-text-secondary">
          {episode.audio_url ? (
            <span className="inline-flex items-center gap-1">
              <Headphones className="size-3.5" aria-hidden="true" /> Listen here
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <ExternalLink className="size-3.5" aria-hidden="true" /> Listen with the publisher
            </span>
          )}
          {durationLabel(episode.duration_seconds) ? <span>{durationLabel(episode.duration_seconds)}</span> : null}
        </span>
      </span>
    </Link>
  );
}

export function EpisodeList({ entries, urls, timeZone }: { entries: EpisodeEntry[]; urls: Map<string, string>; timeZone: string }) {
  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <li key={`${e.type}:${e.id}`}>{e.type === "church" ? <ItemCard item={e} urls={urls} /> : <ExternalEpisodeCard episode={e} timeZone={timeZone} />}</li>
      ))}
    </ul>
  );
}

/** Honest note about external shows: the app links to them; it doesn't control them. */
export function ExternalShowNote() {
  return (
    <p className="text-meta text-text-secondary">
      This show is published by someone else. Episodes come from the publisher&apos;s feed or podcast app; the church doesn&apos;t host, edit, or control them, and
      who can find them outside this app is up to the publisher.
    </p>
  );
}
