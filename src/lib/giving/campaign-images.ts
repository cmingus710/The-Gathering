import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateImageFile } from "@/lib/uploads";

/**
 * Campaign images live in the private campaign-images bucket. Storage RLS
 * (public.can_view_campaign_image) lets a caller read one only while it
 * belongs to a campaign they can see, so signed URLs are created with the
 * viewer's own client. Same processing as event covers: real type checked,
 * re-encoded to WebP at most 1600×1000, all metadata (EXIF, GPS) removed.
 */
export const CAMPAIGN_IMAGE_BUCKET = "campaign-images";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const URL_TTL_SECONDS = 300;

export type ProcessedCampaignImage = { ok: true; bytes: Buffer; path: string } | { ok: false; message: string };

export async function processCampaignImage(file: File): Promise<ProcessedCampaignImage> {
  const check = await validateImageFile(file, { maxBytes: MAX_UPLOAD_BYTES, minSize: 320, maxSize: 8000, label: "image" });
  if (!check.ok) return check;
  try {
    const bytes = await sharp(check.bytes, { limitInputPixels: 8000 * 8000, failOn: "error" })
      .rotate()
      .resize(1600, 1000, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (bytes.byteLength > 2 * 1024 * 1024) return { ok: false, message: "That image is too detailed to store. Try a smaller or simpler one." };
    return { ok: true, bytes, path: `campaigns/${randomBytes(12).toString("base64url")}.webp` };
  } catch {
    return { ok: false, message: "We couldn't read that image. Try a different file." };
  }
}

export async function signCampaignImages(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await supabase.storage.from(CAMPAIGN_IMAGE_BUCKET).createSignedUrls(unique, URL_TTL_SECONDS);
  for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  return out;
}
