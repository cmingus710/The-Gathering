import { type Framing, visibleRect } from "./framing";

/**
 * Browser-side image helpers for the cropper. Nothing here uploads
 * anything; the server still validates, re-orients, re-encodes, and removes
 * metadata from whatever it receives.
 */

/**
 * Largest side kept in memory while editing. 4096 × 4096 is the biggest
 * canvas iPhone Safari allows, and is plenty for any frame in the app.
 */
const WORKING_MAX_SIDE = 4096;

export type EditableImage = {
  /** Object URL of the chosen file, for previews (revoke with release()). */
  url: string;
  /** Upright size (orientation applied), in pixels. */
  width: number;
  height: number;
  /** A drawable copy at most WORKING_MAX_SIDE on its longer side. */
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  release: () => void;
};

export class ImageDecodeError extends Error {}

/** True for HEIC/HEIF by type or name (iPhone photos); only some browsers can show them. */
export const isHeic = (file: File) => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/**
 * Decodes a chosen photo for editing. Orientation from the camera (EXIF) is
 * applied by the browser, so rotated phone photos come out upright. Very
 * large photos are scaled down once, so a 48-megapixel photo doesn't hold
 * hundreds of megabytes while someone drags it around.
 * Throws ImageDecodeError when this browser can't read the file (for
 * example HEIC outside Safari); callers fall back to uploading it as is.
 */
export async function loadEditableImage(file: File): Promise<EditableImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageDecodeError("This browser can't show that image.");
  }
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) {
    URL.revokeObjectURL(url);
    throw new ImageDecodeError("This browser can't show that image.");
  }
  let source: CanvasImageSource = img;
  let sourceWidth = width;
  let sourceHeight = height;
  const scale = Math.min(1, WORKING_MAX_SIDE / Math.max(width, height));
  if (scale < 1 && typeof createImageBitmap === "function") {
    try {
      sourceWidth = Math.max(1, Math.round(width * scale));
      sourceHeight = Math.max(1, Math.round(height * scale));
      source = await createImageBitmap(img, { resizeWidth: sourceWidth, resizeHeight: sourceHeight, resizeQuality: "high" });
    } catch {
      source = img;
      sourceWidth = width;
      sourceHeight = height;
    }
  }
  return {
    url,
    width,
    height,
    source,
    sourceWidth,
    sourceHeight,
    release: () => {
      URL.revokeObjectURL(url);
      if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
    },
  };
}

/**
 * Draws the framed part of an image into a new file, at most `maxSide`
 * pixels on its longer side (never enlarged). `aspect` null keeps the whole
 * image. The result carries no camera or location metadata.
 */
export async function renderFramed(
  image: Pick<EditableImage, "source" | "sourceWidth" | "sourceHeight">,
  opts: { aspect: number | null; framing: Framing; maxSide: number; type: "image/jpeg" | "image/png"; name: string; quality?: number },
): Promise<File> {
  const { source, sourceWidth: sw, sourceHeight: sh } = image;
  const rect = opts.aspect ? visibleRect(sw / sh, opts.aspect, opts.framing) : { x: 0, y: 0, w: 1, h: 1 };
  const cropW = rect.w * sw;
  const cropH = rect.h * sh;
  const scale = Math.min(1, opts.maxSide / Math.max(cropW, cropH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropW * scale));
  canvas.height = Math.max(1, Math.round(cropH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageDecodeError("This browser couldn't prepare the photo.");
  if (opts.type === "image/jpeg") {
    // JPEG has no transparency: put see-through areas on white, not black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, rect.x * sw, rect.y * sh, cropW, cropH, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, opts.type, opts.quality ?? 0.9));
  // Free the canvas memory at once (Safari keeps it otherwise).
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new ImageDecodeError("This browser couldn't prepare the photo.");
  return new File([blob], opts.name, { type: opts.type, lastModified: Date.now() });
}

/** File name for a derived copy: "IMG_1234.HEIC" → "IMG_1234-cropped.jpg". */
export function derivedName(name: string, type: "image/jpeg" | "image/png"): string {
  const base = name.replace(/\.[^.]+$/, "").slice(0, 120) || "photo";
  return `${base}-cropped.${type === "image/png" ? "png" : "jpg"}`;
}
