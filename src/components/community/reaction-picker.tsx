"use client";

import { SmilePlus } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { reactAction } from "@/app/(member)/community/actions";
import { cn } from "@/components/ui/cn";
import { REACTIONS, type ReactionKind, type Reactions } from "@/lib/community/types";

/**
 * Reaction state for one post or comment. Same rules as before: each of
 * Love, Praying, and Amen is its own on/off choice (a member may pick more
 * than one), the count changes at once, and the server's answer replaces it.
 */
export function useReactions(type: "thread" | "post", id: string, initial: Reactions | null) {
  const [reactions, setReactions] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(kind: ReactionKind) {
    if (!reactions) return;
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
  return { reactions, toggle, pending, error };
}

export type ReactionState = ReturnType<typeof useReactions>;

/** Small summary: the emoji of each reaction in use and the total. Zero counts are left out. */
export function ReactionSummary({ reactions, className }: { reactions: Reactions | null; className?: string }) {
  if (!reactions) return null;
  const used = REACTIONS.filter((r) => reactions[r.kind].count > 0);
  if (!used.length) return null;
  const total = used.reduce((n, r) => n + reactions[r.kind].count, 0);
  const spoken = used.map((r) => `${r.label} ${reactions[r.kind].count}`).join(", ");
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-meta text-text-secondary", className)}>
      <span aria-hidden="true" className="flex -space-x-1">
        {used.map((r) => (
          <span key={r.kind} className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-[0.8125rem] ring-2 ring-surface">
            {r.emoji}
          </span>
        ))}
      </span>
      <span aria-hidden="true" className="tabular-nums">
        {total}
      </span>
      <span className="sr-only">Reactions: {spoken}</span>
    </span>
  );
}

/**
 * The compact React control: one button opens a small picker of the three
 * reactions (each a toggle with aria-pressed and its name in text). It
 * opens by tap, click, Enter, or Space; Escape or a tap outside closes it.
 */
export function ReactionPicker({
  state,
  disabled,
  size = "md",
  what,
}: {
  state: ReactionState;
  disabled?: boolean;
  size?: "md" | "sm";
  /** e.g. "this post" (for screen readers) */
  what: string;
}) {
  const { reactions, toggle, pending, error } = state;
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!reactions) return null;
  const mine = REACTIONS.filter((r) => reactions[r.kind].mine);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-picker` : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control font-semibold hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-55",
          size === "sm" ? "px-2 text-meta" : "w-full px-3 text-[0.9375rem]",
          mine.length ? "text-primary" : "text-text-secondary",
        )}
      >
        {mine.length ? (
          <span aria-hidden="true" className="text-base">
            {mine.map((r) => r.emoji).join("")}
          </span>
        ) : (
          <SmilePlus className={size === "sm" ? "size-4" : "size-5"} aria-hidden="true" />
        )}
        <span>{mine.length === 1 ? mine[0].label : "React"}</span>
        <span className="sr-only"> to {what}</span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={`${id}-picker`}
          role="group"
          aria-label={`Reactions for ${what}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
          className="absolute bottom-full left-0 z-30 mb-1 flex gap-1 rounded-full border border-border bg-surface p-1 shadow-(--elev-lift)"
        >
          {REACTIONS.map((r) => {
            const s = reactions[r.kind];
            return (
              <button
                key={r.kind}
                type="button"
                aria-pressed={s.mine}
                disabled={pending}
                onClick={() => toggle(r.kind)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-meta font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-primary disabled:opacity-60",
                  s.mine ? "bg-primary-soft text-text ring-1 ring-primary" : "text-text-secondary hover:bg-surface-muted hover:text-text",
                )}
              >
                <span aria-hidden="true" className="text-lg">
                  {r.emoji}
                </span>
                <span>{r.label}</span>
                {s.count ? <span className="tabular-nums">{s.count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="absolute left-0 top-full z-20 mt-1 w-max max-w-[16rem] rounded-control bg-surface px-2 py-1 text-sm text-danger shadow-(--elev-lift)">
          {error}
        </p>
      ) : null}
    </div>
  );
}
