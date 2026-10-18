import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imageDimensions, sniffImage, validateImageFile } from "./uploads";

const root = path.resolve(import.meta.dirname, "../..");
const file = (rel: string, type = "image/png") => {
  const buf = readFileSync(path.join(root, rel));
  return new File([buf], path.basename(rel), { type });
};

describe("image upload validation", () => {
  it("accepts the approved PNG and WebP assets and reads their size", async () => {
    const png = await validateImageFile(file("public/brand/gathering-icon.png"), { maxBytes: 2e6, label: "icon" });
    expect(png).toMatchObject({ ok: true, kind: "png", width: 444, height: 512 });
    const webp = await validateImageFile(file("public/brand/the-gathering-logo.webp", "image/webp"), { maxBytes: 2e6, label: "logo" });
    expect(webp).toMatchObject({ ok: true, kind: "webp", width: 1200, height: 1116 });
  });

  it("rejects SVG and spoofed files regardless of declared type", async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], "logo.png", { type: "image/png" });
    expect(await validateImageFile(svg, { maxBytes: 2e6, label: "logo" })).toMatchObject({ ok: false });
    const html = new File(["<html>"], "x.jpg", { type: "image/jpeg" });
    expect(sniffImage(new Uint8Array(await html.arrayBuffer()))).toBeNull();
  });

  it("enforces size and dimension limits", async () => {
    const icon = file("public/brand/gathering-icon.png");
    expect(await validateImageFile(icon, { maxBytes: 100, label: "icon" })).toMatchObject({ ok: false });
    expect(await validateImageFile(icon, { maxBytes: 2e6, minSize: 600, label: "icon" })).toMatchObject({ ok: false });
    expect(await validateImageFile(new File([], "e.png"), { maxBytes: 2e6, label: "icon" })).toMatchObject({ ok: false });
  });

  it("reads JPEG dimensions", () => {
    // Minimal JPEG header: SOI, APP0 (len 16), SOF0 with 20×10.
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x0a, 0x00, 0x14, 0x03, 0, 0, 0, 0,
    ]);
    expect(sniffImage(bytes)).toBe("jpeg");
    expect(imageDimensions(bytes, "jpeg")).toEqual({ width: 20, height: 10 });
  });
});
