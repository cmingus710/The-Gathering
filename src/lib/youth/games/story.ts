import type { StoryConfig } from "./config";
import { isSeed, nextSeed, shuffled } from "./random";

/**
 * Put the Story in Order: the game as a pure state machine, so every rule
 * (shuffling, moving, hints, checking, starting over, replaying, resuming)
 * is the same in the member player, the editor preview, and the tests.
 *
 * Nothing is timed. Checking never takes anything away: it only says which
 * scenes are already in the right place. A hint moves the first scene that
 * isn't in its place into it and pins it there.
 */
export type StoryState = {
  seed: number;
  /** Scene ids, in the order the child has arranged them. */
  order: string[];
  /** Scenes placed by a hint: already right, and they stay put. */
  pinned: string[];
  hintsUsed: number;
  checks: number;
  /** After Check Answer: the scenes that were in the right place (cleared by the next move). */
  checked: string[] | null;
  /** The scene the last hint placed (to show its clue). */
  lastHint: string | null;
  solved: boolean;
  /** How many times this child has finished this version (never reduced). */
  completions: number;
};

export type StoryAction =
  | { type: "move"; id: string; to: number }
  | { type: "step"; id: string; by: -1 | 1 }
  | { type: "check" }
  | { type: "hint"; max: number }
  | { type: "dismiss" }
  | { type: "restart" }
  | { type: "replay" };

const correctOrder = (c: StoryConfig) => c.scenes.map((s) => s.id);

/** A shuffled arrangement that is never already solved (for two or more scenes). */
export function shuffleScenes(ids: string[], seed: number): string[] {
  const out = shuffled(ids, seed);
  if (ids.length > 1 && out.every((id, i) => id === ids[i])) out.push(out.shift()!);
  return out;
}

export function newStory(c: StoryConfig, seed: number, completions = 0): StoryState {
  return { seed, order: shuffleScenes(correctOrder(c), seed), pinned: [], hintsUsed: 0, checks: 0, checked: null, lastHint: null, solved: false, completions };
}

/** Which slots are right now (by scene id). */
export function inPlace(c: StoryConfig, order: string[]): string[] {
  const right = correctOrder(c);
  return order.filter((id, i) => right[i] === id);
}

function moveTo(order: string[], pinned: string[], id: string, to: number): string[] {
  const from = order.indexOf(id);
  if (from < 0 || to < 0 || to >= order.length || from === to || pinned.includes(id) || pinned.includes(order[to])) return order;
  // Only the free slots shift; pinned scenes keep their places.
  const freeSlots = order.map((x, i) => (pinned.includes(x) ? -1 : i)).filter((i) => i >= 0);
  const free = freeSlots.map((i) => order[i]);
  const fi = free.indexOf(id);
  const ti = freeSlots.indexOf(to);
  free.splice(fi, 1);
  free.splice(ti, 0, id);
  const out = [...order];
  freeSlots.forEach((slot, k) => (out[slot] = free[k]));
  return out;
}

/** The nearest free slot from `from` in a direction, or -1. */
function nextFree(order: string[], pinned: string[], from: number, by: -1 | 1): number {
  for (let i = from + by; i >= 0 && i < order.length; i += by) if (!pinned.includes(order[i])) return i;
  return -1;
}

export function storyReducer(c: StoryConfig) {
  return (s: StoryState, a: StoryAction): StoryState => {
    switch (a.type) {
      case "move":
      case "step": {
        if (s.solved) return s;
        const to = a.type === "move" ? a.to : nextFree(s.order, s.pinned, s.order.indexOf(a.id), a.by);
        const order = moveTo(s.order, s.pinned, a.id, to);
        return order === s.order ? s : { ...s, order, checked: null, lastHint: null };
      }
      case "check": {
        if (s.solved) return s;
        const right = inPlace(c, s.order);
        const solved = right.length === s.order.length;
        return { ...s, checks: s.checks + 1, checked: right, solved, lastHint: null, completions: s.completions + (solved ? 1 : 0) };
      }
      case "hint": {
        if (s.solved || s.hintsUsed >= a.max) return s;
        const right = correctOrder(c);
        const slot = s.order.findIndex((id, i) => right[i] !== id);
        if (slot < 0) return s;
        const id = right[slot];
        const order = [...s.order];
        const from = order.indexOf(id);
        [order[slot], order[from]] = [order[from], order[slot]];
        return { ...s, order, pinned: [...s.pinned, id], hintsUsed: s.hintsUsed + 1, checked: null, lastHint: id };
      }
      case "dismiss":
        return { ...s, checked: null, lastHint: null };
      case "restart":
        return newStory(c, nextSeed(s.seed), s.completions);
      case "replay":
        return s.solved ? newStory(c, nextSeed(s.seed), s.completions) : s;
    }
  };
}

/** What's saved with the child's progress (simple keys and values only). */
export function storyData(s: StoryState): Record<string, unknown> {
  return {
    game: "story_order",
    seed: s.seed,
    order: s.order,
    pinned: s.pinned,
    hints_used: s.hintsUsed,
    checks: s.checks,
    solved: s.solved,
    completions: s.completions,
  };
}

/**
 * Picks up saved progress when it still fits this version's scenes;
 * otherwise starts a fresh board (keeping the completion count).
 */
export function resumeStory(c: StoryConfig, data: Record<string, unknown> | null | undefined, seed: number, completed = false): StoryState {
  const d = data ?? {};
  const completions = Math.max(typeof d.completions === "number" && Number.isInteger(d.completions) ? d.completions : 0, completed ? 1 : 0);
  const ids = correctOrder(c);
  const order = Array.isArray(d.order) ? d.order : [];
  const pinned = Array.isArray(d.pinned) ? d.pinned : [];
  const fits =
    d.game === "story_order" &&
    isSeed(d.seed) &&
    order.length === ids.length &&
    new Set(order).size === ids.length &&
    order.every((id) => typeof id === "string" && ids.includes(id)) &&
    pinned.every((id) => typeof id === "string" && order.indexOf(id) === ids.indexOf(id));
  if (!fits) return newStory(c, isSeed(d.seed) ? (d.seed as number) : seed, completions);
  const hintsUsed = typeof d.hints_used === "number" && d.hints_used >= 0 ? Math.floor(d.hints_used) : 0;
  const checks = typeof d.checks === "number" && d.checks >= 0 ? Math.floor(d.checks) : 0;
  const solved = d.solved === true && inPlace(c, order as string[]).length === ids.length;
  return { seed: d.seed as number, order: order as string[], pinned: pinned as string[], hintsUsed, checks, checked: null, lastHint: null, solved, completions };
}
