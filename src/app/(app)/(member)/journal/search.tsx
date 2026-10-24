"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, rowListClass } from "@/components/ui/card";
import { entryDisplayTitle } from "@/lib/journal/labels";
import { searchJournalAction, type JournalListItem } from "./actions";

function linkLabel(link: JournalListItem["link"]): string | null {
  if (!link) return null;
  if (link.kind === "passage") return link.label ?? "A passage";
  if (link.kind === "assignment") return link.available ? `${link.plan_title}: ${link.label}` : "A reading plan day";
  if (link.kind === "lesson_answer" || link.kind === "lesson_notes") return link.available && link.title ? `Sunday lesson: ${link.title}` : "A Sunday lesson no longer available";
  return link.available ? (link.title ?? null) : "Teaching no longer available";
}

/** The entry list with search (sent as a POST, never in the URL). */
export function JournalList({ initial, total: initialTotal, status }: { initial: JournalListItem[]; total: number; status: "active" | "archived" }) {
  const [items, setItems] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (offset: number, q = query) =>
    start(async () => {
      const r = await searchJournalAction({ query: q, status, offset });
      if (!r.ok) return setError(r.message);
      setError(null);
      setSearched(q);
      setTotal(r.total);
      setItems(offset ? [...items, ...r.items] : r.items);
    });
  return (
    <div>
      <form
        role="search"
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(0);
        }}
      >
        <label htmlFor="journal-search" className="sr-only">
          Search My Journal
        </label>
        <input
          id="journal-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search My Journal"
          className="min-h-12 flex-1 rounded-control border border-border-strong bg-surface px-4"
        />
        <Button type="submit" variant="secondary" loading={pending} icon={<Search className="size-4" aria-hidden="true" />}>
          Search
        </Button>
      </form>
      <p role="status" className="mb-2 text-meta text-text-secondary">
        {error ?? (searched ? `${total} ${total === 1 ? "entry matches" : "entries match"} “${searched}”.` : "")}
      </p>
      {items.length ? (
        <ul className={rowListClass}>
          {items.map((e) => (
            <li key={e.id}>
              <Link href={`/journal/${e.id}`} className="block px-4 py-3 hover:bg-surface-muted/60">
                <span className="block font-semibold">{entryDisplayTitle(e.title, e.link)}</span>
                <span className="block text-meta text-text-secondary">
                  {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(e.updated_at))}
                  {linkLabel(e.link) ? ` · ${linkLabel(e.link)}` : ""}
                </span>
                {e.excerpt ? <span className="mt-0.5 line-clamp-2 block text-meta text-text-secondary">{e.excerpt}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState glyph="journal" title={searched ? "Nothing matches" : status === "archived" ? "No archived entries" : "No entries yet"}>
          {searched ? "Try other words." : status === "archived" ? "Entries you archive appear here." : "Write your first entry, write about a reading from a plan, or answer the questions in a Sunday lesson."}
        </EmptyState>
      )}
      {items.length < total ? (
        <Button variant="secondary" size="sm" className="mt-4" loading={pending} onClick={() => run(items.length, searched)}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}
