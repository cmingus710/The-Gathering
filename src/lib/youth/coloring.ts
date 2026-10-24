/**
 * Bible Coloring Studio: the picture format, a child's artwork, and the
 * edits made to it. Shared by the studio (browser), the editor, and the save
 * endpoint. The database checks the same rules again
 * (youth.coloring_template_problem, youth.coloring_doc_problem in
 * 20261122000100); nothing here grants access.
 *
 * A picture (an activity version's config.coloring) is data only:
 *   - mode "regions": fillable parts (normalized path data: absolute M/L/C/Z
 *     commands and numbers) plus line-art details. Built only by the SVG
 *     checker on the server (coloring-svg.ts), never stored as markup.
 *   - mode "freehand": an ordinary line-art image uploaded through the
 *     artwork pipeline. It has no parts, so it can't be tap-filled.
 * Coordinates are in the picture's own space (longest side 1000 units).
 */

export const PALETTE = [
  { key: "red", label: "Red", hex: "#e53935" },
  { key: "orange", label: "Orange", hex: "#fb8c00" },
  { key: "yellow", label: "Yellow", hex: "#fdd835" },
  { key: "green", label: "Green", hex: "#43a047" },
  { key: "sky", label: "Sky blue", hex: "#4fc3f7" },
  { key: "blue", label: "Blue", hex: "#1e5bc6" },
  { key: "purple", label: "Purple", hex: "#8e44ad" },
  { key: "pink", label: "Pink", hex: "#f48fb1" },
  { key: "brown", label: "Brown", hex: "#8d5a3b" },
  { key: "peach", label: "Peach", hex: "#f6c49a" },
  { key: "white", label: "White", hex: "#ffffff" },
  { key: "black", label: "Black", hex: "#262626" },
] as const;

export type ColorKey = (typeof PALETTE)[number]["key"];

const colorByKey = new Map<string, (typeof PALETTE)[number]>(PALETTE.map((c) => [c.key, c]));
export const isColorKey = (v: unknown): v is ColorKey => typeof v === "string" && colorByKey.has(v);
export const colorHex = (k: string) => colorByKey.get(k)?.hex ?? "#ffffff";
export const colorLabel = (k: string) => colorByKey.get(k)?.label ?? "No color";

/** Brush widths in picture units (the picture's longest side is 1000). */
export const BRUSHES = [
  { key: "s", label: "Small", width: 8 },
  { key: "m", label: "Medium", width: 18 },
  { key: "l", label: "Large", width: 36 },
] as const;

export type BrushKey = (typeof BRUSHES)[number]["key"];
export const isBrushKey = (v: unknown): v is BrushKey => v === "s" || v === "m" || v === "l";
export const brushWidth = (k: string) => BRUSHES.find((b) => b.key === k)?.width ?? 18;

/** Paper and ink. Line art is always drawn in ink, on top of the coloring. */
export const PAPER = "#ffffff";
export const INK = "#1f1f1f";

export const ART_SOURCE_KINDS = ["original", "licensed", "public_domain", "permission"] as const;
export type ArtSourceKind = (typeof ART_SOURCE_KINDS)[number];

export type Region = { id: string; label: string; d: string; rule: "nonzero" | "evenodd"; w: number };
export type LineArt = { d: string; w: number; fill?: boolean };
export type Attribution = { source_kind: ArtSourceKind; credit: string; license: string; source_url: string | null };

export type ColoringTemplate = {
  format: 1;
  mode: "regions" | "freehand";
  width: number;
  height: number;
  /** Outline width for parts, in picture units. */
  outline?: number;
  regions: Region[];
  lines: LineArt[];
  /** Freehand only: the uploaded line art (activities/<activity>/<asset>.webp). */
  line_art_asset_id?: string;
  /** The story in words: the text alternative to the picture. */
  story: string;
  attribution: Attribution;
};

export type Stroke = {
  t: "paint" | "erase";
  /** Paint only. */
  c?: ColorKey;
  s: BrushKey;
  /** "x,y x,y …" in integer picture units. */
  p: string;
  /** "Stay inside the lines": the part this stroke is kept inside. */
  r?: string;
};

