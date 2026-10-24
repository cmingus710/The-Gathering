import "server-only";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { checkTemplate, LIMITS, type Attribution, type ColoringTemplate, type LineArt, type Region } from "./coloring";
import {
  ellipsePath,
  lengthAttr,
  linePath,
  matrixScale,
  multiply,
  parseNumberList,
  parsePathData,
  parseTransform,
  polyPath,
  rectPath,
  segsBounds,
  segsToD,
  transformSegs,
  type Matrix,
  type Seg,
} from "./coloring-path";

/**
 * Turns an uploaded SVG into a coloring picture, or explains why it can't.
 *
 * Strict by design: the file is refused (not cleaned) if it contains
 * anything active or external: scripts, event handlers, links or
 * references (href, url(…)), styles, embedded images or fonts, foreign
 * content, animation, DOCTYPE or entity declarations, processing
 * instructions, or any element this checker doesn't know. What is accepted
 * is only read for geometry: shapes are converted to normalized path data
 * and the SVG text itself is never stored or shown to anyone.
 *
 * Template format ("Gathering coloring SVG"):
 *   - a root <svg> with a viewBox (or plain numeric width and height);
 *   - fillable parts: a shape, or a <g> of shapes, with data-region="Name"
 *     (the name is what keyboard and screen reader users hear; a <title>
 *     child or aria-label is used when data-region is empty);
 *   - everything else drawn (stroked, or filled with a dark color) is line
 *     art, kept on top of the coloring;
 *   - transforms are applied; colors in the file are ignored (parts start
 *     white); Inkscape and Sodipodi editor metadata is ignored.
 */
export const SVG_MAX_BYTES = 512 * 1024;
const MAX_ELEMENTS = 4000;
const MAX_OUTPUT_CHARS = 240_000;

export type SvgCheckResult =
  | { ok: true; template: ColoringTemplate; warnings: string[] }
  | { ok: false; errors: string[] };

type XNode = Record<string, unknown>;

