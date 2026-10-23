"use client";

import { PenSquare, Search, X } from "lucide-react";
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { librarySearchAction, type LibraryFilters } from "@/app/(app)/(member)/prayer/library/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import type { LibraryCard as Card } from "@/lib/prayer/library";
import { LibraryCard, libraryGridClass } from "./library-card";

/**
 * The library's search field and results. Searching runs as a POST (a
 * Server Action) so search words never appear in the address bar, history,
 * or request logs; it is combined with the filters chosen above it and goes
 * through the same access-checked list. While a search is active its results
 * replace the list the server rendered (`children`).
 */
export function LibraryBrowser({
  view,
  filters,
  filtered,
  tz,
  canAdd,
  filterPanel,
  children,
}: {
  view: string;
  filters: LibraryFilters;
  /** Whether any filter is applied (for the empty state's wording). */
  filtered: boolean;
  tz: string;
  canAdd: boolean;
  /** The filter controls, shown under the search field. */
  filterPanel?: ReactNode;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; items: Card[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const id = useId();

  const run = (q: string, append = false) =>
    start(async () => {
      const last = append && results?.items.length ? results.items[results.items.length - 1] : null;
      const page = await librarySearchAction(q, view, filters, last?.cursor_at ? { before: last.cursor_at, beforeId: last.id } : null);
      if ("error" in page) {
        setError(page.error);
        return;
      }
      setError("");
      setResults({ q, items: append && results ? [...results.items, ...page.items] : page.items, hasMore: page.has_more });
    });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) run(q);
    else setResults(null);
  }

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={onSubmit} className="flex flex-wrap gap-2 sm:flex-nowrap">
        <label htmlFor={id} className="sr-only">
          Search the Prayer Library
        </label>
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
          <input
            id={id}
            type="search"
            value={query}
            maxLength={100}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, words, topic, purpose, use, or author"
            className="block min-h-13 w-full rounded-full border border-border-strong bg-surface pl-12 pr-4 text-base text-text shadow-(--elev-card) placeholder:text-text-secondary focus-visible:outline-3 focus-visible:outline-primary"
          />
        </div>
        <Button type="submit" variant="primary" loading={pending} icon={<Search className="size-4" aria-hidden="true" />}>
          Search
        </Button>
        {results ? (
          <Button
            variant="ghost"
            onClick={() => {
              setResults(null);
              setQuery("");
            }}
            icon={<X className="size-4" aria-hidden="true" />}
          >
            Clear search
          </Button>
        ) : null}
      </form>
      {filterPanel}
      <p role="status" className={error ? "text-danger" : "sr-only"}>
        {error || (results ? `${results.items.length}${results.hasMore ? "+" : ""} ${results.items.length === 1 ? "prayer" : "prayers"} found` : "")}
      </p>
      {results ? (
        results.items.length ? (
          <>
            <ul className={libraryGridClass} aria-label={`Search results for “${results.q}”`}>
              {results.items.map((c) => (
                <li key={c.id}>
                  <LibraryCard card={c} tz={tz} />
                </li>
              ))}
            </ul>
            {results.hasMore ? (
              <Button size="sm" variant="secondary" loading={pending} onClick={() => run(results.q, true)}>
                Show more results
              </Button>
            ) : null}
          </>
        ) : (
          <EmptyState
            glyph="prayer"
            title="No prayers match your search"
            action={
              canAdd ? (
                <ButtonLink href="/prayer/library/new" variant="secondary" size="sm" icon={<PenSquare className="size-4" aria-hidden="true" />}>
                  Add a prayer
                </ButtonLink>
              ) : null
            }
          >
            Try fewer or different words{filtered ? ", or reset the filters" : ""}. If the prayer you need isn&apos;t here yet, you could write one and share it.
          </EmptyState>
        )
      ) : (
        children
      )}
    </div>
  );
}
