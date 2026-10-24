import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processImage } from "@/lib/media/images";

/**
 * Learn & Play artwork lives in the private `youth` bucket at
 * activities/<activity>/<asset>.webp. Every upload goes through the media
 * library's image pipeline (real format checked from the bytes, decompression
 * bombs refused, orientation applied, all metadata including GPS removed) and
 * is stored only as a re-encoded WebP: SVG, HTML, scripts, and animated
 * images never reach storage. Storage RLS (public.youth_can_read_object /
 * youth_can_write_object) decides every read and write, so signed URLs are
 * always created with the viewer's own client.
 */
export const YOUTH_BUCKET = "youth";
export const ART_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** The bucket's own limit (20261028000300). */
const STORED_MAX_BYTES = 1024 * 1024;
const URL_TTL_SECONDS = 300;

export type ProcessedArt = { ok: true; bytes: Buffer; width: number; height: number } | { ok: false; message: string };

export async function processActivityArt(file: File): Promise<ProcessedArt> {
  if (!file || file.size === 0) return { ok: false, message: "Choose an image to upload." };
  if (file.size > ART_MAX_UPLOAD_BYTES) return { ok: false, message: "The image must be 4 MB or smaller." };
  const input = Buffer.from(await file.arrayBuffer());
  // Try a large copy first; fall back to smaller ones if it doesn't fit the bucket.
  for (const v of [
    { name: "art", size: 1600, quality: 82 },
    { name: "art", size: 1280, quality: 74 },
    { name: "art", size: 960, quality: 68 },
  ]) {
    const done = await processImage(input, [v]);
    if (!done.ok) return done;
    const out = done.outputs.art;
    if (Math.min(done.width, done.height) < 200) return { ok: false, message: "The image must be at least 200 pixels on each side." };
    if (out.bytes.byteLength <= STORED_MAX_BYTES) return { ok: true, bytes: out.bytes, width: out.width, height: out.height };
  }
  return { ok: false, message: "That image is too detailed to store. Try a smaller or simpler one." };
}

export async function signActivityArt(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await supabase.storage.from(YOUTH_BUCKET).createSignedUrls(unique, URL_TTL_SECONDS);
  for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  return out;
}
