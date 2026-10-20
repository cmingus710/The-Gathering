import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./format";
import { clientKey, getAnonClient } from "./server";

/** Responses about restricted media are never cached or referred onward. */
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export const notFound = () => new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });
export const tooMany = () => new Response("Too many requests", { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": "60" } });

export function redirectTo(url: string) {
  return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, Location: url } });
}

/** The caller's own client (member session, or visitor rights when signed out). */
export async function callerClient(): Promise<{ supabase: SupabaseClient; signedIn: boolean } | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  return { supabase, signedIn: Boolean(data?.claims?.sub) };
}

/** Best-effort limit for signed-out callers (keyed hash of the address). */
export async function allowPublic(request: Request, action: string, max: number, windowSeconds: number): Promise<boolean> {
  const key = clientKey(request, action);
  const anon = getAnonClient();
  if (!key || !anon) return true;
  const { data, error } = await anon.rpc("media_public_hit", { p_key_hash: key, p_action: action, p_max: max, p_window_seconds: windowSeconds });
  return error ? true : data !== false;
}

export const validId = isUuid;
