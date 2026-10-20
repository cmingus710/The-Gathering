/**
 * Checks what an uploaded file really is from its leading (and, for
 * PowerPoint, trailing) bytes, independent of its name or the browser's
 * MIME type. Pure functions: callers read the bytes from storage.
 */
export type AssetKind = "audio" | "video" | "image" | "document" | "captions";

export type Sniffed =
  | { ok: true; mime: string; note?: string }
  | { ok: false; message: string };

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

/** ISO base media (MP4/M4A/HEIF): the brand after "ftyp". */
export function ftypBrand(b: Uint8Array): { major: string; compatible: string[] } | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  const size = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  const end = Math.min(b.length, size > 0 ? size : 32);
  const compatible: string[] = [];
  for (let i = 16; i + 4 <= end; i += 4) compatible.push(ascii(b, i, 4));
  return { major: ascii(b, 8, 4), compatible };
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif"]);
const AUDIO_BRANDS = new Set(["M4A ", "M4B ", "M4P "]);
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash", "MSNV", "f4v "]);

export function sniffImageKind(b: Uint8Array): "jpeg" | "png" | "webp" | "heif" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  const brand = ftypBrand(b);
  if (brand && (HEIF_BRANDS.has(brand.major) || brand.compatible.some((c) => HEIF_BRANDS.has(c)))) return "heif";
  return null;
}

function isMp3(b: Uint8Array): boolean {
  if (b.length >= 3 && ascii(b, 0, 3) === "ID3") return true;
  // MPEG audio frame sync: 11 set bits, layer III/II/I (not "reserved").
  return b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0 && (b[1] & 0x18) !== 0x08;
}

function isAdts(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0;
}

/**
 * head: the first bytes of the file (at least 64 KB when available).
 * tail: the last bytes (needed only for PowerPoint, to find its parts).
 */
export function sniffAsset(kind: AssetKind, head: Uint8Array, tail?: Uint8Array): Sniffed {
  switch (kind) {
    case "audio": {
      if (isMp3(head)) return { ok: true, mime: "audio/mpeg" };
      const brand = ftypBrand(head);
      if (brand && (AUDIO_BRANDS.has(brand.major) || MP4_BRANDS.has(brand.major))) return { ok: true, mime: "audio/mp4" };
      if (isAdts(head)) return { ok: true, mime: "audio/aac" };
      return { ok: false, message: "That file isn't MP3, M4A, or AAC audio." };
    }
    case "video": {
      const brand = ftypBrand(head);
      if (!brand) return { ok: false, message: "That file isn't an MP4 video." };
      if (brand.major === "qt  ") return { ok: false, message: "QuickTime (.mov) files don't play in every browser. Export as MP4 (H.264 video, AAC audio)." };
      if (HEIF_BRANDS.has(brand.major)) return { ok: false, message: "That's an image, not a video." };
      if (!MP4_BRANDS.has(brand.major) && !brand.compatible.some((c) => MP4_BRANDS.has(c))) {
        return { ok: false, message: "That video format isn't supported. Export as MP4 (H.264 video, AAC audio)." };
      }
      return { ok: true, mime: "video/mp4" };
    }
    case "image": {
      const k = sniffImageKind(head);
      if (!k) return { ok: false, message: "That file isn't a JPEG, PNG, WebP, or HEIC image." };
      return { ok: true, mime: k === "heif" ? "image/heic" : `image/${k}` };
    }
    case "document": {
      if (head.length >= 5 && ascii(head, 0, 5) === "%PDF-") return { ok: true, mime: "application/pdf" };
      if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
        // A .pptx is a ZIP whose central directory (at the end) lists ppt/ parts.
        const directory = tail ? Buffer.from(tail).toString("latin1") : "";
        const headNames = Buffer.from(head).toString("latin1");
        if ((directory + headNames).includes("ppt/presentation.xml") && (directory + headNames).includes("[Content_Types].xml")) {
          if (/vbaProject\.bin/.test(directory)) return { ok: false, message: "Presentations with macros aren't accepted. Save as a .pptx without macros." };
          return { ok: true, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
        }
        return { ok: false, message: "That ZIP file isn't a PowerPoint presentation (.pptx)." };
      }
      return { ok: false, message: "Documents must be PDF or PowerPoint (.pptx)." };
    }
    case "captions": {
      let text = Buffer.from(head).toString("utf8");
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      if (!/^WEBVTT(?:[ \t][^\r\n]*)?(?:\r?\n|$)/.test(text)) return { ok: false, message: "Captions must be a WebVTT file starting with “WEBVTT”." };
      if (/\u0000/.test(text)) return { ok: false, message: "That captions file isn't plain text." };
      return { ok: true, mime: "text/vtt" };
    }
  }
}

/** Removes markup a caption file could carry beyond WebVTT's own cue tags. */
export function sanitizeVtt(input: string): string {
  return input
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/<(?!\/?(?:b|i|u|c|v|lang|ruby|rt)(?:[.\s][^>]*)?>|\d{1,2}:\d{2})[^>]*>/gi, "")
    .slice(0, 2_000_000);
}

/** Plain transcript text from a WebVTT file (cue text only, de-duplicated). */
export function vttToTranscript(vtt: string): string {
  const out: string[] = [];
  for (const block of sanitizeVtt(vtt).split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const t = lines
      .slice(at + 1)
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .trim();
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out.join("\n");
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Accept attribute for file inputs, per kind. */
export const ACCEPT: Record<AssetKind, string> = {
  audio: "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a,.aac",
  video: "video/mp4,.mp4",
  image: "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif",
  document: "application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.pptx",
  captions: "text/vtt,.vtt",
};

/** The browser's MIME type is often empty or vague; fall back to the extension. */
export function declaredMime(kind: AssetKind, name: string, type: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = {
    mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", mp4: "video/mp4",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
    pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", vtt: "text/vtt",
  };
  const t = type.toLowerCase();
  if (kind === "audio" && t === "audio/x-m4a") return "audio/mp4";
  if (t && t !== "application/octet-stream" && !(kind === "audio" && t === "video/mp4")) return t;
  return byExt[ext] ?? t;
}
