/**
 * Geometry for coloring pictures: reads SVG path data and basic shapes,
 * applies transforms, and writes normalized path data that uses only
 * absolute M, L, C, and Z commands with plain numbers. Anything that doesn't
 * parse is refused (null), never guessed at. Pure functions, no DOM.
 */
export type Matrix = [number, number, number, number, number, number];
export type Seg = { c: "M"; x: number; y: number } | { c: "L"; x: number; y: number } | { c: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { c: "Z" };

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 × m2 (apply m2 first, then m1). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a, b, c, d, e, f] = m1;
  const [A, B, C, D, E, F] = m2;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** How much a transform scales lengths (for stroke widths). */
export const matrixScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

const NUM = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const MAX_ABS = 1e6;

function numbers(s: string): number[] | null {
  const out: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "," || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    NUM.lastIndex = i;
    const m = NUM.exec(s);
    if (!m) return null;
    const v = Number(m[0]);
    if (!Number.isFinite(v) || Math.abs(v) > MAX_ABS) return null;
    out.push(v);
    i = NUM.lastIndex;
  }
  return out;
}

/** An SVG transform list (matrix, translate, scale, rotate, skewX, skewY), or null if it can't be read. */
export function parseTransform(value: string | undefined | null): Matrix | null {
  if (!value || !value.trim()) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /\s*([a-zA-Z]+)\s*\(([^)]*)\)\s*,?/y;
  let i = 0;
  const s = value.trim();
  while (i < s.length) {
    re.lastIndex = i;
    const part = re.exec(s);
    if (!part) return null;
    i = re.lastIndex;
    const args = numbers(part[2]);
    if (!args) return null;
    let t: Matrix;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    switch (part[1]) {
      case "matrix":
        if (args.length !== 6) return null;
        t = args as Matrix;
        break;
      case "translate":
        if (args.length < 1 || args.length > 2) return null;
        t = [1, 0, 0, 1, args[0], args[1] ?? 0];
        break;
      case "scale":
        if (args.length < 1 || args.length > 2) return null;
        t = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
        break;
      case "rotate": {
        if (args.length !== 1 && args.length !== 3) return null;
        const a = rad(args[0]);
        const r: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        t = args.length === 3 ? multiply(multiply([1, 0, 0, 1, args[1], args[2]], r), [1, 0, 0, 1, -args[1], -args[2]]) : r;
        break;
      }
      case "skewX":
        if (args.length !== 1) return null;
        t = [1, 0, Math.tan(rad(args[0])), 1, 0, 0];
        break;
      case "skewY":
        if (args.length !== 1) return null;
        t = [1, Math.tan(rad(args[0])), 0, 1, 0, 0];
        break;
      default:
        return null;
    }
    m = multiply(m, t);
  }
  return m.every(Number.isFinite) ? m : null;
}

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Tokens of path data: commands and numbers (arc flags may be written without separators). */
function tokens(d: string): Array<string | number> | null {
  const out: Array<string | number> = [];
  let i = 0;
  let cmd = "";
  let argIndex = 0;
  while (i < d.length) {
    const ch = d[i];
    if (" ,\t\n\r\f".includes(ch)) {
      i++;
      continue;
    }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      out.push(ch);
      cmd = ch.toUpperCase();
      argIndex = 0;
      i++;
      continue;
    }
    if (!cmd) return null;
    // The two arc flags are single 0/1 characters.
    const n = ARGS[cmd] || 1;
    const pos = argIndex % n;
    if (cmd === "A" && (pos === 3 || pos === 4)) {
      if (ch !== "0" && ch !== "1") return null;
      out.push(ch === "1" ? 1 : 0);
      i++;
      argIndex++;
      continue;
    }
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) return null;
    const v = Number(m[0]);
    if (!Number.isFinite(v) || Math.abs(v) > MAX_ABS) return null;
    out.push(v);
    i = NUM.lastIndex;
    argIndex++;
  }
  return out;
}

