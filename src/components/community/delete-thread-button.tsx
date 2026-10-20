"use client";

import { useActionState, type ReactNode } from "react";
import { deleteThreadAction } from "@/app/(member)/community/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { initialFormState } from "@/lib/forms";

export function DeleteThreadButton({ threadId, back, hasReplies, icon }: { threadId: string; back: string; hasReplies: boolean; icon: ReactNode }) {
  const [state, action] = useActionState(deleteThreadAction, initialFormState);
  return (
    <>
      <ConfirmDialog
        triggerVariant="ghost"
        trigger={<>{icon} Delete</>}
        title="Delete your discussion?"
        confirmLabel="Delete discussion"
        formAction={action}
        hidden={{ threadId, back }}
      >
        {hasReplies
          ? "Its title and text are erased. Because others replied, a “deleted” placeholder keeps their replies in place."
          : "It will be removed completely."}
      </ConfirmDialog>
      {state.status === "error" ? <FormMessage state={state} /> : null}
    </>
  );
}
