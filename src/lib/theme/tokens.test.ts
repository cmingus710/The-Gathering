import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, palette as p } from "./tokens";

describe("approved palette", () => {
  it("matches the brief and the CSS tokens", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8").toLowerCase();
    const brief = {
      "brand-gold": "#ad8c53",
      "brand-charcoal": "#363430",
      background: "#f7f4ed",
      surface: "#ffffff",
      "surface-muted": "#eae3d5",
      primary: "#80642f",
      text: "#363430",
      "text-secondary": "#716b61",
      success: "#52664d",
      danger: "#a14538",
    };
    for (const [name, hex] of Object.entries(brief)) {
      expect(css).toContain(`--color-${name}: ${hex};`);
    }
    expect(p.primary.toLowerCase()).toBe("#80642f");
  });

  // Normal-size text needs 4.5:1 (WCAG AA).
  const textPairs: Array<[string, string, string]> = [
    ["text on background", p.text, p.background],
    ["text on surface", p.text, p.surface],
    ["text on surface-muted", p.text, p.surfaceMuted],
    ["secondary text on background", p.textSecondary, p.background],
    ["secondary text on surface", p.textSecondary, p.surface],
    ["white on primary button", p.onPrimary, p.primary],
    ["white on primary hover", p.onPrimary, p.primaryHover],
    ["primary link on surface", p.primary, p.surface],
    ["primary link on background", p.primary, p.background],
    ["primary text on primary-soft", p.primary, p.primarySoft],
    ["success on surface", p.success, p.surface],
    ["success on success-soft", p.success, p.successSoft],
    ["danger on surface", p.danger, p.surface],
    ["danger on danger-soft", p.danger, p.dangerSoft],
    ["danger on background", p.danger, p.background],
    ["white on danger button", p.onPrimary, p.danger],
    ["white on danger hover", p.onPrimary, p.dangerHover],
    ["ivory on charcoal", p.background, p.brandCharcoal],
  ];
  it.each(textPairs)("%s meets 4.5:1", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  // Control boundaries and focus indicators need 3:1 (WCAG 1.4.11).
  const uiPairs: Array<[string, string, string]> = [
    ["input border on surface", p.borderStrong, p.surface],
    ["input border on background", p.borderStrong, p.background],
    ["focus ring on background", p.primary, p.background],
    ["focus ring on surface", p.primary, p.surface],
  ];
  it.each(uiPairs)("%s meets 3:1", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("documents why logo gold is decorative only", () => {
    expect(contrastRatio(p.brandGold, p.background)).toBeLessThan(3);
    expect(contrastRatio(p.onPrimary, p.brandGold)).toBeLessThan(4.5);
  });
});