export type ColoringDoc = { fills: Record<string, ColorKey>; strokes: Stroke[] };

export const LIMITS = {
  regions: 300,
  lines: 800,
  pathChars: 40_000,
  story: 1500,
  strokes: 2000,
  pointsChars: 18_000,
  /** Saved artwork (JSON text). */
  docChars: 400_000,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^M[MLCZ0-9 .-]*$/;
const POINTS = /^-?\d{1,4},-?\d{1,4}( -?\d{1,4},-?\d{1,4})*$/;
const CONTROL = /[\u0000-\u001F\u007F]/;
const STORY_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// Same as youth.markup_free: no HTML tags or script URLs.
const MARKUP = /<\s*\/?\s*[a-z!?][^>]*>|javascript\s*:|vbscript\s*:/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const plain = (v: unknown, max: number, re = CONTROL) => typeof v === "string" && v.length <= max && !re.test(v) && !MARKUP.test(v);

export type Checked<T> = { ok: true; value: T } | { ok: false; problem: string };

/**
 * Checks a picture exactly as the database does (minus "this asset belongs to
 * the activity", which only the database can know). Problems are worded to
 * follow "The coloring picture …".
 */
export function checkTemplate(raw: unknown): Checked<ColoringTemplate> {
  const bad = (problem: string): Checked<ColoringTemplate> => ({ ok: false, problem });
  if (!isObj(raw)) return bad("isn't a coloring picture");
  if (!onlyKeys(raw, ["format", "mode", "width", "height", "outline", "regions", "lines", "line_art_asset_id", "story", "attribution"])) return bad("has an unsupported field");
  if (raw.format !== 1 || (raw.mode !== "regions" && raw.mode !== "freehand")) return bad("isn't a supported coloring picture format");
  if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height) || !num(raw.width, 100, 1000) || !num(raw.height, 100, 1000)) return bad("has an unsupported size");
  if (raw.outline !== undefined && !num(raw.outline, 0, 24)) return bad("has an unsupported outline width");
  if (!Array.isArray(raw.regions) || !Array.isArray(raw.lines)) return bad("is missing its parts");
  if (raw.regions.length > LIMITS.regions || raw.lines.length > LIMITS.lines) return bad("has too many parts");
  const ids = new Set<string>();
  if (raw.mode === "regions") {
    if (!raw.regions.length) return bad("has no parts to fill");
    if (raw.line_art_asset_id !== undefined) return bad("mixes tap-to-fill parts with uploaded line art");
    for (const r of raw.regions) {
      if (!isObj(r) || !onlyKeys(r, ["id", "label", "d", "rule", "w"])) return bad("has a part in an unsupported format");
      if (typeof r.id !== "string" || !/^r\d{1,3}$/.test(r.id) || ids.has(r.id)) return bad("has a part without a unique id");
      ids.add(r.id);
      if (!plain(r.label, 80) || !(r.label as string).trim()) return bad("has a part without a plain-text name");
      if (typeof r.d !== "string" || r.d.length < 2 || r.d.length > LIMITS.pathChars || !PATH.test(r.d)) return bad("has a part with unsupported shape data");
      if ((r.rule !== "nonzero" && r.rule !== "evenodd") || !num(r.w, 0, 40)) return bad("has a part with unsupported drawing settings");
    }
  } else {
    if (raw.regions.length || raw.lines.length) return bad("is freehand-only, so it can't have tap-to-fill parts");
    if (typeof raw.line_art_asset_id !== "string" || !UUID.test(raw.line_art_asset_id)) return bad("needs line art uploaded for this activity");
  }
  for (const l of raw.lines) {
    if (!isObj(l) || !onlyKeys(l, ["d", "w", "fill"]) || typeof l.d !== "string" || l.d.length < 2 || l.d.length > LIMITS.pathChars || !PATH.test(l.d)
      || !num(l.w, 0, 40) || (l.fill !== undefined && typeof l.fill !== "boolean")) return bad("has line art in an unsupported format");
  }
  if (raw.story !== undefined && !plain(raw.story, LIMITS.story, STORY_CONTROL)) return bad("has a story summary that isn't plain text (1,500 characters at most)");
  const a = raw.attribution;
  if (!isObj(a) || !onlyKeys(a, ["source_kind", "credit", "license", "source_url"])) return bad("needs the artwork's attribution");
  if (!ART_SOURCE_KINDS.includes(a.source_kind as ArtSourceKind)) return bad("needs to say where the artwork came from");
  if ((a.credit !== undefined && !plain(a.credit, 300)) || (a.license !== undefined && !plain(a.license, 300))) return bad("has attribution that isn't plain text");
  if (a.source_kind !== "original" && !String(a.credit ?? "").trim()) return bad("needs the artist or source for artwork that isn't original");
  if (a.source_url != null && (typeof a.source_url !== "string" || !/^https:\/\/[^\s<>"]+$/.test(a.source_url) || a.source_url.length > 500)) {
    return bad("has a source link that doesn't start with https://");
  }
  return {
    ok: true,
    value: {
      ...(raw as unknown as ColoringTemplate),
      story: (raw.story as string | undefined) ?? "",
      attribution: { source_kind: a.source_kind as ArtSourceKind, credit: String(a.credit ?? ""), license: String(a.license ?? ""), source_url: (a.source_url as string | null | undefined) ?? null },
    },
  };
}

/** The coloring picture in an activity's config, if it has a valid one. */
export function templateFromConfig(config: unknown): ColoringTemplate | null {
  if (!isObj(config) || config.coloring === undefined) return null;
  const t = checkTemplate(config.coloring);
  return t.ok ? t.value : null;
}

/** Where the line art of a freehand picture is stored (the artwork path convention). */
export function lineArtPath(activityId: string, t: ColoringTemplate): string | null {
  return t.mode === "freehand" && t.line_art_asset_id ? `activities/${activityId}/${t.line_art_asset_id}.webp` : null;
}

export const emptyDoc = (): ColoringDoc => ({ fills: {}, strokes: [] });

/** Checks a child's artwork against the picture, as youth.coloring_doc_problem does. */
export function checkDoc(raw: unknown, t: Pick<ColoringTemplate, "regions"> | null): Checked<ColoringDoc> {
  const bad = (problem: string): Checked<ColoringDoc> => ({ ok: false, problem });
  if (!isObj(raw) || !onlyKeys(raw, ["fills", "strokes"])) return bad("isn't a coloring picture");
  const fills = raw.fills ?? {};
  const strokes = raw.strokes ?? [];
  if (!isObj(fills) || !Array.isArray(strokes)) return bad("isn't a coloring picture");
  const ids = t ? new Set(t.regions.map((r) => r.id)) : null;
  for (const [k, v] of Object.entries(fills)) {
    if (ids && !ids.has(k)) return bad("colors a part the picture doesn't have");
    if (!ids && !/^r\d{1,3}$/.test(k)) return bad("colors a part the picture doesn't have");
    if (!isColorKey(v)) return bad("uses a color that isn't in the palette");
  }
  if (strokes.length > LIMITS.strokes) return bad("has too many brush strokes");
  for (const s of strokes) {
    if (!isObj(s) || !onlyKeys(s, ["t", "c", "s", "p", "r"])) return bad("has a brush stroke in an unsupported format");
    if (s.t === "paint") {
      if (!isColorKey(s.c)) return bad("uses a color that isn't in the palette");
    } else if (s.t !== "erase" || s.c !== undefined) return bad("has a brush stroke in an unsupported format");
    if (!isBrushKey(s.s)) return bad("has an unsupported brush size");
    if (typeof s.p !== "string" || s.p.length > LIMITS.pointsChars || !POINTS.test(s.p)) return bad("has a brush stroke in an unsupported format");
    if (s.r !== undefined && (typeof s.r !== "string" || (ids ? !ids.has(s.r) : !/^r\d{1,3}$/.test(s.r)))) return bad("keeps a stroke inside a part the picture doesn't have");
  }
  return { ok: true, value: { fills: fills as Record<string, ColorKey>, strokes: strokes as Stroke[] } };
}

/** Stable text form (what is saved, kept on the device, and compared). */
export function serializeDoc(doc: ColoringDoc): string {
  const fills: Record<string, ColorKey> = {};
  for (const k of Object.keys(doc.fills).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) fills[k] = doc.fills[k];
  return JSON.stringify({
    fills,
    strokes: doc.strokes.map((s) => (s.t === "paint" ? { t: s.t, c: s.c, s: s.s, p: s.p, ...(s.r ? { r: s.r } : {}) } : { t: s.t, s: s.s, p: s.p, ...(s.r ? { r: s.r } : {}) })),
  });
}

export function parseDoc(text: string, t: Pick<ColoringTemplate, "regions"> | null): ColoringDoc | null {
  try {
    const d = checkDoc(JSON.parse(text), t);
    return d.ok ? d.value : null;
  } catch {
    return null;
  }
}

export const isEmptyDoc = (d: ColoringDoc) => Object.keys(d.fills).length === 0 && d.strokes.length === 0;

// ---------------------------------------------------------------------------
// Edits (each returns a new document; the history keeps the old ones)
// ---------------------------------------------------------------------------
export function fillRegion(doc: ColoringDoc, region: string, color: ColorKey): ColoringDoc {
  if (doc.fills[region] === color) return doc;
  return { ...doc, fills: { ...doc.fills, [region]: color } };
}

/**
 * Size as the database measures it (octet_length of jsonb::text, which adds
 * a space after every ":" and ","): an upper bound from the compact text.
 */
export function storedSize(doc: ColoringDoc): number {
  const text = serializeDoc(doc);
  let extra = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === ":" || text[i] === ",") extra++;
  return text.length + extra;
}

