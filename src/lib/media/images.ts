import "server-only";
import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { sniffImageKind } from "./files";

/**
 * Image processing for the media library and photo galleries. Every served
 * copy is re-encoded here:
 *   - the real format is checked from the bytes (JPEG, PNG, WebP, HEIC/HEIF);
 *   - pixel counts are checked before full decoding (decompression bombs);
 *   - camera orientation is applied (EXIF for JPEG, HEIF rotation for HEIC),
 *     then colour is converted to sRGB using the embedded profile;
 *   - all metadata (EXIF, GPS, XMP, IPTC, ICC) is dropped from the output;
 *   - output is WebP at bounded sizes.
 * HEIC from iPhones uses HEVC compression, which sharp's bundled libvips
 * can't decode; libheif's WebAssembly build (heic-decode) does that step.
 */
export const MAX_PIXELS = 50_000_000; // ~8K × 6K
const MAX_SIDE = 12_000;

export type ImageError = { ok: false; message: string };
export type ProcessedImage = {
  ok: true;
  width: number;
  height: number;
  hash: string;
  outputs: Record<string, { bytes: Buffer; width: number; height: number }>;
};

export type Variant = { name: string; size: number; quality: number };

export const LIBRARY_VARIANTS: Variant[] = [
  { name: "main", size: 2000, quality: 82 },
  { name: "small", size: 640, quality: 78 },
];
export const GALLERY_VARIANTS: Variant[] = [
  { name: "display", size: 2048, quality: 82 },
  { name: "thumb", size: 480, quality: 74 },
];

async function decodeHeic(bytes: Buffer): Promise<{ data: Buffer; width: number; height: number } | ImageError> {
  let all: Awaited<ReturnType<(typeof import("heic-decode"))["default"]["all"]>>;
  try {
    const { default: heic } = await import("heic-decode");
    all = await heic.all({ buffer: bytes });
  } catch {
    return {
      ok: false,
      message:
        "This HEIC photo couldn't be read. On iPhone, choose Settings → Camera → Formats → Most Compatible, or share the photo as JPEG, then try again.",
    };
  }
  try {
    const first = all[0];
    if (!first || first.width * first.height > MAX_PIXELS || first.width > MAX_SIDE || first.height > MAX_SIDE) {
      return { ok: false, message: "That photo is too large to process. Choose one under 50 megapixels." };
    }
    const decoded = await first.decode();
    return { data: Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), width: decoded.width, height: decoded.height };
  } catch {
    return { ok: false, message: "This HEIC photo couldn't be read. Try sharing it as JPEG." };
  } finally {
    all.dispose();
  }
}

/** Decodes, checks, orients, converts, strips, and resizes into each variant. */
export async function processImage(bytes: Buffer, variants: Variant[]): Promise<ProcessedImage | ImageError> {
  const kind = sniffImageKind(bytes);
  if (!kind) return { ok: false, message: "That file isn't a JPEG, PNG, WebP, or HEIC image." };
  const hash = createHash("sha256").update(bytes).digest("hex");

  let base: Sharp;
  let width: number;
  let height: number;
  try {
    if (kind === "heif") {
      // AVIF-compressed HEIF decodes in sharp directly; HEVC (iPhone) needs libheif.
      const brand = String.fromCharCode(...bytes.subarray(8, 12));
      if (brand === "avif") {
        const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
        if (!meta.width || !meta.height) return { ok: false, message: "We couldn't read that photo." };
        base = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate();
        width = meta.autoOrient?.width ?? meta.width;
        height = meta.autoOrient?.height ?? meta.height;
      } else {
        const raw = await decodeHeic(bytes);
        if ("ok" in raw) return raw;
        base = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 }, limitInputPixels: MAX_PIXELS });
        width = raw.width;
        height = raw.height;
      }
    } else {
      const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
      if (!meta.width || !meta.height) return { ok: false, message: "We couldn't read that photo." };
      if (meta.width > MAX_SIDE || meta.height > MAX_SIDE || meta.width * meta.height > MAX_PIXELS) {
        return { ok: false, message: "That photo is too large to process. Choose one under 50 megapixels." };
      }
      if ((meta.pages ?? 1) > 1) return { ok: false, message: "Animated images aren't supported. Choose a still photo." };
      // rotate() with no angle applies the EXIF orientation, then the tag is dropped.
      base = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate();
      width = meta.autoOrient?.width ?? meta.width;
      height = meta.autoOrient?.height ?? meta.height;
    }
  } catch {
    return { ok: false, message: "We couldn't read that photo. Try a different file." };
  }
  if (width < 16 || height < 16) return { ok: false, message: "That image is too small." };

  const outputs: ProcessedImage["outputs"] = {};
  try {
    for (const v of variants) {
      // toColourspace converts using the embedded ICC profile; withMetadata is
      // never called, so EXIF/GPS/XMP/IPTC/ICC are not written.
      const { data, info } = await base
        .clone()
        .toColourspace("srgb")
        .resize(v.size, v.size, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: v.quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      outputs[v.name] = { bytes: data, width: info.width, height: info.height };
    }
  } catch {
    return { ok: false, message: "We couldn't process that photo. Try a different file." };
  }
  return { ok: true, width, height, hash, outputs };
}

/** Re-encodes an already processed WebP (gallery approval), verifying it. */
export async function reencodeWebp(bytes: Buffer, size: number, quality: number): Promise<Buffer | null> {
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
    if (meta.format !== "webp" || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096) return null;
    return await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .toColourspace("srgb")
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
  } catch {
    return null;
  }
}

/** True when an encoded image carries no EXIF, XMP, IPTC, or ICC metadata. */
export async function hasNoMetadata(bytes: Buffer): Promise<boolean> {
  const meta = await sharp(bytes).metadata();
  return !meta.exif && !meta.xmp && !meta.iptc && !meta.icc && !meta.orientation;
}
