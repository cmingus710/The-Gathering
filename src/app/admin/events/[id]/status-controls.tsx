"use client";

import { useActionState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { SeriesStatus } from "@/lib/events/types";
import { eventStatusAction } from "../actions";

/** Lifecycle: draft → published (now or scheduled) → canceled → archived. */
export function StatusControls({ id, status, timezone, hasRegistrations }: { id: string; status: SeriesStatus; timezone: string; hasRegistrations: boolean }) {
  const [state, action] = useActionState(eventStatusAction, initialFormState);
  const hidden = { id, timezone };
  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      {status === "draft" ? (
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="timezone" value={timezone} />
          <input type="hidden" name="action" value="publish" />
          <TextField
            label="Publish at"
            name="publishAt"
            type="datetime-local"
            optional
            error={state.fieldErrors?.publishAt}
            hint={`Leave blank to publish now. Time zone: ${timezone.replace(/_/g, " ")}.`}
          />
          <SubmitButton pendingText="Publishing…">Publish</SubmitButton>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === "published" && !hasRegistrations ? (
          <ConfirmDialog triggerVariant="secondary" trigger="Unpublish" title="Unpublish this event?" confirmLabel="Unpublish" formAction={action} hidden={{ ...hidden, action: "unpublish" }}>
            It becomes a draft and disappears from the calendar and feeds. Nobody is emailed (nobody has registered).
          </ConfirmDialog>
        ) : null}
        {status === "published" ? (
          <CancelDialog action={action} hidden={hidden} hasRegistrations={hasRegistrations} />
        ) : null}
        {status !== "archived" && !(status === "published" && hasRegistrations) ? (
          <ConfirmDialog triggerVariant="secondary" trigger="Archive" title="Archive this event?" confirmLabel="Archive" formAction={action} hidden={{ ...hidden, action: "archive" }}>
            Archived events are hidden from members and calendar feeds. The record and its registrations are kept.
          </ConfirmDialog>
        ) : null}
        {status === "archived" ? (
          <ConfirmDialog triggerVariant="secondary" trigger="Restore as draft" title="Restore this event?" confirmLabel="Restore" formAction={action} hidden={{ ...hidden, action: "restore" }}>
            It becomes a draft you can edit and publish again.
          </ConfirmDialog>
        ) : null}
      </div>
    </div>
  );
}

function CancelDialog({ action, hidden, hasRegistrations }: { action: (fd: FormData) => void; hidden: Record<string, string>; hasRegistrations: boolean }) {
  return (
    <form action={action} className="w-full space-y-2 rounded-card border border-danger/40 p-4">
      <input type="hidden" name="id" value={hidden.id} />
      <input type="hidden" name="timezone" value={hidden.timezone} />
      <input type="hidden" name="action" value="cancel" />
      <TextField label="Reason for canceling (shown to members)" name="reason" optional maxLength={500} />
      <p className="text-sm text-text-secondary">
        The event stays on the calendar marked canceled, and calendar feeds show the cancellation.
        {hasRegistrations ? " Everyone registered or waitlisted for upcoming dates is emailed." : ""}
      </p>
      <SubmitButton variant="danger-outline" pendingText="Canceling…">
        Cancel this event
      </SubmitButton>
    </form>
  );
}
