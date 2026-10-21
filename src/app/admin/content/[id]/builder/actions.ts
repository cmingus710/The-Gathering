"use server";

import { revalidatePath } from "next/cache";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { ANSWERABLE, checkScriptureRef, isBlockKind, type AdminBlock, type BlockKind } from "@/lib/media/workbook";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Lesson builder actions (content.edit; changing a scheduled or published
 * lesson needs content.publish, which the database checks). Each save names
 * the block revision it was edited from, so a teacher never overwrites
 * someone else's newer edit without seeing it.
 */
export type BlockInput = {
  id: string | null;
  client_key: string | null;
  kind: BlockKind;
  heading: string;
  body: string;
  prompt: string;
  scripture_ref: string;
  asset_id: string;
  caption: string;
  alt_text: string;
  teacher_only: boolean;
  teacher_note: string;
};

export type BlockResult =
  | { ok: true; status: "saved" | "removed"; block: AdminBlock }
  | { ok: true; status: "conflict"; current: AdminBlock }
  | { ok: false; error: string };

const UNAVAILABLE = "The content service is unavailable. Nothing was saved.";

async function client() {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content");
  return createClient();
}

function asResult(data: unknown, error: { code?: string; message?: string } | null): BlockResult {
  if (error) return { ok: false, error: dbErrorMessage(error) };
  const r = data as { status: "saved" | "removed" | "conflict"; block?: AdminBlock; current?: AdminBlock };
  if (r.status === "conflict") return { ok: true, status: "conflict", current: r.current! };
  return { ok: true, status: r.status, block: r.block! };
}

export async function saveBlockAction(itemId: string, input: BlockInput, baseRevision: number | null): Promise<BlockResult> {
  if (!isUuid(itemId) || (input.id !== null && !isUuid(input.id)) || (input.client_key !== null && !isUuid(input.client_key))) {
    return { ok: false, error: "That block couldn't be found." };
  }
  if (!isBlockKind(input.kind)) return { ok: false, error: "Choose what kind of block this is." };
  const heading = String(input.heading ?? "").trim();
  const body = String(input.body ?? "");
  const prompt = String(input.prompt ?? "").trim();
  const note = String(input.teacher_note ?? "");
  if (heading.length > 200) return { ok: false, error: "The heading can be at most 200 characters." };
  if (body.length > 20_000) return { ok: false, error: "The text can be at most 20,000 characters." };
  if (note.length > 10_000) return { ok: false, error: "The teacher note can be at most 10,000 characters." };
  if (ANSWERABLE.has(input.kind) && !prompt) return { ok: false, error: "Write the question members will answer." };
  if (prompt.length > 1000) return { ok: false, error: "A question can be at most 1,000 characters." };
  let ref = "";
  if (input.kind === "scripture") {
    const r = checkScriptureRef(String(input.scripture_ref ?? ""));
    if (!r.ok) return { ok: false, error: r.error };
    ref = r.ref;
  }
  if ((input.kind === "image" || input.kind === "media") && !isUuid(input.asset_id)) return { ok: false, error: "Choose a file from the media library." };
  const supabase = await client();
  if (!supabase) return { ok: false, error: UNAVAILABLE };
  const payload: Record<string, unknown> = {
    id: input.id,
    client_key: input.client_key,
    kind: input.kind,
    heading,
    body,
    prompt: ANSWERABLE.has(input.kind) ? prompt : null,
    scripture_ref: input.kind === "scripture" ? ref : null,
    asset_id: input.kind === "image" || input.kind === "media" ? input.asset_id : null,
    caption: input.kind === "image" || input.kind === "media" ? String(input.caption ?? "").trim().slice(0, 500) : null,
    alt_text: input.kind === "image" ? String(input.alt_text ?? "").trim().slice(0, 500) : null,
    teacher_only: !!input.teacher_only,
    teacher_note: note,
  };
  const { data, error } = await supabase.rpc("media_admin_lesson_block_save", { p_item: itemId, p_block: payload, p_base_revision: baseRevision });
  const result = asResult(data, error);
  if (result.ok && result.status === "saved") revalidatePath(`/lessons/${itemId}`);
  return result;
}

export async function removeBlockAction(itemId: string, blockId: string, baseRevision: number): Promise<BlockResult> {
  if (!isUuid(itemId) || !isUuid(blockId)) return { ok: false, error: "That block couldn't be found." };
  const supabase = await client();
  if (!supabase) return { ok: false, error: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_admin_lesson_block_remove", { p_item: itemId, p_block: blockId, p_base_revision: baseRevision });
  return asResult(data, error);
}

export async function restoreBlockAction(itemId: string, blockId: string): Promise<BlockResult> {
  if (!isUuid(itemId) || !isUuid(blockId)) return { ok: false, error: "That block couldn't be found." };
  const supabase = await client();
  if (!supabase) return { ok: false, error: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_admin_lesson_block_restore", { p_item: itemId, p_block: blockId });
  return asResult(data, error);
}

export async function reorderBlocksAction(itemId: string, ids: string[]): Promise<{ ok: boolean; conflict?: boolean; error?: string }> {
  if (!isUuid(itemId) || !Array.isArray(ids) || ids.length > 100 || !ids.every(isUuid)) return { ok: false, error: "That order couldn't be saved." };
  const supabase = await client();
  if (!supabase) return { ok: false, error: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_admin_lesson_blocks_reorder", { p_item: itemId, p_ids: ids });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  const status = (data as { status: string }).status;
  return status === "conflict" ? { ok: false, conflict: true } : { ok: true };
}
