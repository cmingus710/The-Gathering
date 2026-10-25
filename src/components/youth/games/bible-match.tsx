"use client";

import { Heart, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { MatchCard, MatchConfig } from "@/lib/youth/games/config";
import { availableSizes, cardFace, gridStep, matchData, matchReducer, pairById, pairOf, resumeMatch, type MatchState } from "@/lib/youth/games/match";
import { builtInAlt, GamePicture, type MediaMap } from "./game-art";
import { SaveNote } from "./save-note";
import { useProgressSaver, type SaveTarget } from "./use-progress-saver";

/** Columns for each board size (fewer on narrow screens, via the classes below). */
const COLS: Record<number, string> = {
  3: "grid-cols-3",
  4: "grid-cols-4",
  6: "grid-cols-3 min-[30rem]:grid-cols-4",
  8: "grid-cols-4",
  10: "grid-cols-4 min-[36rem]:grid-cols-5",
  12: "grid-cols-4 min-[36rem]:grid-cols-6",
};

/**
 * Bible Match. Cards are buttons in a grid: tap or click to turn one over;
 * with a keyboard, arrow keys (and Home/End) move between cards and Enter or
 * Space turns one over. Taps are applied one at a time to the latest board
 * (see matchReducer), so rapid tapping can't break it. A miss stays face up
 * until the next tap; nothing is timed. The optional move counter is just a
 * count, never a score.
 */
export function BibleMatchPlayer({
  config,
  media,
  initial,
  target,
  seed,
  who,
}: {
  config: MatchConfig;
  media: MediaMap;
  initial: { data: Record<string, unknown>; completed: boolean } | null;
  target: SaveTarget;
  seed: number;
  who: string;
}) {
  const reducer = useMemo(() => matchReducer(config), [config]);
  const [s, dispatch] = useReducer(reducer, null, () => resumeMatch(config, initial?.data, seed, initial?.completed) as MatchState);
  const { save, status, preview } = useProgressSaver(target);
  const [focus, setFocus] = useState(0);
  const grid = useRef<HTMLUListElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const sizes = availableSizes(config);

  const saved = useRef(JSON.stringify(matchData(s)));
  useEffect(() => {
    const data = matchData(s);
    const json = JSON.stringify(data);
    if (json === saved.current) return;
    saved.current = json;
    save(data, Boolean(initial?.completed) || s.completions > 0, s.solved);
  }, [s, save, initial?.completed]);

  useEffect(() => {
    if (s.solved) doneRef.current?.focus();
  }, [s.solved]);

  const text = (card: MatchCard | null) => {
    if (!card) return "picture";
    const alt = card.description || (card.image && "asset" in card.image ? (media[card.image.asset]?.alt ?? "") : builtInAlt(card.image));
    return card.label || alt || "picture";
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const cols = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").filter(Boolean).length : 4;
    const next = gridStep(index, e.key, cols, s.deck.length);
    if (next === index) return;
    e.preventDefault();
    setFocus(next);
    grid.current?.querySelectorAll<HTMLButtonElement>("button[data-card]")[next]?.focus();
  };

  const found = s.lastMatch ? pairById(config, s.lastMatch) : null;
  const missed = s.lastMiss ? s.lastMiss.map((c) => text(cardFace(config, c))) : null;

  if (s.solved) {
    const pairs = s.matched.map((id) => pairById(config, id)).filter((p) => !!p);
    return (
      <div className="space-y-5">
        <div className="space-y-2 rounded-card border border-success bg-success-soft p-5">
          <h3 ref={doneRef} tabIndex={-1} className="flex items-center gap-2 text-[1.25rem] font-semibold outline-none">
            <Sparkles className="size-5 text-success" aria-hidden="true" />
            {who === "You" ? "You found all the pairs!" : `${who} found all the pairs!`}
          </h3>
          {config.show_moves ? <p className="text-text-secondary">That took {s.moves} {s.moves === 1 ? "turn" : "turns"}. Every way of getting there is a good one.</p> : null}
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {pairs.map((p) => (
            <li key={p.id} className="flex gap-3 rounded-card border border-border bg-surface p-3">
              <div className="flex shrink-0 items-start gap-1.5 self-start">
                <GamePicture image={p.a.image} media={media} kind="matching" alt="" className="w-14 rounded-tile" />
                {config.mode === "related" && p.b ? <GamePicture image={p.b.image} media={media} kind="matching" alt="" className="w-14 rounded-tile" /> : null}
              </div>
              <div className="min-w-0 space-y-1">
                <p className="font-semibold [overflow-wrap:anywhere]">{config.mode === "related" ? `${text(p.a)} · ${text(p.b)}` : text(p.a)}</p>
                {p.note ? <p className="text-meta text-text-secondary">{p.note}</p> : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => dispatch({ type: "replay" })}>
            Play again
          </Button>
          {sizes.length > 1 ? <SizePicker sizes={sizes} current={s.size} onPick={(size) => dispatch({ type: "restart", size })} label="Or start a board with" /> : null}
        </div>
        {preview ? <SaveNote status={status} preview /> : <p className="text-meta text-text-secondary">Finishing is saved. Playing again keeps it.</p>}
        {preview ? null : <SaveNote status={status} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-text-secondary">
        {config.mode === "related"
          ? "Turn over two cards to find a person and the thing that goes with their story."
          : "Turn over two cards to find two pictures that are the same."}{" "}
        Tap a card, or use the arrow keys and Enter. Take as long as you like.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {sizes.length > 1 ? (
          <SizePicker
            sizes={sizes}
            current={s.size}
            onPick={(size) => {
              if (size !== s.size) dispatch({ type: "restart", size });
            }}
            label="Board"
          />
        ) : (
          <span />
        )}
        <p className="text-meta text-text-secondary">
          {s.matched.length} of {s.size} pairs found{config.show_moves ? ` · ${s.moves} ${s.moves === 1 ? "turn" : "turns"} (no rush)` : ""}
        </p>
      </div>

      <ul ref={grid} className={cn("grid gap-2 sm:gap-3", COLS[s.size] ?? "grid-cols-4")} aria-label="Cards">
        {s.deck.map((card, i) => {
          const matched = s.matched.includes(pairOf(card));
          const up = matched || s.faceUp.includes(card);
          const face = cardFace(config, card);
          return (
            <li key={card}>
              <button
                type="button"
                data-card
                tabIndex={i === focus ? 0 : -1}
                onFocus={() => setFocus(i)}
                onKeyDown={(e) => onKey(e, i)}
                onClick={() => dispatch({ type: "flip", card })}
                aria-disabled={matched || undefined}
                aria-label={`Card ${i + 1}: ${up ? text(face) : "face down"}${matched ? ", matched" : ""}`}
                className={cn(
                  "relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-tile border-2 text-left transition-[border-color,background-color,transform] duration-150",
                  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none",
                  matched ? "border-success bg-success-soft" : up ? "border-primary bg-surface" : "border-border-strong/60 bg-surface-muted hover:border-border-strong active:scale-[0.98] motion-reduce:active:scale-100",
                )}
              >
                {up && face ? (
                  <>
                    <GamePicture image={face.image} media={media} kind="matching" alt="" className="w-full" />
                    {face.label ? <span className="flex flex-1 items-center justify-center p-1 text-center text-meta font-semibold leading-tight [overflow-wrap:anywhere]">{face.label}</span> : null}
                    {matched ? <Heart className="absolute right-1.5 top-1.5 size-4 fill-current text-success" aria-hidden="true" /> : null}
                  </>
                ) : (
                  <span className="play-art flex h-full w-full items-center justify-center" data-kind="matching" aria-hidden="true">
                    <svg viewBox="0 0 40 40" className="size-1/2 opacity-70">
                      <path d="M20 8v24M12 16h16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div aria-live="polite" className="space-y-2">
        {found ? (
          <div className="rounded-card border border-success bg-success-soft p-4">
            <p className="flex items-center gap-2 font-semibold">
              <Heart className="size-5 fill-current text-success" aria-hidden="true" />
              {config.mode === "related" ? `A pair! ${text(found.a)} goes with ${text(found.b)}.` : `A pair! ${text(found.a)}.`}
            </p>
            {found.note ? <p className="mt-1">{found.note}</p> : null}
          </div>
        ) : missed ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface-muted p-4">
            <p>
              {missed[0]} and {missed[1]} aren&apos;t a pair this time. Tap another card to keep going.
            </p>
            <Button variant="secondary" size="sm" icon={<Undo2 className="size-4" aria-hidden="true" />} onClick={() => dispatch({ type: "cover" })}>
              Turn them back
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => dispatch({ type: "restart" })}>
          New board
        </Button>
        <SaveNote status={status} preview={preview} />
      </div>
    </div>
  );
}

function SizePicker({ sizes, current, onPick, label }: { sizes: number[]; current: number; onPick: (size: number) => void; label: string }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span className="text-meta font-semibold text-text-secondary" aria-hidden="true">
        {label}
      </span>
      {sizes.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={n === current}
          onClick={() => onPick(n)}
          className={cn(
            "inline-flex min-h-11 items-center rounded-full border px-4 text-meta font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
            n === current ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
          )}
        >
          {n} pairs
        </button>
      ))}
    </fieldset>
  );
}
