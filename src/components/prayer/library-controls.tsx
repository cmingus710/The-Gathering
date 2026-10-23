"use client";

import { Archive, Check, Copy, EyeOff, FilePen, Flag, RotateCcw, Send } from "lucide-react";
import { useActionState, useId, useRef, useState } from "react";
import { libraryReportAction, libraryStatusAction } from "@/app/(app)/(member)/prayer/library/actions";
import { libraryModAction } from "@/app/admin/prayer/library/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { LIBRARY_LIMITS, LIBRARY_REPORT_REASONS, type LibraryStatus } from "@/lib/prayer/library";
import { DialogAction } from "./controls";

/**
 * Copies the whole prayer with its attribution (see copyText). Uses the
 * Clipboard API, with a selectable fallback when it isn't available.
 */
export function CopyPrayerButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const fallbackId = useId();
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        icon={state === "copied" ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        {state === "copied" ? "Copied" : "Copy prayer"}
      </Button>
      <span role="status" className="sr-only">
        {state === "copied" ? "The prayer and its attribution were copied." : ""}
      </span>
      {state === "failed" ? (
        <div className="space-y-1">
          <label htmlFor={fallbackId} className="block text-meta font-semibold">
            Copying isn&apos;t available here. Select the text below and copy it.
          </label>
          <textarea id={fallbackId} readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} className="block w-full rounded-control border border-border-strong bg-surface px-4 py-2.5 text-meta" />
        </div>
      ) : null}
    </div>
  );
}

/** The contributor's lifecycle buttons. */
export function LibraryAuthorControls({ id, status, modArchived, postingRestricted }: { id: string; status: LibraryStatus; modArchived: boolean; postingRestricted: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && !postingRestricted ? (
        <DialogAction action={libraryStatusAction} hidden={{ prayerId: id, status: "published" }} trigger="Publish" variant="primary" icon={<Send className="size-4" aria-hidden="true" />} title="Publish this prayer?" confirmLabel="Publish">
          <p>Approved church members will be able to find, read, save, and copy it right away. You can edit or archive it later.</p>
        </DialogAction>
      ) : null}
      {status === "published" ? (
        <DialogAction action={libraryStatusAction} hidden={{ prayerId: id, status: "draft" }} trigger="Move to drafts" icon={<FilePen className="size-4" aria-hidden="true" />} title="Move this prayer back to your drafts?" confirmLabel="Move to drafts">
          <p>It leaves the library until you publish it again. Only you will see it.</p>
        </DialogAction>
      ) : null}
      {status !== "archived" ? (
        <DialogAction action={libraryStatusAction} hidden={{ prayerId: id, status: "archived" }} trigger="Archive" icon={<Archive className="size-4" aria-hidden="true" />} title="Archive this prayer?" confirmLabel="Archive">
          <p>It leaves the library and anyone&apos;s saved prayers. Only you will see it, and you can restore it later.</p>
        </DialogAction>
      ) : !modArchived && !postingRestricted ? (
        <DialogAction action={libraryStatusAction} hidden={{ prayerId: id, status: "published" }} trigger="Restore and publish" icon={<RotateCcw className="size-4" aria-hidden="true" />} title="Restore this prayer?" confirmLabel="Restore and publish">
          <p>It returns to the library with its original publication date.</p>
        </DialogAction>
      ) : null}
    </div>
  );
}

/** Moderator actions on a library prayer (each needs a reason and is recorded). */
export function LibraryModeration({ id, hidden, modArchived, status, reportId }: { id: string; hidden: boolean; modArchived: boolean; status: LibraryStatus; reportId?: string }) {
  const base = { prayerId: id, ...(reportId ? { reportId } : {}) };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hidden && status === "published" ? (
        <DialogAction action={libraryModAction} hidden={{ ...base, action: "hide" }} trigger="Hide" variant="danger-outline" icon={<EyeOff className="size-4" aria-hidden="true" />} title="Hide this prayer?" confirmLabel="Hide" confirmVariant="danger" reason={{ label: "Reason (recorded in the moderation log)", minLength: 3 }}>
          <p>It disappears from the library, search, and saved prayers at once, and its link stops working for members. The contributor still sees it, marked hidden.</p>
        </DialogAction>
      ) : null}
      {status === "published" ? (
        <DialogAction action={libraryModAction} hidden={{ ...base, action: "archive" }} trigger="Archive" icon={<Archive className="size-4" aria-hidden="true" />} title="Archive this prayer?" confirmLabel="Archive" reason={{ label: "Reason (recorded in the moderation log)", minLength: 3 }}>
          <p>It leaves the library and the contributor can&apos;t republish it. Use this for duplicates or prayers that no longer belong; a moderator can restore it.</p>
        </DialogAction>
      ) : null}
      {hidden || modArchived ? (
        <DialogAction action={libraryModAction} hidden={{ ...base, action: "restore" }} trigger="Restore" icon={<RotateCcw className="size-4" aria-hidden="true" />} title="Restore this prayer?" confirmLabel="Restore" reason={{ label: "Reason (recorded in the moderation log)", minLength: 3 }}>
          <p>It returns to the library{modArchived ? " as published" : ""}.</p>
        </DialogAction>
      ) : null}
    </div>
  );
}

/** Report a library prayer. Prayer moderators see a copy of it as it was when reported. */
export function LibraryReportDialog({ id, reported }: { id: string; reported: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(libraryReportAction, initialFormState);
  const [details, setDetails] = useState("");
  const titleId = useId();
  if (reported && state.status !== "success") {
    return <p className="text-meta text-text-secondary">You reported this prayer. A prayer moderator will review it.</p>;
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => ref.current?.showModal()} aria-haspopup="dialog" icon={<Flag className="size-4" aria-hidden="true" />}>
        Report<span className="sr-only"> this prayer</span>
      </Button>
      <dialog ref={ref} aria-labelledby={titleId} className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-6 text-text backdrop:bg-black/60">
        <h2 id={titleId} className="text-xl font-bold">
          Report this prayer
        </h2>
        {state.status === "success" ? (
          <div className="mt-4 space-y-4">
            <FormMessage state={state} />
            <Button variant="secondary" size="sm" onClick={() => ref.current?.close()} autoFocus>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="mt-4 space-y-4">
            <p className="text-meta text-text-secondary">A prayer moderator will review it. The person who shared it isn&apos;t told who reported it.</p>
            <FormMessage state={state} />
            <input type="hidden" name="id" value={id} />
            <fieldset className="space-y-2">
              <legend className="font-semibold">What&apos;s wrong?</legend>
              {LIBRARY_REPORT_REASONS.map((r, i) => (
                <label key={r.value} className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input type="radio" name="reason" value={r.value} required defaultChecked={i === 0} className="size-5 accent-primary" />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <label className="block space-y-1.5">
              <span className="font-semibold">
                Anything else? <span className="font-normal text-text-secondary">(optional)</span>
              </span>
              <textarea name="details" maxLength={LIBRARY_LIMITS.report} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} className="block w-full rounded-control border border-border-strong bg-surface px-4 py-2.5" />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => ref.current?.close()}>
                Cancel
              </Button>
              <SubmitButton size="sm" pendingText="Sending…">
                Send report
              </SubmitButton>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
