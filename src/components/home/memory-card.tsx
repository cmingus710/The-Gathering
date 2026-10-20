import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import type { Item } from "@/lib/memory/types";

export type HomeMemory = { item: Item; collection: { id: string; title: string }; more: number; due_count: number };

/**
 * The current memory verse. Shown only when the member has an active
 * assignment; nothing is invented when there isn't one, and the card never
 * shows results or practice history.
 */
export function MemoryCard({ data }: { data: HomeMemory }) {
  const card = data.item.card;
  const href = card ? `/memory/verses/${card.id}` : "/memory/assignment";
  return (
    <section aria-labelledby="home-memory">
      <h2 id="home-memory" className="sr-only">
        Memory verse
      </h2>
      <Link href={href} className="interactive flex min-h-16 items-center gap-3 rounded-card border border-border bg-surface p-3 hover:bg-surface-muted/60">
        <TileIcon name="memory" className="size-11 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-semibold text-text-secondary">
            Memory verse · {data.collection.title}
            {data.more > 0 ? ` · ${data.more} more` : ""}
          </span>
          <span className="block truncate font-semibold text-text">
            {data.item.title ? `${data.item.title} · ` : ""}
            {data.item.passage.label} ({data.item.passage.translation.code})
          </span>
          {data.due_count > 0 ? (
            <span className="text-meta text-text-secondary">
              {data.due_count === 1 ? "1 verse is ready to review" : `${data.due_count} verses are ready to review`}
            </span>
          ) : null}
        </span>
        <span className="hidden shrink-0 text-meta font-semibold text-primary sm:inline">{card ? "Practice" : "Start"}</span>
        <ChevronRight className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
      </Link>
    </section>
  );
}
