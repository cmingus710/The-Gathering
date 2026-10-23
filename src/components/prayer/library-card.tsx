"use client";

import { Archive, Bookmark, BookmarkCheck, EyeOff, FilePen } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { libraryBookmarkAction } from "@/app/(app)/(member)/prayer/library/actions";
import { cn } from "@/components/ui/cn";
import type { Category, LibraryCard as Card } from "@/lib/prayer/library";
import { formatDate } from "@/lib/time";

/** Private save/bookmark toggle. Only the member who saves a prayer ever sees that they did. */
export function BookmarkButton({ prayerId, title, initialSaved, compact = false }: { prayerId: string; title: string; initialSaved: boolean; compact?: boolean }) {
  const [saved, setSaved] = useState(initialSaved);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const result = await libraryBookmarkAction(prayerId, !saved);
      if (result.ok) {
        setSaved(result.saved);
        setMessage(result.saved ? "Saved to your prayers. Only you can see this." : "Removed from your saved prayers.");
      } else setMessage(result.message);
    });
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        className={cn(
          "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border text-meta font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
          compact ? "px-3" : "px-4",
          saved ? "border-primary bg-primary-soft text-text" : "border-border-strong bg-surface text-text hover:border-primary",
        )}
      >
        {saved ? <BookmarkCheck className="size-4 text-primary" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
        {saved ? "Saved" : "Save"}
        <span className="sr-only"> {title}</span>
      </button>
      <span role="status" className="sr-only">
        {message}
      </span>
    </span>
  );
}

/** Topic and purpose labels (intended uses too, when asked). */
export function CategoryLabels({ categories, kinds = ["topic", "purpose"], className }: { categories: Category[]; kinds?: Category["kind"][]; className?: string }) {
  const shown = categories.filter((c) => kinds.includes(c.kind));
  if (!shown.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Labels">
      {shown.map((c) => (
        <li
          key={c.id}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold",
            c.kind === "purpose" ? "bg-primary-soft text-primary" : c.kind === "use" ? "border border-border text-text-secondary" : "bg-surface-muted text-text",
          )}
        >
          {c.name}
        </li>
      ))}
    </ul>
  );
}

/** One library prayer in a list: title, excerpt, labels, who shared it and when, and a private save. */
export function LibraryCard({ card, tz }: { card: Card; tz: string }) {
  const visible = card.status === "published" && !card.hidden;
  const when = card.published_at ?? card.updated_at;
  return (
    <article aria-labelledby={`lib-${card.id}`} className="relative flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-5 shadow-(--elev-card) transition-colors hover:border-border-strong">
      {card.mine && !visible ? (
        <p className="flex flex-wrap items-center gap-x-3 text-meta font-semibold">
          {card.hidden ? (
            <span className="inline-flex items-center gap-1 text-danger">
              <EyeOff className="size-3.5" aria-hidden="true" /> Hidden by a moderator
            </span>
          ) : null}
          {card.status === "draft" ? (
            <span className="inline-flex items-center gap-1 text-text-secondary">
              <FilePen className="size-3.5" aria-hidden="true" /> Draft · only you can see it
            </span>
          ) : null}
          {card.status === "archived" ? (
            <span className="inline-flex items-center gap-1 text-text-secondary">
              <Archive className="size-3.5" aria-hidden="true" /> Archived{card.mod_archived ? " by a moderator" : ""}
            </span>
          ) : null}
        </p>
      ) : null}
      <h3 id={`lib-${card.id}`} className="font-display text-[1.1875rem] font-semibold leading-snug text-text">
        {/* The whole card opens the prayer; the save button sits above the link. */}
        <Link href={`/prayer/library/${card.id}`} className="outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary">
          {card.title}
        </Link>
      </h3>
      <p className="line-clamp-3 text-meta text-text-secondary">{card.excerpt}</p>
      <CategoryLabels categories={card.categories} />
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-2">
        <p className="min-w-0 text-meta text-text-secondary">
          <span className="block">
            Shared by {card.mine ? "you" : card.contributor}
            {card.origin === "shared" && card.source_name ? <> · from {card.source_name}</> : null}
          </span>
          <span className="block">
            {card.published_at ? "Published " : "Last saved "}
            <time dateTime={when}>{formatDate(when, tz)}</time>
          </span>
        </p>
        {visible ? (
          <span className="relative z-10">
            <BookmarkButton prayerId={card.id} title={card.title} initialSaved={card.saved} compact />
          </span>
        ) : null}
      </div>
    </article>
  );
}

export const libraryGridClass = "grid gap-4 sm:grid-cols-2";
