import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { UnreadCounts } from "./types";

/**
 * Server-side reads for community pages. Every function here calls an
 * access-checked database function as the signed-in member; nothing reads
 * community tables directly.
 */
export class CommunityUnavailableError extends Error {
  constructor() {
    super("The community service is unavailable.");
    this.name = "CommunityUnavailableError";
  }
}

export async function communityRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await createClient();
  if (!supabase) throw new CommunityUnavailableError();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const err = new Error(error.message) as Error & { code?: string };
    err.code = error.code;
    throw err;
  }
  return data as T;
}

/** Like communityRpc, but returns null instead of throwing (for optional panels). */
export async function tryCommunityRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  try {
    return await communityRpc<T>(fn, args);
  } catch {
    return null;
  }
}

export async function getUnreadCounts(): Promise<UnreadCounts> {
  return (await tryCommunityRpc<UnreadCounts>("community_unread_counts")) ?? { notifications: 0, messages: 0 };
}

/** Short-lived signed URLs for group images; storage RLS decides who gets one. */
export async function signGroupImages(paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (!unique.length) return out;
  const supabase = await createClient();
  if (!supabase) return out;
  const { data } = await supabase.storage.from("group-images").createSignedUrls(unique, 300);
  for (const row of data ?? []) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  return out;
}
