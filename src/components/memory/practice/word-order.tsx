"use client";

import { Lightbulb, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/memory/types";
import { failureMessage, sessionHint } from "./api";

/**
 * Word order: tap (or press Enter on) a piece to place it next; tap a
 * placed piece to send it back. No dragging is needed. Every piece has its
 * own id from the server, so repeated words ("the world" three times) are
 * separate pieces, and identical pieces are interchangeable when checked.
 */
export function WordOrder({ session, kids, busy, onSubmit }: { session: Session; kids: boolean; busy: boolean; onSubmit: (p: Record<string, unknown>) => void }) {
  const chips = useMemo(() => session.setup.chips ?? [], [session.setup.chips]);
  const byId = useMemo(() => new Map(chips.map((c) => [c.id, c])), [chips]);
  const [placed, setPlaced] = useState<string[]>([]);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hinting, setHinting] = useState(false);
  const pool = chips.filter((c) => !placed.includes(c.id));

  const place = (id: string) => {
    setPlaced((p) => [...p, id]);
    setAnnounce(`Placed “${byId.get(id)?.text}” in position ${placed.length + 1} of ${chips.length}.`);
  };
  const unplace = (id: string) => {
    const at = placed.indexOf(id);
    setPlaced((p) => p.filter((x) => x !== id));
    setAnnounce(`Removed “${byId.get(id)?.text}” from position ${at + 1}. Pieces after it moved up.`);
  };
  const hint = async () => {
    setHinting(true);
    setError(null);
    const r = await sessionHint<{ position: number; id: string }>(session.id, { order: placed });
    setHinting(false);
    if (r.kind !== "ok") return setError(failureMessage(r));
    // Everything before the hinted position was right; keep it and place the hint.
    const keep = placed.slice(0, r.data.position - 1).filter((x) => x !== r.data.id);
    setPlaced([...keep, r.data.id]);
    setAnnounce(`Hint: position ${r.data.position} is “${byId.get(r.data.id)?.text}”.`);
  };

  return (
    <div className="space-y-5">
      <p className="text-text-secondary">
        {kids ? "Tap the words in the right order." : "Tap pieces in order to build the verse. Tap a placed piece to send it back."}
      </p>
      <section aria-labelledby="order-answer" className="rounded-card border border-border bg-surface p-4">
        <h3 id="order-answer" className="mb-2 text-meta font-semibold text-text-secondary">
          Your order ({placed.length} of {chips.length})
        </h3>
        {placed.length ? (
          <ol className="flex flex-wrap gap-2">
            {placed.map((id, n) => (
              <li key={id}>
                <Button variant="secondary" className="memory-control font-serif" onClick={() => unplace(id)} aria-label={`Position ${n + 1}: ${byId.get(id)?.text}. Send back.`}>
                  <span className="text-meta text-text-secondary" aria-hidden="true">
                    {n + 1}
                  </span>
                  {byId.get(id)?.text}
                  <X className="size-3.5 text-text-secondary" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-meta text-text-secondary">Nothing placed yet.</p>
        )}
      </section>
      <section aria-labelledby="order-pool">
        <h3 id="order-pool" className="mb-2 text-meta font-semibold text-text-secondary">
          Pieces to place
        </h3>
        {pool.length ? (
          <ul className="flex flex-wrap gap-2">
            {pool.map((c) => (
              <li key={c.id}>
                <Button variant="secondary" className="memory-control font-serif" onClick={() => place(c.id)}>
                  {c.text}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-text-secondary">All pieces are placed.</p>
        )}
      </section>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={!placed.length} onClick={() => unplace(placed[placed.length - 1])} icon={<Undo2 className="size-4" aria-hidden="true" />}>
          Undo
        </Button>
        <Button variant="ghost" size="sm" disabled={!placed.length} onClick={() => {
            setPlaced([]);
            setAnnounce("All pieces sent back.");
          }}
        >
          Start over
        </Button>
        <Button variant="ghost" size="sm" loading={hinting} onClick={hint} icon={<Lightbulb className="size-4" aria-hidden="true" />}>
          Hint
        </Button>
      </div>
      {error ? <Alert tone="error" title={error} /> : null}
      <Button className="memory-control" disabled={pool.length > 0} loading={busy} loadingText="Checking…" onClick={() => onSubmit({ order: placed })}>
        Check the order
      </Button>
    </div>
  );
}
