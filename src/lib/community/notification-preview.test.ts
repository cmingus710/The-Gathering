import { describe, expect, it } from "vitest";
import { abbreviate, PREVIEW_TITLE_MAX, toPreview } from "./notification-preview";

const base = { id: "00000000-0000-4000-8000-000000000001", created_at: "2026-10-21T10:00:00Z", read: false };

describe("bell notification previews", () => {
  it("never shows prayer, care, message, youth, or moderation titles", () => {
    for (const category of ["prayer", "care", "messages", "youth", "moderation"] as const) {
      const p = toPreview({ ...base, category, title: "An update on “Surgery for Anna Smith”" });
      expect(p.generic).toBe(true);
      expect(p.title).not.toMatch(/Anna|Surgery/);
      expect(JSON.stringify(p)).not.toMatch(/Anna|Surgery/);
    }
  });

  it("keeps other titles, shortened at a word boundary", () => {
    const long = `Sam replied in “${"word ".repeat(40)}”`;
    const p = toPreview({ ...base, category: "forum", title: long });
    expect(p.generic).toBe(false);
    expect(p.title.length).toBeLessThanOrEqual(PREVIEW_TITLE_MAX);
    expect(p.title.endsWith("…")).toBe(true);
    expect(toPreview({ ...base, category: "events", title: "Picnic moved to 5 pm" }).title).toBe("Picnic moved to 5 pm");
  });

  it("carries no destination URL", () => {
    const p = toPreview({ ...base, category: "forum", title: "x", ...({ url: "/community/t/1" } as object) });
    expect(p).not.toHaveProperty("url");
  });

  it("abbreviates whitespace and short strings safely", () => {
    expect(abbreviate("  a   b  ")).toBe("a b");
    expect(abbreviate("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
