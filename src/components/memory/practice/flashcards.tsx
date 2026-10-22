"use client";

import { RotateCw } from "lucide-react";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/memory/types";
import { failureMessage, sessionReveal, type RevealResponse } from "./api";
import { ProviderText } from "./provider-text";
import { ConfidencePicker } from "./confidence";

/**
 * Flashcards: one side shows the reference (or, for reference practice,
 * the verse), the other side is fetched only when the member flips it, so
 * nothing hidden is in the page (or a screen reader) beforehand.
 */
export function Flashcards({ session, kids, busy, onSubmit }: { session: Session; kids: boolean; busy: boolean; onSubmit: (p: Record<string, unknown>) => void }) {
  const toRef = session.setup.direction === "text_to_ref";
  const [back, setBack] = useState<string | null>(null);
  const [licensed, setLicensed] = useState<RevealResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const backRef = useRef<HTMLDivElement>(null);
  const flip = async () => {
    setLoading(true);
    setError(null);
    const r = await sessionReveal(session.id);
    setLoading(false);
    if (r.kind !== "ok") return setError(failureMessage(r));
    setBack(toRef ? r.data.reference : (r.data.text ?? ""));
    if (r.data.verses) setLicensed(r.data);
    requestAnimationFrame(() => backRef.current?.focus());
  };
  return (
    <div className="space-y-5">
      <p className="text-text-secondary">
        {toRef ? "Read the verse and say its reference. Then flip the card to check." : "Say the verse from memory. Then flip the card to check."}
      </p>
      <div className="rounded-card border border-border-strong/60 bg-surface p-5 shadow-(--elev-card) sm:p-8">
        <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-text-secondary">Front</p>
        <p className={toRef ? "memory-text" : "font-display text-display font-semibold"}>{session.setup.front}</p>
      </div>
      {back === null ? (
        <Button className="memory-control" onClick={flip} loading={loading} loadingText="Flipping…" icon={<RotateCw className="size-4" aria-hidden="true" />}>
          Flip the card
        </Button>
      ) : (
        <>
          <div ref={backRef} tabIndex={-1} className="rounded-card border border-primary/50 bg-primary-soft/40 p-5 outline-none focus-visible:outline-3 focus-visible:outline-primary sm:p-8">
            <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-text-secondary">Back</p>
            {licensed?.verses ? (
              <ProviderText verses={licensed.verses} copyright={licensed.copyright ?? null} fumsId={licensed.fums_id ?? null} session={session} label={session.reference} />
            ) : (
              <p className={toRef ? "font-display text-display font-semibold" : "memory-text"}>{back}</p>
            )}
          </div>
          <ConfidencePicker kids={kids} busy={busy} onChoose={(c) => onSubmit({ confidence: c })} />
        </>
      )}
      {error ? <Alert tone="error" title={error} /> : null}
    </div>
  );
}