/** Path data as absolute M/L/C/Z segments, or null if it isn't valid path data. */
export function parsePathData(d: string, maxSegments = 20_000): Seg[] | null {
  const tk = tokens(d);
  if (!tk || !tk.length || typeof tk[0] !== "string" || (tk[0] !== "M" && tk[0] !== "m")) return null;
  const segs: Seg[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  // Last control point (for S and T) and the command it came from.
  let cx = 0;
  let cy = 0;
  let prev = "";
  let i = 0;
  while (i < tk.length) {
    const raw = tk[i];
    if (typeof raw !== "string") return null;
    i++;
    const rel = raw === raw.toLowerCase();
    let cmd = raw.toUpperCase();
    if (cmd === "Z") {
      segs.push({ c: "Z" });
      x = sx;
      y = sy;
      prev = "Z";
      continue;
    }
    const n = ARGS[cmd];
    let first = true;
    do {
      const args: number[] = [];
      for (let k = 0; k < n; k++) {
        const v = tk[i + k];
        if (typeof v !== "number") return null;
        args.push(v);
      }
      i += n;
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      switch (cmd) {
        case "M":
          x = args[0] + ox;
          y = args[1] + oy;
          segs.push({ c: first ? "M" : "L", x, y });
          if (first) {
            sx = x;
            sy = y;
          }
          break;
        case "L":
          x = args[0] + ox;
          y = args[1] + oy;
          segs.push({ c: "L", x, y });
          break;
        case "H":
          x = args[0] + ox;
          segs.push({ c: "L", x, y });
          break;
        case "V":
          y = args[0] + (rel ? y : 0);
          segs.push({ c: "L", x, y });
          break;
        case "C": {
          const s: Seg = { c: "C", x1: args[0] + ox, y1: args[1] + oy, x2: args[2] + ox, y2: args[3] + oy, x: args[4] + ox, y: args[5] + oy };
          segs.push(s);
          cx = s.x2;
          cy = s.y2;
          x = s.x;
          y = s.y;
          break;
        }
        case "S": {
          const rx = prev === "C" || prev === "S" ? 2 * x - cx : x;
          const ry = prev === "C" || prev === "S" ? 2 * y - cy : y;
          const s: Seg = { c: "C", x1: rx, y1: ry, x2: args[0] + ox, y2: args[1] + oy, x: args[2] + ox, y: args[3] + oy };
          segs.push(s);
          cx = s.x2;
          cy = s.y2;
          x = s.x;
          y = s.y;
          break;
        }
        case "Q":
        case "T": {
          let qx: number;
          let qy: number;
          let ex: number;
          let ey: number;
          if (cmd === "Q") {
            qx = args[0] + ox;
            qy = args[1] + oy;
            ex = args[2] + ox;
            ey = args[3] + oy;
          } else {
            qx = prev === "Q" || prev === "T" ? 2 * x - cx : x;
            qy = prev === "Q" || prev === "T" ? 2 * y - cy : y;
            ex = args[0] + ox;
            ey = args[1] + oy;
          }
          segs.push({ c: "C", x1: x + (2 / 3) * (qx - x), y1: y + (2 / 3) * (qy - y), x2: ex + (2 / 3) * (qx - ex), y2: ey + (2 / 3) * (qy - ey), x: ex, y: ey });
          cx = qx;
          cy = qy;
          x = ex;
          y = ey;
          break;
        }
        case "A": {
          const ex = args[5] + ox;
          const ey = args[6] + oy;
          for (const s of arcToCubics(x, y, args[0], args[1], args[2], args[3] === 1, args[4] === 1, ex, ey)) segs.push(s);
          x = ex;
          y = ey;
          break;
        }
        default:
          return null;
      }
      prev = cmd === "M" ? "L" : cmd;
      if (cmd === "M") cmd = "L";
      first = false;
      if (segs.length > maxSegments) return null;
    } while (i < tk.length && typeof tk[i] === "number");
  }
  return segs;
}

/** An elliptical arc as cubic Béziers (SVG 1.1 appendix F.6). */
function arcToCubics(x1: number, y1: number, rxIn: number, ryIn: number, angle: number, large: boolean, sweep: boolean, x2: number, y2: number): Seg[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ c: "L", x: x2, y: y2 }];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Seg[] = [];
  let t = theta1;
  const pt = (a: number): [number, number] => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
  const dpt = (a: number): [number, number] => [-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos];
  for (let p = 0; p < parts; p++) {
    const t2 = t + step;
    const [px1, py1] = pt(t);
    const [dx1, dy1] = dpt(t);
    const [px2, py2] = p === parts - 1 ? [x2, y2] : pt(t2);
    const [dx2, dy2] = dpt(t2);
    out.push({ c: "C", x1: px1 + k * dx1, y1: py1 + k * dy1, x2: px2 - k * dx2, y2: py2 - k * dy2, x: px2, y: py2 });
    t = t2;
  }
  return out;
}

export function transformSegs(segs: Seg[], m: Matrix): Seg[] {
  return segs.map((s) => {
    if (s.c === "Z") return s;
    if (s.c === "C") {
      const [x1, y1] = applyMatrix(m, s.x1, s.y1);
      const [x2, y2] = applyMatrix(m, s.x2, s.y2);
      const [x, y] = applyMatrix(m, s.x, s.y);
      return { c: "C", x1, y1, x2, y2, x, y };
    }
    const [x, y] = applyMatrix(m, s.x, s.y);
    return { c: s.c, x, y };
  });
}

const fmt = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
};

/** Normalized path data: absolute M/L/C/Z, numbers to one decimal, spaces only. */
export function segsToD(segs: Seg[]): string {
  let out = "";
  for (const s of segs) {
    if (s.c === "Z") out += "Z";
    else if (s.c === "C") out += `C${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)}`;
    else out += `${s.c}${fmt(s.x)} ${fmt(s.y)}`;
  }
  return out;
}

export function segsBounds(segs: Seg[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const s of segs) {
    if (s.c === "Z") continue;
    if (s.c === "C") {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    }
    add(s.x, s.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

// ---------------------------------------------------------------------------
// Basic shapes as path data (null for invalid or zero-size shapes)
// ---------------------------------------------------------------------------
export function rectPath(x: number, y: number, w: number, h: number, rxIn = 0, ryIn = 0): string | null {
  if (!(w > 0 && h > 0)) return null;
  let rx = Math.max(0, rxIn || ryIn || 0);
  let ry = Math.max(0, ryIn || rxIn || 0);
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string | null {
  if (!(rx > 0 && ry > 0)) return null;
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

export function polyPath(points: string, close: boolean): string | null {
  const n = numbers(points);
  if (!n || n.length < 4 || n.length % 2) return null;
  let d = `M${n[0]} ${n[1]}`;
  for (let i = 2; i < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
  return close ? `${d}Z` : d;
}

export function linePath(x1: number, y1: number, x2: number, y2: number): string {
  return `M${x1} ${y1}L${x2} ${y2}`;
}

/** A plain number attribute (no units other than px), or null. */
export function lengthAttr(v: string | undefined, fallback: number | null = null): number | null {
  if (v === undefined) return fallback;
  if (v.length > 64) return null;
  const m = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(px)?\s*$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && Math.abs(n) <= MAX_ABS ? n : null;
}

export { numbers as parseNumberList };
