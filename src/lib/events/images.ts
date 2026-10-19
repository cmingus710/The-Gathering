import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateImageFile } from "@/lib/uploads";
import { MAX_COVER_BYTES } from "./limits";

export const EVENT_IMAGE_BUCKET = "event-images";
const MAX_UPLOAD_BYTES = MAX_COVER_BYTES;
const URL_TTL_SECONDS = 300;

export type ProcessedCover = { ok: true; bytes: Buffer; path: string } | { ok: false; message: string };

/**
 * Validates the real file type, size, and dimensions, then re-encodes to a
 * WebP of at most 1600×1000 with all metadata (EXIF, GPS) removed. Only the
 * re-encoded copy is stored, under an unguessable name.
 */
export async function processEventCover(file: File, folder: string): Promise<ProcessedCover> {
  const check = await validateImageFile(file, { maxBytes: MAX_UPLOAD_BYTES, minSize: 320, maxSize: 8000, label: "image" });
  if (!check.ok) return check;
  try {
    const bytes = await sharp(check.bytes, { limitInputPixels: 8000 * 8000, failOn: "error" })
      .rotate()
      .resize(1600, 1000, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { ok: true, bytes, path: `${folder}/${randomBytes(12).toString("base64url")}.webp` };
  } catch {
    return { ok: false, message: "We couldn't read that image. Try a different file." };
  }
}

/**
 * Short-lived signed URL for an event cover. Storage RLS decides: only
 * people who can see the event (or event managers) get a URL.
 */
export async function signCoverUrls(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await supabase.storage.from(EVENT_IMAGE_BUCKET).createSignedUrls(unique, URL_TTL_SECONDS);
  for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  return out;
}
