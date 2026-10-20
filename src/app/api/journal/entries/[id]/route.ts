import { z } from "zod";
import { dbError, json, readJson, signedInClient } from "@/lib/journal/route";

export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().max(200),
  body: z.string().max(100_000),
  base_version: z.number().int().min(1),
  force: z.boolean().optional(),
});

/**
 * Autosave. 200 {status: "saved", version} when stored; 409 with the
 * current saved text when another tab or device saved a newer version
 * (nothing is overwritten unless the member chose "keep mine").
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/journal/entries/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return json(404, { error: "This entry wasn't found." });
  const caller = await signedInClient();
  if (caller instanceof Response) return caller;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json(400, { error: "This entry is too long to save, or the request wasn't valid." });
  const { data, error } = await caller.supabase.rpc("journal_entry_save", {
    p_id: id,
    p_title: parsed.data.title,
    p_body: parsed.data.body,
    p_base_version: parsed.data.base_version,
    p_force: parsed.data.force ?? false,
  });
  if (error) return dbError(error);
  const r = data as { status: "saved" | "conflict"; version?: number; updated_at?: string; current?: unknown };
  return r.status === "conflict" ? json(409, r) : json(200, r);
}
