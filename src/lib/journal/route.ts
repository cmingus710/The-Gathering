import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared pieces of the journal API routes. Responses are private and never
 * cached; request and response bodies are never logged (errors are mapped
 * to fixed, generic messages).
 */
export const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
export const MAX_BODY_CHARS = 450_000;

export function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function signedInClient(): Promise<{ supabase: SupabaseClient } | Response> {
  const supabase = await createClient();
  if (!supabase) return json(503, { error: "Journals are unavailable right now." });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json(401, { error: "Your session has ended. Sign in again to save." });
  return { supabase };
}

/** Maps a database error to a status and a member-safe message. */
export function dbError(error: { code?: string; message?: string }): Response {
  if (error.code === "42501") return json(403, { error: "Your account can't use the journal right now." });
  if (error.code === "P0002") return json(404, { error: "This entry wasn't found. It may have been deleted." });
  if (error.code === "22023") {
    const tooOften = /too often/i.test(error.message ?? "");
    return json(tooOften ? 429 : 400, { error: error.message ?? "That couldn't be saved." });
  }
  return json(503, { error: "That couldn't be saved right now." });
}

/** Reads a JSON body with a size cap (before parsing). */
export async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_CHARS * 4) return json(413, { error: "This entry is too long to save." });
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json(413, { error: "This entry is too long to save." });
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : json(400, { error: "Invalid request." });
  } catch {
    return json(400, { error: "Invalid request." });
  }
}
