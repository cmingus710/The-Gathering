import { INK, PAPER, brushWidth, colorHex, decodePoints, type ColoringDoc, type ColoringTemplate, type Point, type Stroke } from "@/lib/youth/coloring";

/**
 * Canvas drawing for the coloring studio, its thumbnails, and the image
 * export. Brush strokes live on their own layer so the eraser removes only
 * strokes (never the tap-to-fill colors or the line art); "stay inside the
 * lines" clips a stroke to the part it started in.
 */
export type RegionPaths = Map<string, { path: Path2D; rule: CanvasFillRule }>;

export function regionPaths(t: ColoringTemplate): RegionPaths {
  const out: RegionPaths = new Map();
  for (const r of t.regions) out.set(r.id, { path: new Path2D(r.d), rule: r.rule });
  return out;
}

/** The topmost part under a point (picture units), or null. */
export function regionAt(t: ColoringTemplate, paths: RegionPaths, ctx: CanvasRenderingContext2D, x: number, y: number): string | null {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = t.regions.length - 1; i >= 0; i--) {
    const p = paths.get(t.regions[i].id);
    if (p && ctx.isPointInPath(p.path, x, y, p.rule)) return t.regions[i].id;
  }
  return null;
}

/** Draws one stroke (or the part drawn so far) in picture units; the caller sets the scale. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Pick<Stroke, "t" | "c" | "s" | "r">, points: Point[], paths: RegionPaths | null) {
  if (!points.length) return;
  ctx.save();
  const clip = s.r && paths ? paths.get(s.r) : null;
  if (clip) ctx.clip(clip.path, clip.rule);
  ctx.globalCompositeOperation = s.t === "erase" ? "destination-out" : "source-over";
  const color = s.t === "erase" ? "#000" : colorHex(s.c ?? "black");
  const w = brushWidth(s.s);
  if (points.length === 1) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, w / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Clears and redraws every stroke at `k` pixels per picture unit. */
export function paintStrokes(ctx: CanvasRenderingContext2D, doc: ColoringDoc, paths: RegionPaths | null, k: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  for (const s of doc.strokes) drawStroke(ctx, s, decodePoints(s.p), paths);
}

/** The whole picture on one canvas: paper, fills, strokes, then line art on top. */
export function paintPicture(
  canvas: HTMLCanvasElement,
  t: ColoringTemplate,
  doc: ColoringDoc,
  opts: { k: number; lineArt?: HTMLImageElement | null; paths?: RegionPaths },
) {
  const { k } = opts;
  const paths = opts.paths ?? regionPaths(t);
  canvas.width = Math.max(1, Math.round(t.width * k));
  canvas.height = Math.max(1, Math.round(t.height * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  for (const r of t.regions) {
    const p = paths.get(r.id);
    if (!p) continue;
    ctx.fillStyle = doc.fills[r.id] ? colorHex(doc.fills[r.id]) : PAPER;
    ctx.fill(p.path, p.rule);
  }
  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  const lctx = layer.getContext("2d");
  if (lctx) {
    paintStrokes(lctx, doc, paths, k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const r of t.regions) {
    const p = paths.get(r.id);
    const w = r.w || t.outline || 0;
    if (!p || !w) continue;
    ctx.lineWidth = w;
    ctx.stroke(p.path);
  }
  for (const l of t.lines) {
    const p = new Path2D(l.d);
    if (l.fill) ctx.fill(p);
    if (l.w) {
      ctx.lineWidth = l.w;
      ctx.stroke(p);
    }
  }
  if (opts.lineArt && opts.lineArt.complete && opts.lineArt.naturalWidth) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(opts.lineArt, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
  }
}

/** A PNG of the picture (about 2000 pixels on its longest side). */
export function exportPng(t: ColoringTemplate, doc: ColoringDoc, lineArt: HTMLImageElement | null): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  paintPicture(canvas, t, doc, { k: 2, lineArt });
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      // A line-art image without cross-origin permission taints the canvas.
      resolve(null);
    }
  });
}

export function fileSlug(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return s || "picture";
}
