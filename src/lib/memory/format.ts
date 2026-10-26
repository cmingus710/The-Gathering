import type { Activity, Confidence, Difficulty, Quality, ReviewChange, Stage } from "./types";

/** Member-facing wording for scripture memory. Kept in one place so the
 *  pages, the practice screens, and the guides describe things the same way. */

export const ACTIVITIES: Array<{ key: Activity; label: string; short: string; description: string; kids: string; recall: "always" | "challenge" | "never" }> = [
  {
    key: "read_repeat",
    label: "Read & repeat",
    short: "Read",
    description: "Read the verse aloud, then hide words step by step and say it again. Reveal it whenever you like.",
    kids: "Read it, hide some words, and say it again!",
    recall: "never",
  },
  {
    key: "flashcards",
    label: "Flashcards",
    short: "Cards",
    description: "See the reference, say the verse, then flip the card and tell us how you did.",
    kids: "Look at the card, say the verse, then flip it.",
    recall: "always",
  },
  {
    key: "missing_words",
    label: "Missing words",
    short: "Blanks",
    description: "Fill in hidden words: choose from a list in Guided and Growing, or type them in Challenge.",
    kids: "Find the words that are missing.",
    recall: "challenge",
  },
  {
    key: "word_order",
    label: "Word order",
    short: "Order",
    description: "Put phrases or words back in the right order. Tap or use the keyboard; no dragging needed.",
    kids: "Put the words in the right order.",
    recall: "challenge",
  },
  {
    key: "type_verse",
    label: "Type the verse",
    short: "Type",
    description: "Type the verse from memory and see exactly where it matches. Ask for the next word if you're stuck.",
    kids: "Type the verse from memory.",
    recall: "always",
  },
  {
    key: "self_check",
    label: "Self-check recitation",
    short: "Recite",
    description: "See only the reference, recite away from the screen, then reveal the verse and check yourself honestly.",
    kids: "Say it out loud, then check!",
    recall: "always",
  },
];

export function activityLabel(a: Activity): string {
  return ACTIVITIES.find((x) => x.key === a)?.label ?? a;
}

export const DIFFICULTIES: Array<{ key: Difficulty; label: string; description: string }> = [
  { key: "guided", label: "Guided", description: "Fewer hidden words, longer phrases, word choices. A good start for anyone, and for practicing with children." },
  { key: "growing", label: "Growing", description: "More hidden words, shorter phrases, a few extra word choices." },
  { key: "challenge", label: "Challenge", description: "Type hidden words yourself and order single words. These count as recall." },
];

export function difficultyLabel(d: Difficulty): string {
  return DIFFICULTIES.find((x) => x.key === d)?.label ?? d;
}

export const STAGES: Record<Stage, { label: string; description: string }> = {
  new: { label: "New", description: "Not practiced yet, or just starting." },
  learning: { label: "Learning", description: "Recalled once or twice. Reviews come back within a day or two." },
  reviewing: { label: "Reviewing", description: "Recalled on separate days. Reviews spread out to 4, 7, then 14 days." },
  well_known: { label: "Well known", description: "Recalled over weeks. Still reviewed every 30 to 60 days; nothing is ever marked permanently mastered." },
};

export const CONFIDENCE: Array<{ key: Confidence; label: string; kids: string }> = [
  { key: "not_yet", label: "Not yet", kids: "Not yet" },
  { key: "partly", label: "Partly", kids: "A little" },
  { key: "mostly", label: "Mostly", kids: "Mostly" },
  { key: "fully", label: "Word for word", kids: "Every word!" },
];

export function confidenceLabel(c: Confidence | null): string | null {
  return c ? (CONFIDENCE.find((x) => x.key === c)?.label ?? c) : null;
}

export const QUALITY: Record<Quality, string> = {
  strong: "Recalled",
  partial: "Partly recalled",
  practice: "Needs more practice",
  none: "Practiced",
};

/** What happened to the review schedule, in plain words. */
export function changeExplanation(change: ReviewChange, dueOn: string | null, today?: string): string {
  const when = dueOn ? reviewDate(dueOn, today) : null;
  switch (change) {
    case "advanced":
      return when ? `Next review ${when}.` : "This verse moved ahead.";
    case "kept":
      return when ? `Let's look at it again ${when}.` : "Let's look at it again soon.";
    case "eased":
      return when ? `It'll come back ${when} for a little more practice. Nothing you've done is lost.` : "It'll come back soon for a little more practice.";
    case "early":
      return when ? `Reviewed early, which is great practice. Your next review stays ${when}.` : "Reviewed early, which is great practice.";
    case "already_today":
      return "Your review for today is already counted. Extra practice still helps.";
    default:
      return "Practice counted. Recall activities move a verse along the review schedule.";
  }
}

/** "today", "tomorrow", "in 4 days", or a date. YYYY-MM-DD strings only. */
export function reviewDate(due: string, today?: string): string {
  if (!today) return `on ${formatDay(due)}`;
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return `on ${formatDay(due)}`;
}

export function formatDay(ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function percent(accuracy: number | null): string | null {
  return accuracy === null ? null : `${Math.round(accuracy * 100)}%`;
}

/** Audience label for staff screens. */
export function audienceLabel(c: { audience: string; group_name: string | null }): string {
  return c.audience === "group" ? `Group: ${c.group_name ?? "a group"}` : c.audience === "personal" ? "Personal" : "All members";
}

/** Status label for staff screens. */
export function collectionStatus(c: { status: string; scheduled: boolean }): { label: string; tone: "success" | "warning" | "neutral" | "info" } {
  if (c.status === "archived") return { label: "Archived", tone: "neutral" };
  if (c.status === "draft") return { label: "Draft", tone: "info" };
  return c.scheduled ? { label: "Scheduled", tone: "warning" } : { label: "Published", tone: "success" };
}

/** Whether a licensed version's permission covers all six activities (else unchanged-text practice only). */
export const allExercises = (modes: readonly string[] | null | undefined) => !!modes && modes.includes("missing_words");

/** How a licensed version is practiced, for members and staff. */
export function licensedPracticeNote(code: string, modes: readonly string[] | null | undefined): string {
  return allExercises(modes)
    ? `${code} is licensed: all six activities are available. They hide, reveal, or rearrange its words on screen only; the verse itself is never changed or stored, and its copyright stays on screen.`
    : `${code} is licensed: it's shown exactly as published and practiced with flashcards and self-check. Activities that hide or rearrange words aren't available for this version.`;
}
