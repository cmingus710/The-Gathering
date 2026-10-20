/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { Film, Headphones } from "lucide-react";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";
import { durationLabel, formatDay, itemDate, itemHref, KIND_LABEL, speakers } from "@/lib/media/format";
import type { ItemCard as Item, ItemKind } from "@/lib/media/types";
import type { IconName } from "@/lib/icons";

const GLYPH: Record<ItemKind, IconName> = {
  devotional: "devotionals",
  lesson: "lessons",
  episode: "podcasts",
  book: "reading",
  assignment: "reading",
  playlist: "music",
};

export function itemCover(item: Pick<Item, "cover">, urls: Map<string, string>, prefer: "small" | "large" = "small"): string | null {
  if (!item.cover) return null;
  const path = prefer === "small" ? (item.cover.variant_path ?? item.cover.path) : item.cover.path;
  return urls.get(path) ?? null;
}

/** Card for lists, search, related content, and the home page. */
export function ItemCard({ item, urls, showKind = false, className }: { item: Item; urls: Map<string, string>; showKind?: boolean; className?: string }) {
  const cover = itemCover(item, urls);
  const day = itemDate(item);
  const who = speakers(item);
  const meta = [
    showKind ? KIND_LABEL[item.kind] : null,
    item.kind === "assignment" && item.book ? item.book.title : null,
    item.kind === "book" ? item.book_author : null,
    day && item.kind !== "book" && item.kind !== "playlist" ? formatDay(day, "short") : null,
    who || null,
  ].filter(Boolean);
  return (
    <Link href={itemHref(item)} className={cn("interactive flex gap-3.5 rounded-card border border-border bg-surface p-3 hover:bg-surface-muted/60", className)}>
      {cover ? (
        <img src={cover} alt="" className="size-20 shrink-0 rounded-tile object-cover sm:size-24" />
      ) : (
        <span className="flex size-20 shrink-0 items-center justify-center rounded-tile bg-surface-muted sm:size-24" aria-hidden="true">
          <TileIcon name={GLYPH[item.kind]} className="size-12" />
        </span>
      )}
      <span className="min-w-0 flex-1 py-0.5">
        {meta.length ? <span className="block truncate text-[0.8125rem] font-semibold text-text-secondary">{meta.join(" · ")}</span> : null}
        <span className="mt-0.5 block font-semibold leading-snug text-text line-clamp-2">{item.title}</span>
        {item.summary ? <span className="mt-0.5 block text-meta text-text-secondary line-clamp-2">{item.summary}</span> : null}
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-text-secondary">
          {item.media?.video ? (
            <span className="inline-flex items-center gap-1">
              <Film className="size-3.5" aria-hidden="true" /> Video
            </span>
          ) : null}
          {item.media?.audio ? (
            <span className="inline-flex items-center gap-1">
              <Headphones className="size-3.5" aria-hidden="true" /> Audio
            </span>
          ) : null}
          {durationLabel(item.media?.duration_seconds) ? <span>{durationLabel(item.media?.duration_seconds)}</span> : null}
          {item.series ? <span>{item.series.title}</span> : null}
          {item.completed ? <span className="font-semibold text-success">Done</span> : null}
        </span>
      </span>
    </Link>
  );
}
