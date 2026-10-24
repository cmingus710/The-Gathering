"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./format";

/**
 * The member's own lesson answers and notes (My Journal entries). Every call
 * acts on the caller's rows only (the database functions use auth.uid());
 * nothing here can reach another member's answers.
 */

/** Keeps an answer for the reworded question (it then refers to the current wording). */
export async function acceptQuestionChangeAction(formData: FormData): Promise<void> {
  const item = formData.get("item");
  const block = formData.get("block");
  if (!isUuid(item) || !isUuid(block)) return;
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.rpc("media_workbook_answer_accept", { p_item: String(item), p_block: String(block) });
  revalidatePath(`/lessons/${item}/workbook`);
}

/** Deletes one of the member's answers (for example to a removed question). */
export async function deleteAnswerAction(formData: FormData): Promise<void> {
  const item = formData.get("item");
  const block = formData.get("block");
  if (!isUuid(item) || !isUuid(block)) return;
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.rpc("media_workbook_delete", { p_item: String(item), p_block: String(block) });
  revalidatePath(`/lessons/${item}/workbook`);
}

/** Deletes every answer and the note the member wrote for a lesson. */
export async function deleteWorkbookAction(formData: FormData): Promise<void> {
  const item = formData.get("item");
  if (!isUuid(item)) return;
  const supabase = await createClient();
  if (!supabase) return;
  const { error } = await supabase.rpc("media_workbook_delete", { p_item: String(item), p_block: null });
  revalidatePath("/journal");
  redirect(error ? `/lessons/${item}/workbook?error=delete` : "/journal?notice=lesson-deleted");
}
