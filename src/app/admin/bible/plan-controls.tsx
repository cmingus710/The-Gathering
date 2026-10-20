"use client";

import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { coverAction, duplicatePlanAction, importStageAction, planStatusAction } from "./actions";

export function StatusControls({
  planId,
  status,
  featured,
  canPublish,
  audience,
}: {
  planId: string;
  status: "draft" | "published" | "archived";
  featured: boolean;
  canPublish: boolean;
  audience: "members" | "group";
}) {
  const [state, action] = useActionState(planStatusAction, initialFormState);
  const dialog = useRef<HTMLDialogElement>(null);
  if (!canPublish) return <p className="text-meta text-text-secondary">A reading plan publisher publishes, archives, and features plans.</p>;
  const btn = (act: string, label: string, variant: "primary" | "secondary" = "secondary") => (
    <form action={action}>
      <input type="hidden" name="id" value={planId} />
      <SubmitButton size="sm" variant={variant} name="action" value={act} pendingText="Saving…">
        {label}
      </SubmitButton>
    </form>
  );
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <>
            <Button size="sm" onClick={() => dialog.current?.showModal()} aria-haspopup="dialog">
              Publish…
            </Button>
            <dialog ref={dialog} aria-labelledby="publish-title" className="m-auto w-[min(30rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-6 text-text shadow-(--elev-lift) backdrop:bg-black/50">
              <h2 id="publish-title" className="font-display text-xl font-semibold">
                Publish this plan?
              </h2>
              <p className="mt-2 text-text-secondary">
                Members in its audience will see it and can join. After publishing, its schedule, translation, and audience are fixed; days are changed one at a time with a reason, and members&apos; history is kept.
              </p>
              <form action={action} onSubmit={() => dialog.current?.close()} className="mt-5 flex flex-wrap justify-end gap-2">
                <input type="hidden" name="id" value={planId} />
                <input type="hidden" name="action" value="publish" />
                <input type="hidden" name="confirm" value="publish" />
                <Button variant="secondary" size="sm" onClick={() => dialog.current?.close()} autoFocus>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Publish
                </Button>
              </form>
            </dialog>
          </>
        ) : null}
        {status === "published" ? btn("archive", "Archive") : null}
        {status === "archived" ? btn("restore", "Restore") : null}
        {status === "published" && audience === "members" ? (featured ? btn("unfeature", "Stop featuring") : btn("feature", "Make the featured church plan")) : null}
      </div>
    </div>
  );
}

export function DuplicateForm({ planId, title, mode, canEdit }: { planId: string; title: string; mode: "calendar" | "personal"; canEdit: boolean }) {
  const [state, action] = useActionState(duplicatePlanAction, initialFormState);
  if (!canEdit) return null;
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={planId} />
      <TextField label="Title of the copy" name="title" defaultValue={`${title} (next version)`} maxLength={120} />
      <CheckboxField name="new_version" label="This is the next version of this plan" defaultChecked hint="Recorded on the copy, so you can see which plan it replaces." />
      {mode === "calendar" ? <TextField label="Move dates by (days)" name="shift_days" type="number" min={-800} max={800} defaultValue="0" hint="For example 365 or 366 for next year." /> : null}
      <SubmitButton variant="secondary" size="sm" pendingText="Copying…">
        Duplicate as a draft
      </SubmitButton>
    </form>
  );
}

export function CoverForm({ planId, hasCover, alt }: { planId: string; hasCover: boolean; alt: string | null }) {
  const [state, action] = useActionState(coverAction, initialFormState);
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={planId} />
        <TextField label="Cover image" name="cover" type="file" accept="image/png,image/jpeg,image/webp" hint="PNG, JPEG, or WebP up to 4 MB. Re-encoded without location data." />
        <TextField label="Image description" name="cover_alt" defaultValue={alt ?? ""} maxLength={300} optional hint="For people using screen readers." />
        <SubmitButton variant="secondary" size="sm" pendingText="Uploading…">
          {hasCover ? "Replace cover" : "Add cover"}
        </SubmitButton>
      </form>
      {hasCover ? (
        <form action={action}>
          <input type="hidden" name="id" value={planId} />
          <input type="hidden" name="remove" value="1" />
          <SubmitButton variant="ghost" size="sm" pendingText="Removing…">
            Remove cover
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

export function ImportForm({ planId }: { planId: string }) {
  const [state, action] = useActionState(importStageAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="plan_id" value={planId} />
      <TextField
        label="Spreadsheet"
        name="file"
        type="file"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        required
        hint="Excel (.xlsx) or CSV, up to 1 MB and 2,000 days. From Google Sheets or Numbers, download or export as .xlsx. You'll see a preview with any problems before anything changes."
      />
      <SubmitButton variant="secondary" size="sm" pendingText="Checking…">
        Preview import
      </SubmitButton>
    </form>
  );
}
