import Link from "next/link";
import { formatDay, itemHref, KIND_LABEL, readingHref } from "@/lib/media/format";
import type { ItemCard, VideoUse } from "@/lib/media/types";
import { itemCover } from "./item-card";
import { VideoPlayer } from "./video-player";

const PROVIDER: Record<string, string> = { youtube: "YouTube", vimeo: "Vimeo" };

function hrefFor(u: VideoUse): string {
  return u.kind === "assignment" && u.book ? readingHref(u.book.id, u.id) : itemHref({ id: u.id, kind: u.kind, book: u.book });
}

/** "Also in": other content the viewer can open that shows the same video. */
export function VideoUsedIn({ uses, compact = false }: { uses: VideoUse[]; compact?: boolean }) {
  if (!uses.length) return null;
  return (
    <div className={compact ? "text-meta" : "rounded-card border border-border bg-surface p-4"}>
      <p className={compact ? "font-semibold text-text-secondary" : "mb-1 font-semibold"}>Also in</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {uses.map((u) => (
          <li key={u.id}>
            <Link href={hrefFor(u)} className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline">
              {u.title}
              <span className="ml-1 font-normal text-text-secondary">({KIND_LABEL[u.kind]})</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A published video in search results and on Videos: thumbnail and Play in
 * place (no second page needed), title, short description, provider, and
 * where else it appears. The title links to the video's own page.
 */
export function VideoCard({ item, urls, headingLevel = "h3" }: { item: ItemCard; urls: Map<string, string>; headingLevel?: "h2" | "h3" }) {
  const H = headingLevel;
  const video = item.video;
  const provider = video?.kind === "external_video" && video.provider ? PROVIDER[video.provider] : video ? "Church video" : null;
  const meta = [KIND_LABEL.video, provider, item.publish_at ? formatDay(item.publish_at.slice(0, 10), "short") : null].filter(Boolean).join(" · ");
  return (
    <article className="overflow-hidden rounded-card border border-border bg-surface p-3 sm:p-4" aria-labelledby={`video-${item.id}`}>
      {video ? <VideoPlayer video={video} title={item.title} itemId={item.id} poster={itemCover(item, urls, "large")} compact /> : null}
      <div className="mt-2 space-y-1">
        <p className="text-[0.8125rem] font-semibold text-text-secondary">{meta}</p>
        <H id={`video-${item.id}`} className="font-semibold leading-snug text-text">
          <Link href={itemHref(item)} className="underline-offset-2 hover:underline">
            {item.title}
          </Link>
        </H>
        {item.summary ? <p className="text-meta text-text-secondary line-clamp-3">{item.summary}</p> : null}
        {item.tags.length ? (
          <ul aria-label="Tags" className="flex flex-wrap gap-1.5 pt-1">
            {item.tags.slice(0, 6).map((t) => (
              <li key={t} className="rounded-full bg-surface-muted px-2.5 py-0.5 text-[0.75rem] font-semibold text-text-secondary">
                {t}
              </li>
            ))}
          </ul>
        ) : null}
        {item.used_in?.length ? <VideoUsedIn uses={item.used_in} compact /> : null}
      </div>
    </article>
  );
}
