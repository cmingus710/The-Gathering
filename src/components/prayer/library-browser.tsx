"use client";

import { PenSquare, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { librarySearchAction, type LibraryFilters } from "@/app/(app)/(member)/prayer/library/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { segmentClass } from "@/components/ui/segmented";
import type { LibraryCard as Card } from "@/lib/prayer/library";
import { LibraryCard, libraryGridClass } from "./library-card";

type Scope = "collection" | "all";
const KEY = "prayer-library-search:";

/** The last search on this list, kept for this tab only (never in the address bar or history). */
function readSearch(key: string): { q: string; scope: Scope } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY + key) ?? "null") as { q?: unknown; scope?: unknown } | null;
    return v && typeof v.q === "string" && v.q.trim() ? { q: v.q.slice(0, 100), scope: v.scope === "all" ? "all" : "collection" } : null;
  } catch {
    return null;
  }
}

function writeSearch(key: string, value: { q: string; scope: Scope } | null) {
  try {
    if (value) sessionStorage.setItem(KEY + key, JSON.stringify(value));
    else sessionStorage.removeItem(KEY + key);
  } catch {}
}

/**
 * The library's search field and results. Searching runs as a POST (a
 * Server Action) so search words never appear in the address bar, history,
 * or request logs; it is combined with the filters chosen above it and goes
 * through the same access-checked list. While a search is active its results
 * replace the list the server rendered (`children`).
 *
 * On a collection page it searches that collection, or every prayer when the
 * reader switches the scope. The last search on each list is kept in this
 * tab's session storage (cleared with "Clear search" or when the tab closes),
 * so coming back from a prayer shows the same results again.
 */
export function LibraryBrowser({
  view,
  filters,
  filtered,
  tz,
  canAdd,
  filterPanel,
  collection = null,
  listKey,
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
  /** On a collection page: its id and name (searches stay inside it unless the reader chooses all prayers). */
  collection?: { id: string; name: string } | null;
  /** Names this list for the remembered search when `view` alone doesn't (the Collections landing). */
  listKey?: string;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("collection");
  const [results, setResults] = useState<{ q: string; scope: Scope; items: Card[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const id = useId();
  const storeKey = listKey ?? `${view}:${collection?.id ?? "all"}`;
  const restored = useRef(false);

  async function search(q: string, s: Scope, append = false) {
    const last = append && results?.items.length ? results.items[results.items.length - 1] : null;
    const within = collection && s === "collection" ? collection.id : null;
    const page = await librarySearchAction(q, view, filters, last?.cursor_at ? { before: last.cursor_at, beforeId: last.id } : null, within);
    if ("error" in page) {
      setError(page.error);
      return;
    }
    setError("");
    writeSearch(storeKey, { q, scope: s });
    setResults({ q, scope: s, items: append && results ? [...results.items, ...page.items] : page.items, hasMore: page.has_more });
  }
  const run = (q: string, s: Scope, append = false) => start(() => search(q, s, append));

  // Coming back to this list in the same tab: show the last search again.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = readSearch(storeKey);
    if (!saved) return;
    start(async () => {
      setQuery(saved.q);
      setScope(saved.scope);
      await search(saved.q, saved.scope);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) run(q, scope);
    else clear();
  }

  function clear() {
    setResults(null);
    setQuery("");
    writeSearch(storeKey, null);
  }

  const searchAll = !collection || scope === "all";
  const label = collection && !searchAll ? `Search ${collection.name}` : "Search the Prayer Library";

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={onSubmit} className="flex flex-wrap gap-2 sm:flex-nowrap">
        <label htmlFor={id} className="sr-only">
          {label}
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
            placeholder={collection && !searchAll ? `Search ${collection.name}` : "Search by title, words, collection, topic, purpose, use, or author"}
            className="block min-h-13 w-full rounded-full border border-border-strong bg-surface pl-12 pr-4 text-base text-text shadow-(--elev-card) placeholder:text-text-secondary focus-visible:outline-3 focus-visible:outline-primary"
          />
        </div>
        <Button type="submit" variant="primary" loading={pending} icon={<Search className="size-4" aria-hidden="true" />}>
          Search
        </Button>
        {results ? (
          <Button variant="ghost" onClick={clear} icon={<X className="size-4" aria-hidden="true" />}>
            Clear search
          </Button>
        ) : null}
      </form>
      {collection ? (
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Where to search</legend>
          {(["collection", "all"] as const).map((s) => (
            <label key={s} className={cn(segmentClass(scope === s), "cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary")}>
              <input
                type="radio"
                name={`${id}-scope`}
                value={s}
                checked={scope === s}
                onChange={() => {
                  setScope(s);
                  if (results) run(results.q, s);
                }}
                className="sr-only"
              />
              {s === "collection" ? `In ${collection.name}` : "All prayers"}
            </label>
          ))}
        </fieldset>
      ) : null}
      {filterPanel}
      <p role="status" className={error ? "text-danger" : "sr-only"}>
        {error || (results ? `${results.items.length}${results.hasMore ? "+" : ""} ${results.items.length === 1 ? "prayer" : "prayers"} found` : "")}
      </p>
      {results ? (
        results.items.length ? (
          <>
            <ul className={libraryGridClass} aria-label={`Search results for “${results.q}”${collection && results.scope === "collection" ? ` in ${collection.name}` : ""}`}>
              {results.items.map((c) => (
                <li key={c.id}>
                  <LibraryCard card={c} tz={tz} fromCollection={collection && c.collection?.id === collection.id ? collection.id : null} />
                </li>
              ))}
            </ul>
            {results.hasMore ? (
              <Button size="sm" variant="secondary" loading={pending} onClick={() => run(results.q, results.scope, true)}>
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
            Try fewer or different words{filtered ? ", or reset the filters" : ""}
            {collection && results.scope === "collection" ? ", or search all prayers" : ""}. If the prayer you need isn&apos;t here yet, you could write one and share it.
          </EmptyState>
        )
      ) : (
        children
      )}
    </div>
  );
}
