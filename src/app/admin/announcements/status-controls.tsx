"use client";

import { Archive, Undo2 } from "lucide-react";
import { useActionState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { setAnnouncementStatusAction } from "./actions";

export function AnnouncementStatusControls({ id, archived, canUnpublish }: { id: string; archived: boolean; canUnpublish: boolean }) {
  const [state, action] = useActionState(setAnnouncementStatusAction, initialFormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      {archived ? (
        <SubmitButton name="status" value="draft" variant="secondary" size="sm" pendingText="Restoring…" icon={<Undo2 className="size-4" aria-hidden="true" />}>
          Restore as draft
        </SubmitButton>
      ) : (
        <>
          {canUnpublish ? (
            <SubmitButton name="status" value="draft" variant="secondary" size="sm" pendingText="Moving…" icon={<Undo2 className="size-4" aria-hidden="true" />}>
              Unpublish to draft
            </SubmitButton>
          ) : null}
          <SubmitButton name="status" value="archived" variant="danger-outline" size="sm" pendingText="Archiving…" icon={<Archive className="size-4" aria-hidden="true" />}>
            Archive
          </SubmitButton>
        </>
      )}
    </form>
  );
}
