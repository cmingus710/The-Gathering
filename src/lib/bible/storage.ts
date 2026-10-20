import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The private `bible` bucket (plan covers, staged text imports, reference
 * PDFs), always used with the signed-in person's session so Storage RLS
 * (public.bible_can_read_object / _write_object / _delete_object) decides.
 * Covers use 5-minute signed URLs; reference PDFs are signed for 5 minutes
 * for source managers only. Signed URLs are never logged.
 */
export const BIBLE_BUCKET = "bible";
export const URL_TTL = 300;

export async function signBiblePaths(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await supabase.storage.from(BIBLE_BUCKET).createSignedUrls(unique, URL_TTL);
  for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  return out;
}

export async function signBiblePath(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BIBLE_BUCKET).createSignedUrl(path, URL_TTL);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

export async function bibleUploadToken(supabase: SupabaseClient, path: string) {
  const { data, error } = await supabase.storage.from(BIBLE_BUCKET).createSignedUploadUrl(path);
  return error || !data?.token ? null : data.token;
}

/** Downloads an object, refusing anything larger than maxBytes. */
export async function downloadBibleObject(supabase: SupabaseClient, path: string, maxBytes: number): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(BIBLE_BUCKET).download(path);
  if (error || !data || data.size > maxBytes) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadBibleObject(supabase: SupabaseClient, path: string, bytes: Buffer, contentType: string): Promise<boolean> {
  const { error } = await supabase.storage.from(BIBLE_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
  return !error;
}

export async function removeBibleObjects(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<boolean> {
  const list = paths.filter((p): p is string => !!p);
  if (!list.length) return true;
  const { error } = await supabase.storage.from(BIBLE_BUCKET).remove(list);
  return !error;
}
