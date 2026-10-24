/**
 * How an entry is named in lists and downloads when the member hasn't given
 * it a title. Lesson answers (20261122000100) are named by the question they
 * answer, as the member saw it; lesson notes by what they are.
 */
export function entryDisplayTitle(title: string, link: { kind: string; question?: string | null } | null): string {
  if (title.trim()) return title.trim();
  if (link?.kind === "lesson_answer" && link.question?.trim()) {
    const first = link.question.trim().split("\n")[0].trim();
    return first.length > 120 ? `${first.slice(0, 119).trimEnd()}…` : first;
  }
  if (link?.kind === "lesson_answer") return "Lesson answer";
  if (link?.kind === "lesson_notes") return "Lesson notes";
  return "Untitled";
}

/** The longest text an entry can hold (lesson answers and notes keep the lesson's limit). */
export function entryBodyLimit(kind: string | null | undefined): number {
  return kind === "lesson_answer" || kind === "lesson_notes" ? 10_000 : 100_000;
}
