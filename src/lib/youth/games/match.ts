import type { MatchConfig, MatchPair } from "./config";
import { isSeed, nextSeed, rng, shuffled } from "./random";

/**
 * Bible Match: the memory game as a pure state machine. Every tap is one
 * action applied to the latest state, so rapid or repeated taps can't flip a
 * third card, match a pair twice, or count a move twice.
 *
 * Nothing is timed. A pair that doesn't match stays face up until the next
 * tap (or "Turn them back"), so nobody has to read quickly.
 *
 * Cards are "<pair id>:a" and "<pair id>:b". The board (which pairs, in
 * which places) is rebuilt from the seed and size, so it is the same after a
 * reload or on another device.
 */
export type MatchState = {
  size: number;
  seed: number;
  /** Card ids in board order. */
  deck: string[];
  /** Pair ids found so far, in the order they were found. */
  matched: string[];
  /** Face-up cards that aren't matched yet: none, one, or a non-matching two. */
  faceUp: string[];
  /** One move = turning over two cards. */
  moves: number;
  /** The pair just found (to show its explanation). */
  lastMatch: string | null;
  /** The last two cards that didn't match (for gentle feedback). */
  lastMiss: [string, string] | null;
  solved: boolean;
  completions: number;
};

export type MatchAction = { type: "flip"; card: string } | { type: "cover" } | { type: "restart"; size?: number } | { type: "replay" };

export const pairOf = (card: string) => card.slice(0, card.lastIndexOf(":"));

/** The board sizes this configuration can fill, smallest first. */
export function availableSizes(c: MatchConfig): number[] {
  return c.sizes.filter((s) => s <= c.pairs.length);
}

export function buildDeck(c: MatchConfig, size: number, seed: number): string[] {
  const next = rng(seed);
  const pick = shuffled(
    c.pairs.map((p) => p.id),
    Math.floor(next() * 2 ** 31),
  ).slice(0, size);
  return shuffled(
    pick.flatMap((id) => [`${id}:a`, `${id}:b`]),
    Math.floor(next() * 2 ** 31),
  );
}

export function newMatch(c: MatchConfig, size: number, seed: number, completions = 0): MatchState {
  return { size, seed, deck: buildDeck(c, size, seed), matched: [], faceUp: [], moves: 0, lastMatch: null, lastMiss: null, solved: false, completions };
}

export function matchReducer(c: MatchConfig) {
  return (s: MatchState, a: MatchAction): MatchState => {
    switch (a.type) {
      case "flip": {
        const card = a.card;
        if (s.solved || !s.deck.includes(card) || s.matched.includes(pairOf(card)) || s.faceUp.includes(card)) return s;
        // Two non-matching cards are showing: this tap turns them back and starts a new turn.
        if (s.faceUp.length !== 1) return { ...s, faceUp: [card], lastMatch: null, lastMiss: null };
        const first = s.faceUp[0];
        const moves = s.moves + 1;
        if (pairOf(first) === pairOf(card)) {
          const matched = [...s.matched, pairOf(card)];
          const solved = matched.length === s.size;
          return { ...s, faceUp: [], matched, moves, lastMatch: pairOf(card), lastMiss: null, solved, completions: s.completions + (solved ? 1 : 0) };
        }
        return { ...s, faceUp: [first, card], moves, lastMatch: null, lastMiss: [first, card] };
      }
      case "cover":
        return s.faceUp.length === 2 ? { ...s, faceUp: [], lastMiss: null } : s;
      case "restart": {
        const size = a.size && availableSizes(c).includes(a.size) ? a.size : s.size;
        return newMatch(c, size, nextSeed(s.seed), s.completions);
      }
      case "replay":
        return s.solved ? newMatch(c, s.size, nextSeed(s.seed), s.completions) : s;
    }
  };
}

export function matchData(s: MatchState): Record<string, unknown> {
  return { game: "bible_match", size: s.size, seed: s.seed, matched: s.matched, moves: s.moves, solved: s.solved, completions: s.completions };
}

/** Saved progress, if it still fits this version's pairs; otherwise a fresh board on the smallest size. */
export function resumeMatch(c: MatchConfig, data: Record<string, unknown> | null | undefined, seed: number, completed = false): MatchState | null {
  const sizes = availableSizes(c);
  if (!sizes.length) return null;
  const d = data ?? {};
  const completions = Math.max(typeof d.completions === "number" && Number.isInteger(d.completions) ? d.completions : 0, completed ? 1 : 0);
  const size = typeof d.size === "number" && sizes.includes(d.size) ? d.size : sizes[0];
  if (d.game !== "bible_match" || !isSeed(d.seed) || d.size !== size) return newMatch(c, size, isSeed(d.seed) ? (d.seed as number) : seed, completions);
  const deck = buildDeck(c, size, d.seed as number);
  const onBoard = new Set(deck.map(pairOf));
  const matched = Array.isArray(d.matched) ? [...new Set(d.matched.filter((id): id is string => typeof id === "string" && onBoard.has(id)))] : [];
  const solved = d.solved === true && matched.length === size;
  const moves = typeof d.moves === "number" && d.moves >= 0 ? Math.floor(d.moves) : 0;
  return { size, seed: d.seed as number, deck, matched, faceUp: [], moves, lastMatch: null, lastMiss: null, solved, completions };
}

export function pairById(c: MatchConfig, id: string): MatchPair | undefined {
  return c.pairs.find((p) => p.id === id);
}

/** The face of a card: in identical mode both cards show the first card's picture. */
export function cardFace(c: MatchConfig, card: string) {
  const p = pairById(c, pairOf(card));
  if (!p) return null;
  return c.mode === "related" && card.endsWith(":b") ? (p.b ?? p.a) : p.a;
}

/** Arrow-key movement in a grid of `count` cells with `cols` columns (Home/End to the ends). */
export function gridStep(index: number, key: string, cols: number, count: number): number {
  switch (key) {
    case "ArrowRight":
      return Math.min(count - 1, index + 1);
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowDown":
      return index + cols < count ? index + cols : index;
    case "ArrowUp":
      return index - cols >= 0 ? index - cols : index;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return index;
  }
}
