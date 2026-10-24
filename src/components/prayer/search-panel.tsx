"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { searchAction } from "@/app/(app)/(member)/prayer/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { PrayerCard } from "@/lib/prayer/types";
import { PrayerRow, prayerListClass } from "./prayer-row";

/**
 * Search within the current view, in one toolbar with the View menu (`tools`)
 * and the Filters toggle. Runs as a POST (Server Action) so search words
 * never appear in the address bar, history, or request logs. Results come
 * from the same access-checked function as the list. While a search is
 * active, it replaces the list rendered by the server (`children`).
 *
 * `filters.panel` (the server-rendered Status and Audience form) opens below
 * the toolbar, closed by default; `filters.summary` shows what's applied.
 */
export function SearchPanel({
  view,
  tools,
  filters,
  children,
}: {
  view: string;
  tools?: ReactNode;
  filters?: { count: number; panel: ReactNode; summary?: ReactNode };
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; items: PrayerCard[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pending, start] = useTransition();
  const id = useId();
  const panelId = `${id}-filters`;

  const run = (q: string, append = false) =>
    start(async () => {
      const last = append && results?.items.length ? results.items[results.items.length - 1] : null;
      const page = await searchAction(q, view, last ? { before: last.last_activity_at, beforeId: last.id } : null);
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

  const clear = () => {
    setResults(null);
    setQuery("");
  };

  return (
    <div className="space-y-3">
      <div className="@container">
        <div className="flex flex-col gap-2 @min-[34rem]:flex-row">
          <form role="search" onSubmit={onSubmit} className="relative min-w-0 flex-1">
            <label htmlFor={id} className="sr-only">
              Search prayer requests
            </label>
            <input
              id={id}
              type="search"
              value={query}
              maxLength={100}
              autoComplete="off"
              enterKeyHint="search"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prayer requests"
              className="block min-h-11 w-full rounded-control border border-border-strong/60 bg-surface pr-11 pl-11 text-base text-text placeholder:text-text-secondary hover:border-border-strong focus-visible:outline-3 focus-visible:outline-primary [&::-webkit-search-cancel-button]:hidden"
            />
            <button
              type="submit"
              aria-label="Search"
              aria-busy={pending || undefined}
              className="absolute inset-y-0 left-0 flex w-11 items-center justify-center rounded-l-control text-text-secondary hover:text-text focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-primary"
            >
              {pending ? <Spinner /> : <Search className="size-4" aria-hidden="true" />}
            </button>
            {results || query ? (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear search"
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-text-secondary hover:text-text focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </form>
          {tools || filters ? (
            <div className="flex gap-2">
              {tools ? <div className="min-w-0 flex-1 @min-[34rem]:flex-none">{tools}</div> : null}
              {filters ? (
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls={panelId}
                  onClick={() => setFiltersOpen((o) => !o)}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-control border px-4 text-meta font-semibold text-text",
                    "hover:border-border-strong hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    filtersOpen || filters.count ? "border-primary bg-primary-soft" : "border-border-strong/60 bg-surface",
                  )}
                >
                  <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
                  Filters
                  {filters.count ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.8125rem] font-bold leading-5 text-on-primary">
                      {filters.count}
                      <span className="sr-only"> applied</span>
                    </span>
                  ) : null}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {filters ? (
        <div id={panelId} hidden={!filtersOpen}>
          {filters.panel}
        </div>
      ) : null}
      {filters?.summary && !filtersOpen ? filters.summary : null}
      <p role="status" className={error ? "text-danger" : "sr-only"}>
        {error || (results ? `${results.items.length}${results.hasMore ? "+" : ""} results` : "")}
      </p>
      {results ? (
        results.items.length ? (
          <>
            <ul className={prayerListClass} aria-label="Search results">
              {results.items.map((c) => (
                <li key={c.id}>
                  <PrayerRow card={c} />
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
          <p className="rounded-card border border-border bg-surface px-5 py-4 text-text-secondary">No requests match your search.</p>
        )
      ) : (
        children
      )}
    </div>
  );
}
