import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The private `memory` bucket (collection covers), always used with the
 * signed-in person's session so Storage RLS (public.memory_can_read_object
 * / _write_object) decides. Covers use 5-minute signed URLs.
 */
export const MEMORY_BUCKET = "memory";
const URL_TTL = 300;

export async function signMemoryPaths(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await supabase.storage.from(MEMORY_BUCKET).createSignedUrls(unique, URL_TTL);
  for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  return out;
}

export async function uploadMemoryObject(supabase: SupabaseClient, path: string, bytes: Buffer): Promise<boolean> {
  const { error } = await supabase.storage.from(MEMORY_BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: false, cacheControl: "3600" });
  return !error;
}

export async function removeMemoryObjects(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<boolean> {
  const list = paths.filter((p): p is string => !!p);
  if (!list.length) return true;
  const { error } = await supabase.storage.from(MEMORY_BUCKET).remove(list);
  return !error;
}
