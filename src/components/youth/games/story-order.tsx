"use client";

import { ArrowLeft, ArrowRight, CircleCheck, GripVertical, Lightbulb, Lock, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { Difficulty } from "@/lib/youth/activities";
import { STORY_RULES, type StoryConfig, type StoryScene } from "@/lib/youth/games/config";
import { resumeStory, storyData, storyReducer } from "@/lib/youth/games/story";
import { GamePicture, type MediaMap } from "./game-art";
import { SaveNote } from "./save-note";
import { useProgressSaver, type SaveTarget } from "./use-progress-saver";

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * Put the Story in Order. Three ways to move a picture, all equal:
 *   * drag it by its handle (mouse, touch, or pen);
 *   * tap it to pick it up, then tap the place it should go;
 *   * the Move earlier / Move later buttons (keyboard and switch users).
 * Every move is announced. Nothing is timed. Check my order says which
 * pictures are already right; a hint places one picture and pins it.
 */
export function StoryOrderPlayer({
  config,
  difficulty,
  media,
  initial,
  target,
  seed,
  who,
}: {
  config: StoryConfig;
  difficulty: Difficulty;
  media: MediaMap;
  initial: { data: Record<string, unknown>; completed: boolean } | null;
  target: SaveTarget;
  seed: number;
  /** "You", or the child's name. */
  who: string;
}) {
  const reducer = useMemo(() => storyReducer(config), [config]);
  const [s, dispatch] = useReducer(reducer, null, () => resumeStory(config, initial?.data, seed, initial?.completed));
  const { save, status, preview } = useProgressSaver(target);
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const drag = useRef<{ id: string; pointer: number } | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const rules = STORY_RULES[difficulty];
  const hintsLeft = Math.max(0, rules.hints - s.hintsUsed);
  const byId = useMemo(() => new Map(config.scenes.map((x) => [x.id, x])), [config]);
  const n = s.order.length;

  // Save after every change that matters (not on load, not for feedback alone).
  const saved = useRef(JSON.stringify(storyData(s)));
  const lastChecks = useRef(s.checks);
  useEffect(() => {
    const data = storyData(s);
    const json = JSON.stringify(data);
    if (json === saved.current) return;
    saved.current = json;
    const now = s.checks !== lastChecks.current || s.solved;
    lastChecks.current = s.checks;
    save(data, Boolean(initial?.completed) || s.completions > 0, now);
  }, [s, save, initial?.completed]);

  useEffect(() => {
    if (s.solved) doneRef.current?.focus();
  }, [s.solved]);

  const scene = (id: string) => byId.get(id) as StoryScene;
  const label = (id: string) => scene(id).caption || "this picture";

  const moveTo = (id: string, to: number) => {
    const from = s.order.indexOf(id);
    if (from === to) return;
    dispatch({ type: "move", id, to });
    setAnnounce(`Moved “${label(id)}” to place ${to + 1} of ${n}.`);
  };
  const step = (id: string, by: -1 | 1) => {
    dispatch({ type: "step", id, by });
    setAnnounce(`Moved “${label(id)}” ${by < 0 ? "earlier" : "later"}.`);
  };

  const tap = (id: string, index: number) => {
    if (s.solved || s.pinned.includes(id)) return;
    if (!selected) {
      setSelected(id);
      setAnnounce(`Picked up “${label(id)}”. Now choose the place it should go.`);
    } else if (selected === id) {
      setSelected(null);
      setAnnounce("Put it back.");
    } else {
      moveTo(selected, index);
      setSelected(null);
    }
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (s.solved) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, pointer: e.pointerId };
    setSelected(id);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointer !== e.pointerId) return;
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-slot]");
    setOver(slot ? Number(slot.dataset.slot) : null);
  };
  const onHandleUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (over !== null && !s.pinned.includes(s.order[over])) moveTo(d.id, over);
    setOver(null);
    setSelected(null);
  };

  const check = () => {
    setSelected(null);
    dispatch({ type: "check" });
  };
  const hint = () => {
    setSelected(null);
    dispatch({ type: "hint", max: rules.hints });
  };

  const right = new Set(s.checked ?? []);
  const hinted = s.lastHint ? scene(s.lastHint) : null;

  if (s.solved) {
    return (
      <div className="space-y-5">
        <div className="space-y-2 rounded-card border border-success bg-success-soft p-5">
          <h3 ref={doneRef} tabIndex={-1} className="flex items-center gap-2 text-[1.25rem] font-semibold outline-none">
            <Sparkles className="size-5 text-success" aria-hidden="true" />
            {who === "You" ? "You put the story in order!" : `${who} put the story in order!`}
          </h3>
          <p className="text-text-secondary">Here&apos;s what happened, from beginning to end.</p>
        </div>
        <ol className="space-y-3">
          {s.order.map((id, i) => {
            const x = scene(id);
            return (
              <li key={id} className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-4 rounded-card border border-border bg-surface p-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <GamePicture image={x.image} media={media} kind="puzzle" alt={x.description || (x.image && "asset" in x.image ? (media[x.image.asset]?.alt ?? "") : "")} className="rounded-tile" />
                <div className="space-y-1">
                  <p className="text-meta font-semibold text-text-secondary">{ordinal(i + 1)}</p>
                  <p className="font-semibold">{x.caption}</p>
                  {x.note ? <p className="text-text-secondary">{x.note}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
        {config.wrap_up ? <p className="whitespace-pre-line rounded-card border border-border bg-surface-muted p-4">{config.wrap_up}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => dispatch({ type: "replay" })}>
            Play again
          </Button>
          {preview ? null : <p className="text-meta text-text-secondary">Finishing is saved. Playing again keeps it.</p>}
        </div>
        <SaveNote status={status} preview={preview} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-text-secondary">
        Put the pictures in the order they happened. Drag a picture by its handle, or tap a picture and then tap the place it goes. The arrow buttons move a picture one place. There&apos;s no
        rush.
      </p>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="The story, in your order">
        {s.order.map((id, i) => {
          const x = scene(id);
          const pinned = s.pinned.includes(id);
          const isSel = selected === id;
          const ok = right.has(id);
          return (
            <li
              key={id}
              data-slot={i}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-card border-2 bg-surface transition-colors",
                isSel ? "border-primary ring-2 ring-primary" : over === i ? "border-primary border-dashed" : ok || pinned ? "border-success" : "border-border",
              )}
            >
              <button
                type="button"
                onClick={() => tap(id, i)}
                disabled={pinned}
                aria-pressed={isSel}
                aria-label={`Place ${i + 1} of ${n}: ${x.caption || "picture"}.${pinned ? " Placed by a hint." : ok ? " In the right place." : ""} ${
                  selected && !isSel ? "Move the picked-up picture here." : isSel ? "Picked up. Tap again to put it back." : "Pick up."
                }`}
                className="block text-left outline-none focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-primary disabled:cursor-default"
              >
                <GamePicture image={x.image} media={media} kind="puzzle" alt="" />
                <span className="flex items-start gap-2 p-2.5">
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-meta font-semibold" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="min-w-0 font-semibold leading-snug [overflow-wrap:anywhere]">{x.caption}</span>
                </span>
              </button>
              <div className="mt-auto flex items-center justify-between gap-1 border-t border-border px-1.5 py-1">
                {pinned ? (
                  <span className="inline-flex min-h-11 items-center gap-1.5 px-1.5 text-meta text-text-secondary">
                    <Lock className="size-4" aria-hidden="true" /> Hint
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={`Move “${x.caption || "picture"}” earlier`}
                      onClick={() => step(id, -1)}
                      disabled={i === 0}
                      className="inline-flex size-11 items-center justify-center rounded-button text-text-secondary hover:bg-surface-muted hover:text-text focus-visible:outline-3 focus-visible:outline-primary disabled:opacity-35"
                    >
                      <ArrowLeft className="size-5" aria-hidden="true" />
                    </button>
                    <span
                      role="presentation"
                      onPointerDown={(e) => onHandleDown(e, id)}
                      onPointerMove={onHandleMove}
                      onPointerUp={onHandleUp}
                      onPointerCancel={onHandleUp}
                      title="Drag to move"
                      className="inline-flex size-11 cursor-grab touch-none items-center justify-center rounded-button text-text-secondary hover:bg-surface-muted active:cursor-grabbing"
                    >
                      <GripVertical className="size-5" aria-hidden="true" />
                    </span>
                    <button
                      type="button"
                      aria-label={`Move “${x.caption || "picture"}” later`}
                      onClick={() => step(id, 1)}
                      disabled={i === n - 1}
                      className="inline-flex size-11 items-center justify-center rounded-button text-text-secondary hover:bg-surface-muted hover:text-text focus-visible:outline-3 focus-visible:outline-primary disabled:opacity-35"
                    >
                      <ArrowRight className="size-5" aria-hidden="true" />
                    </button>
                  </>
                )}
                {ok && !pinned ? <CircleCheck className="mr-1.5 size-5 shrink-0 text-success" aria-hidden="true" /> : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<CircleCheck className="size-4" aria-hidden="true" />} onClick={check}>
          Check my order
        </Button>
        <Button variant="secondary" icon={<Lightbulb className="size-4" aria-hidden="true" />} onClick={hint} disabled={hintsLeft === 0}>
          {hintsLeft === 0 ? "No hints left" : `Hint (${hintsLeft} left)`}
        </Button>
        <Button
          variant="ghost"
          icon={<RotateCcw className="size-4" aria-hidden="true" />}
          onClick={() => {
            setSelected(null);
            dispatch({ type: "restart" });
            setAnnounce("Started over with the pictures mixed up again.");
          }}
        >
          Start over
        </Button>
      </div>

      <div aria-live="polite" className="space-y-2">
        {s.checked ? (
          <div className="space-y-2 rounded-card border border-primary bg-primary-soft p-4">
            <p className="font-semibold">
              {s.checked.length === 0
                ? "Not quite yet, and that's okay."
                : `Good thinking! ${s.checked.length} of ${n} ${s.checked.length === 1 ? "picture is" : "pictures are"} in the right place.`}
            </p>
            <p className="text-text-secondary">
              {s.checked.length ? "They have a check mark. " : ""}Move the others and check again{hintsLeft ? ", or try a hint" : ""}.
            </p>
            <Button variant="secondary" size="sm" onClick={() => dispatch({ type: "dismiss" })}>
              Try again
            </Button>
          </div>
        ) : null}
        {hinted ? (
          <div className="rounded-card border border-border bg-surface-muted p-4">
            <p className="flex items-start gap-2 font-semibold">
              <Lightbulb className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                “{hinted.caption}” goes {ordinal(s.order.indexOf(hinted.id) + 1)}. It&apos;s placed for you.
              </span>
            </p>
            {hinted.clue ? <p className="mt-1 text-text-secondary">{hinted.clue}</p> : null}
          </div>
        ) : null}
        <p className="sr-only">{announce}</p>
      </div>
      <SaveNote status={status} preview={preview} />
    </div>
  );
}
