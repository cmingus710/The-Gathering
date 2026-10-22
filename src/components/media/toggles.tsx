"use client";

import { Bookmark, BookmarkCheck, CircleCheck, Circle } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { cn } from "@/components/ui/cn";
import { completeAssignmentAction, toggleBookmarkAction } from "@/lib/media/member-actions";

/** Save for later (private to the member). */
export function BookmarkButton({ type, id, saved, label }: { type: "item" | "show"; id: string; saved: boolean; label: string }) {
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={optimistic}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          await toggleBookmarkAction(type, id, !optimistic);
        })
      }
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-meta font-semibold transition-colors",
        optimistic ? "border-primary bg-primary-soft text-primary" : "border-border-strong/60 bg-surface text-text hover:bg-surface-muted",
      )}
    >
      {optimistic ? <BookmarkCheck className="size-4" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
      {optimistic ? "Saved" : "Save"}
      <span className="sr-only"> {label}</span>
    </button>
  );
}

/** Marks a reading assignment done (the member's own record); pressing again undoes it. */
export function CompleteToggle({ id, done, label }: { id: string; done: boolean; label?: string }) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={optimistic}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setFailed(false);
            setOptimistic(!optimistic);
            const r = await completeAssignmentAction(id, !optimistic);
            if (!r.ok) setFailed(true);
          })
        }
        className={cn(
          "inline-flex min-h-12 items-center gap-2 rounded-full border px-5 font-semibold transition-colors",
          optimistic ? "border-success bg-success-soft text-success" : "border-border-strong/60 bg-surface text-text hover:bg-surface-muted",
        )}
      >
        {optimistic ? <CircleCheck className="size-5" aria-hidden="true" /> : <Circle className="size-5" aria-hidden="true" />}
        {optimistic ? "Done" : "Mark as done"}
        {label ? <span className="sr-only">: {label}</span> : null}
      </button>
      <span role="status" className={failed ? "text-meta font-semibold text-danger" : "sr-only"}>
        {failed ? "That didn't save. Try again." : ""}
      </span>
    </span>
  );
}
