import { ftypBrand } from "@/lib/media/files";

/**
 * Photo and video attachments on discussions and replies (Phase 13).
 * Pure helpers shared by the composer (checks before uploading) and the
 * server (checks after uploading). The database enforces the same limits
 * (community.attachment_limits in 20261031000200_community_attachments.sql).
 */
export const ATTACHMENT_LIMITS = {
  perPost: 6,
  videosPerPost: 2,
  imageMb: 20,
  videoMb: 50,
  altMax: 300,
} as const;

/** File input accept list: photos (HEIC included) and MP4 video. */
export const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4";

export const VIDEO_FORMAT_MESSAGE =
  "This video format can't be played on every device; export as MP4 (H.264) and try again. On iPhone, choose Settings → Camera → Formats → Most Compatible, or share the video as MP4.";

export type AttachmentKind = "image" | "video";
export type AttachmentVariant = "thumb" | "display" | "video";

const IMAGE_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };
const IMAGE_MIME = new Set(Object.values(IMAGE_EXT));

/**
 * What a chosen file is, from its name and the browser's type (bytes are
 * checked again on the server). HEIC photos are accepted and converted.
 */
export function classifyAttachment(name: string, type: string, size: number):
  | { ok: true; kind: AttachmentKind; mime: string }
  | { ok: false; message: string } {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const t = (type || "").toLowerCase();
  let kind: AttachmentKind | null = null;
  let mime = "";
  if (IMAGE_MIME.has(t) || (!t.startsWith("video/") && IMAGE_EXT[ext])) {
    kind = "image";
    mime = IMAGE_MIME.has(t) ? t : IMAGE_EXT[ext];
  } else if (t === "video/mp4" || (ext === "mp4" && (!t || t === "application/octet-stream" || t.startsWith("video/")))) {
    kind = "video";
    mime = "video/mp4";
  } else if (t.startsWith("video/") || ["mov", "m4v", "hevc", "webm", "avi", "mkv", "3gp"].includes(ext)) {
    return { ok: false, message: VIDEO_FORMAT_MESSAGE };
  } else {
    return { ok: false, message: "Choose a JPEG, PNG, WebP, or iPhone (HEIC) photo, or an MP4 video." };
  }
  const maxMb = kind === "image" ? ATTACHMENT_LIMITS.imageMb : ATTACHMENT_LIMITS.videoMb;
  if (!size || size <= 0) return { ok: false, message: "That file is empty." };
  if (size > maxMb * 1024 * 1024) return { ok: false, message: `${kind === "image" ? "Photos" : "Videos"} must be ${maxMb} MB or smaller.` };
  return { ok: true, kind, mime };
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Sample entry types of every `stsd` (sample description) box found in a window of an MP4. */
export function sampleEntryTypes(window: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 4; i + 20 <= window.length; i++) {
    // "stsd" followed by version/flags (4), entry count (4), entry size (4), entry type (4).
    if (window[i] === 0x73 && window[i + 1] === 0x74 && window[i + 2] === 0x73 && window[i + 3] === 0x64) {
      const type = ascii(window, i + 16);
      if (/^[\x20-\x7e]{4}$/.test(type)) out.push(type);
    }
  }
  return out;
}

const H264 = new Set(["avc1", "avc3"]);
const HEVC = new Set(["hvc1", "hev1", "dvh1", "dvhe"]);
const OTHER_VIDEO = new Set(["av01", "vp08", "vp09", "mp4v", "s263", "jpeg", "mjp2", "apcn", "apch", "apcs", "apco", "ap4h"]);

/**
 * Checks an uploaded MP4's container and video codec from its first and
 * last bytes (the codec is described in the `moov` box, at either end).
 * Only H.264 plays on every phone and browser: QuickTime (.mov), HEVC
 * ("High Efficiency" on iPhone), AV1, and VP9 are refused with advice.
 */
export function checkForumVideo(head: Uint8Array, tail?: Uint8Array): { ok: true } | { ok: false; message: string } {
  const brand = ftypBrand(head);
  if (!brand) return { ok: false, message: "That file isn't an MP4 video." };
  if (brand.major === "qt  ") return { ok: false, message: VIDEO_FORMAT_MESSAGE };
  if (["heic", "heix", "mif1", "msf1", "avif"].includes(brand.major)) return { ok: false, message: "That's a photo, not a video." };
  const types = [...sampleEntryTypes(head), ...(tail ? sampleEntryTypes(tail) : [])];
  if (types.some((t) => HEVC.has(t) || OTHER_VIDEO.has(t))) return { ok: false, message: VIDEO_FORMAT_MESSAGE };
  if (types.some((t) => H264.has(t))) return { ok: true };
  return { ok: false, message: `We couldn't confirm this video is H.264. ${VIDEO_FORMAT_MESSAGE}` };
}

/** Where a member's browser loads an attachment (access is rechecked on every request). */
export function attachmentUrl(id: string, variant: AttachmentVariant): string {
  return `/api/community/attachments/${id}?variant=${variant}`;
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
