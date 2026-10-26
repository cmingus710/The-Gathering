import { describe, expect, it } from "vitest";
import { createDisplayEvents, textVisibleAtStart } from "./fums-events";

describe("FUMS display events for licensed memory practice", () => {
  it("reports once per activity, however often text is shown again", () => {
    const sent: string[] = [];
    const ev = createDisplayEvents((t) => sent.push(t));
    ev.register("session-1", "token-a");
    expect(ev.shown("session-1")).toBe(true);
    // Rerenders, moved words, more hints, the result: same display event.
    for (let i = 0; i < 5; i++) ev.shown("session-1");
    expect(sent).toEqual(["token-a"]);
  });

  it("treats a new activity as a new display event", () => {
    const sent: string[] = [];
    const ev = createDisplayEvents((t) => sent.push(t));
    ev.register("session-1", "token-a");
    ev.register("session-2", "token-a");
    ev.shown("session-1");
    ev.shown("session-2");
    expect(sent).toEqual(["token-a", "token-a"]);
  });

  it("reports nothing without a token (stored text) or before anything is shown", () => {
    const sent: string[] = [];
    const ev = createDisplayEvents((t) => sent.push(t));
    ev.register("stored", null);
    expect(ev.shown("stored")).toBe(false);
    ev.register("licensed", "token-b");
    expect(sent).toEqual([]);
  });

  it("knows which activities show text as soon as they open", () => {
    expect(["read_repeat", "missing_words", "word_order"].every((a) => textVisibleAtStart(a as never))).toBe(true);
    expect(textVisibleAtStart("flashcards", "text_to_ref")).toBe(true);
    expect(textVisibleAtStart("flashcards", "ref_to_text")).toBe(false);
    expect(textVisibleAtStart("type_verse")).toBe(false);
    expect(textVisibleAtStart("self_check")).toBe(false);
  });
});
