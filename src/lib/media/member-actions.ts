"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./format";

/** Bookmarks are private to the member; the database checks they can see the item. */
export async function toggleBookmarkAction(type: "item" | "show", id: string, on: boolean): Promise<{ ok: boolean }> {
  if ((type !== "item" && type !== "show") || !isUuid(id)) return { ok: false };
  const supabase = await createClient();
  if (!supabase) return { ok: false };
  const { error } = await supabase.rpc("media_bookmark", { p_type: type, p_id: id, p_on: on });
  if (!error) revalidatePath("/saved");
  return { ok: !error };
}

/** A member marks a reading assignment done (their own record only; nothing syncs from Audible). */
export async function completeAssignmentAction(id: string, done: boolean): Promise<{ ok: boolean }> {
  if (!isUuid(id)) return { ok: false };
  const supabase = await createClient();
  if (!supabase) return { ok: false };
  const { error } = await supabase.rpc("media_assignment_complete", { p_item: id, p_done: done });
  if (!error) revalidatePath("/reading");
  return { ok: !error };
}

const MUTABLE = ["devotional", "lesson", "episode", "assignment", "playlist", "gallery"];

/** Which new-content notices the member wants (all on unless muted). */
export async function saveTeachingPrefsAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) return;
  const muted = MUTABLE.filter((k) => formData.get(`notify_${k}`) !== "on");
  await supabase.rpc("media_prefs_save", { p_muted: muted });
  revalidatePath("/notifications/settings");
}

export async function clearListeningHistoryAction(): Promise<void> {
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.rpc("media_progress_clear");
  revalidatePath("/saved");
}
