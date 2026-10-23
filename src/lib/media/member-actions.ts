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
  // The Church reading page and every book's reading page (counts and schedule).
  if (!error) revalidatePath("/reading", "layout");
  return { ok: !error };
}

const MUTABLE = ["devotional", "lesson", "episode", "assignment", "playlist", "video", "gallery"];

/** Which new-content notices the member wants (all on unless muted). */
export async function saveTeachingPrefsAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) return;
  const muted = MUTABLE.filter((k) => formData.get(`notify_${k}`) !== "on");
  const { error } = await supabase.rpc("media_prefs_save", { p_muted: muted });
  // Before 20261109000200 the database doesn't know "video" yet: save the rest.
  if (error && muted.includes("video")) await supabase.rpc("media_prefs_save", { p_muted: muted.filter((k) => k !== "video") });
  revalidatePath("/notifications/settings");
}

export async function clearListeningHistoryAction(): Promise<void> {
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.rpc("media_progress_clear");
  revalidatePath("/saved");
}

/** Phase 13: a member's own place in a church book (private; nothing syncs from Kindle or Audible). */
export async function saveBookProgressAction(id: string, status: string, position: string): Promise<{ ok: boolean; message: string }> {
  if (!isUuid(id) || !["want", "reading", "finished"].includes(status)) return { ok: false, message: "Choose where you are with this book." };
  if (position.length > 80) return { ok: false, message: "Keep your place note to 80 characters." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "Reading progress is unavailable right now. Nothing was saved." };
  const { error } = await supabase.rpc("media_book_progress_save", { p_item: id, p_status: status, p_position: position.trim() || null });
  if (error) return { ok: false, message: error.code === "P0001" || error.code === "22023" ? error.message : "Couldn't save your progress. Try again." };
  revalidatePath(`/reading/books/${id}`);
  revalidatePath("/reading");
  return { ok: true, message: "Saved. Only you can see this." };
}

export async function clearBookProgressAction(id: string): Promise<{ ok: boolean }> {
  if (!isUuid(id)) return { ok: false };
  const supabase = await createClient();
  if (!supabase) return { ok: false };
  const { error } = await supabase.rpc("media_book_progress_clear", { p_item: id });
  if (!error) revalidatePath(`/reading/books/${id}`);
  return { ok: !error };
}
