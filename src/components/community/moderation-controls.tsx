"use client";

import { EyeOff, Lock, LockOpen, Pin, PinOff, RotateCcw } from "lucide-react";
import { useActionState } from "react";
import { modPostAction, modThreadAction } from "@/app/(member)/community/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

export const reasonField = (required: boolean) => (
  <TextAreaField
    label="Reason (recorded, and shown to the author)"
    name="reason"
    required={required}
    minLength={required ? 3 : undefined}
    maxLength={500}
    rows={2}
    className="mb-4"
  />
);

/**
 * Moderator and group-leader tools for a thread. Every action is checked
 * again by the database (scope, and that leaders can't act on another
 * leader's content) and recorded in the moderation log.
 */
export function ThreadModeration({
  threadId,
  pinned,
  locked,
  status,
  reportId,
}: {
  threadId: string;
  pinned: boolean;
  locked: boolean;
  status: "visible" | "hidden" | "deleted";
  reportId?: string;
}) {
  const [state, action] = useActionState(modThreadAction, initialFormState);
  const hidden = { threadId, ...(reportId ? { reportId } : {}) };
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {status === "visible" ? (
          <form action={action}>
            <input type="hidden" name="threadId" value={threadId} />
            <input type="hidden" name="op" value={pinned ? "unpin" : "pin"} />
            <SubmitButton size="sm" variant="secondary" icon={pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}>
              {pinned ? "Unpin" : "Pin"}
            </SubmitButton>
          </form>
        ) : null}
        {locked ? (
          <form action={action}>
            <input type="hidden" name="threadId" value={threadId} />
            <input type="hidden" name="op" value="unlock" />
            <SubmitButton size="sm" variant="secondary" icon={<LockOpen className="size-4" aria-hidden="true" />}>
              Unlock
            </SubmitButton>
          </form>
        ) : (
          <ConfirmDialog
            triggerVariant="secondary"
            trigger={<><Lock className="size-4" aria-hidden="true" /> Lock</>}
            title="Lock this discussion?"
            confirmLabel="Lock discussion"
            formAction={action}
            hidden={{ ...hidden, op: "lock" }}
            fields={reasonField(false)}
          >
            No one can reply or edit until it&apos;s unlocked. It stays readable.
          </ConfirmDialog>
        )}
        {status === "visible" ? (
          <ConfirmDialog
            trigger={<><EyeOff className="size-4" aria-hidden="true" /> Hide</>}
            title="Hide this discussion?"
            confirmLabel="Hide discussion"
            formAction={action}
            hidden={{ ...hidden, op: "hide" }}
            fields={reasonField(true)}
          >
            Members will no longer see it. The text is kept so it can be restored, and the author is told.
          </ConfirmDialog>
        ) : status === "hidden" ? (
          <ConfirmDialog
            triggerVariant="secondary"
            trigger={<><RotateCcw className="size-4" aria-hidden="true" /> Restore</>}
            title="Restore this discussion?"
            confirmLabel="Restore"
            formAction={action}
            hidden={{ ...hidden, op: "restore" }}
            fields={reasonField(true)}
          />
        ) : null}
      </div>
    </div>
  );
}

export function PostModeration({ postId, threadId, status, reportId }: { postId: string; threadId: string; status: "visible" | "hidden" | "deleted"; reportId?: string }) {
  const [state, action] = useActionState(modPostAction, initialFormState);
  if (status === "deleted") return null;
  const hidden = { postId, threadId, ...(reportId ? { reportId } : {}) };
  return (
    <div className="space-y-2">
      <FormMessage state={state} />
      {status === "visible" ? (
        <ConfirmDialog
          trigger={<><EyeOff className="size-4" aria-hidden="true" /> Hide reply</>}
          title="Hide this reply?"
          confirmLabel="Hide reply"
          formAction={action}
          hidden={{ ...hidden, op: "hide" }}
          fields={reasonField(true)}
        >
          Members will see &ldquo;Removed by a moderator&rdquo; instead. The author is told.
        </ConfirmDialog>
      ) : (
        <ConfirmDialog
          triggerVariant="secondary"
          trigger={<><RotateCcw className="size-4" aria-hidden="true" /> Restore reply</>}
          title="Restore this reply?"
          confirmLabel="Restore"
          formAction={action}
          hidden={{ ...hidden, op: "restore" }}
          fields={reasonField(true)}
        />
      )}
    </div>
  );
}
