import { plainText, type ActivityKind, type Difficulty } from "@/lib/youth/activities";
import { isGameArtKey, type GameArtKey } from "./art";

/**
 * Learn & Play game configuration: the data a version gives the Story Order
 * and Bible Match players. It is data only (no URLs, markup, or code). The
 * database checks the same shape when a draft is saved
 * (youth.game_config_problem) and completeness when it is published
 * (youth.game_config_issues); these helpers shape the editor's fields, show
 * the same problems while editing, and read a stored configuration
 * defensively in the players.
 */
export type GameImage = { asset: string } | { art: GameArtKey };

export type StoryScene = {
  id: string;
  image: GameImage | null;
  caption: string;
  /** The picture's description for people who can't see it (optional; the caption is always shown). */
  description: string;
  /** A gentle clue shown when a hint places this scene. */
  clue: string;
  /** What happened here, shown with the correct order at the end. */
  note: string;
};

export type StoryConfig = { player: "story_order"; scenes: StoryScene[]; wrap_up: string };

export type MatchCard = { image: GameImage | null; label: string; description: string };

export type MatchPair = { id: string; a: MatchCard; b: MatchCard | null; note: string };

export type MatchMode = "identical" | "related";

export type MatchConfig = { player: "bible_match"; mode: MatchMode; sizes: number[]; show_moves: boolean; pairs: MatchPair[] };

export type GameConfig = StoryConfig | MatchConfig;

export const MAX_SCENES = 8;
export const MAX_PAIRS = 12;
export const BOARD_SIZES = [3, 4, 6, 8, 10, 12] as const;
export const LIMITS = { caption: 80, description: 300, clue: 160, note: 300, wrap_up: 600, label: 40 } as const;

/** Difficulty sets how many scenes a story has and how many hints each try offers. */
export const STORY_RULES: Record<Difficulty, { min: number; max: number; hints: number }> = {
  beginner: { min: 3, max: 4, hints: 3 },
  growing: { min: 4, max: 6, hints: 2 },
  challenge: { min: 5, max: 8, hints: 1 },
};

/** Which player an activity type uses. */
export const GAME_FOR_KIND: Partial<Record<ActivityKind, GameConfig["player"]>> = { puzzle: "story_order", matching: "bible_match" };

export const GAME_NAMES: Record<GameConfig["player"], string> = { story_order: "Put the Story in Order", bible_match: "Bible Match" };

const ID = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown, max: number, multiline = false) => (typeof v === "string" ? plainText(v, max, multiline) : "");

export function parseImage(v: unknown): GameImage | null {
  const o = obj(v);
  if (!o) return null;
  if (typeof o.asset === "string" && UUID.test(o.asset) && !("art" in o)) return { asset: o.asset };
  if (isGameArtKey(o.art) && !("asset" in o)) return { art: o.art };
  return null;
}

/** A stable key for "these two pictures are the same". */
export const imageKey = (i: GameImage | null) => (!i ? null : "asset" in i ? `asset:${i.asset}` : `art:${i.art}`);

