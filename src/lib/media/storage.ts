import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Storage helpers for the media buckets, always acting as the signed-in
 * person (or a visitor), so Storage RLS (public.media_can_read_object /
 * _write_object / _delete_object) decides every request.
 *
 * Signed URL lifetimes (also documented in docs/media-guide.md):
 *   images and documents   5 minutes (pages sign them when rendered)
 *   audio and video        30 minutes, re-requested through
 *                          /api/media/<asset>/play, which rechecks access
 * A link already handed out keeps working until it expires; deleting the
 * object stops it at once. Signed URLs are never logged.
 */
export const MEDIA_BUCKET = "media";
export const UPLOAD_BUCKET = "media-uploads";
export const IMAGE_URL_TTL = 300;
export const PLAYBACK_URL_TTL = 1800;

export type Bucket = typeof MEDIA_BUCKET | typeof UPLOAD_BUCKET;

export async function signPaths(supabase: SupabaseClient, paths: Array<string | null | undefined>, bucket: Bucket = MEDIA_BUCKET, ttl = IMAGE_URL_TTL) {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, ttl);
  for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  return out;
}

export async function signPath(supabase: SupabaseClient, path: string, bucket: Bucket = MEDIA_BUCKET, ttl = IMAGE_URL_TTL, download?: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl, download ? { download } : undefined);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

/**
 * A one-time token for the browser to upload to exactly this path (valid for
 * 2 hours). Creating it requires insert permission for the caller under
 * Storage RLS, so only registered paths can be signed.
 */
export async function createUploadToken(supabase: SupabaseClient, bucket: Bucket, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.token) return null;
  return { token: data.token, signedUrl: data.signedUrl };
}

export async function removePaths(supabase: SupabaseClient, bucket: Bucket, paths: string[]): Promise<boolean> {
  const list = paths.filter(Boolean);
  if (!list.length) return true;
  const { error } = await supabase.storage.from(bucket).remove(list);
  return !error;
}

export async function uploadBytes(supabase: SupabaseClient, bucket: Bucket, path: string, bytes: Buffer, contentType: string) {
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
  return !error;
}

/** Downloads a whole object (images for processing), refusing anything over maxBytes. */
export async function downloadObject(supabase: SupabaseClient, bucket: Bucket, path: string, maxBytes: number): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  if (data.size > maxBytes) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Reads only part of a stored object (the start, or the end with a negative
 * start) through a short-lived signed URL, so large media can be checked
 * without downloading it.
 */
export async function readRange(supabase: SupabaseClient, bucket: Bucket, path: string, range: { start: number; length: number } | { suffix: number }) {
  const url = await signPath(supabase, path, bucket, 60);
  if (!url) return null;
  const header = "suffix" in range ? `bytes=-${range.suffix}` : `bytes=${range.start}-${range.start + range.length - 1}`;
  try {
    const res = await fetch(url, { headers: { range: header }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok && res.status !== 206) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const limit = "suffix" in range ? range.suffix : range.length;
    // A server that ignores Range sends everything: keep only what was asked.
    return buf.length > limit ? ("suffix" in range ? buf.subarray(buf.length - limit) : buf.subarray(0, limit)) : buf;
  } catch {
    return null;
  }
}
