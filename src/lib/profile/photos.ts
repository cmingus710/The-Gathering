import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { validateImageFile } from "@/lib/uploads";

export const PHOTO_BUCKET = "profile-photos";
/** Signed photo URLs live this long. Hiding or removing a photo stops new URLs at once; issued ones lapse within this window. */
export const PHOTO_URL_TTL_SECONDS = 300;
export const PHOTO_OUTPUT_SIZE = 512;
export const PHOTO_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const PHOTO_MIN_SIDE = 128;
export const PHOTO_MAX_SIDE = 8000;

export type ProcessedPhoto = { ok: true; bytes: Buffer } | { ok: false; message: string };

/**
 * Validates an uploaded image by its real signature, size, and dimensions,
 * then re-encodes it on the server: orientation applied, centre-cropped to a
 * square, resized, and saved as WebP with all metadata (EXIF, GPS) removed.
 * Only this processed copy is stored; the original is never kept.
 */
export async function processProfilePhoto(file: File): Promise<ProcessedPhoto> {
  const check = await validateImageFile(file, {
    maxBytes: PHOTO_MAX_UPLOAD_BYTES,
    minSize: PHOTO_MIN_SIDE,
    maxSize: PHOTO_MAX_SIDE,
    label: "photo",
  });
  if (!check.ok) return check;
  try {
    const bytes = await sharp(check.bytes, { limitInputPixels: PHOTO_MAX_SIDE * PHOTO_MAX_SIDE, failOn: "error" })
      .rotate()
      .resize(PHOTO_OUTPUT_SIZE, PHOTO_OUTPUT_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
    return { ok: true, bytes };
  } catch {
    return { ok: false, message: "We couldn't read that photo. Try a different image." };
  }
}

/** A fresh, unguessable object name in the member's own folder. */
export function newPhotoPath(userId: string): string {
  return `${userId}/${randomBytes(12).toString("base64url")}.webp`;
}

/**
 * Short-lived signed URLs for the given photo paths. Storage RLS decides
 * again here: a path the caller may not see (hidden, replaced, not shared)
 * simply gets no URL and the page falls back to initials.
 */
export async function signPhotoUrls(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(unique, PHOTO_URL_TTL_SECONDS);
  if (error || !data) return out;
  for (const item of data) {
    if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  }
  return out;
}

/** Removes every object in the member's folder except the one to keep. */
export async function removeOldPhotos(supabase: SupabaseClient, userId: string, keep: string | null): Promise<void> {
  const { data } = await supabase.storage.from(PHOTO_BUCKET).list(userId, { limit: 100 });
  const stale = (data ?? []).map((o) => `${userId}/${o.name}`).filter((p) => p !== keep);
  if (stale.length) await supabase.storage.from(PHOTO_BUCKET).remove(stale);
}
