import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authBrand, authPalette as a, brand, contrastRatio, palettes, welcomeBrand, welcomePalette as w, type ThemeName } from "./tokens";

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8").toLowerCase();
const toCss = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The declarations inside the first block that follows `marker`. */
function block(marker: string): string {
  const start = css.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  return css.slice(open, css.indexOf("}", open));
}

describe("design tokens", () => {
  it("keep the approved brand palette unchanged", () => {
    const approved = {
      "brand-gold": "#ad8c53",
      "brand-charcoal": "#363430",
      ivory: "#f7f4ed",
      white: "#ffffff",
      sand: "#eae3d5",
      "deep-gold": "#80642f",
      "warm-gray": "#716b61",
      olive: "#52664d",
      clay: "#a14538",
    };
    for (const [name, hex] of Object.entries(approved)) expect(css).toContain(`--color-${name}: ${hex};`);
    expect(brand.gold).toBe("#AD8C53");
  });

  it("mirror the light tokens in @theme and the dark tokens in the dark block", () => {
    const light = block("@theme {");
    const dark = block("--theme-dark-tokens");
    for (const [key, hex] of Object.entries(palettes.light)) expect(light, key).toContain(`--color-${toCss(key)}: ${hex.toLowerCase()};`);
    for (const [key, hex] of Object.entries(palettes.dark)) expect(dark, key).toContain(`--color-${toCss(key)}: ${hex.toLowerCase()};`);
  });

  it("build on the approved colours", () => {
    expect(palettes.light.primary).toBe(brand.deepGold);
    expect(palettes.light.background).toBe(brand.ivory);
    expect(palettes.light.surface).toBe(brand.white);
    expect(palettes.light.cta).toBe(brand.charcoal);
    expect(palettes.light.text).toBe(brand.charcoal);
    expect(palettes.light.danger).toBe(brand.clay);
    expect(palettes.dark.cta).toBe(brand.ivory);
    expect(palettes.dark.text).toBe(brand.ivory);
    for (const theme of ["light", "dark"] as const) expect(palettes[theme].accent).toBe(brand.gold);
  });

  describe.each(["light", "dark"] as ThemeName[])("%s theme", (theme) => {
    const p = palettes[theme];
    // Normal-size text needs 4.5:1 (WCAG AA).
    const textPairs: Array<[string, string, string]> = [
      ["text on background", p.text, p.background],
      ["text on surface", p.text, p.surface],
      ["text on surface-muted", p.text, p.surfaceMuted],
      ["text on surface-raised", p.text, p.surfaceRaised],
      ["secondary text on background", p.textSecondary, p.background],
      ["secondary text on surface", p.textSecondary, p.surface],
      ["secondary text on surface-muted", p.textSecondary, p.surfaceMuted],
      ["accent text on background", p.primary, p.background],
      ["accent text on surface", p.primary, p.surface],
      ["accent text on surface-muted", p.primary, p.surfaceMuted],
      ["accent text on primary-soft", p.primary, p.primarySoft],
      ["text on primary-soft", p.text, p.primarySoft],
      ["CTA button text", p.onCta, p.cta],
      ["CTA button hover text", p.onCta, p.ctaHover],
      ["text on accent fill", p.onPrimary, p.primary],
      ["selected chip (background on text)", p.background, p.text],
      ["success on background", p.success, p.background],
      ["success on surface", p.success, p.surface],
      ["success on success-soft", p.success, p.successSoft],
      ["danger on background", p.danger, p.background],
      ["danger on surface", p.danger, p.surface],
      ["danger on danger-soft", p.danger, p.dangerSoft],
      ["danger button text", p.onDanger, p.danger],
      ["danger button hover text", p.onDanger, p.dangerHover],
    ];
    it.each(textPairs)("%s meets 4.5:1", (_label, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    // Control boundaries, icons, and focus indicators need 3:1 (WCAG 1.4.11).
    const uiPairs: Array<[string, string, string]> = [
      ["input border on surface", p.borderStrong, p.surface],
      ["input border on background", p.borderStrong, p.background],
      ["focus ring on background", p.primary, p.background],
      ["focus ring on surface", p.primary, p.surface],
      ["CTA button against background", p.cta, p.background],
      ["icon structure on surface", p.text, p.surface],
      ["unselected nav icon on surface", p.textSecondary, p.surfaceRaised],
    ];
    it.each(uiPairs)("%s meets 3:1", (_label, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
    });
  });

  it("keeps the original light gold out of small text in the light theme", () => {
    // #AD8C53 on ivory/white is under 3:1: decoration only (icon highlights, rules).
    expect(contrastRatio(brand.gold, palettes.light.surface)).toBeLessThan(4.5);
    expect(palettes.light.primary).not.toBe(brand.gold);
  });

  it("keeps the logo plaque legible: charcoal artwork on ivory", () => {
    expect(contrastRatio(brand.charcoal, brand.ivory)).toBeGreaterThanOrEqual(4.5);
  });

  describe("sign-in panel (.auth-theme)", () => {
    const block = css.slice(css.indexOf(".auth-theme {"), css.indexOf("}", css.indexOf(".auth-theme {")));

    it("mirrors the CSS block exactly and uses the approved mockup colours", () => {
      for (const [key, hex] of Object.entries(a)) expect(block, key).toContain(`--color-${toCss(key)}: ${hex.toLowerCase()};`);
      expect(css).toContain("--color-warm-ivory: #f6f1e6;");
      expect(css).toContain("--color-plum: #352936;");
      expect(css).toContain("--color-antique-gold: #b89a60;");
      expect(a.background).toBe(authBrand.warmIvory);
      expect(a.cta).toBe(authBrand.plum);
    });

    const authText: Array<[string, string, string]> = [
      ["text on ivory", a.text, a.background],
      ["text on input surface", a.text, a.surface],
      ["plum headings and links on ivory", a.primary, a.background],
      ["plum links on surface-muted", a.primary, a.surfaceMuted],
      ["secondary text on ivory", a.textSecondary, a.background],
      ["placeholder on input surface", a.textSecondary, a.surface],
      ["secondary text on surface-muted", a.textSecondary, a.surfaceMuted],
      ["Sign In button text", a.onCta, a.cta],
      ["Sign In button hover text", a.onCta, a.ctaHover],
      ["plum on primary-soft", a.primary, a.primarySoft],
      ["success on success-soft", a.success, a.successSoft],
      ["danger on ivory", a.danger, a.background],
      ["danger on danger-soft", a.danger, a.dangerSoft],
      ["danger button text", a.onDanger, a.danger],
      ["hero text on plum scrim", authBrand.warmIvory, authBrand.plum],
    ];
    it.each(authText)("%s meets 4.5:1", (_label, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    const authUi: Array<[string, string, string]> = [
      ["input border on surface", a.borderStrong, a.surface],
      ["input border on ivory", a.borderStrong, a.background],
      ["focus ring on ivory", a.primary, a.background],
      ["password toggle icon on surface", a.textSecondary, a.surface],
    ];
    it.each(authUi)("%s meets 3:1", (_label, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
    });

    it("documents why antique gold is decorative only on ivory", () => {
      expect(contrastRatio(authBrand.antiqueGold, a.background)).toBeLessThan(3);
    });
  });

  describe("public welcome page (.welcome-theme)", () => {
    const block = css.slice(css.indexOf(".welcome-theme {"), css.indexOf("}", css.indexOf(".welcome-theme {")));

    it("mirrors the CSS block exactly and uses the approved mockup colours", () => {
      for (const [key, hex] of Object.entries(w)) expect(block, key).toContain(`--color-${toCss(key)}: ${hex.toLowerCase()};`);
      expect(w.background).toBe(welcomeBrand.ivory);
      expect(w.accent).toBe(welcomeBrand.antiqueGold);
      expect(w.text).toBe(welcomeBrand.charcoal);
      expect(css).toContain(`--welcome-on-gold: ${welcomeBrand.onGold.toLowerCase()};`);
    });

    const welcomeText: Array<[string, string, string]> = [
      ["charcoal text on ivory", w.text, w.background],
      ["charcoal text on card surface", w.text, w.surface],
      ["secondary text on ivory", w.textSecondary, w.background],
      ["secondary text on card surface", w.textSecondary, w.surface],
      ["links on ivory", w.primary, w.background],
      ["links on surface-muted", w.primary, w.surfaceMuted],
      ["primary on primary-soft", w.primary, w.primarySoft],
      ["outlined header button text", w.text, w.background],
      ["danger on danger-soft", w.danger, w.dangerSoft],
      ["hero heading on scrim", welcomeBrand.ivory, welcomeBrand.scrim],
      ["hero eyebrow (gold) on scrim", welcomeBrand.antiqueGold, welcomeBrand.scrim],
      ["gold button text", welcomeBrand.onGold, welcomeBrand.antiqueGold],
    ];
    it.each(welcomeText)("%s meets 4.5:1", (_label, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    const welcomeUi: Array<[string, string, string]> = [
      ["outlined button border on ivory", w.borderStrong, w.background],
      ["focus ring on ivory", w.primary, w.background],
      ["ivory focus ring on scrim", welcomeBrand.ivory, welcomeBrand.scrim],
      ["ivory button border on scrim", welcomeBrand.ivory, welcomeBrand.scrim],
    ];
    it.each(welcomeUi)("%s meets 3:1", (_label, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
    });

    it("documents why antique gold is decorative only on ivory", () => {
      expect(contrastRatio(welcomeBrand.antiqueGold, w.background)).toBeLessThan(3);
    });
  });
});
