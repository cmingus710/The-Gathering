import type { Activity } from "./types";

/**
 * FUMS display events for licensed memory practice (API.Bible: report a
 * view each time a passage is displayed to a member, including exercise
 * screens where the text is partly hidden).
 *
 * One practice activity (one session) is one display event:
 *   - reported the first time any of the passage's text is on screen in that
 *     activity: when it opens for read & repeat, missing words, word order,
 *     and reference-practice flashcards; at the first hint, reveal, or
 *     checked result for the others;
 *   - never again for the same activity, however often the page rerenders,
 *     a word is moved, or another hint is shown;
 *   - a new activity (Practice again, another activity, another verse) is a
 *     new display event;
 *   - server fetches and cache refreshes are never reported: only the
 *     member's browser reports, and only when text is shown.
 * The token is the one API.Bible returned with the cached passage the
 * activity started from.
 */
export function textVisibleAtStart(activity: Activity, direction?: string | null): boolean {
  return activity === "read_repeat" || activity === "missing_words" || activity === "word_order" || (activity === "flashcards" && direction === "text_to_ref");
}

export function createDisplayEvents(send: (fumsToken: string) => void) {
  const tokens = new Map<string, string>();
  const reported = new Set<string>();
  return {
    /** The activity's FUMS token, from the start response. */
    register(session: string, fumsToken: string | null | undefined) {
      if (fumsToken) tokens.set(session, fumsToken);
    },
    /** Text from this activity is on screen; reports once per activity. */
    shown(session: string): boolean {
      const token = tokens.get(session);
      if (!token || reported.has(session)) return false;
      reported.add(session);
      send(token);
      return true;
    },
  };
}
