/**
 * Learn & Play: activity labels, filters, and age guidance shared by the
 * member pages and the editor. The database decides who may see or play an
 * activity; nothing here grants access.
 *
 * Activity types are a fixed list whose players ship with the app. An
 * activity's configuration is data for that player (validated in the
 * database), never uploaded code.
 */
export const ACTIVITY_KINDS = [
  { key: "story", label: "Bible story", hint: "Read or listen to a story together." },
  { key: "quiz", label: "Quiz", hint: "Questions about the story or lesson." },
  { key: "matching", label: "Matching", hint: "Pair up pictures, words, or verses." },
  { key: "puzzle", label: "Puzzle", hint: "Put the pieces or the story in order." },
  { key: "drawing", label: "Drawing & coloring", hint: "Draw, color, or decorate." },
  { key: "word_game", label: "Word game", hint: "Find, unscramble, or fill in words." },
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]["key"];

/** Difficulty is about the activity, not the child: any child may try any level. */
export const DIFFICULTIES = [
  { key: "beginner", label: "Beginner", hint: "A gentle start, with lots of help." },
  { key: "growing", label: "Growing", hint: "A little more to think about." },
  { key: "challenge", label: "Challenge", hint: "For when they're ready to stretch." },
] as const;

export type Difficulty = (typeof DIFFICULTIES)[number]["key"];

export const CONTENT_SOURCES: Array<[string, string]> = [
  ["original", "Original (written for the church)"],
  ["adapted", "Adapted from another source"],
  ["licensed", "Licensed"],
  ["public_domain", "Public domain"],
  ["permission", "Used with permission"],
];

export const ART_SOURCES: Array<[string, string]> = [
  ["original", "Original (made for the church)"],
  ["licensed", "Licensed (stock or purchased)"],
  ["public_domain", "Public domain"],
  ["permission", "Used with the artist's permission"],
];

export const ACTIVITY_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "info" }> = {
  draft: { label: "Draft", tone: "info" },
  preview: { label: "Ready for preview", tone: "warning" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

const kindLabels = new Map<string, string>(ACTIVITY_KINDS.map((k) => [k.key, k.label]));
const difficultyLabels = new Map<string, string>(DIFFICULTIES.map((d) => [d.key, d.label]));

export const kindLabel = (k: string) => kindLabels.get(k) ?? "Activity";
export const difficultyLabel = (d: string) => difficultyLabels.get(d) ?? "";

export function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === "string" && kindLabels.has(v);
}

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === "string" && difficultyLabels.has(v);
}

/**
 * Suggested ages, worded as guidance ("Suggested for ages 4–7"). Null when
 * none was given. Never used to hide or refuse an activity.
 */
export function ageGuidance(min: number | null | undefined, max: number | null | undefined): string | null {
  const lo = typeof min === "number" ? min : null;
  const hi = typeof max === "number" ? max : null;
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null) return lo === hi ? `Suggested for age ${lo}` : `Suggested for ages ${lo}–${hi}`;
  if (lo !== null) return `Suggested for ages ${lo} and up`;
  return `Suggested for ages up to ${hi}`;
}

/** Older-youth activities (suggested from age 11) get the more grown-up card style. */
export const OLDER_YOUTH_FROM = 11;

export function isOlderYouth(min: number | null | undefined): boolean {
  return typeof min === "number" && min >= OLDER_YOUTH_FROM;
}

export type ActivityFilters = { kind: ActivityKind | null; difficulty: Difficulty | null };

/** Reads the browse filters from search params; unknown values are ignored. */
export function parseFilters(params: Record<string, string | string[] | undefined>): ActivityFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const kind = one(params.type);
  const difficulty = one(params.level);
  return { kind: isActivityKind(kind) ? kind : null, difficulty: isDifficulty(difficulty) ? difficulty : null };
}

export function applyFilters<T extends { kind: string; difficulty: string }>(items: T[], f: ActivityFilters): T[] {
  return items.filter((a) => (!f.kind || a.kind === f.kind) && (!f.difficulty || a.difficulty === f.difficulty));
}

export function filterHref(base: string, f: ActivityFilters): string {
  const q = new URLSearchParams();
  if (f.kind) q.set("type", f.kind);
  if (f.difficulty) q.set("level", f.difficulty);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * Plain text from an editor field: drops HTML tags and control characters
 * (newlines and tabs kept when `multiline`), and trims. The database refuses
 * markup as well; this keeps a pasted snippet from failing the whole form.
 */
export function plainText(value: string, max: number, multiline = false): string {
  const noTags = value.replace(/<\/?[a-z!?][^>]*>/gi, "");
  const control = multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return noTags.replace(control, multiline ? "" : " ").replace(multiline ? /[ \t]+$/gm : / {2,}/g, multiline ? "" : " ").trim().slice(0, max);
}

/** One Scripture reference per line (or separated by semicolons), up to 10. */
export function parseScriptureRefs(value: string): string[] {
  return value
    .split(/[\n;]+/)
    .map((r) => plainText(r, 60))
    .filter(Boolean)
    .slice(0, 10);
}

/** Lesson connections due this week come first, then the rest by title. */
export function sortForHome<T extends { this_week: boolean; title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.this_week) - Number(a.this_week) || a.title.localeCompare(b.title));
}

export type ActivityCard = {
  id: string;
  version_id: string;
  version: number;
  title: string;
  summary: string;
  kind: ActivityKind;
  difficulty: Difficulty;
  age_min: number | null;
  age_max: number | null;
  bible_story: string;
  scripture_refs: string[];
  lesson_title: string;
  lesson_week: string | null;
  this_week: boolean;
  cover_path: string | null;
  cover_alt: string;
  cover_decorative: boolean;
  /** Children the viewer may play this for (home list only). */
  players?: string[];
  progress?: Array<{ child_id: string; status: "started" | "completed" }>;
};

/** One version's full content (the activity page and the editor preview). */
export type ActivityDetail = Omit<ActivityCard, "players" | "progress"> & { description: string; config: Record<string, unknown> };

export type Player = { id: string; display_name: string };

export type ActivityProgress = {
  id: string;
  child_id: string;
  version_id: string;
  version: number;
  status: "started" | "completed";
  revision: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  data?: Record<string, unknown>;
};