/** Too large to save: the studio stops adding strokes and says so (one more full stroke must still fit). */
export function docTooLarge(doc: ColoringDoc): boolean {
  return doc.strokes.length >= LIMITS.strokes || storedSize(doc) > LIMITS.docChars - 2 * LIMITS.pointsChars;
}

export function addStroke(doc: ColoringDoc, stroke: Stroke): ColoringDoc {
  if (!stroke.p || docTooLarge(doc)) return doc;
  return { ...doc, strokes: [...doc.strokes, stroke] };
}

export type Point = { x: number; y: number };

/**
 * Integer points, dropping ones closer than `minGap` units to the last kept
 * point (the last point is always kept), capped so the text fits.
 */
export function encodePoints(points: Point[], minGap = 1.5): string {
  const out: Array<[number, number]> = [];
  const clamp = (v: number) => Math.max(-999, Math.min(1999, Math.round(v)));
  for (let i = 0; i < points.length; i++) {
    const x = clamp(points[i].x);
    const y = clamp(points[i].y);
    const last = out[out.length - 1];
    const isEnd = i === points.length - 1;
    if (last && Math.hypot(x - last[0], y - last[1]) < minGap && !(isEnd && (x !== last[0] || y !== last[1]))) continue;
    out.push([x, y]);
  }
  let text = "";
  for (const [x, y] of out) {
    const next = `${text ? " " : ""}${x},${y}`;
    if (text.length + next.length > LIMITS.pointsChars) break;
    text += next;
  }
  return text;
}

export function decodePoints(p: string): Point[] {
  if (!p) return [];
  return p.split(" ").map((pair) => {
    const [x, y] = pair.split(",");
    return { x: Number(x), y: Number(y) };
  });
}

/** Undo and redo for fills, strokes, and reset alike: snapshots of the document. */
export type History = { past: ColoringDoc[]; present: ColoringDoc; future: ColoringDoc[] };

export const HISTORY_LIMIT = 100;

export const historyStart = (doc: ColoringDoc): History => ({ past: [], present: doc, future: [] });

export function historyPush(h: History, next: ColoringDoc): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function historyUndo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function historyRedo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/** Save status wording: Saving…, Saved, or Unable to save (with why). */
export function coloringStatusLabel(status: string): string {
  switch (status) {
    case "saved":
      return "Saved";
    case "unsaved":
    case "saving":
    case "retrying":
      return "Saving…";
    case "offline":
      return "Unable to save: you're offline";
    case "conflict":
      return "Unable to save: changed on another device";
    case "signed_out":
      return "Unable to save: signed out";
    default:
      return "Unable to save";
  }
}
