import { z } from "zod";
import { fetchMemoryText, sourceVerses } from "@/lib/memory/provider";
import { dbError, json, readJson, signedInClient } from "@/lib/memory/route";

export const dynamic = "force-dynamic";

const Confidence = z.enum(["not_yet", "partly", "mostly", "fully"]);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("hint"),
    position: z.number().int().min(0).max(2000).optional(),
    blank: z.number().int().min(1).max(50).optional(),
    order: z.array(z.string().max(20)).max(60).optional(),
  }),
  z.object({ action: z.literal("reveal") }),
  z.object({
    action: z.literal("submit"),
    level: z.number().int().min(0).max(3).optional(),
    reveals: z.number().int().min(0).max(500).optional(),
    confidence: Confidence.optional(),
    answers: z.record(z.string().regex(/^\d{1,5}$/), z.string().max(100)).optional(),
    order: z.array(z.string().max(20)).max(60).optional(),
    text: z.string().max(20_000).optional(),
  }),
]);

/**
 * Hints, reveals, and submission for one practice activity.
 *   submit → 200 with the stored result (a retry returns the same result);
 *            410 when the activity expired, 409 when the verse was removed or
 *            replaced since it started, its published wording changed, or
 *            the activity is no longer permitted. Nothing is recorded then.
 * For a licensed version, hints and checks need the passage: it's fetched
 * here (the existing integration and its cache) and passed to the database
 * for that call only. Nothing here is logged.
 */
const NEEDS_TEXT = new Set(["missing_words", "word_order", "type_verse"]);
export async function POST(request: Request, ctx: RouteContext<"/api/memory/sessions/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return json(404, { error: "That practice activity wasn't found." });
  const caller = await signedInClient();
  if (caller instanceof Response) return caller;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json(400, { error: "That answer couldn't be read." });
  const { action, ...payload } = parsed.data;
  const fn = action === "hint" ? "memory_session_hint" : action === "reveal" ? "memory_session_reveal" : "memory_session_submit";
  const p: Record<string, unknown> = { ...payload };
  if (action !== "reveal") {
    const src = await caller.supabase.rpc("memory_session_source", { p_session: id });
    if (src.error) return dbError(src.error);
    const ref = src.data as { activity: string; translation_id: string; book: string; sc: number; sv: number; ec: number; ev: number } | null;
    if (ref && (action === "hint" || NEEDS_TEXT.has(ref.activity))) {
      const text = await fetchMemoryText(caller.supabase, ref.translation_id, { book: ref.book, sc: ref.sc, sv: ref.sv, ec: ref.ec, ev: ref.ev });
      if (text.status !== "ok") return json(503, { error: text.status === "stored" ? "That couldn't be checked right now." : `${text.message} Your answer is still on this page.` });
      p.source = sourceVerses(text.verses);
    }
  }
  const args = action === "reveal" ? { p_session: id } : { p_session: id, p };
  const { data, error } = await caller.supabase.rpc(fn, args);
  if (error) return dbError(error);
  const r = data as { status?: string; provider?: { translation_id: string; book: string; sc: number; sv: number; ec: number; ev: number; fingerprint: string } };
  if (r?.status === "expired") return json(410, { error: "This activity has expired. Start it again." });
  if (r?.status === "conflict") return json(409, { error: "This verse changed or was removed since you started, so nothing was recorded." });
  if (r?.status === "changed") return json(409, { error: "The published wording of this passage changed while you practiced, so nothing was recorded. Open the verse to start the new wording." });
  if (r?.status === "unavailable") return json(409, { error: "This activity isn't available for this version right now, so nothing was recorded. Your progress is kept." });
  if (action === "reveal" && r?.provider) {
    // A licensed version: fetched now (its cache only while unexpired), shown
    // unchanged, and only if it's still the wording this activity started on.
    const p = r.provider;
    const text = await fetchMemoryText(caller.supabase, p.translation_id, { book: p.book, sc: p.sc, sv: p.sv, ec: p.ec, ev: p.ev });
    if (text.status !== "ok") return json(503, { error: text.status === "stored" ? "The verse couldn't be shown." : text.message });
    if (text.payload.fingerprint !== p.fingerprint) {
      return json(409, { error: "The wording of this passage changed since you added it. Open the verse to start the new wording; nothing was recorded." });
    }
    const { provider: _drop, ...rest } = r;
    void _drop;
    return json(200, { ...rest, text: null, verses: text.verses, copyright: text.copyright, fums_id: text.fumsId });
  }
  return json(200, data);
}
