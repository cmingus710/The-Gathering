/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import type { CollectionCards } from "@/lib/devotionals/types";
import { collectionHref, dayHref } from "./reading-view";

type Card = CollectionCards["collections"][number];

/**
 * A collection on the devotionals page: its title and card line, and today's
 * morning and evening readings (the member's own date). Only these two
 * readings are listed, never the whole collection.
 */
export function CollectionCard({ collection, today, urls }: { collection: Card; today: string; urls: Map<string, string> }) {
  const cover = collection.cover ? (urls.get(collection.cover.variant_path ?? collection.cover.path) ?? null) : null;
  return (
    <article aria-labelledby={`collection-${collection.id}`} className="rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <div className="flex gap-3.5">
        {cover ? (
          <img src={cover} alt="" className="size-16 shrink-0 rounded-tile object-cover sm:size-20" />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-tile bg-surface-muted sm:size-20" aria-hidden="true">
            <TileIcon name="devotionals" className="size-10" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 id={`collection-${collection.id}`} className="font-display text-[1.25rem] font-semibold leading-snug text-text">
            <Link href={collectionHref(collection.key)} className="hover:underline">
              {collection.title}
            </Link>
          </h3>
          {collection.subtitle ? <p className="text-meta text-text-secondary">{collection.subtitle}</p> : null}
        </div>
      </div>
      {collection.today.length ? (
        <ul aria-label="Today's readings" className="mt-4 grid gap-2 sm:grid-cols-2">
          {collection.today.map((r) => (
            <li key={r.id}>
              <Link
                href={dayHref(collection.key, today, r.slot)}
                className="interactive flex min-h-14 items-start gap-3 rounded-tile border border-border bg-surface-muted/40 px-3 py-2.5 hover:bg-surface-muted"
              >
                {r.slot === "morning" ? <Sun className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /> : <Moon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="block font-semibold text-text">Today&apos;s {r.slot === "morning" ? "Morning" : "Evening"} reading</span>
                  {r.key_verse ? <span className="block text-meta text-text-secondary line-clamp-2 [overflow-wrap:anywhere]">{r.key_verse}</span> : null}
                  {r.scripture_ref ? <span className="block text-[0.8125rem] font-semibold text-text-secondary">{r.scripture_ref}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
