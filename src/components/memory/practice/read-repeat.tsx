"use client";

import { Eye, EyeOff, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Session, Token } from "@/lib/memory/types";
import { TokenText } from "./token-text";

const LEVELS = ["Showing every word", "Every third word hidden", "Two of every three words hidden", "Every word hidden"];

/**
 * Read & repeat: read the verse, then hide words step by step and say it
 * again. Reveal whenever you like (counted as a look, not a mistake).
 * Nothing here is scored.
 */
export function ReadRepeat({ session, onSubmit, busy }: { session: Session; onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const tokens = useMemo(() => session.setup.tokens ?? [], [session.setup.tokens]);
  const [level, setLevel] = useState(0);
  const [showing, setShowing] = useState(false);
  const [reveals, setReveals] = useState(0);
  const [maxLevel, setMaxLevel] = useState(0);
  // Word positions among real words (punctuation-only tokens never hide).
  const order = useMemo(() => {
    let n = 0;
    return new Map(tokens.filter((t) => t.w).map((t) => [t.i, n++]));
  }, [tokens]);
  const hidden = (t: Token) => {
    if (showing || level === 0 || !t.w) return false;
    const n = order.get(t.i) ?? 0;
    return level >= 3 || (level === 1 ? n % 3 === 2 : n % 3 !== 0);
  };
  const change = (to: number) => {
    const next = Math.max(0, Math.min(3, to));
    setLevel(next);
    setMaxLevel((m) => Math.max(m, next));
    setShowing(false);
  };
  return (
    <div className="space-y-5">
      <p className="text-text-secondary">Read the verse aloud. Then hide some words and say it again, filling in the gaps from memory.</p>
      <div className="rounded-card border border-border bg-surface p-4 sm:p-6">
        <TokenText tokens={tokens} isHidden={hidden} label={`${session.label}, ${LEVELS[showing ? 0 : level].toLowerCase()}`} />
      </div>
      <p className="text-meta font-semibold text-text-secondary" aria-live="polite">
        {showing ? "Showing every word" : LEVELS[level]}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="memory-control" onClick={() => change(level + 1)} disabled={level >= 3} icon={<Plus className="size-4" aria-hidden="true" />}>
          Hide more
        </Button>
        <Button variant="secondary" className="memory-control" onClick={() => change(level - 1)} disabled={level <= 0} icon={<Minus className="size-4" aria-hidden="true" />}>
          Hide less
        </Button>
        <Button
          variant="ghost"
          className="memory-control"
          aria-pressed={showing}
          onClick={() => {
            if (!showing) setReveals((r) => r + 1);
            setShowing((s) => !s);
          }}
          disabled={level === 0}
          icon={showing ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        >
          {showing ? "Hide again" : "Show every word"}
        </Button>
      </div>
      <Button className="memory-control" onClick={() => onSubmit({ level: maxLevel, reveals })} loading={busy} loadingText="Saving…">
        I&apos;m done
      </Button>
    </div>
  );
}
