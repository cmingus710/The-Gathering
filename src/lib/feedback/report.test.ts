import { describe, expect, it } from "vitest";
import { problemReportSchema, sanitizePagePath } from "./report";

describe("sanitizePagePath", () => {
  it("keeps a plain app path and drops query strings and fragments", () => {
    expect(sanitizePagePath("/music")).toBe("/music");
    expect(sanitizePagePath("/events/2b0c6a3e-4f1d-4c1b-9d55-3f2c1a7e9b10")).toBe("/events/2b0c6a3e-4f1d-4c1b-9d55-3f2c1a7e9b10");
    expect(sanitizePagePath("/auth/confirm?token_hash=abc&type=signup")).toBe("/auth/confirm");
    expect(sanitizePagePath("/prayer#comment-3")).toBe("/prayer");
    expect(sanitizePagePath("/")).toBe("/");
  });

  it("refuses anything that isn't a plain same-site path", () => {
    for (const bad of [
      undefined,
      null,
      42,
      ["/music"],
      "",
      "music",
      "https://evil.example/music",
      "//evil.example",
      "/\t/evil.example",
      "/a b",
      "/<script>",
      "/a//b",
      `/${"x".repeat(250)}`,
      "/report-problem",
      "/report-problem/x",
    ]) {
      expect(sanitizePagePath(bad)).toBeNull();
    }
  });
});

describe("problemReportSchema", () => {
  it("validates category and description and coerces the checkbox", () => {
    const ok = problemReportSchema.safeParse({ category: "media", description: "  The player stops on my phone.  ", pagePath: "/music?x=1", contactOk: "on" });
    expect(ok.success && ok.data).toEqual({ category: "media", description: "The player stops on my phone.", pagePath: "/music", contactOk: true });
    expect(problemReportSchema.safeParse({ category: "billing", description: "A long enough description." }).success).toBe(false);
    expect(problemReportSchema.safeParse({ category: "other", description: "short" }).success).toBe(false);
    expect(problemReportSchema.safeParse({ category: "other", description: "x".repeat(2001) }).success).toBe(false);
    const quiet = problemReportSchema.safeParse({ category: "other", description: "A long enough description.", pagePath: "", contactOk: "" });
    expect(quiet.success && quiet.data).toMatchObject({ pagePath: null, contactOk: false });
  });
});
