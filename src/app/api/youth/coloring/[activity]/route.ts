import { z } from "zod";
import { NO_STORE, json } from "@/lib/journal/route";
import { createClient } from "@/lib/supabase/server";
import { LIMITS, checkDoc, serializeDoc } from "@/lib/youth/coloring";

export const dynamic = "force-dynamic";

const MAX_BYTES = LIMITS.docChars + 2000;

/** The body as text, or null once it passes `max` bytes (stops reading; never buffers more). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const Body = z.object({
  // The explicitly chosen child (guardians); null for a youth coloring as themselves.
  child: z.uuid().nullable(),
  version: z.uuid(),
  base_version: z.number().int().min(0).max(100_000_000),
  doc: z.unknown(),
});

/**
 * Autosave of one child's coloring on one activity version. The database
 * (youth_coloring_save) checks on every call that the signed-in person may
 * color for that child, that the activity is still open to them, that the
 * version is still the published one, and that the save is based on the
 * latest revision; otherwise nothing is written. Responses are private and
 * never cached; artwork is never logged.
 *   200 saved · 409 saved meanwhile elsewhere (with the saved picture)
 *   410 a new version was published · 401 signed out · 404 not open to them
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/youth/coloring/[activity]">) {
  const { activity } = await ctx.params;
  if (!z.uuid().safeParse(activity).success) return json(404, { error: "This picture isn't available." });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return json(413, { error: "This picture is too large to save." });

  // Who is asking, before reading the body.
  const supabase = await createClient();
  if (!supabase) return json(503, { error: "Saving is unavailable right now." });
  const { data: user, error: authError } = await supabase.auth.getUser();
  if (authError || !user.user) return json(401, { error: "Your session has ended. Sign in again to save." });

  const text = await readCapped(request, MAX_BYTES);
  if (text === null) return json(413, { error: "This picture is too large to save." });
  let parsed: z.infer<typeof Body>;
  try {
    const raw = Body.safeParse(JSON.parse(text));
    if (!raw.success) return json(400, { error: "Invalid request." });
    parsed = raw.data;
  } catch {
    return json(400, { error: "Invalid request." });
  }
  const doc = checkDoc(parsed.doc, null);
  if (!doc.ok) return json(400, { error: `That picture couldn't be saved: it ${doc.problem}.` });

  const { data, error } = await supabase.rpc("youth_coloring_save", {
    p_activity: activity,
    p_child: parsed.child,
    p_version: parsed.version,
    p_base_revision: parsed.base_version,
    p_doc: doc.value,
  });
  if (error) {
    if (error.code === "42501") return json(401, { error: "Your session has ended. Sign in again to save." });
    if (error.code === "P0002") return json(404, { error: "This picture isn't available to you any more." });
    if (error.code === "22023") return json(/too often/i.test(error.message ?? "") ? 429 : 400, { error: error.message ?? "That couldn't be saved." });
    return json(503, { error: "That couldn't be saved right now." });
  }
  const r = data as { status: "saved" | "conflict" | "version"; revision?: number; updated_at?: string; current?: { revision: number; doc: unknown; updated_at: string | null } };
  if (r.status === "version") {
    return json(410, { error: "This activity was just updated, so this picture can't be saved any more. Use Download to keep a copy of what's on screen, then reload to start the new version." });
  }
  if (r.status === "conflict") {
    const current = checkDoc(r.current?.doc ?? {}, null);
    return Response.json(
      { current: { body: serializeDoc(current.ok ? current.value : { fills: {}, strokes: [] }), version: r.current?.revision ?? 0, updated_at: r.current?.updated_at ?? null } },
      { status: 409, headers: NO_STORE },
    );
  }
  return json(200, { version: r.revision, updated_at: r.updated_at });
}
