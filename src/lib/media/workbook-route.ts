import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { json, readJson } from "@/lib/journal/route";
import { createClient } from "@/lib/supabase/server";

/**
 * Autosave endpoints for lesson answers and notes (My Journal entries since
 * 20261122000100). Same contract as the
 * journal's: 200 when stored, 409 with the current saved text when another
 * tab or device saved newer text, 401 when the session ended. Responses are
 * private and never cached; request and response bodies are never logged.
 */
export const SaveBody = z.object({
  body: z.string().max(10_000),
  base_version: z.number().int().min(0),
  force: z.boolean().optional(),
});

export async function workbookCaller(): Promise<{ supabase: SupabaseClient } | Response> {
  const supabase = await createClient();
  if (!supabase) return json(503, { error: "Lesson answers are unavailable right now." });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json(401, { error: "Your session has ended. Sign in again to save." });
  return { supabase };
}

export function workbookDbError(error: { code?: string; message?: string }): Response {
  if (error.code === "42501") return json(403, { error: "Your account can't save lesson answers right now." });
  if (error.code === "P0002") return json(404, { error: error.message && error.message !== "Not found." ? error.message : "This lesson isn't available any more." });
  if (error.code === "22023") {
    const tooOften = /too often/i.test(error.message ?? "");
    return json(tooOften ? 429 : 400, { error: error.message ?? "That couldn't be saved." });
  }
  return json(503, { error: "That couldn't be saved right now." });
}

export async function readSave(request: Request): Promise<z.infer<typeof SaveBody> | Response> {
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = SaveBody.safeParse(raw);
  if (!parsed.success) return json(400, { error: "This is too long to save (10,000 characters at most), or the request wasn't valid." });
  return parsed.data;
}

export function saveResult(data: unknown): Response {
  const r = data as { status: "saved" | "conflict" };
  return r.status === "conflict" ? json(409, r) : json(200, r);
}
