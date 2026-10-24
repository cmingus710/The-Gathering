import { Film, Headphones } from "lucide-react";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { durationLabel, formatDay, itemDate, itemHref, speakers } from "@/lib/media/format";
import { parseFraming } from "@/lib/media/framing";
import type { ItemCard } from "@/lib/media/types";
import { FramedImage } from "./framed-image";
import { itemCover } from "./item-card";

/**
 * A larger card for the featured lesson and similar single highlights.
 * `fullDate` shows the date with its weekday and year.
 */
export function FeaturedItem({ item, urls, eyebrow, fullDate = false }: { item: ItemCard; urls: Map<string, string>; eyebrow: string; fullDate?: boolean }) {
  const cover = itemCover(item, urls, "large");
  const day = itemDate(item);
  const who = speakers(item);
  return (
    <Link href={itemHref(item)} className="interactive block overflow-hidden rounded-card border border-border bg-surface shadow-(--elev-card) hover:bg-surface-muted/40">
      {cover ? (
        <FramedImage
          src={cover}
          alt={item.cover?.alt ?? ""}
          framing={parseFraming(item.cover?.framing)}
          fit={item.kind === "book" && !item.cover?.framing ? "contain" : "cover"}
          className="aspect-[16/9] w-full bg-surface-muted"
        />
      ) : (
        <div className="flex aspect-[16/7] items-center justify-center bg-surface-muted" aria-hidden="true">
          <TileIcon name="lessons" className="size-16" />
        </div>
      )}
      <div className="space-y-1.5 p-5">
        <p className="text-meta font-semibold text-primary">{eyebrow}</p>
        <h2 className="font-display text-2xl font-semibold leading-snug text-text">{item.title}</h2>
        <p className="text-meta text-text-secondary">{[day ? formatDay(day, fullDate ? "full" : "long") : null, who || null, item.series?.title].filter(Boolean).join(" · ")}</p>
        {item.summary ? <p className="text-text-secondary line-clamp-3">{item.summary}</p> : null}
        <p className="flex flex-wrap gap-3 pt-1 text-meta font-semibold text-text">
          {item.media?.video ? (
            <span className="inline-flex items-center gap-1">
              <Film className="size-4" aria-hidden="true" /> Watch
            </span>
          ) : null}
          {item.media?.audio ? (
            <span className="inline-flex items-center gap-1">
              <Headphones className="size-4" aria-hidden="true" /> Listen
            </span>
          ) : null}
          {durationLabel(item.media?.duration_seconds) ? <span className="text-text-secondary">{durationLabel(item.media?.duration_seconds)}</span> : null}
        </p>
      </div>
    </Link>
  );
}
