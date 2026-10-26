import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, palettes } from "@/lib/theme/tokens";
import { HIGHLIGHT_COLORS } from "./format";

/**
 * Highlighted verses keep body text readable (WCAG AA, 4.5:1) in both
 * themes, and the six colors stay distinguishable from one another.
 */
describe("reader highlight colors", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
  const block = (selector: string) => {
    const i = css.indexOf("--hl-yellow", css.indexOf(selector, css.indexOf("Scripture reader (Phase 8)")));
    return Object.fromEntries([...css.slice(i, css.indexOf("}", i)).matchAll(/--hl-(\w+): (#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
  };
  const light = block(":root,");
  const dark = block('[data-theme="dark"]');
  const names = HIGHLIGHT_COLORS.map((c) => c.value);

  it("defines all six colors for light, dark, and system dark", () => {
    expect(names).toEqual(["yellow", "green", "blue", "pink", "purple", "orange"]);
    expect(Object.keys(light)).toEqual(names);
    expect(Object.keys(dark)).toEqual(names);
    const sys = css.slice(css.indexOf('[data-theme="system"]', css.indexOf("Scripture reader (Phase 8)")));
    for (const n of names) expect(sys.slice(0, sys.indexOf("}"))).toContain(`--hl-${n}: ${dark[n]}`);
    for (const n of names) expect(css).toContain(`.scripture mark[data-color="${n}"] { background: var(--hl-${n}); }`);
  });

  it("passes contrast for light and dark text", () => {
    for (const c of Object.values(light)) expect(contrastRatio(palettes.light.text, c)).toBeGreaterThanOrEqual(4.5);
    for (const c of Object.values(dark)) expect(contrastRatio(palettes.dark.text, c)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every pair of colors visibly different in each theme", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const theme of [light, dark]) {
      for (const a of names) {
        for (const b of names) {
          if (a >= b) continue;
          const [x, y] = [rgb(theme[a]), rgb(theme[b])];
          const distance = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
          expect(distance, `${a} vs ${b}`).toBeGreaterThan(20);
        }
      }
    }
  });
});
