"use client";

import { Eye, Lightbulb } from "lucide-react";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/memory/types";
import { failureMessage, sessionHint, sessionReveal, type RevealResponse } from "./api";
import { ProviderText } from "./provider-text";
import { ConfidencePicker } from "./confidence";

/**
 * Self-check recitation: only the reference is shown. The member recites
 * away from the screen, reveals the verse, and records how it went. This
 * is the member's own check; it never claims to prove memorization, and
 * nothing is recorded or listened to (no microphone).
 */
export function SelfCheck({
  session,
  kids,
  busy,
  hint,
  provider = false,
  onSubmit,
}: {
  session: Session;
  kids: boolean;
  busy: boolean;
  hint: string | null;
  /** A licensed version: no "how it begins" hints (they'd show part of the text). */
  provider?: boolean;
  onSubmit: (p: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [licensed, setLicensed] = useState<RevealResponse | null>(null);
  const [firstWords, setFirstWords] = useState<{ words: string; more: boolean } | null>(null);
  const [showEditorial, setShowEditorial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"reveal" | "hint" | null>(null);
  const revealed = useRef<HTMLDivElement>(null);
  const reveal = async () => {
    setLoading("reveal");
    setError(null);
    const r = await sessionReveal(session.id);
    setLoading(null);
    if (r.kind !== "ok") return setError(failureMessage(r));
    setText(r.data.text ?? "");
    if (r.data.verses) setLicensed(r.data);
    requestAnimationFrame(() => revealed.current?.focus());
  };
  const more = async () => {
    setLoading("hint");
    const r = await sessionHint<{ words: string; more: boolean }>(session.id);
    setLoading(null);
    if (r.kind !== "ok") return setError(failureMessage(r));
    setFirstWords(r.data);
  };
  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border-strong/60 bg-surface p-5 shadow-(--elev-card) sm:p-8">
        <p className="font-display text-display font-semibold">{session.label}</p>
        <p className="mt-2 text-text-secondary">
          {kids ? "Say the verse out loud. When you're done, tap Reveal to check!" : "Look away and recite the verse aloud or in your head. Take your time; there's no timer. When you're ready, reveal it and check yourself."}
        </p>
        {firstWords ? (
          <p className="mt-3 text-meta" aria-live="polite">
            <span className="font-semibold">It begins:</span> <span className="memory-text">{firstWords.words}…</span>
          </p>
        ) : null}
        {showEditorial && hint ? (
          <p className="mt-3 text-meta" aria-live="polite">
            <span className="font-semibold">Hint from the church:</span> {hint}
          </p>
        ) : null}
      </div>
      {text === null ? (
        <div className="flex flex-wrap gap-2">
          <Button className="memory-control" onClick={reveal} loading={loading === "reveal"} loadingText="Revealing…" icon={<Eye className="size-4" aria-hidden="true" />}>
            Reveal the verse
          </Button>
          {!provider && (!firstWords || firstWords.more) ? (
            <Button variant="secondary" className="memory-control" onClick={more} loading={loading === "hint"} icon={<Lightbulb className="size-4" aria-hidden="true" />}>
              {firstWords ? "A few more words" : "Show how it begins"}
            </Button>
          ) : null}
          {hint && !showEditorial ? (
            <Button variant="ghost" className="memory-control" onClick={() => setShowEditorial(true)}>
              Show the church&apos;s hint
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div ref={revealed} tabIndex={-1} className="rounded-card border border-primary/50 bg-primary-soft/40 p-5 outline-none focus-visible:outline-3 focus-visible:outline-primary sm:p-8">
            <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-text-secondary">The verse</p>
            {licensed?.verses ? (
              <ProviderText verses={licensed.verses} copyright={licensed.copyright ?? null} fumsId={licensed.fums_id ?? null} session={session} label={session.reference} />
            ) : (
              <p className="memory-text">{text}</p>
            )}
          </div>
          <ConfidencePicker kids={kids} busy={busy} question="How did your recitation go?" onChoose={(c) => onSubmit({ confidence: c })} />
          <p className="text-meta text-text-secondary">This records your own judgment. It helps plan your reviews; it isn&apos;t a test.</p>
        </>
      )}
      {error ? <Alert tone="error" title={error} /> : null}
    </div>
  );
}
