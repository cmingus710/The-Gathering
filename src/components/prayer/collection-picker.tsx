"use client";

import { Check, FolderOpen, FolderPlus, Search, X } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { addLibraryCollectionAction } from "@/app/(app)/(member)/prayer/library/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { COLLECTION_LIMITS, filterCollections, findCollectionByName, type CollectionOption } from "@/lib/prayer/library";

/**
 * The prayer editor's Collection field: the active collections as a
 * searchable list of choices (no leaving the editor), with General prayers
 * for anything that doesn't fit elsewhere. Submits the chosen id as
 * `collection`; the database checks it again. Required to publish, optional
 * for a draft.
 *
 * When `onCreated` is given, the member can also start a collection here
 * (20261127000100) and it becomes the chosen one; the half-written prayer
 * stays as it is, because the new collection is created on its own, without
 * submitting the editor.
 */
export function CollectionPicker({
  collections,
  value,
  onChange,
  onCreated,
  error,
}: {
  collections: CollectionOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Lets the member add a collection from here; omit to offer only the existing ones. */
  onCreated?: (collection: CollectionOption) => void;
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
        {!shown.length ? <li className="px-1 py-2 text-meta text-text-secondary">No collection matches “{query}”. Try another word, choose General prayers, or start a collection below.</li> : null}
      </ul>
      {onCreated ? <AddCollection collections={collections} onCreated={onCreated} onChoose={(c) => onChange(c.id)} /> : null}
      <input type="hidden" name="collection" value={value ?? ""} />
      {error?.length ? (
        <p id={errorId} className="text-meta font-medium text-danger">
          {error[0]}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Start a collection from inside the editor. It is created on its own (a
 * Server Action call, not a submit), so the prayer being written isn't
 * touched and the new collection becomes the chosen one straight away. These
 * inputs carry no `name`, so they never travel with the prayer; the database
 * checks membership, the name, and the limits again.
 */
function AddCollection({
  collections,
  onCreated,
  onChoose,
}: {
  collections: CollectionOption[];
  onCreated: (collection: CollectionOption) => void;
  onChoose: (collection: CollectionOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const id = useId();
  // A name that is already on the list: choose that collection instead of making another.
  const existing = findCollectionByName(collections, name);

  function close() {
    setOpen(false);
    setName("");
    setDescription("");
    setError("");
  }

  function create() {
    if (pending) return;
    setError("");
    if (existing) {
      onChoose(existing);
      close();
      return;
    }
    start(async () => {
      const result = await addLibraryCollectionAction(name, description);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onCreated(result.collection);
      close();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" icon={<FolderPlus className="size-4" aria-hidden="true" />} onClick={() => setOpen(true)}>
        Start a new collection
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-tile border border-border-strong bg-surface-muted p-3.5">
      <p className="font-semibold">Start a new collection</p>
      <p className="text-meta text-text-secondary">
        Other members see it once a prayer is published in it, and anyone can add prayers to it afterwards. Give it a name others will recognize, such as “Prayers for our
        school”.
      </p>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-name`} className="block font-semibold">
          Name
        </label>
        <input
          id={`${id}-name`}
          type="text"
          value={name}
          maxLength={COLLECTION_LIMITS.name}
          autoComplete="off"
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          // Enter creates the collection instead of submitting the prayer.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
          onChange={(e) => setName(e.target.value)}
          className="block min-h-12 w-full rounded-control border border-border-strong bg-surface px-4 py-2.5 text-base"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-description`} className="block font-semibold">
          Short description <span className="font-normal text-text-secondary">(optional)</span>
        </label>
        <input
          id={`${id}-description`}
          type="text"
          value={description}
          maxLength={COLLECTION_LIMITS.description}
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
          onChange={(e) => setDescription(e.target.value)}
          className="block min-h-12 w-full rounded-control border border-border-strong bg-surface px-4 py-2.5 text-base"
        />
      </div>
      <p role="status" className={cn("text-meta", existing ? "text-text-secondary" : "sr-only")}>
        {existing ? `“${existing.name}” already exists. Creating will choose it instead.` : ""}
      </p>
      {error ? (
        <p id={`${id}-error`} className="text-meta font-medium text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" loading={pending} loadingText="Creating…" disabled={name.trim().length < 2} onClick={create}>
          {existing ? "Choose it" : "Create and choose"}
        </Button>
        <Button type="button" variant="ghost" size="sm" icon={<X className="size-4" aria-hidden="true" />} onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
