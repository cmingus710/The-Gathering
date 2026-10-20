import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, palettes } from "@/lib/theme/tokens";

/** Highlighted verses keep body text readable (WCAG AA, 4.5:1) in both themes. */
describe("reader highlight colors", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
  const block = (selector: string) => {
    const i = css.indexOf("--hl-yellow", css.indexOf(selector, css.indexOf("Scripture reader (Phase 8)")));
    return Object.fromEntries([...css.slice(i, css.indexOf("}", i)).matchAll(/--hl-(\w+): (#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
  };
  it("passes contrast for light and dark text", () => {
    const light = block(":root,");
    const dark = block('[data-theme="dark"]');
    expect(Object.keys(light)).toEqual(["yellow", "green", "blue", "pink"]);
    expect(Object.keys(dark)).toEqual(["yellow", "green", "blue", "pink"]);
    for (const c of Object.values(light)) expect(contrastRatio(palettes.light.text, c)).toBeGreaterThanOrEqual(4.5);
    for (const c of Object.values(dark)) expect(contrastRatio(palettes.dark.text, c)).toBeGreaterThanOrEqual(4.5);
  });
});
