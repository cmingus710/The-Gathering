"use client";

import { Bookmark, BookmarkCheck, CircleCheck, Circle } from "lucide-react";
import { useOptimistic, useTransition } from "react";
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

/** Marks a reading assignment done (the member's own record). */
export function CompleteToggle({ id, done }: { id: string; done: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={optimistic}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          await completeAssignmentAction(id, !optimistic);
        })
      }
      className={cn(
        "inline-flex min-h-12 items-center gap-2 rounded-full border px-5 font-semibold transition-colors",
        optimistic ? "border-success bg-success-soft text-success" : "border-border-strong/60 bg-surface text-text hover:bg-surface-muted",
      )}
    >
      {optimistic ? <CircleCheck className="size-5" aria-hidden="true" /> : <Circle className="size-5" aria-hidden="true" />}
      {optimistic ? "Done" : "Mark as done"}
    </button>
  );
}
