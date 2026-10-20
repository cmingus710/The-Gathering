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
});
