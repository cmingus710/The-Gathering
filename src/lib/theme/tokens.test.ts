import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brand, contrastRatio, palette as p } from "./tokens";

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8").toLowerCase();

describe("design tokens", () => {
  it("keep the approved brand palette unchanged", () => {
    const approved = {
      "brand-gold": "#ad8c53",
      "brand-charcoal": "#363430",
      ivory: "#f7f4ed",
      sand: "#eae3d5",
      "deep-gold": "#80642f",
      olive: "#52664d",
      clay: "#a14538",
    };
    for (const [name, hex] of Object.entries(approved)) expect(css).toContain(`--color-${name}: ${hex};`);
    expect(brand.gold).toBe("#AD8C53");
  });

  it("mirror the CSS semantic tokens exactly", () => {
    const toCss = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    for (const [key, hex] of Object.entries(p)) {
      expect(css, key).toContain(`--color-${toCss(key)}: ${hex.toLowerCase()};`);
    }
  });

  it("use the brand gold as the accent colour", () => {
    expect(p.primary).toBe(brand.gold);
    expect(p.cta).toBe(brand.ivory);
  });

  // Normal-size text needs 4.5:1 (WCAG AA).
  const textPairs: Array<[string, string, string]> = [
    ["text on background", p.text, p.background],
    ["text on surface", p.text, p.surface],
    ["text on surface-muted", p.text, p.surfaceMuted],
    ["secondary text on background", p.textSecondary, p.background],
    ["secondary text on surface", p.textSecondary, p.surface],
    ["secondary text on surface-muted", p.textSecondary, p.surfaceMuted],
    ["gold accent on background", p.primary, p.background],
    ["gold accent on surface", p.primary, p.surface],
    ["gold accent on primary-soft", p.primary, p.primarySoft],
    ["CTA button text", p.onCta, p.cta],
    ["CTA button hover text", p.onCta, p.ctaHover],
    ["text on gold fill", p.onPrimary, p.primary],
    ["selected chip (background on text)", p.background, p.text],
    ["success on background", p.success, p.background],
    ["success on surface", p.success, p.surface],
    ["success on success-soft", p.success, p.successSoft],
    ["danger on background", p.danger, p.background],
    ["danger on surface", p.danger, p.surface],
    ["danger on danger-soft", p.danger, p.dangerSoft],
    ["danger button text", p.onCta, p.danger],
    ["danger button hover text", p.onCta, p.dangerHover],
    ["logo plaque: charcoal on ivory", brand.charcoal, brand.ivory],
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
    ["CTA button against background", p.cta, p.background],
  ];
  it.each(uiPairs)("%s meets 3:1", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("documents why gold text is not used on surface-muted", () => {
    expect(contrastRatio(p.primary, p.surfaceMuted)).toBeLessThan(4.5);
  });
});
