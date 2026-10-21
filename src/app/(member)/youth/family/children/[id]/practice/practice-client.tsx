"use client";

import { useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { childPracticeAction } from "../../../../actions";

type Card = { id: string; reference: string; stage: string; due_on: string | null; review_ready: boolean; sessions: number; translation: string };
type Token = { i: number; t: string; g: boolean; b: boolean; w: boolean };
type Session = {
  id: string;
  activity: "read_repeat" | "flashcards" | "self_check";
  label: string;
  translation: { code: string; attribution: string } | null;
  setup: { tokens?: Token[]; front?: string; direction?: string };
};

const ACTIVITIES = [
  { key: "read_repeat", label: "Read & repeat", help: "Read it together, then hide more words each time." },
  { key: "flashcards", label: "Flashcards", help: "See the reference, say the verse, then flip." },
  { key: "self_check", label: "Say it", help: "Say it from memory, then show the verse to check." },
] as const;

const CONFIDENCE = [
  ["not_yet", "Not yet"],
  ["partly", "Partly"],
  ["mostly", "Mostly"],
  ["fully", "Every word"],
] as const;

/**
 * Practice for a child profile, run by a verified guardian. Large text and
 * buttons, short steps, and plain instructions. Results are saved only after
 * the server confirms, and always on the child.
 */
export function ChildPractice({ child, childName, cards }: { child: string; childName: string; cards: Card[] }) {
  const [session, setSession] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);

  function begin(card: string, activity: Session["activity"]) {
    setStatus(null);
    setRevealed(null);
    setLevel(0);
    start(async () => {
      const r = await childPracticeAction("start", { child, card, activity, difficulty: "guided" });
      if (!r.ok) return setStatus({ tone: "error", text: r.message });
      setSession(r.data as unknown as Session);
      requestAnimationFrame(() => heading.current?.focus());
    });
  }

  function reveal() {
    if (!session) return;
    start(async () => {
      const r = await childPracticeAction("reveal", { session: session.id });
      if (!r.ok) return setStatus({ tone: "error", text: r.message });
      setRevealed(String(r.data.text ?? r.data.reference ?? ""));
    });
  }

  function finish(payload: Record<string, unknown>) {
    if (!session) return;
    start(async () => {
      const r = await childPracticeAction("submit", { session: session.id, payload });
      if (!r.ok) return setStatus({ tone: "error", text: `${r.message} Nothing was lost; try again.` });
      if (r.data.saved === false) return setStatus({ tone: "info", text: "This activity expired. Start it again." });
      const review = r.data.review as { change?: string } | undefined;
      setStatus({
        tone: "success",
        text: `Saved for ${childName}.${review?.change === "advanced" ? " Nice work: this verse moved forward in the review schedule." : ""}`,
      });
      setSession(null);
    });
  }

  if (!session) {
    return (
      <div className="space-y-4">
        {status ? <Alert tone={status.tone === "error" ? "error" : status.tone === "success" ? "success" : "info"} title={status.text} /> : null}
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.id} className="rounded-card border border-border bg-surface p-5 shadow-(--elev-card)">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[1.25rem] font-semibold">
                  {c.reference} <span className="text-meta font-normal text-text-secondary">{c.translation}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{c.stage === "new" ? "New" : c.stage === "learning" ? "Learning" : c.stage === "reviewing" ? "Reviewing" : "Well known"}</Badge>
                  {c.review_ready ? <Badge tone="success">Ready for review</Badge> : null}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {ACTIVITIES.map((a) => (
                  <Button key={a.key} variant="secondary" size="lg" disabled={pending} onClick={() => begin(c.id, a.key)} className="h-auto flex-col items-start py-3 text-left">
                    <span>{a.label}</span>
                    <span className="text-meta font-normal text-text-secondary">{a.help}</span>
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const words = session.setup.tokens ?? [];
  const hidden = (t: Token, n: number) => t.w && level > 0 && n % (4 - Math.min(level, 3)) === 0;
  return (
    <section aria-labelledby="practice-now" className="space-y-5 rounded-card border border-border bg-surface p-5 shadow-(--elev-card) sm:p-7">
      <p className="text-meta font-semibold text-text-secondary">Practicing as {childName}</p>
      <h3 id="practice-now" ref={heading} tabIndex={-1} className="font-display text-[1.75rem] font-semibold outline-none">
        {session.label}
      </h3>
      {session.activity === "read_repeat" ? (
        <>
          <p className="text-[1.5rem] leading-relaxed" aria-live="polite">
            {words.map((t, n) => (
              <span key={t.i}>
                {hidden(t, n) ? <span className="inline-block min-w-[3ch] border-b-2 border-text-secondary" aria-label="hidden word">&nbsp;</span> : t.t}
                {t.b ? <br /> : t.g ? "" : " "}
              </span>
            ))}
          </p>
          <div className="flex flex-wrap gap-2">
            {level < 3 ? (
              <Button size="lg" onClick={() => setLevel(level + 1)}>
                Hide more words
              </Button>
            ) : null}
            <Button size="lg" variant="secondary" disabled={pending} onClick={() => finish({ level, reveals: 0 })}>
              Done for now
            </Button>
          </div>
        </>
      ) : (
        <>
          {session.activity === "flashcards" ? <p className="text-[1.5rem] leading-relaxed">{session.setup.front}</p> : <p className="text-[1.25rem]">Say the verse from memory. Then show it to check.</p>}
          {revealed ? (
            <>
              <blockquote className={cn("border-l-4 border-primary pl-4 text-[1.5rem] leading-relaxed")}>{revealed}</blockquote>
              <fieldset>
                <legend className="mb-2 font-semibold">How well did {childName} know it?</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CONFIDENCE.map(([k, l]) => (
                    <Button key={k} size="lg" variant="secondary" disabled={pending} onClick={() => finish({ confidence: k })}>
                      {l}
                    </Button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <Button size="lg" disabled={pending} onClick={reveal}>
              {session.activity === "flashcards" ? "Flip the card" : "Show the verse"}
            </Button>
          )}
        </>
      )}
      {session.translation ? <p className="text-meta text-text-secondary">{session.translation.attribution}</p> : null}
      <div aria-live="polite">{status ? <Alert tone={status.tone === "error" ? "error" : "info"} title={status.text} /> : null}</div>
      <Button variant="ghost" onClick={() => setSession(null)}>
        Stop without saving
      </Button>
    </section>
  );
}
