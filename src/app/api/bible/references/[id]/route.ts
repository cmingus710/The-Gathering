import { z } from "zod";
import { signBiblePath } from "@/lib/bible/storage";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * Restricted preview of a reference PDF: source managers only (checked by
 * bible_admin_reference and again by Storage RLS when signing), then a
 * 5-minute signed link opened in the browser's own PDF viewer. Not public;
 * the signed link is never logged.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/bible/references/[id]">) {
  const { id } = await ctx.params;
  const notFound = new Response("Not found", { status: 404, headers: NO_STORE });
  if (!z.uuid().safeParse(id).success) return notFound;
  const supabase = await createClient();
  if (!supabase) return notFound;
  const { data, error } = await supabase.rpc("bible_admin_reference", { p_id: id });
  const f = data as { path: string; status: string } | null;
  if (error || !f || f.status !== "ready") return notFound;
  const url = await signBiblePath(supabase, f.path);
  return url ? new Response(null, { status: 303, headers: { ...NO_STORE, Location: url } }) : notFound;
}
