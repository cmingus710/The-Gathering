"use client";

import { FolderPlus, PenSquare, X } from "lucide-react";
import { useActionState, useState } from "react";
import { startLibraryCollectionAction, type CollectionCreatedState } from "@/app/(app)/(member)/prayer/library/actions";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { collectionHref, COLLECTION_LIMITS, findCollectionByName, type CollectionShelf } from "@/lib/prayer/library";

/**
 * The Prayer Library's Collections view: a member starts a collection when
 * none of the shelves fits (20261127000100). A new collection holds nothing
 * yet, so only its creator sees it until a prayer is published in it; the
 * next step is offered right away. The database checks membership, the name,
 * how many of the member's collections are still empty, and the rate limit.
 */
export function StartCollectionCard({ collections }: { collections: CollectionShelf[] }) {
  const [state, action] = useActionState<CollectionCreatedState, FormData>(startLibraryCollectionAction, initialFormState);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Lets the member start another after one is created (the state object
  // itself changes with every result, so a dismissed one stays dismissed).
  const [dismissed, setDismissed] = useState<CollectionCreatedState | null>(null);
  const created = state.status === "success" && state.created && state !== dismissed ? state.created : null;
  const fe = state.fieldErrors ?? {};
  const existing = findCollectionByName(collections, name);

  if (created) {
    return (
      <section aria-labelledby="pl-started" className="space-y-3">
        <h3 id="pl-started" className="sr-only">
          New collection
        </h3>
        <Alert tone="success" title={state.message ?? `“${created.name}” is ready.`}>
          It&apos;s on your own list of collections meanwhile; nobody else sees it yet.
        </Alert>
        <div className="flex flex-wrap gap-2">
          <ButtonLink
            href={`/prayer/library/new?${new URLSearchParams({ collection: created.id })}`}
            size="sm"
            icon={<PenSquare className="size-4" aria-hidden="true" />}
          >
            Add the first prayer
          </ButtonLink>
          <ButtonLink href={collectionHref(created.id)} variant="secondary" size="sm">
            Open the collection
          </ButtonLink>
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderPlus className="size-4" aria-hidden="true" />}
            onClick={() => {
              setDismissed(state);
              setName("");
              setOpen(true);
            }}
          >
            Start another
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="pl-start" className="rounded-card border border-border bg-surface-muted p-4 sm:p-5">
      <h3 id="pl-start" className="font-display text-[1.125rem] font-semibold leading-tight">
        Don&apos;t see the right collection?
      </h3>
      <p className="mt-1 text-meta text-text-secondary">
        Start one, then add the prayers that belong in it. Other members see a new collection once a prayer is published in it, and anyone can add prayers to it afterwards.
      </p>
      {!open ? (
        <Button className="mt-3" variant="secondary" size="sm" icon={<FolderPlus className="size-4" aria-hidden="true" />} onClick={() => setOpen(true)}>
          Start a collection
        </Button>
      ) : (
        <form action={action} className="mt-4 max-w-xl space-y-3">
          <FormMessage state={state} />
          <TextField
            label="Name"
            name="name"
            required
            minLength={2}
            maxLength={COLLECTION_LIMITS.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fe.name}
            hint="A name other members will recognize, such as “Prayers for our school”."
          />
          {existing ? (
            <p role="status" className="text-meta text-text-secondary">
              “{existing.name}” already exists. You can add your prayer to it instead.
            </p>
          ) : null}
          <TextAreaField
            label="Short description"
            name="description"
            optional
            rows={2}
            maxLength={COLLECTION_LIMITS.description}
            defaultValue={state.status === "error" ? state.values?.description : ""}
            error={fe.description}
            hint="One or two sentences shown on the collection's card."
          />
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" pendingText="Creating…" icon={<FolderPlus className="size-4" aria-hidden="true" />} disabled={name.trim().length < 2}>
              Create collection
            </SubmitButton>
            <Button
              variant="ghost"
              size="sm"
              icon={<X className="size-4" aria-hidden="true" />}
              onClick={() => {
                setOpen(false);
                setName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
