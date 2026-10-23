/** Longest note a member can write under one question. */
export const NOTE_MAX = 1000;

/**
 * The journal entry body for a member's notes on a content item's questions
 * (journal text is Markdown): each question, in order, as a numbered quote,
 * followed by the member's note. Questions without a note are kept, marked
 * as such, so the entry reads like the page did.
 */
export function notesJournalBody(rows: Array<{ question: string; note: string }>): string {
  return rows
    .map(({ question, note }, i) => {
      const quoted = question
        .trim()
        .split("\n")
        .map((l, j) => `> ${j === 0 ? `**${i + 1}.** ` : ""}${l}`.trimEnd())
        .join("\n");
      const text = note.replace(/\r\n?/g, "\n").trim();
      return `${quoted}\n\n${text || "_No notes._"}`;
    })
    .join("\n\n");
}
