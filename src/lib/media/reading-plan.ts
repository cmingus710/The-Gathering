import type { Attachment, ItemCard } from "./types";

/** One assignment on the unified reading page (public.media_reading_plan). */
export type PlanAssignment = ItemCard & {
  instructions: string | null;
  questions: string[];
  body: string;
  group_id: string | null;
  group_name: string | null;
  attachments: Attachment[];
  discussion: { thread_id: string; title: string; replies: number } | null;
};

export type PlanNote = {
  id: string;
  title: string;
  excerpt: string;
  updated_at: string;
  link: { kind: string; available: boolean; item_id: string | null; title: string | null } | null;
};

/**
 * A reading plan for a book: the book's assignments for one audience. The
 * church-wide assignments are one plan; each group's assignments are another.
 * The grouping uses the assignments' own audience (never titles).
 */
export type ReadingPlan = { key: string; label: string; assignments: PlanAssignment[] };

export const CHURCH_PLAN = "church";

export function planKey(a: Pick<PlanAssignment, "group_id">): string {
  return a.group_id ?? CHURCH_PLAN;
}

/** Plans in a stable order: church-wide first, then groups by name. Assignments keep date order. */
export function groupPlans(assignments: PlanAssignment[]): ReadingPlan[] {
  const plans = new Map<string, ReadingPlan>();
  for (const a of assignments) {
    const key = planKey(a);
    let p = plans.get(key);
    if (!p) {
      p = { key, label: key === CHURCH_PLAN ? "Church-wide" : (a.group_name ?? "Your group"), assignments: [] };
      plans.set(key, p);
    }
    p.assignments.push(a);
  }
  return [...plans.values()].sort((x, y) => (x.key === CHURCH_PLAN ? -1 : y.key === CHURCH_PLAN ? 1 : x.label.localeCompare(y.label)));
}

/**
 * The assignment for "today" (a YYYY-MM-DD date in the church's time zone),
 * using the same rule as the Church reading page and the home page: it has
 * started and hasn't ended; when several overlap, the latest start wins.
 * Never "whichever was edited last".
 */
export function currentAssignment<T extends Pick<ItemCard, "starts_on" | "ends_on">>(assignments: T[], today: string): T | null {
  let best: T | null = null;
  for (const a of assignments) {
    if (!a.starts_on || a.starts_on > today || (a.ends_on && a.ends_on < today)) continue;
    if (!best || a.starts_on > (best.starts_on ?? "")) best = a;
  }
  return best;
}

/** The next assignment to start after today, when none is current. */
export function nextAssignment<T extends Pick<ItemCard, "starts_on">>(assignments: T[], today: string): T | null {
  let best: T | null = null;
  for (const a of assignments) {
    if (!a.starts_on || a.starts_on <= today) continue;
    if (!best || a.starts_on < (best.starts_on ?? "")) best = a;
  }
  return best;
}

/** Where an assignment sits relative to today and the plan's current assignment. */
export function assignmentTiming(a: Pick<ItemCard, "id" | "starts_on">, today: string, currentId: string | null): "upcoming" | "now" | "past" {
  if (a.id === currentId) return "now";
  return a.starts_on && a.starts_on > today ? "upcoming" : "past";
}

/** Assignments the member checked off in one plan. A percentage only when the total is known (never from free text). */
export function planCompletion(plan: Pick<ReadingPlan, "assignments">): { done: number; total: number; percent: number | null } {
  const total = plan.assignments.length;
  const done = plan.assignments.filter((a) => a.completed).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : null };
}

/**
 * Which plan to show: the one named in the address, else the plan of the
 * selected assignment, else church-wide, else the first.
 */
export function choosePlan(plans: ReadingPlan[], requested: string | null, selectedAssignment: string | null): ReadingPlan | null {
  if (!plans.length) return null;
  const byKey = requested ? plans.find((p) => p.key === requested) : undefined;
  if (byKey) return byKey;
  const bySelection = selectedAssignment ? plans.find((p) => p.assignments.some((a) => a.id === selectedAssignment)) : undefined;
  return bySelection ?? plans.find((p) => p.key === CHURCH_PLAN) ?? plans[0];
}
