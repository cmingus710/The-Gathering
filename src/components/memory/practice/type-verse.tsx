"use client";

import { Lightbulb } from "lucide-react";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/memory/types";
import { failureMessage, sessionHint } from "./api";
import { ConfidencePicker } from "./confidence";

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Type the verse from memory. The text isn't sent until the member checks,
 * so it can't be peeked at in the page. "Next word" asks the server for the
 * word at the member's current position (counted as a hint).
 */
export function TypeVerse({ session, kids, busy, onSubmit }: { session: Session; kids: boolean; busy: boolean; onSubmit: (p: Record<string, unknown>) => void }) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hinting, setHinting] = useState(false);
  const [stage, setStage] = useState<"typing" | "confidence">("typing");
  const id = useId();
  const words = session.setup.words ?? 0;
  const typed = wordCount(text);

  const next = async () => {
    setHinting(true);
    setError(null);
    const r = await sessionHint<{ word: string; position: number }>(session.id, { position: Math.min(typed, Math.max(words - 1, 0)) });
    setHinting(false);
    if (r.kind !== "ok") return setError(failureMessage(r));
    setHint(r.data.word);
  };

  return (
    <div className="space-y-4">
      <label htmlFor={id} className="block font-semibold">
        {kids ? `Type ${session.label}` : `Type ${session.label} from memory`}
      </label>
      <p className="text-meta text-text-secondary" id={`${id}-rules`}>
        {session.setup.ignore_case ? "Capital letters don't matter" : "Capital letters count"} ·{" "}
        {session.setup.ignore_punctuation ? "punctuation doesn't matter" : "punctuation counts"} · verse numbers and the reference are set aside. Different words are never accepted.
      </p>
      <textarea
        id={id}
        aria-describedby={`${id}-rules ${id}-count`}
        className="memory-text memory-control min-h-40 w-full rounded-tile border border-border-strong bg-surface p-3 text-text focus-visible:outline-3 focus-visible:outline-primary"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
        autoCapitalize="sentences"
        autoCorrect="off"
        spellCheck={false}
        disabled={stage === "confidence"}
      />
      <p id={`${id}-count`} className="text-meta text-text-secondary">
        {typed} of about {words} words
      </p>
      {hint ? (
        <p className="text-meta" aria-live="polite">
          <span className="font-semibold">Next word:</span> <span className="memory-text">{hint}</span>
        </p>
      ) : null}
      {error ? <Alert tone="error" title={error} /> : null}
      {stage === "typing" ? (
        <div className="flex flex-wrap gap-2">
          <Button className="memory-control" disabled={!typed} onClick={() => setStage("confidence")}>
            Check
          </Button>
          <Button variant="secondary" className="memory-control" loading={hinting} onClick={next} icon={<Lightbulb className="size-4" aria-hidden="true" />}>
            Next word
          </Button>
        </div>
      ) : (
        <>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStage("typing")}>
          Keep editing
        </Button>
        <ConfidencePicker
          kids={kids}
          busy={busy}
          optional
          question="Before we check: how sure do you feel?"
          submitLabel="Check my verse"
          onChoose={(c) => onSubmit({ text, ...(c ? { confidence: c } : {}) })}
        />
        </>
      )}
    </div>
  );
}
