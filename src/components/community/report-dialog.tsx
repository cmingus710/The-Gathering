"use client";

import { Flag } from "lucide-react";
import { useActionState, useId, useRef, useState } from "react";
import { reportAction } from "@/app/(member)/community/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { REPORT_REASONS } from "@/lib/community/types";
import { initialFormState } from "@/lib/forms";

/**
 * Report a post, reply, or the selected messages. Only the chosen items are
 * sent to moderators, never the rest of the conversation or discussion.
 */
export function ReportDialog({
  type,
  ids,
  label = "Report",
  what,
  compact,
}: {
  type: "thread" | "post" | "message";
  ids: string[];
  label?: string;
  /** e.g. "this reply" or "2 selected messages" */
  what: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(reportAction, initialFormState);
  const [details, setDetails] = useState("");
  const titleId = useId();
  const done = state.status === "success";
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => ref.current?.showModal()}
        aria-haspopup="dialog"
        disabled={!ids.length}
        icon={<Flag className="size-4" aria-hidden="true" />}
      >
        {compact ? <span className="sr-only">{label} {what}</span> : <>{label}<span className="sr-only"> {what}</span></>}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-6 text-text backdrop:bg-black/60"
      >
        <h2 id={titleId} className="text-xl font-bold">
          Report {what}
        </h2>
        {done ? (
          <div className="mt-4 space-y-4">
            <FormMessage state={state} />
            <Button variant="secondary" size="sm" onClick={() => ref.current?.close()} autoFocus>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="mt-4 space-y-4">
            <p className="text-[0.95rem] text-text-secondary">
              Moderators will see only {what}
              {type === "message" ? ", not the rest of your conversation" : ""}. If someone is in danger right now, call 911.
            </p>
            <FormMessage state={state} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="ids" value={ids.join(",")} />
            <fieldset className="space-y-2">
              <legend className="font-semibold">What&apos;s wrong?</legend>
              {REPORT_REASONS.map((r, i) => (
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
              <textarea
                name="details"
                maxLength={1000}
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className="block w-full rounded-control border border-border-strong bg-surface px-4 py-2.5"
              />
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
