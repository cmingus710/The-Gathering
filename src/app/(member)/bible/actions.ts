"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isValidTimeZone, isValidYmd } from "@/lib/bible/dates";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Bible reading is unavailable right now. Nothing was changed.";
const uuid = z.uuid();

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

function idFrom(formData: FormData, key = "id"): string | null {
  return uuid.safeParse(formData.get(key)).data ?? null;
}

export async function joinPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/bible");
  const plan = idFrom(formData, "plan_id");
  if (!plan) return errorState("That plan isn't available.");
  const start = String(formData.get("start_date") ?? "");
  const tz = String(formData.get("timezone") ?? "");
  if (start && !isValidYmd(start)) return errorState("Choose a start date.", { fieldErrors: { start_date: ["Choose a start date."] } });
  if (tz && !isValidTimeZone(tz)) return errorState("Choose a valid time zone.");
  const { error } = await rpc("bible_plan_join", {
    p_plan: plan,
    p_start_date: start || null,
    p_timezone: tz || null,
    p_from_start: formData.get("count_from") !== "today",
  });
  if (error) return errorState(dbErrorMessage(error, "You couldn't join this plan right now."));
  revalidatePath("/bible", "layout");
  revalidatePath("/home");
  return { status: "success", message: "You've joined the plan." };
}

export async function updateEnrollmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/bible");
  const id = idFrom(formData);
  if (!id) return errorState("That plan isn't available.");
  const payload: Record<string, unknown> = {};
  if (formData.has("reminders_form")) {
    payload.reminders = formData.get("reminders") === "on";
    payload.reminders_paused = formData.get("reminders_paused") === "on";
    const time = String(formData.get("reminder_time") ?? "");
    if (time && !/^\d{2}:\d{2}$/.test(time)) return errorState("Choose a reminder time.");
    if (time) payload.reminder_time = time;
    const tz = String(formData.get("timezone") ?? "");
    if (tz && !isValidTimeZone(tz)) return errorState("Choose a valid time zone.");
    if (tz) payload.timezone = tz;
  }
  if (formData.get("make_primary") === "1") payload.is_primary = true;
  if (formData.has("pause")) payload.reminders_paused = formData.get("pause") === "1";
  const start = String(formData.get("start_date") ?? "");
  if (start) {
    if (!isValidYmd(start)) return errorState("Choose a start date.");
    payload.start_date = start;
  }
  const countFrom = String(formData.get("count_from") ?? "");
  if (countFrom === "today" || countFrom === "start") payload.count_from = countFrom;
  const { error } = await rpc("bible_enrollment_update", { p_id: id, p: payload });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/bible", "layout");
  revalidatePath("/home");
  return { status: "success", message: "Saved." };
}

export async function leavePlanAction(formData: FormData) {
  await requireApprovedMember("/bible");
  const id = idFrom(formData);
  if (id) await rpc("bible_plan_leave", { p_id: id });
  revalidatePath("/bible", "layout");
  revalidatePath("/home");
}

export async function deleteHistoryAction(formData: FormData) {
  await requireApprovedMember("/bible");
  const id = idFrom(formData);
  if (id) await rpc("bible_enrollment_delete", { p_id: id, p_confirm: "delete" });
  revalidatePath("/bible", "layout");
  redirect("/bible");
}

/** Mark read or not read (idempotent). Returns the new state for the toggle. */
export async function completeDayAction(dayId: string, done: boolean): Promise<{ ok: true; completed: boolean } | { ok: false; message: string }> {
  await requireApprovedMember("/bible");
  if (!uuid.safeParse(dayId).success) return { ok: false, message: "That reading isn't available." };
  const { data, error } = await rpc("bible_day_complete", { p_day: dayId, p_done: done });
  if (error) return { ok: false, message: dbErrorMessage(error, "That couldn't be saved. Please try again.") };
  revalidatePath("/bible", "layout");
  revalidatePath("/home");
  return { ok: true, completed: !!(data as { completed: boolean }).completed };
}

export type BookmarkInput =
  | { kind: "passage"; translation_id: string; book: string; chapter: number; start_verse: number | null; end_verse: number | null; label?: string }
  | { kind: "assignment"; day_id: string; label?: string };

export async function toggleBookmarkAction(input: BookmarkInput): Promise<{ ok: true; bookmarked: boolean } | { ok: false; message: string }> {
  await requireApprovedMember("/bible");
  const { data, error } = await rpc("bible_bookmark_toggle", { p: input });
  if (error) return { ok: false, message: dbErrorMessage(error, "The bookmark couldn't be saved.") };
  revalidatePath("/bible/bookmarks");
  return { ok: true, bookmarked: !!(data as { bookmarked: boolean }).bookmarked };
}

export async function removeBookmarkAction(formData: FormData) {
  await requireApprovedMember("/bible/bookmarks");
  const id = idFrom(formData);
  if (id) await rpc("bible_bookmark_remove", { p_id: id });
  revalidatePath("/bible/bookmarks");
}

export async function highlightAction(input: {
  translationId: string;
  book: string;
  chapter: number;
  verses: number[];
  color: string | null;
}): Promise<{ ok: true; highlights: Array<{ verse: number; color: string }> } | { ok: false; message: string }> {
  await requireApprovedMember("/bible");
  if (!uuid.safeParse(input.translationId).success || !/^[1-3A-Z][A-Z0-9]{2}$/.test(input.book)) return { ok: false, message: "Choose verses first." };
  if (input.color !== null && !["yellow", "green", "blue", "pink"].includes(input.color)) return { ok: false, message: "Choose a highlight color." };
  const { data, error } = await rpc("bible_highlight_set", {
    p_translation: input.translationId,
    p_book: input.book,
    p_chapter: input.chapter,
    p_verses: input.verses.slice(0, 200),
    p_color: input.color,
  });
  if (error) return { ok: false, message: dbErrorMessage(error, "The highlight couldn't be saved.") };
  return { ok: true, highlights: (data as Array<{ verse: number; color: string }>) ?? [] };
}

export async function readerPrefsAction(input: { text_size?: number; line_spacing?: number; verse_numbers?: boolean; translation_id?: string }) {
  await requireApprovedMember("/bible");
  const p: Record<string, unknown> = {};
  if (input.text_size !== undefined) p.text_size = Math.round(Math.min(200, Math.max(85, input.text_size)));
  if (input.line_spacing !== undefined) p.line_spacing = Math.min(2.2, Math.max(1.3, Math.round(input.line_spacing * 100) / 100));
  if (input.verse_numbers !== undefined) p.verse_numbers = !!input.verse_numbers;
  if (input.translation_id && uuid.safeParse(input.translation_id).success) p.translation_id = input.translation_id;
  const { error } = await rpc("bible_reader_prefs_save", { p });
  return { ok: !error };
}

export async function clearAnnotationsAction(formData: FormData) {
  await requireApprovedMember("/bible/bookmarks");
  const kind = String(formData.get("kind"));
  if (kind === "bookmarks" || kind === "highlights") await rpc("bible_annotations_clear", { p_kind: kind, p_confirm: kind });
  revalidatePath("/bible/bookmarks");
}

/** The member's preferred Bible version (empty = the church's default). */
export async function preferredVersionAction(formData: FormData) {
  await requireApprovedMember("/bible");
  const value = String(formData.get("translation_id") ?? "");
  if (value && !uuid.safeParse(value).success) return;
  await rpc("bible_reader_prefs_save", { p: { translation_id: value } });
  revalidatePath("/bible", "layout");
}
