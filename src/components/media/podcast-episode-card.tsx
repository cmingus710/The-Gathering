/* eslint-disable @next/next/no-img-element -- short-lived signed URLs or the publisher's own artwork, never through the image optimizer */
import { ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { TileIcon } from "@/components/icons/icon";
import { durationLabel, formatInstant, itemHref } from "@/lib/media/format";
import { parseProviderRefString, providerEmbed, safeHttpsUrl } from "@/lib/media/embeds";
import type { PodcastEpisode, Show } from "@/lib/media/types";
import { EmbedPlayer } from "./embed-player";
import { VideoPlayer } from "./video-player";
import { attachmentVideo } from "@/lib/media/videos";
import { EpisodePlayer } from "./episode-player";
import { itemCover } from "./item-card";
import { ShowArt } from "./podcast";
import { ShowMoreText } from "./show-more-text";
import { BookmarkButton } from "./toggles";

const QUIET_LINK = "inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-meta font-semibold text-primary hover:bg-primary-soft";

function Artwork({ src }: { src: string | null }) {
  return src ? (
    <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-20 shrink-0 rounded-tile object-cover sm:size-24" />
  ) : (
    <span className="flex size-20 shrink-0 items-center justify-center rounded-tile bg-surface-muted sm:size-24" aria-hidden="true">
      <TileIcon name="podcasts" className="size-12" />
    </span>
  );
}

/** Why an episode has no player here, with where to listen instead. */
function NoInlinePlayer({ children }: { children: ReactNode }) {
  return <p className="rounded-tile bg-surface-muted px-4 py-3 text-meta text-text-secondary">{children}</p>;
}

/**
 * One episode on the Podcasts page: artwork, show, date and length, title,
 * a short description, and its player right in the card (no detail page
 * needed). The episode page still holds the full notes, transcripts, and
 * files, and its link keeps working for shared links and bookmarks.
 */
export function PodcastEpisodeCard({
  entry,
  urls,
  shows,
  timeZone,
  member,
}: {
  entry: PodcastEpisode;
  urls: Map<string, string>;
  shows: Map<string, Show>;
  timeZone: string;
  member: boolean;
  /** Unused since the shared video player builds embeds in the browser. */
  origin?: string;
}) {
  const headingId = `ep-${entry.type}-${entry.id}`;

  if (entry.type === "church") {
    const show = entry.show ? shows.get(entry.show.id) : undefined;
    const showArt = show?.artwork ? (urls.get(show.artwork.variant_path ?? show.artwork.path) ?? null) : null;
    const art = itemCover(entry, urls) ?? showArt;
    const play = entry.play;
    const duration = play?.duration_seconds ?? entry.media?.duration_seconds ?? null;
    const href = itemHref(entry);
    const meta = [entry.show?.title, entry.publish_at ? formatInstant(entry.publish_at, timeZone) : null, durationLabel(duration)].filter(Boolean);
    return (
      <section aria-labelledby={headingId} className="space-y-4 rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
        <div className="flex gap-4">
          <Artwork src={art} />
          <div className="min-w-0 flex-1 space-y-1 py-0.5">
            {meta.length ? <p className="text-[0.8125rem] font-semibold text-text-secondary [overflow-wrap:anywhere]">{meta.join(" · ")}</p> : null}
            <h2 id={headingId} className="font-display text-xl font-semibold leading-snug text-text text-balance [overflow-wrap:anywhere]">
              {entry.title}
            </h2>
          </div>
        </div>
        {entry.summary ? <ShowMoreText text={entry.summary} /> : null}

        {!play ? (
          <NoInlinePlayer>This episode doesn&apos;t have audio you can play here. Open the episode for its notes and files.</NoInlinePlayer>
        ) : play.role === "audio" ? (
          <EpisodePlayer
            resumeAt={entry.progress?.position}
            track={{
              key: `a:${play.asset_id}`,
              itemId: entry.id,
              src: `/api/media/${play.asset_id}/play`,
              title: entry.title,
              subtitle: entry.show?.title ?? null,
              artwork: art,
              href,
              duration,
              captions: play.captions.map((c) => ({ src: `/api/media/${c.asset_id}/vtt`, label: c.label, language: c.language })),
              saveProgress: member,
            }}
          />
        ) : (
          <VideoPlayer
            video={attachmentVideo(play)}
            title={entry.title}
            itemId={entry.id}
            poster={art}
            resumeAt={entry.progress?.position}
            saveProgress={member}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {member ? <BookmarkButton type="item" id={entry.id} saved={entry.bookmarked} label={entry.title} /> : <span />}
          <Link href={href} className={QUIET_LINK}>
            Episode details <ChevronRight className="size-4" aria-hidden="true" />
            <span className="sr-only">: {entry.title}</span>
          </Link>
        </div>
      </section>
    );
  }

  const art = safeHttpsUrl(entry.artwork_url);
  const audio = safeHttpsUrl(entry.audio_url);
  const link = safeHttpsUrl(entry.link);
  const providerRef = parseProviderRefString(entry.provider_ref);
  const provider = providerRef ? providerEmbed(providerRef) : null;
  const meta = [entry.show_title, entry.published_at ? formatInstant(entry.published_at, timeZone) : null, durationLabel(entry.duration_seconds)].filter(Boolean);
  const href = `/podcasts/external/${entry.id}`;
  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <div className="flex gap-4">
        <Artwork src={art} />
        <div className="min-w-0 flex-1 space-y-1 py-0.5">
          {meta.length ? <p className="text-[0.8125rem] font-semibold text-text-secondary [overflow-wrap:anywhere]">{meta.join(" · ")}</p> : null}
          <h2 id={headingId} className="font-display text-xl font-semibold leading-snug text-text text-balance [overflow-wrap:anywhere]">
            {entry.title}
          </h2>
        </div>
      </div>
      {entry.description ? <ShowMoreText text={entry.description} /> : null}

      {audio ? (
        <EpisodePlayer
          resumeAt={entry.progress?.position}
          track={{
            key: `e:${entry.id}`,
            itemId: null,
            src: audio,
            title: entry.title,
            subtitle: entry.show_title,
            artwork: art,
            href,
            duration: entry.duration_seconds,
            saveProgress: member,
          }}
        />
      ) : (
        <NoInlinePlayer>This publisher&apos;s episodes play in their own app or site. Use the link below to listen.</NoInlinePlayer>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap gap-1">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className={QUIET_LINK}>
              Publisher&apos;s site <ExternalLink className="size-4" aria-hidden="true" />
              <span className="sr-only">(opens a new tab)</span>
            </a>
          ) : null}
          {provider && !audio ? (
            <a href={provider.openUrl} target="_blank" rel="noopener noreferrer" className={QUIET_LINK}>
              {provider.openLabel} <ExternalLink className="size-4" aria-hidden="true" />
              <span className="sr-only">(opens a new tab)</span>
            </a>
          ) : null}
        </span>
        <Link href={href} className={QUIET_LINK}>
          Episode details <ChevronRight className="size-4" aria-hidden="true" />
          <span className="sr-only">: {entry.title}</span>
        </Link>
      </div>
    </section>
  );
}

/**
 * An external show added by its Apple Podcasts or Spotify link only (no
 * feed episodes to list): the provider's official player sits in the card,
 * as on the show page. The provider controls its own playback; the app
 * unloads a tapped player when another one starts.
 */
export function ProviderShowCard({ show, urls, eager, member }: { show: Show; urls: Map<string, string>; eager: boolean; member: boolean }) {
  const ref = parseProviderRefString(show.provider_ref);
  if (!ref) return null;
  const headingId = `show-${show.id}`;
  const providerName = ref.provider === "spotify" ? "Spotify" : "Apple Podcasts";
  const meta = [show.author || "Podcast", providerName].filter(Boolean);
  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <div className="flex gap-4">
        <ShowArt show={show} urls={urls} className="size-20 sm:size-24" />
        <div className="min-w-0 flex-1 space-y-1 py-0.5">
          <p className="text-[0.8125rem] font-semibold text-text-secondary [overflow-wrap:anywhere]">{meta.join(" · ")}</p>
          <h2 id={headingId} className="font-display text-xl font-semibold leading-snug text-text text-balance [overflow-wrap:anywhere]">
            {show.title}
          </h2>
        </div>
      </div>
      {show.description ? <ShowMoreText text={show.description} /> : null}
      <EmbedPlayer
        autoload
        eager={eager}
        title={`${show.title} on ${providerName}`}
        embed={providerEmbed(ref)}
        actions={
          <>
            {member ? <BookmarkButton type="show" id={show.id} saved={show.bookmarked} label={show.title} /> : null}
            <Link href={`/podcasts/shows/${show.id}`} className={QUIET_LINK}>
              Show details <ChevronRight className="size-4" aria-hidden="true" />
              <span className="sr-only">: {show.title}</span>
            </Link>
          </>
        }
      />
    </section>
  );
}
