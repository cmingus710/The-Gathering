import { z } from "zod";
import { dbError, json, readJson, signedInClient } from "@/lib/memory/route";

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

/** Starts a practice activity. The server chooses what is hidden or shuffled. */
export async function POST(request: Request) {
  const caller = await signedInClient();
  if (caller instanceof Response) return caller;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json(400, { error: "Choose a verse, an activity, and a difficulty." });
  const { data, error } = await caller.supabase.rpc("memory_session_start", {
    p_card: parsed.data.card_id,
    p_activity: parsed.data.activity,
    p_difficulty: parsed.data.difficulty,
    p_segment: parsed.data.segment,
    p_options: parsed.data.options ?? {},
  });
  if (error) return dbError(error);
  return json(200, data);
}
