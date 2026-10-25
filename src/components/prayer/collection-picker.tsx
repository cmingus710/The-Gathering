"use client";

import { Check, FolderOpen, Search } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/components/ui/cn";
import { filterCollections, type CollectionOption } from "@/lib/prayer/library";

/**
 * The prayer editor's Collection field: the active collections as a
 * searchable list of choices (no leaving the editor), with General prayers
 * for anything that doesn't fit elsewhere. Submits the chosen id as
 * `collection`; the database checks it again. Required to publish, optional
 * for a draft.
 */
export function CollectionPicker({
  collections,
  value,
  onChange,
  error,
}: {
  collections: CollectionOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string[];
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const shown = filterCollections(collections, query);
  const chosen = collections.find((c) => c.id === value) ?? null;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <fieldset className="space-y-2" aria-describedby={error?.length ? `${hintId} ${errorId}` : hintId}>
      <legend className="font-semibold">
        Collection <span className="font-normal text-text-secondary">(required to publish)</span>
      </legend>
      <p id={hintId} className="text-meta text-text-secondary">
        Where members will find it when browsing, such as Morning Prayers. Choose General prayers if none fits. A draft can wait.
      </p>
      <p className="flex min-h-11 items-center gap-2 rounded-tile border border-border bg-surface-muted px-3 text-meta" aria-live="polite">
        <FolderOpen className="size-4 shrink-0 text-primary" aria-hidden="true" />
        {chosen ? (
          <span className="min-w-0">
            Chosen: <span className="font-semibold text-text">{chosen.name}</span>
          </span>
        ) : (
          <span className="text-text-secondary">No collection chosen yet.</span>
        )}
        {chosen ? (
          <button type="button" onClick={() => onChange(null)} className="ml-auto shrink-0 rounded-full px-2 py-1 font-semibold text-primary hover:underline">
            Clear
          </button>
        ) : null}
      </p>
      {collections.length > 5 ? (
        <div className="relative">
          <label htmlFor={`${id}-q`} className="sr-only">
            Find a collection
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter picks the only match instead of submitting the form.
              if (e.key === "Enter") {
                e.preventDefault();
                if (shown.length === 1) onChange(shown[0].id);
              }
            }}
            placeholder="Find a collection"
            className="block min-h-11 w-full rounded-full border border-border-strong bg-surface pl-10 pr-4 text-base"
          />
        </div>
      ) : null}
      <ul className="max-h-72 space-y-1.5 overflow-y-auto overscroll-contain rounded-tile p-0.5" aria-label="Collections">
        {shown.map((c) => {
          const on = c.id === value;
          return (
            <li key={c.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-tile border px-3.5 py-2.5 transition-colors",
                  "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                  on ? "border-primary bg-primary-soft" : "border-border bg-surface hover:border-primary",
                )}
              >
                <input type="radio" name={`${id}-choice`} value={c.id} checked={on} onChange={() => onChange(c.id)} className="mt-1 size-4 shrink-0 accent-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold [overflow-wrap:anywhere]">{c.name}</span>
                  {c.description ? <span className="block text-meta text-text-secondary">{c.description}</span> : null}
                </span>
                {on ? <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
              </label>
            </li>
          );
        })}
        {!shown.length ? <li className="px-1 py-2 text-meta text-text-secondary">No collection matches “{query}”. Try another word, or choose General prayers.</li> : null}
      </ul>
      <input type="hidden" name="collection" value={value ?? ""} />
      {error?.length ? (
        <p id={errorId} className="text-meta font-medium text-danger">
          {error[0]}
        </p>
      ) : null}
    </fieldset>
  );
}
