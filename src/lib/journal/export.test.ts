import { describe, expect, it } from "vitest";
import { exportFileName, journalMarkdown } from "./export";

describe("journalMarkdown", () => {
  it("writes each entry with its link, withholding content that is no longer available", () => {
    const md = journalMarkdown(
      [
        { title: "Morning", body: "Synthetic **text**.", status: "active", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-02T10:00:00Z",
          link: { kind: "passage", label: "John 3:16–21", translation_code: "WEB" } },
        { title: "", body: "Second.", status: "archived", created_at: "2026-10-03T10:00:00Z", updated_at: "2026-10-03T11:00:00Z",
          link: { kind: "lesson", available: false, title: null } },
        { title: "Plan", body: "Third.", status: "active", created_at: "2026-10-04T10:00:00Z", updated_at: "2026-10-04T10:00:00Z",
          link: { kind: "assignment", available: true, plan_title: "Synthetic Plan", label: "Day 3", question: "What stood out?" } },
      ],
      "2026-10-20T12:00:00Z",
    );
    expect(md).toContain("3 entries.");
    expect(md).toContain("## Morning\n\n*Written 2026-10-01, edited 2026-10-02*\n\n> Passage: John 3:16–21 (WEB)\n\nSynthetic **text**.");
    expect(md).toContain("## Untitled\n\n*Written 2026-10-03, archived*\n\n> A Sunday lesson that is no longer available");
    expect(md).toContain("> Reading plan: Synthetic Plan, Day 3\n\n> Question: What stood out?");
    expect(exportFileName("journal", "md", "2026-10-20T12:00:00Z")).toBe("my-journal-2026-10-20.md");
  });

  it("names a collection reading and the date it was read, or only the date once it's unavailable", () => {
    const entry = (link: Record<string, unknown>) => ({ title: "R", body: "B", status: "active" as const, created_at: "2026-01-01T10:00:00Z", updated_at: "2026-01-01T10:00:00Z", link: { kind: "collection_reading", ...link } });
    const md = journalMarkdown(
      [
        entry({ available: true, title: "Morning & Evening", label: "January 1 · Morning", scripture_ref: "Joshua 5:12", reading_date: "2026-01-01" }),
        entry({ available: false, title: null, label: null, scripture_ref: null, reading_date: "2027-01-01" }),
      ],
      "2027-01-02T12:00:00Z",
    );
    expect(md).toContain("> Morning & Evening: January 1 · Morning (Joshua 5:12), read 2026-01-01");
    expect(md).toContain("> A devotional reading that is no longer available, read 2027-01-01");
  });

  it("names lesson answers by their question and lesson, and lesson notes by their lesson", () => {
    const entry = (title: string, link: Record<string, unknown>) => ({ title, body: "B", status: "active" as const, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", link: link as never });
    const md = journalMarkdown(
      [
        entry("", { kind: "lesson_answer", available: true, title: "Synthetic lesson", question: "What does grace mean?" }),
        entry("", { kind: "lesson_notes", available: false, title: null }),
      ],
      "2026-11-02T12:00:00Z",
    );
    expect(md).toContain("## What does grace mean?\n\n*Written 2026-11-01*\n\n> Answer in Sunday lesson: Synthetic lesson\n\n> Question: What does grace mean?");
    expect(md).toContain("## Lesson notes\n\n*Written 2026-11-01*\n\n> Notes on a Sunday lesson that is no longer available");
  });
});
