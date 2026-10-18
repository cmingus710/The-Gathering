/**
 * Server-side image validation. Checks the real file signature, not just the
 * browser-supplied MIME type or extension. SVG is rejected (it can carry script).
 */
export type ImageKind = "png" | "jpeg" | "webp";

export const IMAGE_MIME: Record<ImageKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const LIMITS = {
  branding: 2 * 1024 * 1024,
  announcement: 4 * 1024 * 1024,
} as const;

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
}

/** Reads width/height from PNG, WebP, or JPEG headers without decoding. */
export function imageDimensions(bytes: Uint8Array, kind: ImageKind): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (kind === "png") return { width: view.getUint32(16), height: view.getUint32(20) };
    if (kind === "webp") {
      const chunk = String.fromCharCode(...bytes.slice(12, 16));
      if (chunk === "VP8X") {
        const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width: w, height: h };
      }
      if (chunk === "VP8L") {
        const b = view.getUint32(21, true);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      return null;
    }
    // JPEG: walk segments to the first SOFn marker.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}

export type ImageCheck =
  | { ok: true; kind: ImageKind; mime: string; width: number; height: number; bytes: Uint8Array }
  | { ok: false; message: string };

export async function validateImageFile(
  file: File,
  opts: { maxBytes: number; minSize?: number; maxSize?: number; label: string },
): Promise<ImageCheck> {
  if (file.size === 0) return { ok: false, message: `Choose a ${opts.label} file.` };
  if (file.size > opts.maxBytes) {
    return { ok: false, message: `The ${opts.label} must be ${Math.round(opts.maxBytes / 1024 / 1024)} MB or smaller.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, message: `The ${opts.label} must be a PNG, JPEG, or WebP image.` };
  const dims = imageDimensions(bytes, kind);
  if (!dims || dims.width < 1 || dims.height < 1) return { ok: false, message: `We couldn't read that ${opts.label}. Try exporting it again.` };
  if (opts.minSize && (dims.width < opts.minSize || dims.height < opts.minSize)) {
    return { ok: false, message: `The ${opts.label} must be at least ${opts.minSize}×${opts.minSize} pixels.` };
  }
  if (opts.maxSize && (dims.width > opts.maxSize || dims.height > opts.maxSize)) {
    return { ok: false, message: `The ${opts.label} must be at most ${opts.maxSize} pixels on each side.` };
  }
  return { ok: true, kind, mime: IMAGE_MIME[kind], ...dims, bytes };
}
