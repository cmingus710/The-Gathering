"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { TextAreaField, TextField } from "@/components/ui/field";
import type { Difficulty } from "@/lib/youth/activities";
import {
  BOARD_SIZES,
  emptyMatch,
  emptyStory,
  GAME_FOR_KIND,
  GAME_NAMES,
  gameIssues,
  LIMITS,
  MAX_PAIRS,
  MAX_SCENES,
  parseMatchConfig,
  parseStoryConfig,
  STORY_RULES,
  type MatchCard,
  type MatchConfig,
  type MatchPair,
  type StoryConfig,
  type StoryScene,
} from "@/lib/youth/games/config";
import { PicturePicker, type ArtOption } from "./picture-picker";

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`;
const move = <T,>(list: T[], i: number, by: -1 | 1) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

/**
 * The game part of the activity editor, for the Puzzle (Put the Story in
 * Order) and Matching (Bible Match) types. Staff fill in forms: scenes in
 * order, or pairs; pictures from the built-in library, this activity's
 * uploads, or a new upload. The whole game is sent with the draft as one
 * hidden value (never typed by hand), reshaped on the server and checked
 * in the database. What would keep it from being published is listed as
 * you go; a draft can be saved incomplete.
 */
export function GameConfigEditor({
  kind,
  difficulty,
  initial,
  art: initialArt,
  activityId,
}: {
  kind: string;
  difficulty: Difficulty;
  initial: Record<string, unknown>;
  art: ArtOption[];
  activityId: string | null;
}) {
  const player = GAME_FOR_KIND[kind as keyof typeof GAME_FOR_KIND];
  const hasStored = initial && typeof initial === "object" && "player" in initial;
  const [enabled, setEnabled] = useState<boolean>(hasStored || !activityId);
  const [story, setStory] = useState<StoryConfig>(() => parseStoryConfig(initial) ?? emptyStory());
  const [match, setMatch] = useState<MatchConfig>(() => parseMatchConfig(initial) ?? emptyMatch());
  const [uploaded, setUploaded] = useState<ArtOption[]>([]);
  const art = [...uploaded.filter((u) => !initialArt.some((a) => a.id === u.id)), ...initialArt];
  const addArt = (a: ArtOption) => setUploaded((u) => [a, ...u]);

  if (!player) return null;
  const config = player === "story_order" ? story : match;
  const issues = enabled ? gameIssues(config, difficulty) : [];
  const fieldset = "space-y-4 rounded-card border border-border p-4 sm:p-5";

  return (
    <fieldset className={fieldset}>
      <legend className="px-1 font-semibold">Game: {GAME_NAMES[player]}</legend>
      <input type="hidden" name="game_config" value={enabled ? JSON.stringify(config) : ""} />
      <div className="space-y-1">
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" checked={enabled} onChange={() => setEnabled(true)} className="size-5" />
          <span>Play it as {GAME_NAMES[player]}</span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" checked={!enabled} onChange={() => setEnabled(false)} className="size-5" />
          <span>No game: do it together, then mark it finished</span>
        </label>
      </div>
      {enabled ? (
        <>
          {player === "story_order" ? (
            <StoryEditor value={story} onChange={setStory} difficulty={difficulty} art={art} onUploaded={addArt} activityId={activityId} />
          ) : (
            <MatchEditor value={match} onChange={setMatch} art={art} onUploaded={addArt} activityId={activityId} />
          )}
          <div aria-live="polite">
            {issues.length ? (
              <div className="space-y-1 rounded-card border border-primary bg-primary-soft p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <TriangleAlert className="size-5 text-primary" aria-hidden="true" /> Before this can be published
                </p>
                <ul className="list-disc space-y-0.5 pl-6 text-meta">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                <p className="text-meta text-text-secondary">You can still save the draft and come back to it.</p>
              </div>
            ) : (
              <p className="text-meta text-text-secondary">The game is complete. Save the draft, then preview it.</p>
            )}
          </div>
        </>
      ) : null}
    </fieldset>
  );
}

function RowTools({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (by: -1 | 1) => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Button variant="ghost" size="sm" icon={<ArrowUp className="size-4" aria-hidden="true" />} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>
        Up
      </Button>
      <Button variant="ghost" size="sm" icon={<ArrowDown className="size-4" aria-hidden="true" />} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>
        Down
      </Button>
      <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={onRemove} aria-label={`Remove ${label}`}>
        Remove
      </Button>
    </div>
  );
}

function StoryEditor({
  value,
  onChange,
  difficulty,
  art,
  onUploaded,
  activityId,
}: {
  value: StoryConfig;
  onChange: (v: StoryConfig) => void;
  difficulty: Difficulty;
  art: ArtOption[];
  onUploaded: (a: ArtOption) => void;
  activityId: string | null;
}) {
  const r = STORY_RULES[difficulty];
  const set = (i: number, patch: Partial<StoryScene>) => onChange({ ...value, scenes: value.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const scenes = value.scenes;
  return (
    <div className="space-y-4">
      <p className="text-meta text-text-secondary">
        Add the scenes <strong>in the correct order</strong>. Children see them mixed up. {difficulty[0].toUpperCase() + difficulty.slice(1)}: {r.min} to {r.max} scenes, {r.hints}{" "}
        {r.hints === 1 ? "hint" : "hints"} each try. (Beginner 3–4 scenes and 3 hints; Growing 4–6 and 2; Challenge 5–8 and 1.)
      </p>
      <ol className="space-y-4">
        {scenes.map((s, i) => (
          <li key={s.id} className="space-y-3 rounded-card border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Scene {i + 1}</h3>
              <RowTools
                index={i}
                count={scenes.length}
                label={`scene ${i + 1}`}
                onMove={(by) => onChange({ ...value, scenes: move(scenes, i, by) })}
                onRemove={() => onChange({ ...value, scenes: scenes.filter((_, k) => k !== i) })}
              />
            </div>
            <PicturePicker label="Picture" value={s.image} onChange={(image) => set(i, { image })} art={art} onUploaded={onUploaded} activityId={activityId} />
            <TextField id={`${s.id}-caption`} name="" label="Caption" value={s.caption} maxLength={LIMITS.caption} onChange={(e) => set(i, { caption: e.target.value })} hint="Short, shown under the picture." />
            <TextField
              id={`${s.id}-description`}
              name=""
              label="Picture description"
              value={s.description}
              maxLength={LIMITS.description}
              onChange={(e) => set(i, { description: e.target.value })}
              hint="For people who can't see the picture. Leave empty if the caption says it all."
              optional
            />
            <TextField id={`${s.id}-clue`} name="" label="Hint" value={s.clue} maxLength={LIMITS.clue} onChange={(e) => set(i, { clue: e.target.value })} hint="A gentle clue, shown when a hint puts this scene in place." optional />
            <TextAreaField
              id={`${s.id}-note`}
              name=""
              rows={2}
              label="What happened"
              value={s.note}
              maxLength={LIMITS.note}
              onChange={(e) => set(i, { note: e.target.value })}
              hint="Shown with the correct order at the end. Include the verse, like (Genesis 8:11)."
              optional
            />
          </li>
        ))}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        icon={<Plus className="size-4" aria-hidden="true" />}
        disabled={scenes.length >= MAX_SCENES}
        onClick={() => onChange({ ...value, scenes: [...scenes, { id: newId("s"), image: null, caption: "", description: "", clue: "", note: "" }] })}
      >
        {scenes.length >= MAX_SCENES ? `Up to ${MAX_SCENES} scenes` : "Add a scene"}
      </Button>
      <TextAreaField
        id="story-wrap-up"
        name=""
        rows={2}
        label="Closing explanation"
        value={value.wrap_up}
        maxLength={LIMITS.wrap_up}
        onChange={(e) => onChange({ ...value, wrap_up: e.target.value })}
        hint="Shown after the story is in order: what it teaches."
        optional
      />
    </div>
  );
}

const blankCard = (): MatchCard => ({ image: null, label: "", description: "" });

function MatchEditor({
  value,
  onChange,
  art,
  onUploaded,
  activityId,
}: {
  value: MatchConfig;
  onChange: (v: MatchConfig) => void;
  art: ArtOption[];
  onUploaded: (a: ArtOption) => void;
  activityId: string | null;
}) {
  const related = value.mode === "related";
  const set = (i: number, patch: Partial<MatchPair>) => onChange({ ...value, pairs: value.pairs.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const setCard = (i: number, side: "a" | "b", patch: Partial<MatchCard>) => set(i, { [side]: { ...(value.pairs[i][side] ?? blankCard()), ...patch } });
  const pairs = value.pairs;
  const card = (p: MatchPair, i: number, side: "a" | "b", title: string) => {
    const c = p[side] ?? blankCard();
    return (
      <div className="space-y-3">
        <PicturePicker label={title} value={c.image} onChange={(image) => setCard(i, side, { image })} art={art} onUploaded={onUploaded} activityId={activityId} />
        <TextField
          id={`${p.id}-${side}-label`}
          name=""
          label="Name on the card"
          value={c.label}
          maxLength={LIMITS.label}
          onChange={(e) => setCard(i, side, { label: e.target.value })}
          hint={related ? "For example a person (Noah) or an object (Ark). A picture, a name, or both." : "Optional, shown under the picture."}
          optional={!related}
        />
        <TextField
          id={`${p.id}-${side}-description`}
          name=""
          label="Picture description"
          value={c.description}
          maxLength={LIMITS.description}
          onChange={(e) => setCard(i, side, { description: e.target.value })}
          hint="For people who can't see it, when the name doesn't say enough."
          optional
        />
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <fieldset className="space-y-1">
        <legend className="font-semibold">Kind of pairs</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" checked={!related} onChange={() => onChange({ ...value, mode: "identical", pairs: pairs.map((p) => ({ ...p, b: null })) })} className="size-5" />
          <span>Identical pictures (two cards the same)</span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" checked={related} onChange={() => onChange({ ...value, mode: "related", pairs: pairs.map((p) => ({ ...p, b: p.b ?? blankCard() })) })} className="size-5" />
          <span>Related pairs (like a person and something from their story)</span>
        </label>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Board sizes children can choose</legend>
        <p className="text-meta text-text-secondary">The smallest is the starting board. Each size needs at least that many pairs.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {BOARD_SIZES.map((n) => (
            <label key={n} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={value.sizes.includes(n)}
                onChange={(e) => onChange({ ...value, sizes: e.target.checked ? [...value.sizes, n].sort((x, y) => x - y) : value.sizes.filter((x) => x !== n) })}
              />
              <span className={cn(n > pairs.length && "text-text-secondary")}>{n} pairs</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" className="size-5" checked={value.show_moves} onChange={(e) => onChange({ ...value, show_moves: e.target.checked })} />
        <span>Show a turn counter (just a count: no timer, score, or ranking)</span>
      </label>
      <ol className="space-y-4">
        {pairs.map((p, i) => (
          <li key={p.id} className="space-y-3 rounded-card border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Pair {i + 1}</h3>
              <RowTools
                index={i}
                count={pairs.length}
                label={`pair ${i + 1}`}
                onMove={(by) => onChange({ ...value, pairs: move(pairs, i, by) })}
                onRemove={() => onChange({ ...value, pairs: pairs.filter((_, k) => k !== i) })}
              />
            </div>
            {related ? (
              <div className="grid gap-4 md:grid-cols-2">
                {card(p, i, "a", "First card")}
                {card(p, i, "b", "Second card")}
              </div>
            ) : (
              card(p, i, "a", "Picture (both cards)")
            )}
            <TextAreaField
              id={`${p.id}-note`}
              name=""
              rows={2}
              label={related ? "Why they belong together" : "Something to say when it's found"}
              value={p.note}
              maxLength={LIMITS.note}
              onChange={(e) => set(i, { note: e.target.value })}
              hint="Shown when the pair is matched. Include the verse, like (1 Samuel 17:40)."
              optional={!related}
            />
          </li>
        ))}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        icon={<Plus className="size-4" aria-hidden="true" />}
        disabled={pairs.length >= MAX_PAIRS}
        onClick={() => onChange({ ...value, pairs: [...pairs, { id: newId("p"), a: blankCard(), b: related ? blankCard() : null, note: "" }] })}
      >
        {pairs.length >= MAX_PAIRS ? `Up to ${MAX_PAIRS} pairs` : "Add a pair"}
      </Button>
    </div>
  );
}
