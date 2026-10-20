import { describe, expect, it } from "vitest";
import { ACTIVITIES, changeExplanation, percent, reviewDate } from "./format";

describe("memory wording", () => {
  it("describes all six activities", () => {
    expect(ACTIVITIES.map((a) => a.key)).toEqual(["read_repeat", "flashcards", "missing_words", "word_order", "type_verse", "self_check"]);
  });

  it("names review dates relative to the member's today", () => {
    expect(reviewDate("2026-10-20", "2026-10-20")).toBe("today");
    expect(reviewDate("2026-10-21", "2026-10-20")).toBe("tomorrow");
    expect(reviewDate("2026-10-24", "2026-10-20")).toBe("in 4 days");
    expect(reviewDate("2026-11-03", "2026-10-20")).toBe("on Tue, Nov 3");
    // Calendar dates, so a daylight-saving change can't shift them.
    expect(reviewDate("2026-11-02", "2026-11-01")).toBe("tomorrow");
    expect(reviewDate("2027-03-15", "2027-03-14")).toBe("tomorrow");
  });

  it("explains schedule changes without shaming", () => {
    expect(changeExplanation("eased", "2026-10-21", "2026-10-20")).toMatch(/Nothing you've done is lost/);
    expect(changeExplanation("early", "2026-10-27", "2026-10-20")).toMatch(/great practice/);
    for (const c of ["advanced", "kept", "eased", "early", "practice", "already_today"] as const) {
      expect(changeExplanation(c, "2026-10-21", "2026-10-20")).not.toMatch(/fail|wrong|bad|lost your/i);
    }
  });

  it("formats accuracy as a whole percentage", () => {
    expect(percent(0.833)).toBe("83%");
    expect(percent(null)).toBeNull();
  });
});
