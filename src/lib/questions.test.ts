import { describe, expect, it } from "vitest";
import { cleanQuestion, questionId, readQuestions } from "./questions";

const form = (...qs: string[]) => {
  const fd = new FormData();
  for (const q of qs) fd.append("questions", q);
  return fd;
};

describe("readQuestions", () => {
  it("keeps each field as one question, in order, with its paragraphs", () => {
    const r = readQuestions(form("First line\r\nstill the first question.\r\n\r\nSecond paragraph.", "Second?"), "questions", { max: 5, maxLength: 500 });
    expect(r).toEqual({ ok: true, questions: ["First line\nstill the first question.\n\nSecond paragraph.", "Second?"] });
  });

  it("ignores empty fields", () => {
    expect(readQuestions(form("", "  \n ", "Only one?", ""), "questions", { max: 5, maxLength: 500 })).toEqual({ ok: true, questions: ["Only one?"] });
    expect(readQuestions(new FormData(), "questions", { max: 5, maxLength: 500 })).toEqual({ ok: true, questions: [] });
  });

  it("counts only filled questions toward the limit", () => {
    expect(readQuestions(form("a", "", "b", "c"), "questions", { max: 3, maxLength: 500 }).ok).toBe(true);
    const r = readQuestions(form("a", "b", "c", "d"), "questions", { max: 3, maxLength: 500 });
    expect(r).toEqual({ ok: false, message: "Up to 3 questions. Remove 1 to save." });
  });

  it("names the too-long question by the number the editor shows", () => {
    const r = readQuestions(form("", "short", "x".repeat(501)), "questions", { max: 5, maxLength: 500 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^Question 3 is 501 characters/);
  });
});

describe("cleanQuestion", () => {
  it("trims, normalizes line endings, and keeps one blank line between paragraphs", () => {
    expect(cleanQuestion("  One  \r\n\r\n\r\n\r\nTwo\rThree  ")).toBe("One\n\nTwo\nThree");
  });
});

describe("questionId", () => {
  it("is stable for the same text and differs for different text", () => {
    expect(questionId("What stood out?")).toBe(questionId("What stood out?"));
    expect(questionId("What stood out?")).not.toBe(questionId("What surprised you?"));
    expect(questionId("Line one\n\nLine two")).toMatch(/^[0-9a-z]+$/);
  });
});
