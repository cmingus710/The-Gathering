import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, parseThemePreference } from "./preference";

describe("theme preference", () => {
  it("keeps a saved choice", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to light without a valid saved choice", () => {
    expect(DEFAULT_THEME).toBe("light");
    for (const v of [undefined, null, "", "DARK", "sepia", "dark; path=/"]) expect(parseThemePreference(v)).toBe("light");
  });
});
