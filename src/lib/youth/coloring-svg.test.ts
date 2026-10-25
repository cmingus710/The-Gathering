import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkTemplate, type Attribution } from "./coloring";
import { COLORING_DEMOS } from "./coloring-demos";
import { parsePathData, parseTransform, segsBounds, segsToD, transformSegs } from "./coloring-path";
import { checkColoringSvg, SVG_MAX_BYTES } from "./coloring-svg";

const meta = { story: "A synthetic story.", attribution: { source_kind: "original", credit: "", license: "", source_url: null } as Attribution };
const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const ok = (text: string) => {
  const r = checkColoringSvg(text, meta);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r;
};
const refused = (text: string, message: RegExp) => {
  const r = checkColoringSvg(text, meta);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.join("\n")).toMatch(message);
};
const part = '<rect data-region="Box" x="10" y="10" width="80" height="80" fill="#fff" stroke="#000"/>';

describe("coloring SVG checks: refusing active and external content", () => {
  it.each([
    ["a script element", `<script>alert(1)</script>${part}`, /scripts/],
    ["a namespaced script", `<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>${part}`, /scripts/],
    ["an event handler", `<rect data-region="Box" x="1" y="1" width="9" height="9" onclick="alert(1)"/>`, /event handler/],
    ["an onload on the root", "", /event handler/, 'viewBox="0 0 100 100" onload="alert(1)"'],
    ["an upper-case event handler", `<rect data-region="Box" x="1" y="1" width="9" height="9" ONMOUSEOVER="x()"/>`, /event handler/],
    ["a link", `<a href="https://example.test">${part}</a>`, /links/],
    ["an xlink:href", `<rect data-region="Box" x="1" y="1" width="9" height="9" xlink:href="https://example.test"/>`, /links to another file/],
    ["an embedded image", `<image href="data:image/png;base64,AAAA" width="10" height="10"/>${part}`, /images/],
    ["use", `<use href="#a"/>${part}`, /use/],
    ["foreignObject", `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>${part}`, /foreignObject/],
    ["a style sheet", `<style>@import url(https://example.test/x.css);</style>${part}`, /style sheets/],
    ["url() in a style attribute", `<rect data-region="Box" x="1" y="1" width="9" height="9" style="fill:url(https://example.test/p.svg#a)"/>`, /reference or script/],
    ["url() in a fill attribute", `<rect data-region="Box" x="1" y="1" width="9" height="9" fill="url(#g)"/>`, /reference or script/],
    ["javascript: in any attribute", `<rect data-region="javascript:alert(1)" x="1" y="1" width="9" height="9"/>`, /reference or script/],
    ["a data: URL", `<rect data-region="Box" x="1" y="1" width="9" height="9" style="background:data:text/html,x"/>`, /reference or script/],
    ["an entity-encoded reference", `<rect data-region="Box" x="1" y="1" width="9" height="9" fill="&#117;rl(#a)"/>`, /reference or script/],
    ["animation", `<rect data-region="Box" x="1" y="1" width="9" height="9"><animate attributeName="x" to="5"/></rect>`, /animation/],
    ["set", `<rect data-region="Box" x="1" y="1" width="9" height="9"><set attributeName="fill" to="red"/></rect>`, /animation/],
    ["text", `<text x="1" y="10">Hi</text>${part}`, /text/],
    ["a gradient", `<linearGradient id="g"/>${part}`, /gradients/],
    ["a filter", `<filter id="f"/>${part}`, /filters/],
    ["an unknown element", `<blink/>${part}`, /isn't supported/],
    ["a nested svg", `<svg viewBox="0 0 10 10">${part}</svg>`, /Nested/],
    ["non-empty defs", `<defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs>${part}`, /clip paths/],
    ["an iframe in editor metadata", `<metadata><iframe src="https://example.test"/></metadata>${part}`, /embedded web content/],
  ])("refuses %s", (_label, body, message, attrs?: string) => {
    refused(svg(body, attrs), message);
  });

  it("refuses DOCTYPE and entity declarations (no entity expansion) and CDATA", () => {
    refused(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>${svg(part)}`, /DOCTYPE/);
    refused(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]>${svg(part)}`, /Entity declarations/);
    refused(svg(`<![CDATA[ <script>alert(1)</script> ]]>${part}`), /CDATA/);
  });

  it("refuses processing instructions such as style sheets", () => {
    refused(`<?xml version="1.0"?><?xml-stylesheet href="https://example.test/x.css"?>${svg(part)}`, /Processing instructions/);
  });

  it("refuses things that aren't SVG, too large, or not well-formed", () => {
    refused("<html><body>hi</body></html>", /isn't an SVG file/);
    refused("\u0089PNG\r\n\u001a\n", /isn't/);
    refused(svg(part).replace("</svg>", ""), /well-formed/);
    refused(svg(part) + " ".repeat(SVG_MAX_BYTES), /KB or smaller/);
    refused(svg(part, ""), /viewBox/);
    refused(svg(part, 'viewBox="0 0 1000 20"'), /too narrow/);
  });

  it("answers quickly on inputs built to make regular expressions backtrack", () => {
    const quick = (text: string) => {
      const t0 = performance.now();
      checkColoringSvg(text, meta);
      expect(performance.now() - t0).toBeLessThan(1500);
    };
    quick("<!--a-->".repeat(60) + "x");
    quick("<?".repeat(200_000));
    quick(svg(`<rect data-region="Box" x="1" y="1" width="9" height="9" stroke="#000" stroke-width="${"1".repeat(400_000)}x"/>`));
    quick(svg(`<rect data-region="${"&lt;".repeat(100_000)}" id="${"&lt;".repeat(20_000)}" x="1" y="1" width="9" height="9"/>`));
    refused(svg(`<rect data-region="Box" x="1" y="1" width="9" height="9" stroke-width="${"1".repeat(5000)}"/>`), /too long/);
  });

  it("explains that ordinary line art without parts is freehand-only", () => {
    refused(svg('<path d="M0 0 L50 50" stroke="#000" fill="none"/>'), /freehand-only/);
  });

  it("refuses broken geometry, nested parts, and lines marked as parts", () => {
    refused(svg('<path data-region="Bad" d="M0 0 L10 x"/>'), /couldn't be read/);
    refused(svg('<path data-region="Bad" d="L10 10"/>'), /couldn't be read/);
    refused(svg('<rect data-region="Bad" x="1" y="1" width="9" height="9" transform="spin(3)"/>'), /transform/);
    refused(svg(`<g data-region="Outer">${part}</g>`), /nested/i);
    refused(svg('<line data-region="Stick" x1="0" y1="0" x2="50" y2="50"/>'), /line, so it can't be a fillable part/);
    refused(svg('<rect data-region="Tiny" x="1" y="1" width="0.01" height="0.01"/>'), /couldn't be read|too small/);
  });
});

describe("coloring SVG checks: what is kept", () => {
  it("keeps only normalized geometry, names, and the editor's story and attribution", () => {
    const r = ok(svg(`<title>Ignored title</title><desc>Ignored</desc>${part}<path d="M10 50 H90" stroke="#000" stroke-width="2" fill="none"/><circle cx="50" cy="50" r="3"/>`));
    const t = r.template;
    expect(t).toMatchObject({ format: 1, mode: "regions", width: 1000, height: 1000, story: "A synthetic story." });
    expect(t.regions).toEqual([{ id: "r1", label: "Box", d: "M100 100L900 100L900 900L100 900Z", rule: "nonzero", w: 10 }]);
    expect(t.lines).toHaveLength(2);
    expect(t.lines[0]).toEqual({ d: "M100 500L900 500", w: 20 });
    expect(t.lines[1].fill).toBe(true); // default black fill: an eye or dot
    expect(JSON.stringify(t)).not.toMatch(/<|svg|title|Ignored|xmlns/);
    expect(checkTemplate(t).ok).toBe(true);
  });

  it("applies transforms and the viewBox origin", () => {
    const r = ok(svg('<g transform="translate(10 0) scale(2)"><rect data-region="Moved" x="0" y="0" width="10" height="10"/></g>', 'viewBox="-10 0 200 100"'));
    expect(r.template.width).toBe(1000);
    expect(r.template.height).toBe(500);
    expect(r.template.regions[0].d).toBe("M100 0L200 0L200 100L100 100Z");
  });

  it("merges a group marked as one part, and names parts from data-region, aria-label, or title", () => {
    const r = ok(svg(`<g data-region="Legs"><rect x="0" y="0" width="5" height="20"/><rect x="10" y="0" width="5" height="20"/></g>
      <rect data-region="" aria-label="Sun" x="50" y="0" width="10" height="10"/>
      <g data-region=""><title>Cloud</title><ellipse cx="80" cy="80" rx="10" ry="5"/></g>
      <rect data-region="" x="30" y="30" width="10" height="10"/>`));
    expect(r.template.regions.map((x) => x.label)).toEqual(["Legs", "Sun", "Cloud", "Part 4"]);
    expect(r.template.regions[0].d.match(/M/g)).toHaveLength(2);
    expect(r.warnings.join(" ")).toMatch(/no name/);
  });

  it("strips markup and control characters from part names", () => {
    const r = ok(svg('<rect data-region="Sky&lt;b&gt;" x="0" y="0" width="10" height="10"/>'));
    expect(r.template.regions[0].label).toBe("Sky");
  });

  it("ignores Inkscape and Sodipodi editor metadata, and hidden shapes", () => {
    const r = ok(
      svg(
        `<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" pagecolor="#ffffff"/>${part}<rect x="0" y="0" width="5" height="5" style="display:none"/>`,
        'viewBox="0 0 100 100" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1.3"',
      ),
    );
    expect(r.template.regions).toHaveLength(1);
    expect(r.template.lines).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/Hidden shapes/);
  });

  it("accepts each demonstration picture with every part named", () => {
    for (const demo of COLORING_DEMOS) {
      const r = ok(demo.svg);
      expect(r.template.regions.length).toBeGreaterThan(8);
      expect(r.template.regions.every((x) => !/^Part \d+$/.test(x.label))).toBe(true);
      expect(r.warnings.filter((w) => /no name/.test(w))).toEqual([]);
      expect(JSON.stringify(r.template).length).toBeLessThan(60_000);
    }
  });

  it("keeps demonstration artwork free of text and outside resources", () => {
    for (const demo of COLORING_DEMOS) {
      expect(demo.svg).not.toMatch(/<text|href|url\(|<image|<script|<style/i);
    }
    const source = readFileSync(path.join(__dirname, "coloring-demos.ts"), "utf8");
    expect(source).toMatch(/Original demonstration artwork/);
  });
});

describe("coloring path geometry", () => {
  it("normalizes relative, shorthand, quadratic, and arc commands to absolute M/L/C/Z", () => {
    const segs = parsePathData("m10 10 h10 v10 l-5 5 s5 5 10 0 q5 5 10 0 t10 0 a5 5 0 0 1 10 0 z")!;
    const d = segsToD(segs);
    expect(d).toMatch(/^M10 10L20 10L20 20L15 25C/);
    expect(d).toMatch(/^[MLCZ0-9 .-]+$/);
    expect(d.endsWith("Z")).toBe(true);
    const b = segsBounds(segs)!;
    expect(b.maxX).toBeCloseTo(55, 0);
  });

  it("reads compact arc flags and implicit repeated commands", () => {
    expect(parsePathData("M0 0a5 5 0 105 5")).not.toBeNull();
    expect(segsToD(parsePathData("M0 0 10 0 10 10")!)).toBe("M0 0L10 0L10 10");
  });

  it("refuses invalid path data and transforms", () => {
    expect(parsePathData("M0 0 L1")).toBeNull();
    expect(parsePathData("X0 0")).toBeNull();
    expect(parsePathData("M0 0 A5 5 0 2 1 5 5")).toBeNull();
    expect(parsePathData("M1e400 0")).toBeNull();
    expect(parseTransform("rotate(90 10)")).toBeNull();
    expect(parseTransform("translate(1,2) evil(3)")).toBeNull();
  });

  it("applies rotate around a point", () => {
    const m = parseTransform("rotate(90 10 10)")!;
    const [s] = transformSegs([{ c: "M", x: 20, y: 10 }], m);
    expect(s).toMatchObject({ c: "M" });
    if (s.c === "M") {
      expect(s.x).toBeCloseTo(10);
      expect(s.y).toBeCloseTo(20);
    }
  });
});
