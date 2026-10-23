"use client";

import { Archive, Plus, RotateCcw } from "lucide-react";
import { useActionState } from "react";
import { categoryArchiveAction, categorySaveAction } from "@/app/admin/prayer/library/actions";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { KIND_LABEL, type AdminCategory, type CategoryKind } from "@/lib/prayer/library";

/** Add a topic, purpose, or use. */
export function AddCategoryForm({ kind }: { kind: CategoryKind }) {
  const [state, action] = useActionState(categorySaveAction, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField label={`New ${KIND_LABEL[kind].toLowerCase()}`} name="name" id={`new-${kind}`} required minLength={2} maxLength={60} className="min-w-0 flex-1" defaultValue={state.status === "error" ? state.values?.name : ""} key={state.status === "success" ? state.message : "form"} />
        <TextField label="Order" name="sortOrder" id={`new-${kind}-order`} type="number" min={0} max={10000} defaultValue="200" className="w-28" />
        <SubmitButton size="sm" variant="secondary" pendingText="Adding…" icon={<Plus className="size-4" aria-hidden="true" />}>
          Add
        </SubmitButton>
      </div>
    </form>
  );
}

/** Rename or reorder one category, and archive or restore it. */
export function CategoryRow({ category }: { category: AdminCategory }) {
  const [state, save] = useActionState(categorySaveAction, initialFormState);
  const [archiveState, archive] = useActionState(categoryArchiveAction, initialFormState);
  return (
    <div className="space-y-2 px-4 py-3">
      <form action={save} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="categoryId" value={category.id} />
        <TextField label="Name" name="name" id={`cat-${category.id}`} required minLength={2} maxLength={60} defaultValue={category.name} className="min-w-0 flex-1" />
        <TextField label="Order" name="sortOrder" id={`cat-${category.id}-order`} type="number" min={0} max={10000} defaultValue={String(category.sort_order)} className="w-28" />
        <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
          Save<span className="sr-only"> {category.name}</span>
        </SubmitButton>
      </form>
      <form action={archive} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="categoryId" value={category.id} />
        <input type="hidden" name="archived" value={String(!category.archived)} />
        <span className="text-meta text-text-secondary">
          {category.archived ? "Archived · " : ""}
          {category.published_count} published {category.published_count === 1 ? "prayer" : "prayers"}
        </span>
        <SubmitButton size="sm" variant="ghost" pendingText="Saving…" icon={category.archived ? <RotateCcw className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}>
          {category.archived ? "Restore" : "Archive"}
          <span className="sr-only"> {category.name}</span>
        </SubmitButton>
      </form>
      {state.status !== "idle" ? <FormMessage state={state} /> : null}
      {archiveState.status === "error" ? <FormMessage state={archiveState} /> : null}
    </div>
  );
}
