"use client";

import { useState, useTransition } from "react";
import { reactAction } from "@/app/(member)/community/actions";
import { cn } from "@/components/ui/cn";
import { REACTIONS, type Reactions } from "@/lib/community/types";

/**
 * Simple reactions. Each is a toggle button with its name and count in text
 * (aria-pressed shows whether you reacted), so nothing relies on emoji or
 * colour alone. The server's answer replaces the optimistic count.
 */
export function ReactionBar({ type, id, initial, disabled }: { type: "thread" | "post"; id: string; initial: Reactions; disabled?: boolean }) {
  const [reactions, setReactions] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(kind: keyof Reactions) {
    const on = !reactions[kind].mine;
    const previous = reactions;
    setReactions({ ...reactions, [kind]: { count: Math.max(0, reactions[kind].count + (on ? 1 : -1)), mine: on } });
    setError(null);
    start(async () => {
      const result = await reactAction({ type, id, kind, on });
      if (result.ok) setReactions(result.reactions);
      else {
        setReactions(previous);
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {REACTIONS.map((r) => {
        const state = reactions[r.kind];
        return (
          <button
            key={r.kind}
            type="button"
            aria-pressed={state.mine}
            disabled={disabled || pending}
            onClick={() => toggle(r.kind)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors disabled:opacity-60",
              state.mine ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:text-text",
            )}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <span>{r.label}</span>
            <span className="tabular-nums">{state.count}</span>
          </button>
        );
      })}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
