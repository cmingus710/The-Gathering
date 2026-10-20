"use client";

import { Search, X } from "lucide-react";
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { searchAction } from "@/app/(member)/prayer/actions";
import { Button } from "@/components/ui/button";
import { rowListClass } from "@/components/ui/card";
import type { PrayerCard } from "@/lib/prayer/types";
import { PrayerRow } from "./prayer-row";

/**
 * Search within the current tab. Runs as a POST (Server Action) so search
 * words never appear in the address bar, history, or request logs. Results
 * come from the same access-checked function as the list. While a search is
 * active, it replaces the list rendered by the server (`children`).
 */
export function SearchPanel({ view, children }: { view: string; children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; items: PrayerCard[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const id = useId();

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

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          Search prayer requests
        </label>
        <input
          id={id}
          type="search"
          value={query}
          maxLength={100}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search requests you can see"
          className="block min-h-11 w-full rounded-full border border-border-strong bg-surface px-4 text-base text-text placeholder:text-text-secondary focus-visible:outline-3 focus-visible:outline-primary"
        />
        <Button type="submit" size="sm" variant="secondary" loading={pending} icon={<Search className="size-4" aria-hidden="true" />}>
          Search
        </Button>
        {results ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setResults(null);
              setQuery("");
            }}
            icon={<X className="size-4" aria-hidden="true" />}
          >
            Clear
          </Button>
        ) : null}
      </form>
      <p role="status" className={error ? "text-danger" : "sr-only"}>
        {error || (results ? `${results.items.length}${results.hasMore ? "+" : ""} results` : "")}
      </p>
      {results ? (
        results.items.length ? (
          <>
            <ul className={rowListClass}>
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
