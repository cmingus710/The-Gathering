/* eslint-disable @next/next/no-img-element -- short-lived signed URLs */
import { ChevronRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { readingHref } from "@/lib/media/format";
import type { ItemCard as Card } from "@/lib/media/types";
import { itemCover } from "../item-card";
import { assignmentDates } from "./assignment-body";

export const PROGRESS_LABEL = { want: "Want to read", reading: "Reading", finished: "Finished" } as const;

/**
 * A current book with this week's assignment for it. The book and the
 * assignment both open the book's reading page (the assignment selected).
 */
export function CurrentBook({ book, assignment, urls, progress }: { book: Card; assignment: Card | null; urls: Map<string, string>; progress?: { status: keyof typeof PROGRESS_LABEL; position: string | null } }) {
  const cover = itemCover(book, urls, "large");
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-(--elev-card)">
      <Link href={readingHref(book.id)} className="interactive flex gap-4 p-4 hover:bg-surface-muted/40 sm:p-5">
        {cover ? (
          <img
            src={cover}
            alt=""
            width={book.cover?.width ?? undefined}
            height={book.cover?.height ?? undefined}
            className="h-auto w-20 shrink-0 self-start rounded-tile border border-border object-contain sm:w-24"
          />
        ) : (
          <span className="flex h-28 w-20 shrink-0 items-center justify-center rounded-tile bg-surface-muted sm:w-24" aria-hidden="true">
            <TileIcon name="reading" className="size-10" />
          </span>
        )}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-meta font-semibold text-primary">Current book</span>
          <span className="block font-display text-xl font-semibold leading-snug text-text [overflow-wrap:anywhere]">{book.title}</span>
          {book.book_author ? <span className="block text-meta text-text-secondary">by {book.book_author}</span> : null}
          {progress ? (
            <span className="block text-meta text-text-secondary">
              <span className="sr-only">Your progress: </span>
              {PROGRESS_LABEL[progress.status]}
              {progress.position ? ` · ${progress.position}` : ""}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-0.5 pt-1 text-meta font-semibold text-primary">
            Listen, read, and track progress <ChevronRight className="size-4" aria-hidden="true" />
          </span>
        </span>
      </Link>
      {assignment ? (
        <Link href={readingHref(book.id, assignment.id)} className="interactive flex items-center gap-3 border-t border-border bg-primary-soft/40 px-4 py-3 hover:bg-primary-soft sm:px-5">
          <span className="min-w-0 flex-1">
            <span className="block text-meta font-semibold text-primary">
              This week&apos;s reading{assignment.starts_on ? ` · ${assignmentDates(assignment)}` : ""}
            </span>
            <span className="block font-semibold text-text [overflow-wrap:anywhere]">{assignment.title}</span>
          </span>
          {assignment.completed ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-meta font-semibold text-success">
              <CircleCheck className="size-4" aria-hidden="true" /> Done
            </span>
          ) : null}
          <ChevronRight className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