function uniqueIds<T extends { id: string }>(items: T[], prefix: string): T[] {
  const seen = new Set<string>();
  return items.map((item, i) => {
    let id = ID.test(item.id) && !seen.has(item.id) ? item.id : `${prefix}${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    return { ...item, id };
  });
}

function parseCard(v: unknown): MatchCard {
  const o = obj(v) ?? {};
  return { image: parseImage(o.image), label: text(o.label, LIMITS.label), description: text(o.description, LIMITS.description) };
}

/**
 * Reads a story configuration (stored, or from the editor), keeping only
 * known fields with clean text. Null when it isn't a story.
 */
export function parseStoryConfig(raw: unknown): StoryConfig | null {
  const o = obj(raw);
  if (!o || o.player !== "story_order") return null;
  const scenes = (Array.isArray(o.scenes) ? o.scenes : []).slice(0, MAX_SCENES).map((s) => {
    const x = obj(s) ?? {};
    return {
      id: typeof x.id === "string" ? x.id : "",
      image: parseImage(x.image),
      caption: text(x.caption, LIMITS.caption),
      description: text(x.description, LIMITS.description),
      clue: text(x.clue, LIMITS.clue),
      note: text(x.note, LIMITS.note),
    };
  });
  return { player: "story_order", scenes: uniqueIds(scenes, "s"), wrap_up: text(o.wrap_up, LIMITS.wrap_up, true) };
}

export function parseMatchConfig(raw: unknown): MatchConfig | null {
  const o = obj(raw);
  if (!o || o.player !== "bible_match") return null;
  const mode: MatchMode = o.mode === "related" ? "related" : "identical";
  const sizes = [...new Set((Array.isArray(o.sizes) ? o.sizes : []).filter((n): n is number => (BOARD_SIZES as readonly unknown[]).includes(n)))].sort((a, b) => a - b);
  const pairs = (Array.isArray(o.pairs) ? o.pairs : []).slice(0, MAX_PAIRS).map((p) => {
    const x = obj(p) ?? {};
    return {
      id: typeof x.id === "string" ? x.id : "",
      a: parseCard(x.a),
      b: mode === "related" ? parseCard(x.b) : null,
      note: text(x.note, LIMITS.note),
    };
  });
  return { player: "bible_match", mode, sizes, show_moves: o.show_moves === true, pairs: uniqueIds(pairs, "p") };
}

export function parseGameConfig(kind: string, raw: unknown): GameConfig | null {
  if (kind === "puzzle") return parseStoryConfig(raw);
  if (kind === "matching") return parseMatchConfig(raw);
  return null;
}

/** The stored form: empty optional fields left out, so versions stay small. */
export function compactConfig(c: GameConfig): Record<string, unknown> {
  const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== null));
  if (c.player === "story_order") {
    return drop({ player: c.player, scenes: c.scenes.map((s) => drop({ ...s })), wrap_up: c.wrap_up });
  }
  return {
    player: c.player,
    mode: c.mode,
    sizes: c.sizes,
    show_moves: c.show_moves,
    pairs: c.pairs.map((p) => drop({ id: p.id, a: drop({ ...p.a }), b: p.b ? drop({ ...p.b }) : null, note: p.note })),
  };
}

const plural = (n: number) => (n === 1 ? "is" : "are");

/**
 * What still keeps a game from being published, in the editor's words (the
 * same rules as youth.game_config_issues; that one also knows when an
 * uploaded picture was removed).
 */
export function gameIssues(c: GameConfig, difficulty: Difficulty): string[] {
  const out: string[] = [];
  if (c.player === "story_order") {
    const n = c.scenes.length;
    const r = STORY_RULES[difficulty];
    if (n === 0) out.push("Add the story's scenes, in the correct order.");
    else if (n < r.min || n > r.max) {
      const level = difficulty[0].toUpperCase() + difficulty.slice(1);
      out.push(`A ${level} story needs ${r.min} to ${r.max} scenes (it has ${n}). Change the scenes or the difficulty.`);
    }
    c.scenes.forEach((s, i) => {
      if (!s.image) out.push(`Scene ${i + 1} needs a picture.`);
      if (!s.caption.trim()) out.push(`Scene ${i + 1} needs a caption.`);
    });
    return out;
  }
  const n = c.pairs.length;
  if (n < 3) out.push(`Add at least 3 pairs (there ${plural(n)} ${n}).`);
  const seen = new Map<string, number>();
  c.pairs.forEach((p, i) => {
    const sides: Array<["first" | "second", MatchCard]> = c.mode === "related" ? [["first", p.a], ["second", p.b ?? { image: null, label: "", description: "" }]] : [["first", p.a]];
    for (const [side, card] of sides) {
      if (c.mode === "identical" && !card.image) out.push(`Pair ${i + 1} needs a picture.`);
      if (c.mode === "related" && !card.image && !card.label.trim()) out.push(`Pair ${i + 1} needs a picture or a name on its ${side} card.`);
      const key = c.mode === "related" ? (card.image || card.label.trim() ? `${imageKey(card.image) ?? ""}|${card.label.trim().toLowerCase()}` : null) : imageKey(card.image);
      if (key === null) continue;
      const other = seen.get(key);
      if (other !== undefined && other !== i + 1) out.push(`Pairs ${other} and ${i + 1} have cards that look the same. Change one of them.`);
      else if (other === undefined) seen.set(key, i + 1);
    }
    if (c.mode === "related" && !p.note.trim()) out.push(`Pair ${i + 1} needs a short explanation, shown when it's matched.`);
  });
  if (!c.sizes.length) out.push("Choose at least one board size.");
  for (const s of c.sizes) if (s > n) out.push(`A board of ${s} pairs needs at least ${s} pairs (there ${plural(n)} ${n}).`);
  return [...new Set(out)];
}

export function emptyStory(): StoryConfig {
  return { player: "story_order", scenes: [], wrap_up: "" };
}

export function emptyMatch(): MatchConfig {
  return { player: "bible_match", mode: "identical", sizes: [3, 4, 6], show_moves: false, pairs: [] };
}
