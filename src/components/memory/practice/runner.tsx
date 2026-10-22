"use client";

import { ArrowLeft, CloudOff, LogIn, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ACTIVITIES, DIFFICULTIES } from "@/lib/memory/format";
import { SubmissionQueue, type SubmitState } from "@/lib/memory/submit";
import type { Activity, Difficulty, PracticeSettings, Segment, Session, SubmitResult } from "@/lib/memory/types";
import { failureMessage, sessionSubmit, startSession } from "./api";
import { Flashcards } from "./flashcards";
import { MissingWords } from "./missing-words";
import { ReadRepeat } from "./read-repeat";
import { ResultDetails } from "./result";
import { SelfCheck } from "./self-check";
import { TypeVerse } from "./type-verse";
import { WordOrder } from "./word-order";

export type RunnerCard = {
  id: string;
  label: string;
  code: string;
  wordCount: number;
  segments: Segment[];
  shortSegments: Segment[];
  hint: string | null;
  /** Activities the verse's version allows (a licensed version: flashcards and self-check). */
  modes: Activity[];
  /** A licensed version: its text is shown only unchanged, never stored. */
  provider: boolean;
};

const SCORED_WHOLE_LIMIT = 80;

/**
 * Practice: choose an activity, difficulty, and part; do it; see what was
 * saved. "Saved" appears only after the server confirms; until then the
 * member's answer stays on the page and is retried (or kept while offline
 * or signed out). Focus moves to the result after checking so keyboard and
 * screen-reader users land on the feedback. No timers anywhere.
 */
