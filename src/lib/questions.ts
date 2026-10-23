/**
 * Question lists (a Bible plan day's reflection questions, a devotional's or
 * lesson's discussion questions). Each question is one array element and may
 * hold several paragraphs; the editor sends one form entry per question.
 */

/** Matches the database: bible.plan_days holds up to 5 (each cut at 500), media.items up to 20. */
export const QUESTION_LIMITS = {
  day: { max: 5, maxLength: 500 },
  content: { max: 20, maxLength: 500 },
} as const;

/**
 * A stable id for a question, derived from its text (FNV-1a, base 36). It
 * doesn't change when questions are reordered, so links that pick a question
 * ("Write privately" on a reading) never land on a different one. Answers
 * themselves keep the question's wording as it read when chosen.
 */
export function questionId(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Trims a question, normalizes line endings, and keeps at most one blank line between paragraphs. */
export function cleanQuestion(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The questions submitted under `name`, in order, with empty fields ignored.
 * Returns a message naming the question to fix when one is too long.
 */
export function readQuestions(
  formData: FormData,
  name: string,
  { max, maxLength }: { max: number; maxLength: number },
): { ok: true; questions: string[] } | { ok: false; message: string } {
  // Numbered the way the editor shows them, empty fields included.
  const fields = formData.getAll(name).map((v) => (typeof v === "string" ? cleanQuestion(v) : ""));
  const long = fields.findIndex((q) => q.length > maxLength);
  if (long >= 0) return { ok: false, message: `Question ${long + 1} is ${fields[long].length.toLocaleString("en-US")} characters. Keep each question to ${maxLength} or fewer.` };
  const questions = fields.filter(Boolean);
  if (questions.length > max) return { ok: false, message: `Up to ${max} questions. Remove ${questions.length - max} to save.` };
  return { ok: true, questions };
}
