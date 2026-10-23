import { describe, expect, it } from "vitest";
import { CENTRED, cleanFraming, describeFraming, framingStyle, isCentred, panFraming, parseFraming, visibleRect, zoomFraming } from "./framing";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("visibleRect", () => {
  it("centres a covering image like object-position: 50% 50%", () => {
    // 2:1 landscape photo in a square frame: the middle half of its width.
    const r = visibleRect(2, 1, CENTRED);
    close(r.x, 0.25);
    close(r.y, 0);
    close(r.w, 0.5);
    close(r.h, 1);
  });

  it("follows object-position at the edges", () => {
    expect(visibleRect(2, 1, { x: 0, y: 50, zoom: 1 }).x).toBe(0);
    close(visibleRect(2, 1, { x: 100, y: 50, zoom: 1 }).x, 0.5);
    // Portrait photo in a 16:9 frame moves vertically.
    const top = visibleRect(3 / 4, 16 / 9, { x: 50, y: 0, zoom: 1 });
    close(top.w, 1);
    close(top.h, 3 / 4 / (16 / 9));
    expect(top.y).toBe(0);
  });

  it("never leaves the image (no empty areas), at any zoom or position", () => {
    for (const imageAspect of [0.5, 0.75, 1, 4 / 3, 16 / 9, 3])
      for (const frameAspect of [1, 16 / 9, 3, 4.5, 3 / 4])
        for (const zoom of [1, 1.7, 4])
          for (const x of [0, 33, 100])
            for (const y of [0, 66, 100]) {
              const r = visibleRect(imageAspect, frameAspect, { x, y, zoom });
              expect(r.x).toBeGreaterThanOrEqual(0);
              expect(r.y).toBeGreaterThanOrEqual(0);
              expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
              expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
              // The rectangle has the frame's shape.
              close((r.w * imageAspect) / r.h, frameAspect);
            }
  });

  it("zoom narrows the visible area around the position", () => {
    const r = visibleRect(1, 1, { x: 50, y: 50, zoom: 2 });
    close(r.w, 0.5);
    close(r.x, 0.25);
  });
});

describe("panFraming and zoomFraming", () => {
  it("dragging the photo right shows more of its left side", () => {
    const f = panFraming({ x: 50, y: 50, zoom: 1 }, 0.1, 0, 2, 1);
    expect(f.x).toBeLessThan(50);
    expect(f.y).toBe(50);
  });

  it("stops at the edges instead of revealing empty space", () => {
    expect(panFraming(CENTRED, 10, -10, 2, 1)).toMatchObject({ x: 0, y: 50 });
    expect(panFraming(CENTRED, -10, 0, 2, 1).x).toBe(100);
  });

  it("does nothing along a side that fits exactly", () => {
    // A 2:1 photo in a square frame fits its height: vertical drags change nothing.
    expect(panFraming(CENTRED, 0, 0.3, 2, 1).y).toBe(50);
  });

  it("keeps the anchored point in place while zooming", () => {
    const before = { x: 20, y: 80, zoom: 1.2 };
    const anchor = { x: 0.3, y: 0.6 };
    const a = visibleRect(1.5, 1, before);
    const after = zoomFraming(before, 2, 1.5, 1, anchor);
    const b = visibleRect(1.5, 1, after);
    expect(after.zoom).toBe(2);
    expect(b.x + anchor.x * b.w).toBeCloseTo(a.x + anchor.x * a.w, 2);
    expect(b.y + anchor.y * b.h).toBeCloseTo(a.y + anchor.y * a.h, 2);
  });

  it("clamps zoom to 1–4", () => {
    expect(zoomFraming(CENTRED, 0.2, 1, 1).zoom).toBe(1);
    expect(zoomFraming(CENTRED, 9, 1, 1).zoom).toBe(4);
  });
});

describe("framingStyle", () => {
  it("is plain object-cover when centred (the old look)", () => {
    expect(framingStyle(null)).toEqual({ objectFit: "cover", objectPosition: "50% 50%" });
  });

  it("zooms around the same point it positions at", () => {
    expect(framingStyle({ x: 20, y: 70, zoom: 1.5 })).toEqual({
      objectFit: "cover",
      objectPosition: "20% 70%",
      transform: "scale(1.5)",
      transformOrigin: "20% 70%",
    });
  });
});

describe("parseFraming and cleanFraming", () => {
  it("reads form values and stored JSON", () => {
    expect(parseFraming('{"x":12.345,"y":99,"zoom":2.5}')).toEqual({ x: 12.3, y: 99, zoom: 2.5 });
    expect(parseFraming({ x: 1, y: 2 })).toEqual({ x: 1, y: 2, zoom: 1 });
  });

  it("treats empty or malformed values as none", () => {
    for (const v of ["", "  ", "nope", "[]", "null", null, undefined, 3, { x: "1", y: 2 }, [1, 2]]) expect(parseFraming(v)).toBeNull();
  });

  it("clamps out-of-range values", () => {
    expect(cleanFraming({ x: -5, y: 140, zoom: 12 })).toEqual({ x: 0, y: 100, zoom: 4 });
    expect(cleanFraming({ x: Number.NaN, y: Infinity })).toEqual({ x: 50, y: 50, zoom: 1 });
  });

  it("knows centred and describes positions", () => {
    expect(isCentred(cleanFraming(null))).toBe(true);
    expect(describeFraming(CENTRED)).toBe("Zoom 100%, horizontally centred, vertically centred");
    expect(describeFraming({ x: 25, y: 100, zoom: 2 })).toBe("Zoom 200%, horizontally 50% toward the left, vertically 100% toward the bottom");
  });
});
