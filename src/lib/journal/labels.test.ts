import { describe, expect, it } from "vitest";
import { entryBodyLimit, entryDisplayTitle } from "./labels";

describe("entryDisplayTitle", () => {
  it("keeps the member's own title", () => {
    expect(entryDisplayTitle("  Morning thoughts ", { kind: "lesson_answer", question: "Q?" })).toBe("Morning thoughts");
  });

  it("names an untitled lesson answer by its question's first line", () => {
    expect(entryDisplayTitle("", { kind: "lesson_answer", question: "What does grace mean?\nThink of this week." })).toBe("What does grace mean?");
    const long = "x".repeat(200);
    expect(entryDisplayTitle("", { kind: "lesson_answer", question: long })).toHaveLength(120);
    expect(entryDisplayTitle("", { kind: "lesson_answer", question: "" })).toBe("Lesson answer");
  });

  it("names untitled lesson notes and other entries", () => {
    expect(entryDisplayTitle("", { kind: "lesson_notes" })).toBe("Lesson notes");
    expect(entryDisplayTitle("", { kind: "lesson" })).toBe("Untitled");
    expect(entryDisplayTitle("", null)).toBe("Untitled");
  });
});

describe("entryBodyLimit", () => {
  it("keeps lesson answers and notes to the lesson's limit", () => {
    expect(entryBodyLimit("lesson_answer")).toBe(10_000);
    expect(entryBodyLimit("lesson_notes")).toBe(10_000);
    expect(entryBodyLimit("lesson")).toBe(100_000);
    expect(entryBodyLimit(null)).toBe(100_000);
  });
});