const FORBIDDEN: Record<string, string> = {
  script: "scripts",
  style: "style sheets",
  foreignobject: "embedded web content (foreignObject)",
  iframe: "embedded web content",
  object: "embedded content",
  embed: "embedded content",
  image: "embedded or linked images",
  feimage: "embedded or linked images",
  use: "references to other parts (use)",
  a: "links",
  audio: "audio",
  video: "video",
  animate: "animation",
  animatemotion: "animation",
  animatetransform: "animation",
  animatecolor: "animation",
  set: "animation",
  mpath: "animation",
  discard: "animation",
  handler: "event handlers",
  listener: "event handlers",
  filter: "filters",
  pattern: "patterns",
  mask: "masks",
  clippath: "clip paths",
  symbol: "symbols",
  marker: "markers",
  lineargradient: "gradients",
  radialgradient: "gradients",
  text: "text (convert text to paths first)",
  tspan: "text (convert text to paths first)",
  textpath: "text (convert text to paths first)",
  font: "fonts",
  "font-face": "fonts",
  switch: "conditional content (switch)",
  view: "views",
  cursor: "cursors",
  link: "links",
  meta: "metadata tags",
};

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);
const IGNORED_SUBTREES = new Set(["title", "desc", "metadata"]);
const ACTIVE_VALUE = /url\s*\(|javascript\s*:|vbscript\s*:|data\s*:|expression\s*\(|@import|\\|<|&#/i;

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const cleanLabel = (s: string) => decode(s.slice(0, 200)).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

/** The prolog (XML declaration, comments, whitespace) then <svg, scanned without backtracking regexes. */
function startsWithSvg(text: string): boolean {
  let i = 0;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  skipSpace();
  if (text.startsWith("<?xml", i)) {
    const end = text.indexOf("?>", i);
    if (end < 0) return false;
    i = end + 2;
  }
  for (;;) {
    skipSpace();
    if (!text.startsWith("<!--", i)) break;
    const end = text.indexOf("-->", i + 4);
    if (end < 0) return false;
    i = end + 3;
  }
  return /^<svg[\s>]/i.test(text.slice(i, i + 5));
}

/** Longest attribute value accepted (path data and point lists may be longer). */
const MAX_ATTR = 1024;
const MAX_GEOMETRY_ATTR = 64 * 1024;

const tagOf = (n: XNode) => Object.keys(n).find((k) => k !== ":@") ?? "";
const attrsOf = (n: XNode) => ((n[":@"] as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
const kidsOf = (n: XNode) => (Array.isArray(n[tagOf(n)]) ? (n[tagOf(n)] as XNode[]) : []);
const localName = (tag: string) => (tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag).toLowerCase();
const prefixOf = (tag: string) => (tag.includes(":") ? tag.slice(0, tag.indexOf(":")).toLowerCase() : "");
const EDITOR_PREFIXES = new Set(["sodipodi", "inkscape"]);

type Paint = { fill: string; stroke: string; strokeWidth: number; fillRule: "nonzero" | "evenodd"; hidden: boolean };

const STYLE_PROPS = new Set(["fill", "stroke", "stroke-width", "fill-rule", "display", "visibility", "opacity", "fill-opacity", "stroke-opacity"]);

function isWhite(v: string) {
  const s = v.trim().toLowerCase().replace(/\s+/g, "");
  return s === "white" || s === "#fff" || s === "#ffffff" || s === "rgb(255,255,255)" || s === "#ffff" || s === "#ffffffff";
}

/**
 * Inspects every element and attribute in the document (including editor
 * metadata) for active or external content. Returns problems found.
 */
function scan(nodes: XNode[], errors: Set<string>, count: { n: number }) {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "#text" || tag === "#comment") continue;
    if (tag.startsWith("?")) {
      if (tag !== "?xml") errors.add("Processing instructions (like <?xml-stylesheet?>) aren't allowed.");
      continue;
    }
    count.n++;
    const name = localName(tag);
    if (FORBIDDEN[name]) errors.add(`The file contains ${FORBIDDEN[name]} (<${tag}>), which coloring pictures can't include.`);
    for (const [k, raw] of Object.entries(attrsOf(node))) {
      const key = k.toLowerCase();
      const v = String(raw ?? "");
      const local = localName(key);
      if (v.length > (local === "d" || local === "points" ? MAX_GEOMETRY_ATTR : MAX_ATTR)) errors.add(`The attribute ${k.slice(0, 40)} on <${tag}> is too long.`);
      else if (/^on/.test(local)) errors.add(`The file contains an event handler (${k}), which isn't allowed.`);
      else if (local === "href" || local === "src" || key === "xml:base") errors.add(`The file links to another file or address (${k}), which isn't allowed.`);
      else if (key.startsWith("xmlns")) {
        // Namespace declarations are names, not resources.
      } else if (ACTIVE_VALUE.test(v)) errors.add(`The attribute ${k} on <${tag}> contains a reference or script (like url(…) or javascript:), which isn't allowed.`);
    }
    scan(kidsOf(node), errors, count);
  }
}

function paintFrom(attrs: Record<string, unknown>, parent: Paint, errors: Set<string>, tag: string): Paint {
  const p: Paint = { ...parent };
  const decls: Array<[string, string]> = [];
  for (const k of ["fill", "stroke", "stroke-width", "fill-rule", "display", "visibility", "opacity", "fill-opacity", "stroke-opacity"]) {
    if (attrs[k] !== undefined) decls.push([k, String(attrs[k])]);
  }
  if (attrs.style !== undefined) {
    for (const part of String(attrs.style).split(";")) {
      const i = part.indexOf(":");
      if (i < 0) continue;
      const prop = part.slice(0, i).trim().toLowerCase();
      const value = part.slice(i + 1).trim();
      if (STYLE_PROPS.has(prop)) decls.push([prop, value]);
    }
  }
  for (const [prop, value] of decls) {
    const v = value.replace(/!important/i, "").trim();
    switch (prop) {
      case "fill":
        if (v !== "inherit") p.fill = v;
        break;
      case "stroke":
        if (v !== "inherit") p.stroke = v;
        break;
      case "stroke-width": {
        const n = lengthAttr(v);
        if (n === null || n < 0) errors.add(`<${tag}> has a stroke width that isn't a plain number (${v}).`);
        else p.strokeWidth = n;
        break;
      }
      case "fill-rule":
        if (v === "evenodd" || v === "nonzero") p.fillRule = v;
        break;
      case "display":
        if (v === "none") p.hidden = true;
        break;
      case "visibility":
        if (v === "hidden" || v === "collapse") p.hidden = true;
        break;
      case "opacity":
      case "fill-opacity":
      case "stroke-opacity": {
        const n = Number(v);
        if (Number.isFinite(n) && n <= 0) {
          if (prop === "fill-opacity") p.fill = "none";
          else if (prop === "stroke-opacity") p.stroke = "none";
          else p.hidden = true;
        }
        break;
      }
    }
  }
  return p;
}

function shapeD(name: string, a: Record<string, unknown>): string | null {
  const n = (k: string, fallback: number | null = 0) => lengthAttr(a[k] === undefined ? undefined : String(a[k]), fallback);
  switch (name) {
    case "path":
      return typeof a.d === "string" ? a.d : null;
    case "rect": {
      const x = n("x"), y = n("y"), w = n("width", null), h = n("height", null), rx = n("rx"), ry = n("ry");
      return x === null || y === null || w === null || h === null || rx === null || ry === null ? null : rectPath(x, y, w, h, rx, ry);
    }
    case "circle": {
      const cx = n("cx"), cy = n("cy"), r = n("r", null);
      return cx === null || cy === null || r === null ? null : ellipsePath(cx, cy, r, r);
    }
    case "ellipse": {
      const cx = n("cx"), cy = n("cy"), rx = n("rx", null), ry = n("ry", null);
      return cx === null || cy === null || rx === null || ry === null ? null : ellipsePath(cx, cy, rx, ry);
    }
    case "polygon":
    case "polyline":
      return typeof a.points === "string" ? polyPath(a.points, name === "polygon") : null;
    case "line": {
      const x1 = n("x1"), y1 = n("y1"), x2 = n("x2"), y2 = n("y2");
      return x1 === null || y1 === null || x2 === null || y2 === null ? null : linePath(x1, y1, x2, y2);
    }
  }
  return null;
}

function titleOf(node: XNode): string {
  for (const k of kidsOf(node)) {
    if (localName(tagOf(k)) === "title") {
      const text = kidsOf(k).map((t) => String(t["#text"] ?? "")).join(" ");
      return cleanLabel(text);
    }
  }
  return "";
}

export function checkColoringSvg(input: string | Uint8Array, meta: { story: string; attribution: Attribution }): SvgCheckResult {
  const bytes = typeof input === "string" ? Buffer.byteLength(input) : input.byteLength;
  if (bytes === 0) return { ok: false, errors: ["Choose an SVG file."] };
  if (bytes > SVG_MAX_BYTES) return { ok: false, errors: [`The SVG must be ${Math.round(SVG_MAX_BYTES / 1024)} KB or smaller. Simplify the artwork and try again.`] };
  let text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: false }).decode(input);
  text = text.replace(/^﻿/, "");
  const errors = new Set<string>();
  const warnings = new Set<string>();

  if (text.includes("\u0000") || text.includes("�")) return { ok: false, errors: ["The file isn't a text SVG (UTF-8)."] };
  if (/<!DOCTYPE/i.test(text)) errors.add("DOCTYPE declarations aren't allowed.");
  if (/<!ENTITY/i.test(text)) errors.add("Entity declarations aren't allowed.");
  if (/<!\[CDATA\[/i.test(text)) errors.add("CDATA sections aren't allowed (they're used for scripts and styles).");
  if (/<\?(?!xml\s)/i.test(text)) errors.add("Processing instructions (like <?xml-stylesheet?>) aren't allowed.");
  if (errors.size) return { ok: false, errors: [...errors] };
  if (!startsWithSvg(text)) {
    return { ok: false, errors: ["This isn't an SVG file. For a photo or scanned drawing, upload it as artwork and use it as freehand-only line art."] };
  }

  const valid = XMLValidator.validate(text, { allowBooleanAttributes: false });
  if (valid !== true) {
    return { ok: false, errors: [`The SVG isn't well-formed XML (line ${valid.err.line}): ${valid.err.msg}`] };
  }
  let doc: XNode[];
  try {
    doc = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      preserveOrder: true,
      processEntities: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      allowBooleanAttributes: false,
      commentPropName: "#comment",
    }).parse(text) as XNode[];
  } catch {
    return { ok: false, errors: ["The SVG couldn't be read."] };
  }

  const count = { n: 0 };
  scan(doc, errors, count);
  if (count.n > MAX_ELEMENTS) errors.add(`The SVG has too many elements (more than ${MAX_ELEMENTS}). Simplify the artwork and try again.`);
  if (errors.size) return { ok: false, errors: [...errors] };

  const roots = doc.filter((n) => !["?xml", "#comment", "#text"].includes(tagOf(n)));
  if (roots.length !== 1 || localName(tagOf(roots[0])) !== "svg") return { ok: false, errors: ["The file must have a single <svg> root element."] };
  const root = roots[0];
  const ra = attrsOf(root);

  // The picture's own space: the viewBox (or numeric width/height), scaled so the longest side is 1000.
  let box: [number, number, number, number] | null = null;
  if (ra.viewBox !== undefined) {
    const v = parseNumberList(String(ra.viewBox));
    if (v && v.length === 4 && v[2] > 0 && v[3] > 0) box = [v[0], v[1], v[2], v[3]];
    else return { ok: false, errors: ["The viewBox must be four numbers with a positive width and height."] };
  } else {
    const w = lengthAttr(ra.width === undefined ? undefined : String(ra.width));
    const h = lengthAttr(ra.height === undefined ? undefined : String(ra.height));
    if (w && h && w > 0 && h > 0) box = [0, 0, w, h];
    else return { ok: false, errors: ["Add a viewBox to the <svg> element (for example viewBox=\"0 0 800 600\")."] };
  }
  const scale = 1000 / Math.max(box[2], box[3]);
  const width = Math.round(box[2] * scale);
  const height = Math.round(box[3] * scale);
  if (width < 100 || height < 100) return { ok: false, errors: ["The picture is too narrow. Use a shape closer to a square or a page."] };
  const rootTransform = parseTransform(ra.transform === undefined ? null : String(ra.transform));
  if (!rootTransform) return { ok: false, errors: ["The <svg> element's transform couldn't be read."] };
  const base: Matrix = multiply([scale, 0, 0, scale, -box[0] * scale, -box[1] * scale], rootTransform);

  const regions: Region[] = [];
  const lines: LineArt[] = [];
  let unnamed = 0;
  let ignoredColors = false;
  let hiddenSkipped = false;
  let outChars = 0;

  const defaultPaint: Paint = { fill: "black", stroke: "none", strokeWidth: 1, fillRule: "nonzero", hidden: false };

  type RegionAcc = { label: string; segs: Seg[]; w: number; rule: "nonzero" | "evenodd"; name: string };

  const shapeSegs = (name: string, a: Record<string, unknown>, m: Matrix, where: string): Seg[] | null => {
    const d = shapeD(name, a);
    if (d === null) {
      errors.add(`${where} has shape data that couldn't be read.`);
      return null;
    }
    const segs = parsePathData(d);
    if (!segs) {
      errors.add(`${where} has path data that couldn't be read.`);
      return null;
    }
    return transformSegs(segs, m);
  };

  const pushPath = (d: string, where: string): boolean => {
    if (d.length > LIMITS.pathChars) {
      errors.add(`${where} is too detailed. Simplify it (fewer points) and try again.`);
      return false;
    }
    outChars += d.length;
    return true;
  };

  const walk = (nodes: XNode[], m: Matrix, paint: Paint, region: RegionAcc | null) => {
    for (const node of nodes) {
      const tag = tagOf(node);
      if (tag === "#text" || tag === "#comment" || tag.startsWith("?")) continue;
      const name = localName(tag);
      if (EDITOR_PREFIXES.has(prefixOf(tag)) || IGNORED_SUBTREES.has(name)) continue;
      const a = attrsOf(node);
      const where = `<${tag}${a.id ? ` id="${cleanLabel(String(a.id)).slice(0, 40)}"` : ""}>`;
      if (name === "defs") {
        if (kidsOf(node).some((k) => !["#text", "#comment"].includes(tagOf(k)))) errors.add("Definitions (<defs> with gradients, clip paths, or symbols) aren't supported.");
        continue;
      }
      if (name === "svg") {
        errors.add("Nested <svg> elements aren't supported.");
        continue;
      }
      if (name !== "g" && !SHAPES.has(name)) {
        errors.add(`${where} isn't supported in coloring pictures.`);
        continue;
      }
      const t = parseTransform(a.transform === undefined ? null : String(a.transform));
      if (!t) {
        errors.add(`${where} has a transform that couldn't be read.`);
        continue;
      }
      const cm = multiply(m, t);
      const p = paintFrom(a, paint, errors, tag);
      if (p.hidden) {
        hiddenSkipped = true;
        continue;
      }
      const regionAttr = a["data-region"];
      const startsRegion = regionAttr !== undefined;
      if (startsRegion && region) {
        errors.add(`${where} is a fillable part inside another fillable part ("${region.label || region.name}"). Parts can't be nested.`);
        continue;
      }
      let acc = region;
      if (startsRegion) {
        const label = cleanLabel(String(regionAttr)) || cleanLabel(String(a["aria-label"] ?? "")) || titleOf(node);
        acc = { label, segs: [], w: 0, rule: p.fillRule, name: where };
      }
      if (name === "g") {
        walk(kidsOf(node), cm, p, acc);
      } else {
        const segs = shapeSegs(name, a, cm, where);
        if (segs) {
          const stroked = p.stroke !== "none" && p.strokeWidth > 0;
          const sw = Math.min(40, Math.round(p.strokeWidth * matrixScale(cm) * 10) / 10);
          if (acc) {
            if (name === "line" || name === "polyline") {
              errors.add(`${where} is a line, so it can't be a fillable part. Use a closed shape.`);
            } else {
              if (p.fill !== "none" && !isWhite(p.fill)) ignoredColors = true;
              acc.segs.push(...segs);
              acc.w = Math.max(acc.w, stroked ? sw : 0);
              if (startsRegion) acc.rule = p.fillRule;
            }
          } else {
            const inkFill = p.fill !== "none" && !isWhite(p.fill) && name !== "line" && name !== "polyline";
            if (p.fill !== "none" && isWhite(p.fill)) ignoredColors = true;
            if (inkFill || stroked) {
              const d = segsToD(segs);
              if (pushPath(d, where)) lines.push({ d, w: stroked ? Math.max(0.5, sw) : 0, ...(inkFill ? { fill: true } : {}) });
            }
          }
        }
      }
      if (startsRegion && acc) {
        if (!acc.segs.length) {
          errors.add(`${where} is marked as a fillable part but has no shapes in it.`);
          continue;
        }
        const b = segsBounds(acc.segs);
        if (!b || b.maxX - b.minX < 1 || b.maxY - b.minY < 1) {
          errors.add(`${where} is too small to fill.`);
          continue;
        }
        const d = segsToD(acc.segs);
        if (!pushPath(d, where)) continue;
        if (!acc.label) unnamed++;
        regions.push({ id: `r${regions.length + 1}`, label: acc.label || `Part ${regions.length + 1}`, d, rule: acc.rule, w: acc.w });
      }
    }
  };

  walk(kidsOf(root), base, paintFrom(ra, defaultPaint, errors, "svg"), null);

  if (regions.length > LIMITS.regions) errors.add(`The picture has ${regions.length} fillable parts; the most is ${LIMITS.regions}.`);
  if (lines.length > LIMITS.lines) errors.add(`The picture has ${lines.length} line-art shapes; the most is ${LIMITS.lines}. Combine or simplify them.`);
  if (outChars > MAX_OUTPUT_CHARS) errors.add("The picture is too detailed to store. Simplify the artwork (fewer points) and try again.");
  if (!regions.length && !errors.size) {
    errors.add('No fillable parts were found. Mark each part children can tap to fill with data-region="Name" (for example data-region="Rainbow, red stripe"). For ordinary line art, upload it as artwork and use it as a freehand-only picture.');
  }
  if (errors.size) return { ok: false, errors: [...errors] };

  if (unnamed) warnings.add(`${unnamed} ${unnamed === 1 ? "part has" : "parts have"} no name, so ${unnamed === 1 ? "it's" : "they're"} called "Part N". Names help children using a keyboard or screen reader.`);
  if (ignoredColors) warnings.add("Colors in the file are ignored: every part starts white for children to color.");
  if (hiddenSkipped) warnings.add("Hidden shapes were left out.");

  const template: ColoringTemplate = {
    format: 1,
    mode: "regions",
    width,
    height,
    regions,
    lines,
    story: meta.story,
    attribution: meta.attribution,
  };
  const checked = checkTemplate(template);
  if (!checked.ok) return { ok: false, errors: [`The coloring picture ${checked.problem}.`] };
  return { ok: true, template: checked.value, warnings: [...warnings] };
}

