import { z } from "zod";
import { json } from "@/lib/journal/route";
import { readSave, saveResult, workbookCaller, workbookDbError } from "@/lib/media/workbook-route";

export const dynamic = "force-dynamic";

/** Autosave of one private workbook answer (owner only; see media_workbook_answer_save). */
export async function PUT(request: Request, ctx: RouteContext<"/api/workbook/[item]/answers/[block]">) {
  const { item, block } = await ctx.params;
  if (!z.uuid().safeParse(item).success || !z.uuid().safeParse(block).success) return json(404, { error: "This question wasn't found." });
  const caller = await workbookCaller();
  if (caller instanceof Response) return caller;
  const body = await readSave(request);
  if (body instanceof Response) return body;
  const { data, error } = await caller.supabase.rpc("media_workbook_answer_save", {
    p_item: item,
    p_block: block,
    p_text: body.body,
    p_base_version: body.base_version,
    p_force: body.force ?? false,
  });
  if (error) return workbookDbError(error);
  return saveResult(data);
}
