import { z } from "zod";
import { json } from "@/lib/journal/route";
import { readSave, saveResult, workbookCaller, workbookDbError } from "@/lib/media/workbook-route";

export const dynamic = "force-dynamic";

/** Autosave of the member's private notes for a lesson (owner only; see media_workbook_note_save). */
export async function PUT(request: Request, ctx: RouteContext<"/api/workbook/[item]/note">) {
  const { item } = await ctx.params;
  if (!z.uuid().safeParse(item).success) return json(404, { error: "This lesson wasn't found." });
  const caller = await workbookCaller();
  if (caller instanceof Response) return caller;
  const body = await readSave(request);
  if (body instanceof Response) return body;
  const { data, error } = await caller.supabase.rpc("media_workbook_note_save", {
    p_item: item,
    p_text: body.body,
    p_base_version: body.base_version,
    p_force: body.force ?? false,
  });
  if (error) return workbookDbError(error);
  return saveResult(data);
}
