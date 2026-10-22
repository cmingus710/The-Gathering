import { z } from "zod";
import { dbError, json, readJson, signedInClient } from "@/lib/journal/route";

export const dynamic = "force-dynamic";

const Body = z.object({
  client_key: z.uuid(),
  title: z.string().max(200),
  body: z.string().max(100_000),
  link: z
    .object({ kind: z.enum(["none", "passage", "assignment", "devotional", "lesson", "book", "book_assignment"]) })
    .catchall(z.union([z.string().max(500), z.number(), z.null()]))
    .nullable()
    .optional(),
});

/** Creates an entry (idempotent per client key; a retried first save never makes two). */
export async function POST(request: Request) {
  const caller = await signedInClient();
  if (caller instanceof Response) return caller;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json(400, { error: "This entry is too long to save, or the request wasn't valid." });
  const { data, error } = await caller.supabase.rpc("journal_entry_create", {
    p_client_key: parsed.data.client_key,
    p_title: parsed.data.title,
    p_body: parsed.data.body,
    p_link: parsed.data.link ?? null,
  });
  if (error) return dbError(error);
  const e = data as { id: string; version: number; updated_at: string };
  return json(200, { id: e.id, version: e.version, updated_at: e.updated_at });
}
