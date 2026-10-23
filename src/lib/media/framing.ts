import type { CSSProperties } from "react";

/**
 * How an image sits in a fixed frame, without changing the image itself.
 *
 * `x` and `y` (0–100) mean exactly what CSS `object-position` means for an
 * `object-fit: cover` image: 0 shows the left (top) edge, 100 the right
 * (bottom) edge, 50 centres it. `zoom` (1–MAX_ZOOM) enlarges the image
 * around that same point. Because the meaning is the CSS one, the same
 * framing works in any frame shape (a square card, a 16:9 banner, a phone
 * and a desktop crop of the same banner) and never leaves an empty area:
 * frames of a different shape keep the chosen point as close as they can.
 *
 * The cropper preview, the saved display (framingStyle), and derived images
 * drawn on a canvas (visibleRect) all use the functions below, so what
 * people see while cropping is what is shown after saving.
 */
export type Framing = { x: number; y: number; zoom: number };

export const MAX_ZOOM = 4;
export const CENTRED: Framing = { x: 50, y: 50, zoom: 1 };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Clamps and rounds a framing; anything unusable becomes centred. */
export function cleanFraming(f: Partial<Framing> | null | undefined): Framing {
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    x: round(clamp(num(f?.x, 50), 0, 100), 1),
    y: round(clamp(num(f?.y, 50), 0, 100), 1),
    zoom: round(clamp(num(f?.zoom, 1), 1, MAX_ZOOM), 3),
  };
}

export const isCentred = (f: Framing) => f.x === 50 && f.y === 50 && f.zoom === 1;

/** Reads a framing from a form field or stored JSON; null when absent or malformed. */
export function parseFraming(value: unknown): Framing | null {
  let v = value;
  if (typeof v === "string") {
    if (!v.trim()) return null;
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== "number" || typeof o.y !== "number") return null;
  return cleanFraming({ x: o.x, y: o.y, zoom: typeof o.zoom === "number" ? o.zoom : 1 });
}

/**
 * The part of the image a frame shows, as fractions of the image (0–1).
 * `imageAspect` and `frameAspect` are width / height.
 */
export function visibleRect(imageAspect: number, frameAspect: number, f: Framing): { x: number; y: number; w: number; h: number } {
  const z = clamp(f.zoom, 1, MAX_ZOOM);
  // At zoom 1 the image covers the frame: one side fits exactly.
  const w = (frameAspect < imageAspect ? frameAspect / imageAspect : 1) / z;
  const h = (frameAspect < imageAspect ? 1 : imageAspect / frameAspect) / z;
  return { x: (clamp(f.x, 0, 100) / 100) * (1 - w), y: (clamp(f.y, 0, 100) / 100) * (1 - h), w, h };
}

/**
 * Moves the image by a distance measured in frame widths/heights (a drag of
 * the whole frame width is 1). Positive moves the picture right/down.
 */
export function panFraming(f: Framing, dx: number, dy: number, imageAspect: number, frameAspect: number): Framing {
  const r = visibleRect(imageAspect, frameAspect, f);
  const nx = 1 - r.w > 1e-6 ? ((r.x - dx * r.w) / (1 - r.w)) * 100 : f.x;
  const ny = 1 - r.h > 1e-6 ? ((r.y - dy * r.h) / (1 - r.h)) * 100 : f.y;
  return cleanFraming({ x: nx, y: ny, zoom: f.zoom });
}

/**
 * Changes the zoom while keeping the point under `anchor` (a position in the
 * frame, 0–1 each way; the centre by default) where it is, as far as the
 * image edges allow.
 */
export function zoomFraming(f: Framing, zoom: number, imageAspect: number, frameAspect: number, anchor = { x: 0.5, y: 0.5 }): Framing {
  const before = visibleRect(imageAspect, frameAspect, f);
  const z = clamp(zoom, 1, MAX_ZOOM);
  const point = { x: before.x + anchor.x * before.w, y: before.y + anchor.y * before.h };
  const after = visibleRect(imageAspect, frameAspect, { ...f, zoom: z });
  const left = point.x - anchor.x * after.w;
  const top = point.y - anchor.y * after.h;
  return cleanFraming({
    x: 1 - after.w > 1e-6 ? (left / (1 - after.w)) * 100 : f.x,
    y: 1 - after.h > 1e-6 ? (top / (1 - after.h)) * 100 : f.y,
    zoom: z,
  });
}

/**
 * Style for an `<img>` filling an `overflow: hidden` frame. Matches
 * visibleRect for every frame shape: object-position places the image and
 * the zoom scales it around that same point.
 */
export function framingStyle(f: Framing | null | undefined): CSSProperties {
  const c = cleanFraming(f);
  const at = `${c.x}% ${c.y}%`;
  return { objectFit: "cover", objectPosition: at, ...(c.zoom > 1 ? { transform: `scale(${c.zoom})`, transformOrigin: at } : {}) };
}

/** A short description of a framing for screen readers. */
export function describeFraming(f: Framing): string {
  const side = (v: number, low: string, high: string) => (Math.abs(v - 50) < 0.5 ? "centred" : v < 50 ? `${Math.round(50 - v) * 2}% toward the ${low}` : `${Math.round(v - 50) * 2}% toward the ${high}`);
  return `Zoom ${Math.round(f.zoom * 100)}%, horizontally ${side(f.x, "left", "right")}, vertically ${side(f.y, "top", "bottom")}`;
}
