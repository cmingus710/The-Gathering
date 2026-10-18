/* eslint-disable @next/next/no-img-element -- signed Supabase Storage URLs; dimensions vary per upload. */
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { PinnedBadge, VisibilityBadge } from "@/components/ui/badge";
import { markdownExcerpt } from "@/lib/announcements/markdown";
import type { AnnouncementWithImage } from "@/lib/announcements/queries";
import { formatDate } from "@/lib/time";
import { MarkdownBody } from "./markdown-body";

export function AnnouncementCard({
  announcement: a,
  timeZone,
  href,
  expanded = false,
  showVisibility = false,
  headingLevel = 3,
}: {
  announcement: Pick<AnnouncementWithImage, "id" | "title" | "body" | "pinned" | "publish_at" | "imageUrl" | "image_alt" | "visibility">;
  timeZone: string;
  href?: string;
  expanded?: boolean;
  showVisibility?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-[0_1px_2px_rgba(54,52,48,0.06)]">
      {a.imageUrl ? (
        <img src={a.imageUrl} alt={a.image_alt ?? ""} className="aspect-[16/9] w-full bg-surface-muted object-cover" loading="lazy" />
      ) : null}
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {a.pinned ? <PinnedBadge /> : null}
          {showVisibility ? <VisibilityBadge visibility={a.visibility} /> : null}
          {a.publish_at ? (
            <time dateTime={a.publish_at} className="text-[0.95rem] text-text-secondary">
              {formatDate(a.publish_at, timeZone)}
            </time>
          ) : null}
        </div>
        <Heading className="font-serif text-xl font-semibold leading-snug">
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
            className="mt-auto inline-flex min-h-11 items-center gap-1 pt-3 font-semibold text-primary underline-offset-2 hover:underline"
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
