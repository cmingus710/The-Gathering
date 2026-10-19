import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { newPhotoPath, PHOTO_OUTPUT_SIZE, processProfilePhoto } from "./photos";

/** A synthetic test image (solid colour) with EXIF metadata attached. */
async function syntheticJpeg(width: number, height: number) {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .jpeg()
    .withExif({ IFD0: { Artist: "Synthetic Test", ImageDescription: "example metadata" } })
    .toBuffer();
  return new File([new Uint8Array(buf)], "synthetic.jpg", { type: "image/jpeg" });
}

describe("profile photo processing", () => {
  it("re-encodes to a square WebP and strips metadata", async () => {
    const result = await processProfilePhoto(await syntheticJpeg(900, 600));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.bytes).metadata();
    expect(meta).toMatchObject({ format: "webp", width: PHOTO_OUTPUT_SIZE, height: PHOTO_OUTPUT_SIZE });
    expect(meta.exif).toBeUndefined();
    expect(result.bytes.toString("latin1")).not.toContain("Synthetic Test");
  });

  it("rejects tiny images, non-images, and spoofed types", async () => {
    expect(await processProfilePhoto(await syntheticJpeg(64, 64))).toMatchObject({ ok: false });
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "x.png", { type: "image/png" });
    expect(await processProfilePhoto(svg)).toMatchObject({ ok: false });
    expect(await processProfilePhoto(new File([], "empty.jpg", { type: "image/jpeg" }))).toMatchObject({ ok: false });
  });

  it("rejects a corrupt image body with a valid signature", async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x02, 0x00, 0x03, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await processProfilePhoto(new File([fake], "x.jpg", { type: "image/jpeg" }))).toMatchObject({ ok: false });
  });

  it("names objects inside the member's own folder with an unguessable id", () => {
    const id = "5b1f8f3e-2c4e-4d0a-9a51-3f5f1c2b7a10";
    const a = newPhotoPath(id);
    expect(a).toMatch(new RegExp(`^${id}/[A-Za-z0-9_-]{16}\\.webp$`));
    expect(newPhotoPath(id)).not.toBe(a);
  });
});
