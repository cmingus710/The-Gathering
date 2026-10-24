import { describe, expect, it } from "vitest";
import { featuredLabel } from "./lessons";

describe("featuredLabel", () => {
  it("names each featured state", () => {
    expect(featuredLabel("today")).toBe("Today's lesson");
    expect(featuredLabel("upcoming")).toBe("Upcoming lesson");
    expect(featuredLabel("latest")).toBe("Latest lesson");
  });

  it("falls back to the past-lesson label", () => {
    expect(featuredLabel(null)).toBe("Latest lesson");
    expect(featuredLabel("other" as never)).toBe("Latest lesson");
  });
});
