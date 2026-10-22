"use client";

import { Archive, CheckCircle2, CircleSlash, EyeOff, RotateCcw, Trash2, UserSearch } from "lucide-react";
import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import { deleteRequestAction, identityLookupAction, statusAction } from "@/app/(app)/(member)/prayer/actions";
import { prayerModAction } from "@/app/admin/prayer/actions";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { AUDIENCE_LABEL } from "@/lib/prayer/format";
import type { Audience, RequestStatus } from "@/lib/prayer/types";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * A button that opens a dialog with an optional reason and submits a form
 * action, announcing the result. Used for status changes, deletion,
 * moderation, and identity lookup.
 */
export function DialogAction({
  action,
  hidden,
  trigger,
  icon,
  variant = "ghost",
  title,
  children,
  confirmLabel,
  confirmVariant = "primary",
  reason,
}: {
  action: Action;
  hidden: Record<string, string>;
  trigger: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  /** Ask for a reason (moderation, identity lookup). */
  reason?: { label: string; minLength: number };
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, initialFormState);
  const [text, setText] = useState("");
  const titleId = useId();
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => ref.current?.showModal()} aria-haspopup="dialog" icon={icon}>
        {trigger}
      </Button>
      {state.status === "success" ? (
        <span role="status" className="text-meta text-success">
          {state.message}
        </span>
      ) : null}
      <dialog ref={ref} aria-labelledby={titleId} className="m-auto w-[min(30rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-6 text-text shadow-(--elev-lift) backdrop:bg-black/50">
        <h2 id={titleId} className="font-display text-xl font-semibold">
          {title}
        </h2>
        {children ? <div className="mt-2 space-y-2 text-text-secondary">{children}</div> : null}
        <form
          action={(fd) => {
            formAction(fd);
          }}
          className="mt-5 space-y-4"
        >
          {state.status === "error" ? <FormMessage state={state} /> : null}
          {state.status === "success" ? <FormMessage state={state} /> : null}
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {reason ? (
            <label className="block space-y-1.5">
              <span className="font-semibold">{reason.label}</span>
              <textarea name="reason" required minLength={reason.minLength} maxLength={500} rows={3} value={text} onChange={(e) => setText(e.target.value)} className="block w-full rounded-control border border-border-strong bg-surface px-4 py-2.5" />
            </label>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => ref.current?.close()} autoFocus>
              {state.status === "success" ? "Close" : "Cancel"}
            </Button>
            {state.status === "success" ? null : (
              <SubmitButton size="sm" variant={confirmVariant} pendingText="Working…">
                {confirmLabel}
              </SubmitButton>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Author controls: answered, close, reopen, archive, restore, delete. */
export function AuthorStatusControls({ id, status, audience, groupName }: { id: string; status: RequestStatus; audience: Audience; groupName: string | null }) {
  const audienceName = audience === "group" ? (groupName ?? "your group") : AUDIENCE_LABEL[audience].toLowerCase();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "open" && audience !== "private" ? (
        <DialogAction action={statusAction} hidden={{ requestId: id, status: "answered" }} trigger="Mark answered" icon={<CheckCircle2 className="size-4" aria-hidden="true" />} title="Mark this prayer answered?" confirmLabel="Mark answered">
          <p>It stays visible to the same audience, with an “Answered” label. People following it are told (without the details).</p>
          <p>To share how it was answered, add an update and tick “This prayer was answered”.</p>
        </DialogAction>
      ) : null}
      {status === "open" || status === "answered" ? (
        <DialogAction action={statusAction} hidden={{ requestId: id, status: "closed" }} trigger="Close" icon={<CircleSlash className="size-4" aria-hidden="true" />} title="Close this request?" confirmLabel="Close request">
          <p>It stays readable by the same audience, but no longer takes comments or prayers and leaves the main feed.</p>
        </DialogAction>
      ) : null}
      {status === "closed" ? (
        <DialogAction action={statusAction} hidden={{ requestId: id, status: "open" }} trigger="Reopen" icon={<RotateCcw className="size-4" aria-hidden="true" />} title="Reopen this request?" confirmLabel="Reopen">
          <p>It returns to the feed for {audienceName}.</p>
        </DialogAction>
      ) : null}
      {status !== "archived" ? (
        <DialogAction action={statusAction} hidden={{ requestId: id, status: "archived" }} trigger="Archive" icon={<Archive className="size-4" aria-hidden="true" />} title="Archive this request?" confirmLabel="Archive">
          <p>Only you will be able to see it. Followers stop getting updates. You can restore it later.</p>
        </DialogAction>
      ) : (
        <DialogAction action={statusAction} hidden={{ requestId: id, status: "closed", confirm: audience }} trigger="Restore" icon={<RotateCcw className="size-4" aria-hidden="true" />} title={`Restore and show it to ${audienceName}?`} confirmLabel="Yes, restore">
          <p>Restoring makes it readable again by {audienceName} (as a closed request). To keep it private, edit the audience to “Private draft” first.</p>
        </DialogAction>
      )}
      <DialogAction action={deleteRequestAction} hidden={{ requestId: id }} trigger="Delete" icon={<Trash2 className="size-4" aria-hidden="true" />} variant="danger-outline" confirmVariant="danger" title="Delete this request permanently?" confirmLabel="Delete">
        <p>The request, its updates, comments, and prayers are deleted for everyone. This can&apos;t be undone.</p>
      </DialogAction>
    </div>
  );
}

/** Moderator controls on a request (scope checked by the database). */
export function RequestModeration({ id, hidden, locked, reportId }: { id: string; hidden: boolean; locked: boolean; reportId?: string }) {
  const base = { type: "request", id, requestId: id, ...(reportId ? { reportId } : {}) };
  const reason = { label: "Reason (shown to the author)", minLength: 3 };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DialogAction action={prayerModAction} hidden={{ ...base, action: hidden ? "restore" : "hide" }} trigger={hidden ? "Restore request" : "Hide request"} icon={<EyeOff className="size-4" aria-hidden="true" />} title={hidden ? "Restore this request?" : "Hide this request?"} confirmLabel={hidden ? "Restore" : "Hide"} reason={reason}>
        <p>{hidden ? "Readers will see it again." : "Only the author will still see it, with a notice."} The action is logged.</p>
      </DialogAction>
      <DialogAction action={prayerModAction} hidden={{ ...base, action: locked ? "unlock" : "lock" }} trigger={locked ? "Unlock comments" : "Lock comments"} title={locked ? "Allow comments again?" : "Lock comments?"} confirmLabel={locked ? "Unlock" : "Lock"} reason={reason} />
    </div>
  );
}

