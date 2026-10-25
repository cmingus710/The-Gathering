import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateImageFile } from "@/lib/uploads";

/**
 * Prayer Library collection covers live in the private prayer-library
 * bucket under collections/<collection id>/. Storage RLS
 * (public.prayer_library_can_read_cover) lets an approved adult member read
 * one only while it belongs to a collection they can see, so signed URLs are
 * created with the viewer's own client. Same processing as campaign images:
 * real type checked, re-encoded to WebP at most 1200×800, all metadata (EXIF,
 * GPS) removed.
 */
export const COLLECTION_COVER_BUCKET = "prayer-library";
export const COLLECTION_COVER_MAX_BYTES = 8 * 1024 * 1024;
const URL_TTL_SECONDS = 300;

export type ProcessedCover = { ok: true; bytes: Buffer; path: string } | { ok: false; message: string };

export async function processCollectionCover(file: File, collectionId: string): Promise<ProcessedCover> {
  const check = await validateImageFile(file, { maxBytes: COLLECTION_COVER_MAX_BYTES, minSize: 240, maxSize: 8000, label: "image" });
  if (!check.ok) return check;
  try {
    const bytes = await sharp(check.bytes, { limitInputPixels: 8000 * 8000, failOn: "error" })
      .rotate()
      .resize(1200, 800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (bytes.byteLength > 2 * 1024 * 1024) return { ok: false, message: "That image is too detailed to store. Try a smaller or simpler one." };
    return { ok: true, bytes, path: `collections/${collectionId}/${randomBytes(12).toString("base64url")}.webp` };
  } catch {
    return { ok: false, message: "We couldn't read that image. Try a different file." };
  }
}

/** Signed URLs for the covers this viewer may read (others are simply left out). */
export async function signCollectionCovers(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await supabase.storage.from(COLLECTION_COVER_BUCKET).createSignedUrls(unique, URL_TTL_SECONDS);
  for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  return out;
}
