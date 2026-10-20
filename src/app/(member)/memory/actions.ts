"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "@/lib/auth/viewer";
import { isValidTimeZone } from "@/lib/bible/dates";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Memory practice is unavailable right now. Nothing was changed.";
const uuid = z.uuid();

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

function idFrom(formData: FormData, key = "id"): string | null {
  return uuid.safeParse(formData.get(key)).data ?? null;
}

function refresh() {
  revalidatePath("/memory", "layout");
  revalidatePath("/home");
}

/** Adds a collection verse (item_id) or a passage chosen from the approved source. */
export async function addVerseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner("/memory");
  const item = idFrom(formData, "item_id");
  let payload: Record<string, unknown>;
  if (item) {
    payload = { item_id: item };
  } else {
    const translation = idFrom(formData, "translation_id");
    const book = String(formData.get("book") ?? "");
    const [sc, sv, ev] = ["chapter", "start_verse", "end_verse"].map((k) => Number(formData.get(k)));
    if (!translation || !/^[1-3A-Z][A-Z0-9]{2}$/.test(book) || ![sc, sv, ev].every((n) => Number.isInteger(n) && n > 0)) {
      return errorState("Choose a book, chapter, and verses.");
    }
    payload = { translation_id: translation, book, sc, sv, ec: sc, ev };
  }
  const { data, error } = await rpc("memory_card_add", { p: payload });
  if (error) return errorState(dbErrorMessage(error, "That verse couldn't be added right now."));
  refresh();
  const card = data as { id: string };
  if (formData.get("then") === "practice") redirect(`/memory/verses/${card.id}`);
  return { status: "success", message: "Added to My Verses.", values: { card_id: card.id } };
}

export async function removeVerseAction(formData: FormData) {
  await requireLearner("/memory/verses");
  const id = idFrom(formData);
  const mode = String(formData.get("mode"));
  if (!id || !["remove", "restore", "delete"].includes(mode)) return;
  await rpc("memory_card_remove", { p_id: id, p_mode: mode, p_confirm: mode === "delete" ? "delete" : null });
  refresh();
  if (mode === "delete" || mode === "remove") redirect("/memory/verses");
}

/** The member's explicit choice to practice the updated text of a verse. */
export async function switchVersionAction(formData: FormData) {
  await requireLearner("/memory/verses");
  const id = idFrom(formData);
  if (!id) return;
  const { data, error } = await rpc("memory_card_switch_version", { p_id: id });
  refresh();
  if (!error) redirect(`/memory/verses/${(data as { id: string }).id}?updated=1`);
}

const Settings = z.object({
  difficulty: z.enum(["guided", "growing", "challenge"]),
  presentation: z.enum(["standard", "kids"]),
  daily_goal: z.union([z.literal(""), z.coerce.number().int().min(1).max(20)]),
  timezone: z.string().max(64),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner("/memory/settings");
  const parsed = Settings.safeParse({
    difficulty: formData.get("difficulty"),
    presentation: formData.get("presentation"),
    daily_goal: String(formData.get("daily_goal") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    reminder_time: String(formData.get("reminder_time") ?? "18:00"),
  });
  if (!parsed.success) return errorState("Please check your choices.");
  if (parsed.data.timezone && !isValidTimeZone(parsed.data.timezone)) return errorState("Choose a valid time zone.");
  const on = (k: string) => formData.get(k) === "on";
  const { error } = await rpc("memory_settings_save", {
    p: {
      difficulty: parsed.data.difficulty,
      presentation: parsed.data.presentation,
      daily_goal: parsed.data.daily_goal === "" ? "" : String(parsed.data.daily_goal),
      timezone: parsed.data.timezone,
      reminder_time: parsed.data.reminder_time,
      ignore_case: on("ignore_case"),
      ignore_punctuation: on("ignore_punctuation"),
      celebrations: on("celebrations"),
      paused: on("paused"),
      remind_weekly: on("remind_weekly"),
      remind_review: on("remind_review"),
      remind_practice: on("remind_practice"),
      remind_challenge: on("remind_challenge"),
    },
  });
  if (error) return errorState(dbErrorMessage(error));
  refresh();
  return { status: "success", message: "Practice settings saved." };
}

export async function deleteHistoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner("/memory/settings");
  const confirm = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (confirm !== "delete my practice history") return errorState("Type the confirmation exactly to delete your practice history.");
  const { error } = await rpc("memory_history_delete", { p_confirm: confirm, p_collections: formData.get("collections") === "on" });
  if (error) return errorState(dbErrorMessage(error));
  refresh();
  return { status: "success", message: "Your practice history was deleted." };
}

export async function saveMyCollectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner("/memory/collections");
  const id = idFrom(formData);
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return errorState("Give the collection a title.", { fieldErrors: { title: ["Give the collection a title."] } });
  const { data, error } = await rpc("memory_my_collection_save", {
    p_id: id,
    p: { title, description: String(formData.get("description") ?? ""), translation_id: idFrom(formData, "translation_id") },
  });
  if (error) return errorState(dbErrorMessage(error));
  refresh();
  if (!id) redirect(`/memory/collections/${(data as { id: string }).id}`);
  return { status: "success", message: "Saved." };
}

export async function myCollectionItemAction(formData: FormData) {
  await requireLearner("/memory/collections");
  const collection = idFrom(formData, "collection_id");
  const card = idFrom(formData, "card_id");
  const item = idFrom(formData, "item_id");
  if (collection && card) await rpc("memory_my_collection_add", { p_collection: collection, p_card: card });
  else if (item) await rpc("memory_my_collection_remove", { p_item: item });
  refresh();
}

export async function deleteMyCollectionAction(formData: FormData) {
  await requireLearner("/memory/collections");
  const id = idFrom(formData);
  if (id) await rpc("memory_my_collection_delete", { p_id: id });
  refresh();
  redirect("/memory/collections");
}

export async function challengeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner("/memory");
  const id = idFrom(formData);
  const op = String(formData.get("op"));
  if (!id) return errorState("That challenge isn't available.");
  const call =
    op === "join"
      ? rpc("memory_challenge_join", { p_id: id, p_understood: formData.get("understood") === "on" })
      : op === "pause" || op === "resume"
        ? rpc("memory_challenge_sharing", { p_id: id, p_on: op === "resume" })
        : op === "leave"
          ? rpc("memory_challenge_leave", { p_id: id })
          : null;
  if (!call) return errorState("Unknown action.");
  const { error } = await call;
  if (error) return errorState(dbErrorMessage(error));
  refresh();
  const messages: Record<string, string> = {
    join: "You've joined. Your practice on these verses now counts toward the group total.",
    pause: "Sharing paused. Nothing you practice now is counted, and your earlier practice was removed from the total.",
    resume: "Sharing resumed from now.",
    leave: "You've left the challenge. Your practice no longer counts toward the group total.",
  };
  return { status: "success", message: messages[op] };
}