export function PracticeRunner({
  card,
  settings,
  today,
  initial,
}: {
  card: RunnerCard;
  settings: PracticeSettings;
  today: string;
  initial: { activity: Activity; difficulty: Difficulty; segment: number; direction: "ref_to_text" | "text_to_ref" };
}) {
  const kids = settings.presentation === "kids";
  const [activity, setActivity] = useState<Activity>(card.modes.includes(initial.activity) ? initial.activity : (card.modes[0] ?? initial.activity));
  const [difficulty, setDifficulty] = useState<Difficulty>(initial.difficulty);
  const [short, setShort] = useState(kids);
  const parts = short ? card.shortSegments : card.segments;
  const scored = activity === "type_verse" || activity === "word_order" || activity === "missing_words";
  const wholeAllowed = !scored || card.wordCount <= SCORED_WHOLE_LIMIT;
  // Kids presentation starts with the first short part; others with the whole passage when allowed.
  const [segment, setSegment] = useState<number>(initial.segment || (wholeAllowed && !(kids && card.shortSegments.length > 1) ? 0 : 1));
  const [direction, setDirection] = useState(card.provider ? "ref_to_text" : initial.direction);
  const [ignoreCase, setIgnoreCase] = useState(settings.ignore_case);
  const [ignorePunct, setIgnorePunct] = useState(settings.ignore_punctuation);
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [submit, setSubmit] = useState<SubmitState<SubmitResult> | null>(null);
  const queue = useRef<SubmissionQueue<SubmitResult> | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const activityHeading = useRef<HTMLHeadingElement>(null);
  const ids = { activity: useId(), difficulty: useId(), part: useId() };

  const segmentValue = !wholeAllowed && segment === 0 ? 1 : Math.min(segment, parts.length > 1 ? parts.length : 0);

  const begin = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    queue.current?.dispose();
    queue.current = null;
    setSubmit(null);
    const r = await startSession({
      card_id: card.id,
      activity,
      difficulty,
      segment: segmentValue,
      options: { direction, ignore_case: ignoreCase, ignore_punctuation: ignorePunct, short },
    });
    setStarting(false);
    if (r.kind !== "ok") return setStartError(failureMessage(r));
    setSession(r.data);
    requestAnimationFrame(() => activityHeading.current?.focus());
  }, [card.id, activity, difficulty, segmentValue, direction, ignoreCase, ignorePunct, short]);

  const send = (payload: Record<string, unknown>) => {
    if (!session) return;
    queue.current?.dispose();
    const id = session.id;
    queue.current = new SubmissionQueue<SubmitResult>({
      send: () => sessionSubmit(id, payload),
      onState: (s) => {
        setSubmit(s);
        if (s.status === "saved" || s.status === "conflict" || s.status === "expired" || s.status === "signed_out" || s.status === "failed") {
          requestAnimationFrame(() => resultHeading.current?.focus());
        }
      },
    });
    queue.current.start();
  };

  useEffect(() => () => queue.current?.dispose(), []);

  // Leaving with an answer that isn't saved asks first.
  const unsaved = !!submit && submit.status !== "saved";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const busy = !!submit && ["saving", "retrying", "offline"].includes(submit.status);
  const done = submit?.status === "saved" && submit.data;
  const info = ACTIVITIES.find((a) => a.key === activity)!;

  return (
    <div data-presentation={kids ? "kids" : "standard"} className="space-y-6">
      {!session ? (
        <section aria-labelledby={ids.activity} className="space-y-5">
          <fieldset>
            <legend id={ids.activity} className="mb-2 text-[1.125rem] font-semibold">
              Choose an activity
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ACTIVITIES.filter((a) => card.modes.includes(a.key)).map((a) => (
                <label
                  key={a.key}
                  className={cn(
                    "memory-control flex cursor-pointer gap-3 rounded-tile border p-3 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                    activity === a.key ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-muted/60",
                  )}
                >
                  <input type="radio" name="activity" value={a.key} checked={activity === a.key} onChange={() => setActivity(a.key)} className="mt-1 size-4 accent-[var(--color-primary)]" />
                  <span>
                    <span className="block font-semibold">{a.label}</span>
                    <span className="block text-meta text-text-secondary">{kids ? a.kids : a.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {card.provider ? (
              <p className="mt-2 text-meta text-text-secondary">
                For {card.code}, practice shows the verse exactly as published: flashcards and self-check. Activities that hide or rearrange words aren&apos;t available for this version.
              </p>
            ) : null}
          </fieldset>
          {activity !== "read_repeat" && activity !== "flashcards" && activity !== "self_check" ? (
            <fieldset>
              <legend id={ids.difficulty} className="mb-2 font-semibold">
                Difficulty
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {DIFFICULTIES.map((d) => (
                  <label
                    key={d.key}
                    className={cn(
                      "memory-control flex cursor-pointer gap-2 rounded-tile border p-3 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                      difficulty === d.key ? "border-primary bg-primary-soft" : "border-border bg-surface",
                    )}
                  >
                    <input type="radio" name="difficulty" value={d.key} checked={difficulty === d.key} onChange={() => setDifficulty(d.key)} className="mt-1 size-4 accent-[var(--color-primary)]" />
                    <span>
                      <span className="block font-semibold">{d.label}</span>
                      <span className="block text-meta text-text-secondary">{d.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {parts.length > 1 || card.segments.length > 1 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={ids.part} className="block font-semibold">
                  Part of the passage
                </label>
                <select id={ids.part} className="memory-control min-h-12 w-full rounded-tile border border-border-strong bg-surface px-3" value={segmentValue} onChange={(e) => setSegment(Number(e.target.value))}>
                  {wholeAllowed ? <option value={0}>The whole passage ({card.wordCount} words)</option> : null}
                  {parts.map((p) => (
                    <option key={p.n} value={p.n}>
                      {p.label} ({p.words} words)
                    </option>
                  ))}
                </select>
                {!wholeAllowed ? <p className="text-meta text-text-secondary">Long passages are typed and ordered one part at a time. The words themselves never change.</p> : null}
              </div>
              <label className="flex min-h-12 items-center gap-2 self-end">
                <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={short} onChange={(e) => {
                    setShort(e.target.checked);
                    setSegment(wholeAllowed ? 0 : 1);
                  }}
                />
                Shorter parts
              </label>
            </div>
          ) : null}
          {activity === "flashcards" && !card.provider ? (
            <fieldset>
              <legend className="mb-2 font-semibold">Card front</legend>
              <div className="flex flex-wrap gap-2">
                {(["ref_to_text", "text_to_ref"] as const).map((d) => (
                  <label key={d} className={cn("memory-control flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4", direction === d ? "border-primary bg-primary-soft" : "border-border bg-surface")}>
                    <input type="radio" name="direction" checked={direction === d} onChange={() => setDirection(d)} className="size-4 accent-[var(--color-primary)]" />
                    {d === "ref_to_text" ? "Reference (say the verse)" : "Verse (say the reference)"}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {activity === "type_verse" ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 font-semibold">How strictly to compare</legend>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />
                Ignore capital letters
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={ignorePunct} onChange={(e) => setIgnorePunct(e.target.checked)} />
                Ignore punctuation (including apostrophes)
              </label>
            </fieldset>
          ) : null}
          {startError ? <Alert tone="error" title={startError} /> : null}
          <Button className="memory-control" onClick={begin} loading={starting} loadingText="Getting it ready…">
            Start {info.label.toLowerCase()}
          </Button>
        </section>
      ) : (
        <section aria-labelledby="activity-heading" className="space-y-5">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="activity-heading" ref={activityHeading} tabIndex={-1} className="text-[1.25rem] font-semibold outline-none">
              {info.label} · {session.label}
            </h2>
            <span className="text-meta text-text-secondary">
              {session.translation.code} · {DIFFICULTIES.find((d) => d.key === session.difficulty)?.label}
            </span>
          </header>
          {!done ? (
            <>
              {session.activity === "read_repeat" ? <ReadRepeat session={session} busy={busy} onSubmit={send} /> : null}
              {session.activity === "flashcards" ? <Flashcards session={session} kids={kids} busy={busy} onSubmit={send} /> : null}
              {session.activity === "missing_words" ? <MissingWords session={session} kids={kids} busy={busy} onSubmit={send} /> : null}
              {session.activity === "word_order" ? <WordOrder session={session} kids={kids} busy={busy} onSubmit={send} /> : null}
              {session.activity === "type_verse" ? <TypeVerse session={session} kids={kids} busy={busy} onSubmit={send} /> : null}
              {session.activity === "self_check" ? <SelfCheck session={session} kids={kids} busy={busy} hint={card.hint} provider={card.provider} onSubmit={send} /> : null}
            </>
          ) : null}
          {submit ? (
            <section aria-labelledby="result-heading" className="rounded-card border border-border bg-surface p-4 sm:p-6">
              <h2 id="result-heading" ref={resultHeading} tabIndex={-1} className="mb-3 text-[1.125rem] font-semibold outline-none">
                <SaveLabel state={submit} />
              </h2>
              <SaveHelp state={submit} retry={() => queue.current?.start()} restart={begin} />
              {done ? <ResultDetails result={submit.data!} today={today} kids={kids} /> : null}
            </section>
          ) : null}
          <p className="text-meta text-text-secondary">
            {session.translation.code} · {session.translation.name}
            {session.translation.attribution ? ` · ${session.translation.attribution}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {done || submit?.status === "expired" || submit?.status === "conflict" ? (
              <Button variant="secondary" onClick={begin} loading={starting} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Practice again
              </Button>
            ) : null}
            {!busy ? (
              <Button
                variant="ghost"
                onClick={() => {
                  queue.current?.dispose();
                  setSession(null);
                  setSubmit(null);
                }}
              >
                Choose another activity
              </Button>
            ) : null}
            <ButtonLink href={`/memory/verses/${card.id}`} variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
              Back to the verse
            </ButtonLink>
          </div>
        </section>
      )}
    </div>
  );
}

function SaveLabel({ state }: { state: SubmitState<SubmitResult> }) {
  switch (state.status) {
    case "saved":
      return <>Saved{state.data?.replayed ? " (already saved earlier)" : ""}</>;
    case "saving":
      return <>Saving…</>;
    case "retrying":
      return <>Not saved yet · trying again</>;
    case "offline":
      return <>Not saved yet · you&apos;re offline</>;
    case "signed_out":
      return <>Not saved · signed out</>;
    case "expired":
      return <>Not saved · this activity expired</>;
    case "conflict":
      return <>Not saved · this verse changed</>;
    default:
      return <>Not saved</>;
  }
}

function SaveHelp({ state, retry, restart }: { state: SubmitState<SubmitResult>; retry: () => void; restart: () => void }) {
  const live = (
    <span className="sr-only" role="status">
      {state.status === "saved" ? "Saved." : state.status === "saving" ? "Saving." : ""}
    </span>
  );
  if (state.status === "saved" || state.status === "saving") return live;
  if (state.status === "retrying" || state.status === "offline") {
    return (
      <Alert tone="warning" title={state.status === "offline" ? "Your answer is kept on this page and will be sent when you're back online." : "Your answer is kept on this page while we keep trying."}>
        {state.message ? <p>{state.message}</p> : null}
        <span className="inline-flex items-center gap-1">
          <CloudOff className="size-4" aria-hidden="true" /> Nothing counts until it says Saved.
        </span>
      </Alert>
    );
  }
  if (state.status === "signed_out") {
    return (
      <Alert tone="error" title="Your session ended, so this wasn't saved.">
        <p>Your answer is still here. Sign in again in another tab, then try again.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary hover:underline" href="/sign-in?next=/memory" target="_blank" rel="noopener">
            <LogIn className="size-4" aria-hidden="true" /> Sign in (new tab)
          </Link>
          <Button size="sm" variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      </Alert>
    );
  }
  if (state.status === "expired") return <Alert tone="error" title="This activity was open too long and expired. Nothing was recorded. Start it again when you're ready." />;
  if (state.status === "conflict") {
    return (
      <Alert tone="error" title="This verse was removed or replaced (perhaps in another tab) after you started, so nothing was recorded.">
        <Button size="sm" variant="secondary" onClick={restart}>
          Start again
        </Button>
      </Alert>
    );
  }
  return (
    <Alert tone="error" title={state.message ?? "That couldn't be saved."}>
      <Button size="sm" variant="secondary" onClick={retry}>
        Try again
      </Button>
    </Alert>
  );
}
