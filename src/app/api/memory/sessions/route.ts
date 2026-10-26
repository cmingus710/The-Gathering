import { z } from "zod";
import { fetchMemoryText, sourceVerses } from "@/lib/memory/provider";
import { dbError, json, readJson, signedInClient } from "@/lib/memory/route";
import type { Card } from "@/lib/memory/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  card_id: z.uuid(),
  activity: z.enum(["read_repeat", "flashcards", "missing_words", "word_order", "type_verse", "self_check"]),
  difficulty: z.enum(["guided", "growing", "challenge"]),
  segment: z.number().int().min(0).max(200),
  options: z
    .object({
      direction: z.enum(["ref_to_text", "text_to_ref"]).optional(),
      ignore_case: z.boolean().optional(),
      ignore_punctuation: z.boolean().optional(),
      short: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Starts a practice activity. The server chooses what is hidden or shuffled.
 * A licensed version's verse is fetched here first (the existing API.Bible
 * integration and its cache) and passed to the database for this call only,
 * which checks it against the wording the member added and builds the
 * activity in memory; only positions are stored. The response carries the
 * text to the member's browser with the provider's copyright notice and the
 * FUMS token to report when it's shown. Nothing here is logged.
 */
export async function POST(request: Request) {
  const caller = await signedInClient();
  if (caller instanceof Response) return caller;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json(400, { error: "Choose a verse, an activity, and a difficulty." });
  const options: Record<string, unknown> = { ...(parsed.data.options ?? {}) };
  const card = await caller.supabase.rpc("memory_card", { p_id: parsed.data.card_id });
  if (card.error) return dbError(card.error);
  const c = card.data as Card;
  let licensed: { copyright: string | null; fums_id: string | null } | null = null;
  if (c.provider) {
    const p = c.passage;
    const text = await fetchMemoryText(caller.supabase, p.translation.id, { book: p.book, sc: p.start_chapter, sv: p.start_verse, ec: p.end_chapter, ev: p.end_verse });
    if (text.status !== "ok") return json(503, { error: text.status === "stored" ? "This verse couldn't be prepared." : text.message });
    options.fingerprint = text.payload.fingerprint;
    options.source = sourceVerses(text.verses);
    licensed = { copyright: text.copyright, fums_id: text.fumsId };
  }
  const { data, error } = await caller.supabase.rpc("memory_session_start", {
    p_card: parsed.data.card_id,
    p_activity: parsed.data.activity,
    p_difficulty: parsed.data.difficulty,
    p_segment: parsed.data.segment,
    p_options: options,
  });
  if (error) return dbError(error);
  return json(200, licensed ? { ...(data as object), licensed } : data);
}
