import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { collectionHref, readingHref } from "@/components/devotionals/reading-view";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { fieldControlClass } from "@/components/ui/field";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isNotFound } from "@/lib/devotionals/load";
import type { CollectionDay, CollectionSearch } from "@/lib/devotionals/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Search devotional readings" };

const PAGE = 20;
const KEY = /^[a-z0-9][a-z0-9-]{1,59}$/;

/** Search within one collection; each result names its calendar day and morning or evening. */
export default async function CollectionSearchPage({ params, searchParams }: PageProps<"/devotionals/collections/[key]/search">) {
  const { key } = await params;
  if (!KEY.test(key)) notFound();
  const sp = await searchParams;
  await requireApprovedMember(`/devotionals/collections/${key}/search`);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const page = typeof sp.page === "string" && /^\d{1,3}$/.test(sp.page) ? Math.max(1, Number(sp.page)) : 1;
  const supabase = await requireClient();
  // The collection itself (and the read rule) first, so a hidden collection is not found even with no query.
  const [day, found] = await Promise.all([
    supabase.rpc("media_collection_day", { p_key: key, p_date: null, p_slot: null }),
    q.trim().length >= 2 ? supabase.rpc("media_collection_search", { p_key: key, p_q: q, p_limit: PAGE, p_offset: (page - 1) * PAGE }) : Promise.resolve(null),
  ]);
  if (isNotFound(day.error) || isNotFound(found?.error ?? null)) notFound();
  const collection = (day.data as CollectionDay | null)?.collection;
  if (!collection) notFound();
  const results = (found?.data as CollectionSearch | null) ?? null;
  const pages = results ? Math.ceil(results.total / PAGE) : 0;
  const pageHref = (p: number) => `${collectionHref(key)}/search?q=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <>
      <BackLink route="/devotionals/collections/[key]/search" params={{ key }} label={collection.title} />
      <PageHeader eyebrow={collection.title} title="Search readings" />
      <form action={`${collectionHref(key)}/search`} method="get" role="search" className="mb-6 flex flex-wrap gap-2">
        <label htmlFor="collection-q" className="sr-only">
          Search {collection.title}
        </label>
        <input
          id="collection-q"
          type="search"
          name="q"
          defaultValue={q}
          minLength={2}
          maxLength={100}
          required
          placeholder="A word, phrase, or reference (Psalm 23)"
          className={cn(fieldControlClass, "min-w-[min(100%,8rem)] flex-1 border-border-strong")}
        />
        <Button type="submit" variant="secondary" icon={<Search className="size-4" aria-hidden="true" />}>
          Search
        </Button>
      </form>
      {found?.error && !isNotFound(found.error) ? <Alert tone="error" title="Search isn't available right now. Try again in a moment." className="mb-6" /> : null}
      {results ? (
        results.total ? (
          <>
            <p className="mb-3 text-meta text-text-secondary" role="status">
              {results.total} {results.total === 1 ? "reading matches" : "readings match"} &ldquo;{results.q}&rdquo;
            </p>
            <ul className="space-y-3">
              {results.items.map((r) => (
                <li key={r.id}>
                  <Link href={readingHref(key, r.id)} className="interactive block rounded-card border border-border bg-surface p-4 hover:bg-surface-muted/60">
                    <span className="block text-[0.8125rem] font-semibold text-text-secondary">
                      {r.label}
                      {r.scripture_ref ? ` · ${r.scripture_ref}` : ""}
                    </span>
                    <span className="mt-0.5 block font-display font-semibold leading-snug text-text [overflow-wrap:anywhere]">{r.key_verse}</span>
                    <span className="mt-1 block text-meta text-text-secondary line-clamp-3 [overflow-wrap:anywhere]">{r.snippet}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {pages > 1 ? (
              <nav aria-label="Search result pages" className="mt-6 flex items-center justify-between gap-2">
                {page > 1 ? (
                  <ButtonLink href={pageHref(page - 1)} variant="secondary" size="sm">
                    Previous
                  </ButtonLink>
                ) : (
                  <span />
                )}
                <span className="text-meta text-text-secondary">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <ButtonLink href={pageHref(page + 1)} variant="secondary" size="sm">
                    Next
                  </ButtonLink>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        ) : (
          <EmptyState glyph="devotionals" title="No readings match">
            Try another word or a Scripture reference.
          </EmptyState>
        )
      ) : (
        <p className="text-meta text-text-secondary">Search the key verses, references, and text of every reading.</p>
      )}
    </>
  );
}
