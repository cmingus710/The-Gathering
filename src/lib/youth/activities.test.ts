import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  ageGuidance,
  applyFilters,
  difficultyLabel,
  filterHref,
  isOlderYouth,
  kindLabel,
  parseFilters,
  parseScriptureRefs,
  plainText,
  sortForHome,
} from "./activities";

describe("Learn & Play helpers", () => {
  it("words ages as a suggestion, never a rule", () => {
    expect(ageGuidance(4, 7)).toBe("Suggested for ages 4–7");
    expect(ageGuidance(6, 6)).toBe("Suggested for age 6");
    expect(ageGuidance(11, null)).toBe("Suggested for ages 11 and up");
    expect(ageGuidance(null, 5)).toBe("Suggested for ages up to 5");
    expect(ageGuidance(null, null)).toBeNull();
  });

  it("uses the older-youth style from 11", () => {
    expect(isOlderYouth(10)).toBe(false);
    expect(isOlderYouth(11)).toBe(true);
    expect(isOlderYouth(null)).toBe(false);
  });

  it("labels the three difficulty levels and every type", () => {
    expect(["beginner", "growing", "challenge"].map(difficultyLabel)).toEqual(["Beginner", "Growing", "Challenge"]);
    for (const k of ACTIVITY_KINDS) expect(kindLabel(k.key)).toBe(k.label);
    expect(kindLabel("html5_game")).toBe("Activity");
  });

  it("reads only known filters from the URL", () => {
    expect(parseFilters({ type: "quiz", level: "growing" })).toEqual({ kind: "quiz", difficulty: "growing" });
    expect(parseFilters({ type: "<script>", level: ["challenge", "beginner"] })).toEqual({ kind: null, difficulty: "challenge" });
    expect(parseFilters({})).toEqual({ kind: null, difficulty: null });
    expect(filterHref("/youth/play", { kind: "story", difficulty: null })).toBe("/youth/play?type=story");
    expect(filterHref("/youth/play", { kind: null, difficulty: null })).toBe("/youth/play");
  });

  it("filters by type and difficulty", () => {
    const items = [
      { id: "1", kind: "quiz", difficulty: "beginner" },
      { id: "2", kind: "quiz", difficulty: "challenge" },
      { id: "3", kind: "story", difficulty: "beginner" },
    ];
    expect(applyFilters(items, { kind: "quiz", difficulty: null }).map((i) => i.id)).toEqual(["1", "2"]);
    expect(applyFilters(items, { kind: null, difficulty: "beginner" }).map((i) => i.id)).toEqual(["1", "3"]);
    expect(applyFilters(items, { kind: "story", difficulty: "challenge" })).toEqual([]);
  });

  it("puts this week's activities first", () => {
    const sorted = sortForHome([
      { title: "B", this_week: false },
      { title: "C", this_week: true },
      { title: "A", this_week: false },
    ]);
    expect(sorted.map((s) => s.title)).toEqual(["C", "A", "B"]);
  });

  it("strips markup and control characters from plain text", () => {
    expect(plainText("  Noah <b>and</b> the <img src=x onerror=alert(1)>ark\u0007 ", 100)).toBe("Noah and the ark");
    expect(plainText("Line one\r\nLine two\u0000", 100, true)).toBe("Line one\r\nLine two");
    expect(plainText("a < b and c > d", 100)).toBe("a < b and c > d");
    expect(plainText("x".repeat(200), 120)).toHaveLength(120);
  });

  it("splits Scripture references by line or semicolon, up to ten", () => {
    expect(parseScriptureRefs("Genesis 6:9-22\n\nGenesis 9:13; John 3:16")).toEqual(["Genesis 6:9-22", "Genesis 9:13", "John 3:16"]);
    expect(parseScriptureRefs(Array.from({ length: 14 }, (_, i) => `Psalm ${i + 1}`).join("\n"))).toHaveLength(10);
  });
});