export function CommentModeration({ commentId, requestId, status, reportId }: { commentId: string; requestId: string; status: "visible" | "hidden" | "deleted"; reportId?: string }) {
  if (status === "deleted") return null;
  const restore = status === "hidden";
  return (
    <DialogAction
      action={prayerModAction}
      hidden={{ type: "comment", id: commentId, requestId, action: restore ? "restore" : "hide", ...(reportId ? { reportId } : {}) }}
      trigger={restore ? "Restore comment" : "Hide comment"}
      icon={<EyeOff className="size-4" aria-hidden="true" />}
      title={restore ? "Restore this comment?" : "Hide this comment?"}
      confirmLabel={restore ? "Restore" : "Hide"}
      reason={{ label: "Reason (shown to the author)", minLength: 3 }}
    />
  );
}

/** Audited identity lookup for an anonymous request (prayer.identity only). */
export function IdentityLookup({ requestId }: { requestId: string }) {
  return (
    <DialogAction
      action={identityLookupAction}
      hidden={{ requestId }}
      trigger="Look up author"
      icon={<UserSearch className="size-4" aria-hidden="true" />}
      title="Look up who wrote this?"
      confirmLabel="Look up"
      reason={{ label: "Why do you need to know? (recorded)", minLength: 10 }}
    >
      <p>Use this only when pastoral care or safety requires it. Your name, the time, and your reason are recorded and visible to other leads. The author isn&apos;t notified.</p>
    </DialogAction>
  );
}
