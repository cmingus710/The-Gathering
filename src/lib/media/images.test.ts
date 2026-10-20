import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { GALLERY_VARIANTS, hasNoMetadata, processImage, reencodeWebp } from "./images";

/** A synthetic 300×200 JPEG, red on the left, with GPS and orientation 6 (rotate 90° clockwise). */
async function phoneJpeg(): Promise<Buffer> {
  const left = await sharp({ create: { width: 150, height: 200, channels: 3, background: "#ff0000" } }).png().toBuffer();
  return sharp({ create: { width: 300, height: 200, channels: 3, background: "#0000ff" } })
    .composite([{ input: left, left: 0, top: 0 }])
    .jpeg()
    .withExif({
      IFD0: { Make: "Synthetic", Model: "Test Camera" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 52/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "87/1 37/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("image processing", () => {
  it("applies orientation, strips GPS and other metadata, and makes display and thumbnail copies", async () => {
    const input = await phoneJpeg();
    const inMeta = await sharp(input).metadata();
    expect(inMeta.exif).toBeDefined();
    expect(inMeta.orientation).toBe(6);
    const r = await processImage(input, GALLERY_VARIANTS);
    if (!r.ok) throw new Error(r.message);
    // Rotated 90°: portrait now.
    expect([r.width, r.height]).toEqual([200, 300]);
    for (const out of Object.values(r.outputs)) {
      expect(await hasNoMetadata(out.bytes)).toBe(true);
      const m = await sharp(out.bytes).metadata();
      expect(m.format).toBe("webp");
      expect(m.width).toBeLessThan(m.height!);
    }
    // Red was on the left; after a clockwise turn it's at the top.
    const { data } = await sharp(r.outputs.display.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200);
    expect(data[2]).toBeLessThan(60);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("decodes iPhone-style HEVC HEIC through libheif", async () => {
    const heic = readFileSync(path.resolve(__dirname, "../../../tests/fixtures/media/synthetic.heic"));
    const r = await processImage(heic, GALLERY_VARIANTS);
    if (!r.ok) throw new Error(r.message);
    // The fixture is stored 320×200 with orientation 6, which libheif applies:
    // portrait, with the blue corner block moved from top-left to top-right.
    expect([r.width, r.height]).toEqual([200, 320]);
    expect(await hasNoMetadata(r.outputs.thumb.bytes)).toBe(true);
    const { data, info } = await sharp(r.outputs.display.bytes).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
    expect(px(info.width - 5, 5)[2]).toBeGreaterThan(150); // blue
    expect(px(5, 5)[0]).toBeGreaterThan(150); // orange
  });

  it("refuses non-images and oversized dimensions with clear messages, and accepts small stills", async () => {
    expect(await processImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), GALLERY_VARIANTS)).toMatchObject({ ok: false });
    const huge = await sharp({ create: { width: 12_500, height: 10, channels: 3, background: "#fff" } }).png().toBuffer();
    expect(await processImage(huge, GALLERY_VARIANTS)).toMatchObject({ ok: false, message: expect.stringMatching(/too large/) });
    const still = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#fff" } }).webp().toBuffer();
    expect((await processImage(still, GALLERY_VARIANTS)).ok).toBe(true);
  });

  it("re-encodes only real WebP review copies on approval", async () => {
    const webp = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#123456" } })
      .webp()
      .withExif({ IFD0: { Make: "x" } })
      .toBuffer();
    const out = await reencodeWebp(webp, 2048, 80);
    expect(out).not.toBeNull();
    expect(await hasNoMetadata(out!)).toBe(true);
    expect(await reencodeWebp(Buffer.from("not an image"), 2048, 80)).toBeNull();
    expect(await reencodeWebp(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer(), 2048, 80)).toBeNull();
  });
});
