import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookCoverCard, BookSearch, bookGridClass } from "@/components/media/reading/collections";
import type { PROGRESS_LABEL } from "@/components/media/reading/current-book";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import {
  ALL_BOOKS,
  ALL_BOOKS_LABEL,
  bookCount,
  bookInCollectionHref,
  collectionHref,
  parseBookQuery,
  parseCollection,
  type CollectionBooks,
} from "@/lib/media/book-collections";
import { coverPaths } from "@/lib/media/format";
import { signPaths } from "@/lib/media/storage";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Books" };

type MyProgress = Map<string, { status: keyof typeof PROGRESS_LABEL; position: string | null }>;

/**
 * One collection of books (a topic assigned to books in "Organize → Topics"),
 * or All Books at /reading/collections/all, as a grid of covers with a search
 * box. The database returns only books the reader can open; a collection
 * with none reads as not found, so a restricted one reveals nothing.
 */
export default async function CollectionPage({ params, searchParams }: PageProps<"/reading/collections/[id]">) {
  const { id } = await params;
  const key = parseCollection(id);
  if (!key) notFound();
  const q = parseBookQuery((await searchParams).q);
  const supabase = await requireClient();
  const [, { data, error }, mine] = await Promise.all([
    requireApprovedMember(collectionHref(key)),
    supabase.rpc("media_books", { p_collection: key === ALL_BOOKS ? null : key, p_q: q || null }),
    supabase.rpc("media_books_progress"),
  ]);
  if (error?.code === "P0002") notFound();
  const r = (data ?? { collection: null, q: null, total: 0, books: [] }) as CollectionBooks;
  const progress: MyProgress = new Map(
    ((mine.data as Array<{ item_id: string; status: keyof typeof PROGRESS_LABEL; position: string | null }> | null) ?? []).map((p) => [p.item_id, p]),
  );
  const urls = await signPaths(supabase, coverPaths(r.books));
  const title = key === ALL_BOOKS ? ALL_BOOKS_LABEL : (r.collection?.name ?? "Collection");
  const scope = key === ALL_BOOKS ? "all books" : "this collection";

  return (
    <>
      <BackLink route="/reading/collections/[id]" />
      <PageHeader
        eyebrow={key === ALL_BOOKS ? null : "Collection"}
        title={title}
        description={error ? null : bookCount(r.total)}
      />
      {error ? (
        <Alert tone="error" title="These books couldn't be loaded right now." />
      ) : (
        <>
          <div className="mb-6 space-y-2">
            <BookSearch action={collectionHref(key)} q={q} label={`Search ${scope} by title, author, or keyword`} placeholder={`Search ${scope}`} />
            {q ? (
              <p className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-meta text-text-secondary" aria-live="polite">
                <span>
                  {r.books.length === 1 ? "1 book matches" : `${r.books.length} books match`} “{q}”
                </span>
                <Link href={collectionHref(key)} className="font-semibold text-primary hover:underline">
                  Clear search
                </Link>
                {key !== ALL_BOOKS ? (
                  <Link href={collectionHref(ALL_BOOKS, q)} className="font-semibold text-primary hover:underline">
                    Search all books
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
          {r.books.length ? (
            <ul className={bookGridClass}>
              {r.books.map((b) => (
                <li key={b.id}>
                  <BookCoverCard book={b} href={bookInCollectionHref(b.id, key)} urls={urls} progress={progress.get(b.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState glyph="reading" title={q ? "No books match that search" : "No books yet"}>
              {q ? "Try a different title, author, or keyword." : "Books will appear here once they're published."}
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
