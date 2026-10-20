"use client";

import { Lightbulb } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Session, Token } from "@/lib/memory/types";
import { failureMessage, sessionHint } from "./api";
import { TokenText } from "./token-text";

/**
 * Missing words. The server sends the verse with its blanks already
 * removed, so no answer is in the page. Guided and Growing offer one
 * choice per distinct word (a repeated word shows how many times it's
 * used, so two choices are never interchangeable); Challenge asks for
 * typed answers. Each blank is a labelled form field ("Blank 2 of 5").
 */
export function MissingWords({ session, kids, busy, onSubmit }: { session: Session; kids: boolean; busy: boolean; onSubmit: (p: Record<string, unknown>) => void }) {
  const tokens = useMemo(() => session.setup.tokens ?? [], [session.setup.tokens]);
  const blanks = useMemo(() => tokens.filter((t) => t.blank), [tokens]);
  const total = session.setup.blank_count ?? blanks.length;
  const typed = !!session.setup.typed;
  const bank = session.setup.bank ?? [];
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [hinted, setHinted] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [hintFor, setHintFor] = useState<number | null>(null);
  const filled = blanks.filter((b) => (answers[b.i] ?? "").trim()).length;

  const hint = async (t: Token) => {
    setHintFor(t.blank!);
    setError(null);
    const r = await sessionHint<{ blank: number; word: string }>(session.id, { blank: t.blank });
    setHintFor(null);
    if (r.kind !== "ok") return setError(failureMessage(r));
    setAnswers((a) => ({ ...a, [t.i]: r.data.word }));
    setHinted((h) => new Set(h).add(t.blank!));
  };

  const field = (t: Token) => {
    const label = `Blank ${t.blank} of ${total}`;
    const common = "memory-control mx-0.5 inline-block min-h-11 rounded-md border border-border-strong bg-surface px-2 align-baseline font-sans text-[1rem] text-text focus-visible:outline-3 focus-visible:outline-primary";
    return (
      <span className="inline-flex items-baseline">
        {t.pre}
        {typed ? (
          <input
            aria-label={label}
            className={`${common} w-[8ch]`}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={answers[t.i] ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [t.i]: e.target.value }))}
          />
        ) : (
          <select aria-label={label} className={common} value={answers[t.i] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [t.i]: e.target.value }))}>
            <option value="">{`(${t.blank})`}</option>
            {bank.map((b) => (
              <option key={b.text} value={b.text}>
                {b.text}
              </option>
            ))}
          </select>
        )}
        {t.post}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <p className="text-text-secondary">
        {typed
          ? "Type each missing word. Punctuation around a blank is already shown."
          : kids
            ? "Pick the missing word for each blank."
            : `Choose the missing word for each blank${bank.some((b) => (b.count ?? 1) > 1) ? " (some words are used more than once)" : ""}.`}
      </p>
      {!typed && bank.length ? (
        <div>
          <p className="mb-1.5 text-meta font-semibold text-text-secondary" id="word-bank">
            Word choices
          </p>
          <ul aria-labelledby="word-bank" className="flex flex-wrap gap-2">
            {bank.map((b) => (
              <li key={b.text} className="rounded-full border border-border bg-surface-muted px-3 py-1 text-meta font-semibold">
                {b.text}
                {(b.count ?? 1) > 1 ? <span className="text-text-secondary"> ×{b.count}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-card border border-border bg-surface p-4 sm:p-6">
        <TokenText tokens={tokens} label={`${session.label} with ${total} missing words`} render={(t) => (t.blank ? field(t) : null)} />
      </div>
      <details className="rounded-tile border border-border bg-surface px-4 py-2">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Need a hint?</summary>
        <p className="mb-2 text-meta text-text-secondary">A hint fills in one word. Hints are part of learning; they&apos;re counted so your reviews come back at the right time.</p>
        <div className="flex flex-wrap gap-2 pb-2">
          {blanks.map((b) => (
            <Button key={b.i} size="sm" variant="secondary" disabled={hinted.has(b.blank!)} loading={hintFor === b.blank} onClick={() => hint(b)} icon={<Lightbulb className="size-4" aria-hidden="true" />}>
              Blank {b.blank}
            </Button>
          ))}
        </div>
      </details>
      <p className="text-meta text-text-secondary" aria-live="polite">
        {filled} of {total} filled
      </p>
      {error ? <Alert tone="error" title={error} /> : null}
      <Button className="memory-control" disabled={filled === 0} loading={busy} loadingText="Checking…" onClick={() => onSubmit({ answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim()])) })}>
        Check my answers
      </Button>
    </div>
  );
}
