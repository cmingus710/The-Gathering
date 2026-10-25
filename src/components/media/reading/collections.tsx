import { Library, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { TileIcon } from "@/components/icons/icon";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { bookCount, type CollectionCover } from "@/lib/media/book-collections";
import { parseFraming } from "@/lib/media/framing";
import type { ItemCard as Card } from "@/lib/media/types";
import { FramedImage } from "../framed-image";
import { itemCover } from "../item-card";
import { PROGRESS_LABEL } from "./current-book";

const coverUrl = (c: CollectionCover, urls: Map<string, string>) => urls.get(c.variant_path ?? c.path) ?? null;

// The fanned covers inside a folder: left, centre (front), right.
const FAN = ["-rotate-6 -mr-5 translate-y-1.5 group-hover:-rotate-9", "z-10 group-hover:-translate-y-1", "rotate-6 -ml-5 translate-y-1.5 group-hover:rotate-9"];

/**
 * The folder shape shared by collection cards (Books, Prayer Library): a tab,
 * a pocket holding `art`, and a label strip with the name, an optional short
 * description, and a count. The whole folder is one link.
 */
export function FolderCard({
  href,
  name,
  description,
  countLabel,
  art,
  accent = false,
}: {
  href: string;
  name: string;
  description?: string | null;
  countLabel: string;
  /** What sits in the pocket: covers, an image, or a fallback icon (decorative). */
  art: ReactNode;
  /** The primary-colored tab (All Books). */
  accent?: boolean;
}) {
  return (
    <Link href={href} className="group block h-full rounded-card pt-3 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <span className="relative flex h-full flex-col">
        {/* Folder tab; the covers tuck behind the label strip like papers in a pocket. */}
        <span
          aria-hidden="true"
          className={cn("absolute -top-3 left-0 h-4 w-2/5 max-w-28 rounded-t-tile border border-b-0 border-border", accent ? "bg-primary" : "bg-accent/40")}
        />
        <span className="relative flex flex-1 flex-col overflow-hidden rounded-card rounded-tl-none border border-border bg-primary-soft shadow-(--elev-card) transition-shadow duration-200 group-hover:shadow-(--elev-lift)">
          <span className="relative flex h-28 items-end justify-center px-3 pt-3 sm:h-32" aria-hidden="true">
            {art}
          </span>
          <span className="relative z-20 block flex-1 border-t border-border bg-surface px-3.5 py-3">
            <span className="block font-semibold leading-snug text-text line-clamp-2 [overflow-wrap:anywhere]">{name}</span>
            {description ? <span className="mt-0.5 block text-meta text-text-secondary line-clamp-2 [overflow-wrap:anywhere]">{description}</span> : null}
            <span className="mt-0.5 block text-meta text-text-secondary">{countLabel}</span>
          </span>
        </span>
      </span>
    </Link>
  );
}

/**
 * A collection as a folder: a tab, a pocket holding up to three of its covers
 * (books the reader can open only), its name, and how many books it holds.
 */
export function CollectionFolder({
  href,
  name,
  count,
  covers,
  urls,
  all = false,
}: {
  href: string;
  name: string;
  count: number;
  covers: CollectionCover[];
  urls: Map<string, string>;
  /** All Books: the library icon instead of a plain tab. */
  all?: boolean;
}) {
  const shown = covers.flatMap((c) => {
    const src = coverUrl(c, urls);
    return src ? [{ src, framing: c.framing }] : [];
  });
  // One cover sits in the middle; two use the outer slots.
  const slots = shown.length === 1 ? [FAN[1]] : shown.length === 2 ? [FAN[0], FAN[2]] : FAN;
  return (
    <FolderCard
      href={href}
      name={name}
      countLabel={bookCount(count)}
      accent={all}
      art={
        shown.length ? (
          shown.map((c, i) => (
            <FramedImage
              key={i}
              src={c.src}
              alt=""
              framing={parseFraming(c.framing)}
              className={cn(
                "-mb-3 h-24 w-16 shrink-0 rounded-md border border-border bg-surface-muted shadow-(--elev-lift) transition-transform duration-200 sm:h-28 sm:w-[4.5rem]",
                slots[i],
              )}
            />
          ))
        ) : all ? (
          <Library className="mb-4 size-12 text-primary" strokeWidth={1.5} />
        ) : (
          <TileIcon name="reading" className="mb-3 size-14" />
        )
      }
    />
  );
}

export const collectionGridClass = "grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4";

/** One book in a collection: its whole cover, title, author, and the reader's own progress. */
export function BookCoverCard({
  book,
  href,
  urls,
  progress,
}: {
  book: Card;
  href: string;
  urls: Map<string, string>;
  progress?: { status: keyof typeof PROGRESS_LABEL; position: string | null };
}) {
  const cover = itemCover(book, urls);
  return (
    <Link href={href} className="interactive group flex h-full flex-col rounded-card border border-border bg-surface p-2.5 shadow-(--elev-card) hover:bg-surface-muted/60 sm:p-3">
      {cover ? (
        <FramedImage
          src={cover}
          alt=""
          framing={parseFraming(book.cover?.framing)}
          // The whole cover unless it was set to fill the frame (as in ItemCard).
          fit={book.cover?.framing ? "cover" : "contain"}
          className="aspect-[2/3] w-full rounded-tile bg-surface-muted"
        />
      ) : (
        <span className="flex aspect-[2/3] w-full items-center justify-center rounded-tile bg-surface-muted" aria-hidden="true">
          <TileIcon name="reading" className="size-14" />
        </span>
      )}
      <span className="mt-2.5 block min-w-0 px-0.5">
        {book.book_current ? <span className="block text-[0.8125rem] font-semibold text-primary">Current book</span> : null}
        <span className="block font-semibold leading-snug text-text line-clamp-3 [overflow-wrap:anywhere]">{book.title}</span>
        {book.book_author ? <span className="mt-0.5 block text-meta text-text-secondary line-clamp-2">{book.book_author}</span> : null}
        {progress ? (
          <span className="mt-1 block text-[0.8125rem] font-semibold text-text-secondary">
            <span className="sr-only">Your progress: </span>
            {PROGRESS_LABEL[progress.status]}
            {progress.position ? ` · ${progress.position}` : ""}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export const bookGridClass = "grid grid-cols-2 gap-3 min-[560px]:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5";

/** Searches all books, or one collection, by title, author, tags, and topics (a plain GET form). */
export function BookSearch({ action, q, label, placeholder }: { action: string; q: string; label: string; placeholder: string }) {
  return (
    <form role="search" action={action} className="flex gap-2">
      <label htmlFor="book-search" className="sr-only">
        {label}
      </label>
      <span className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
        <input
          id="book-search"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={80}
          placeholder={placeholder}
          className="min-h-12 w-full rounded-full border border-border-strong bg-surface pl-11 pr-5 transition-colors hover:border-text-secondary"
        />
      </span>
      <button type="submit" className={buttonClasses("primary")}>
        Search
      </button>
    </form>
  );
}
