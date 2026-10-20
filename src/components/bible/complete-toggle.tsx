"use client";

import { Check, Circle } from "lucide-react";
import { useState, useTransition } from "react";
import { completeDayAction } from "@/app/(member)/bible/actions";
import { Button } from "@/components/ui/button";

/** Mark a reading done (or not). Opening a reading never marks it. */
export function CompleteToggle({ dayId, completed: initial, disabled }: { dayId: string; completed: boolean; disabled?: boolean }) {
  const [completed, setCompleted] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <Button
        variant={completed ? "secondary" : "primary"}
        aria-pressed={completed}
        disabled={disabled || pending}
        loading={pending}
        loadingText="Saving…"
        icon={completed ? <Check className="size-5 text-success" aria-hidden="true" /> : <Circle className="size-5" aria-hidden="true" />}
        onClick={() =>
          start(async () => {
            const r = await completeDayAction(dayId, !completed);
            if (r.ok) {
              setCompleted(r.completed);
              setError(null);
            } else setError(r.message);
          })
        }
      >
        {completed ? "Read" : "Mark as read"}
      </Button>
      <p role="status" className="mt-1 text-meta text-text-secondary">
        {error ?? (completed ? "Marked as read. Select again to undo." : "")}
      </p>
    </div>
  );
}
