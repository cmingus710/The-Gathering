/* eslint-disable @next/next/no-img-element -- signed Supabase Storage URLs; dimensions vary per upload. */
import { ChevronRight, Pin } from "lucide-react";
import Link from "next/link";
import { IconBadge } from "@/components/brand/logo";
import { PinnedBadge, VisibilityBadge } from "@/components/ui/badge";
import { markdownExcerpt } from "@/lib/announcements/markdown";
import type { AnnouncementWithImage } from "@/lib/announcements/queries";
import { formatAge, formatDate } from "@/lib/time";
import { MarkdownBody } from "./markdown-body";

type CardAnnouncement = Pick<AnnouncementWithImage, "id" | "title" | "body" | "pinned" | "publish_at" | "imageUrl" | "image_alt" | "visibility">;

/** Full card, used on the public welcome page. */
export function AnnouncementCard({
  announcement: a,
  timeZone,
  href,
  expanded = false,
  showVisibility = false,
  headingLevel = 3,
}: {
  announcement: CardAnnouncement;
  timeZone: string;
  href?: string;
  expanded?: boolean;
  showVisibility?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      {a.imageUrl ? (
        <img src={a.imageUrl} alt={a.image_alt ?? ""} className="aspect-[16/9] w-full bg-surface-muted object-cover" loading="lazy" />
      ) : null}
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {a.pinned ? <PinnedBadge /> : null}
          {showVisibility ? <VisibilityBadge visibility={a.visibility} /> : null}
          {a.publish_at ? (
            <time dateTime={a.publish_at} className="text-meta font-semibold text-text-secondary">
              {formatDate(a.publish_at, timeZone)}
            </time>
          ) : null}
        </div>
        <Heading className="font-display text-xl font-semibold leading-snug">
          {href ? (
            <Link href={href} className="hover:underline underline-offset-2">
              {a.title}
            </Link>
          ) : (
            a.title
          )}
        </Heading>
        {expanded ? (
          <MarkdownBody source={a.body} className="mt-2" />
        ) : (
          <p className="mt-2 text-text-secondary">{markdownExcerpt(a.body)}</p>
        )}
        {href && !expanded ? (
          <Link
            href={href}
            className="mt-auto inline-flex min-h-11 items-center gap-1 pt-3 font-semibold text-primary hover:text-primary-hover"
            aria-label={`Read “${a.title}”`}
          >
            Read more
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

/** Feed entry for the Announcements tab: author row, title, excerpt. */
export function AnnouncementFeedItem({
  announcement: a,
  churchName,
  iconUrl,
}: {
  announcement: CardAnnouncement;
  churchName: string;
  iconUrl: string;
}) {
  return (
    <article className="py-5">
      <div className="flex items-start gap-3">
        <IconBadge src={iconUrl} className="size-11" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-meta">
            <span className="font-semibold text-text">{churchName}</span>
            {a.publish_at ? (
              <time dateTime={a.publish_at} className="text-text-secondary">
                {formatAge(a.publish_at)}
              </time>
            ) : null}
            {a.pinned ? (
              <span className="inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-primary">
                <Pin className="size-3" aria-hidden="true" />
                Pinned
              </span>
            ) : null}
          </p>
          <h2 className="mt-0.5 font-display text-[1.25rem] font-semibold leading-snug text-text">
            <Link href={`/announcements/${a.id}`} className="hover:underline underline-offset-2">
              {a.title}
            </Link>
          </h2>
          {a.imageUrl ? (
            <img src={a.imageUrl} alt={a.image_alt ?? ""} className="mt-3 aspect-[16/9] w-full rounded-card border border-border bg-surface object-cover" loading="lazy" />
          ) : null}
          <p className="mt-1 text-text-secondary">{markdownExcerpt(a.body, 220)}</p>
        </div>
      </div>
    </article>
  );
}
