"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { processEventCover } from "@/lib/events/images";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { zonedLocalToUtc } from "@/lib/time";
import { requireClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMemoryOptions, memoryEligibility, ineligibleNote } from "./eligibility";
import { fetchMemoryText, type Ref } from "./provider";
import { removeMemoryObjects, uploadMemoryObject } from "./storage";
import type { Passage } from "./types";

/**
 * Memory verse management for staff (/admin/memory) and authorized group
 * leaders (/memory/lead). Every call is authorized again in the database
 * (memory.can_edit / can_publish / can_run_challenges); these actions only
 * validate input and route the result. `base` comes from a fixed list.
 */
const BASES = new Set(["/admin/memory", "/memory/lead"]);
const uuid = z.uuid();

function baseFrom(formData: FormData): string {
  const b = String(formData.get("base") ?? "");
  return BASES.has(b) ? b : "/admin/memory";
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return /^\d{1,3}$/.test(v) ? Number(v) : null;
};

/**
 * A licensed version's verse: fetched here through the existing API.Bible
 * integration, and only what the database keeps (fingerprint, verse
 * numbers, word count, passage ID) is returned, never the text. {} for a
 * stored-text version.
 */
async function licensedPayload(supabase: SupabaseClient, translation: string, ref: Ref): Promise<{ provider?: unknown } | { error: string }> {
  const text = await fetchMemoryText(supabase, translation, ref);
  if (text.status === "stored") return {};
  if (text.status !== "ok") return { error: `${text.message} Nothing was changed.` };
  return { provider: text.payload };
}

/** The collection's version and, for one verse, its passage (from the database, never the form). */
async function collectionFacts(supabase: SupabaseClient, id: string, item?: string) {
  const { data } = await supabase.rpc("memory_admin_collection", { p_id: id });
  const c = data as { translation: { id: string; source_kind?: string }; items: Array<{ id: string; passage: Passage }> } | null;
  return c
    ? { translation: c.translation.id, licensed: c.translation.source_kind === "api", passage: item ? (c.items.find((i) => i.id === item)?.passage ?? null) : null }
    : null;
}

function refresh(base: string) {
  revalidatePath(base, "layout");
  revalidatePath("/memory", "layout");
  revalidatePath("/home");
}

export async function saveCollectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("id")).data ?? null;
  const values = formValues(formData);
  const p: Record<string, unknown> = {
    title: str(formData, "title"),
    description: String(formData.get("description") ?? ""),
    goal_note: str(formData, "goal_note"),
    goal_sessions_per_week: str(formData, "goal_sessions_per_week"),
    sort_order: str(formData, "sort_order") || "100",
  };
  if (formData.has("audience")) {
    p.audience = str(formData, "audience");
    p.group_id = str(formData, "group_id");
  }
  if (formData.has("translation_id")) p.translation_id = str(formData, "translation_id");
  if (formData.has("kind")) p.kind = str(formData, "kind");
  if (formData.has("translation_choice_field")) p.translation_choice = formData.get("translation_choice") === "on";
  if (formData.has("timezone")) p.timezone = str(formData, "timezone");
  const supabase = await requireClient();
  // The shared eligibility rule: the database checks the version's memory
  // permission; a licensed version must also be connected on this server.
  if (typeof p.translation_id === "string" && p.translation_id) {
    const t = (await loadMemoryOptions(supabase)).find((o) => o.id === p.translation_id);
    const e = t ? memoryEligibility(t) : null;
    if (t && e && !e.eligible) return errorState(ineligibleNote(t.code, e.reason), { values });
  }
  const { data, error } = await supabase.rpc("memory_admin_collection_save", {
    p_id: id,
    p,
    p_client_key: id ? null : (uuid.safeParse(formData.get("client_key")).data ?? null),
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  refresh(base);
  if (!id) redirect(`${base}/collections/${(data as { id: string }).id}`);
  return { status: "success", message: "Collection saved." };
}

export async function collectionStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("id")).data;
  const action = str(formData, "op");
  if (!id) return errorState("Collection not found.");
  const supabase = await requireClient();
  if (action === "duplicate") {
    const { data, error } = await supabase.rpc("memory_admin_collection_duplicate", { p_id: id, p_title: str(formData, "title") || null });
    if (error) return errorState(dbErrorMessage(error));
    refresh(base);
    redirect(`${base}/collections/${(data as { id: string }).id}`);
  }
  if (action === "delete") {
    const { data, error } = await supabase.rpc("memory_admin_collection_delete", { p_id: id });
    if (error) return errorState(dbErrorMessage(error));
    await removeMemoryObjects(supabase, [(data as { previous_path: string | null }).previous_path]);
    refresh(base);
    redirect(base);
  }
  if (!["publish", "schedule", "unschedule", "archive", "restore"].includes(action)) return errorState("Unknown action.");
  let at: string | null = null;
  if (action === "schedule") {
    const when = str(formData, "publish_at");
    const tz = str(formData, "timezone") || "America/Chicago";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return errorState("Choose when to publish.");
    at = zonedLocalToUtc(when, tz)?.toISOString() ?? null;
    if (!at) return errorState("That time doesn't exist in the collection's time zone.");
  }
  if (action === "publish" || action === "schedule") {
    // A licensed version is published only while it can actually be fetched here.
    const facts = await collectionFacts(supabase, id);
    const t = facts ? (await loadMemoryOptions(supabase)).find((o) => o.id === facts.translation) : null;
    const e = t ? memoryEligibility(t) : null;
    if (t && e && !e.eligible) return errorState(`${ineligibleNote(t.code, e.reason)} Nothing was published.`);
  }
  const { error } = await supabase.rpc("memory_admin_collection_status", { p_id: id, p_action: action === "schedule" ? "publish" : action, p_at: at });
  if (error) return errorState(dbErrorMessage(error));
  refresh(base);
  const messages: Record<string, string> = {
    publish: "Published. Members can see it now.",
    schedule: "Scheduled.",
    unschedule: "Returned to draft.",
    archive: "Archived. Members keep their practice history.",
    restore: "Restored.",
  };
  return { status: "success", message: messages[action] };
}

export async function coverAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("id")).data;
  if (!id) return errorState("Collection not found.");
  const supabase = await requireClient();
  if (formData.get("remove") === "1") {
    const { data, error } = await supabase.rpc("memory_admin_cover", { p_id: id, p_path: null, p_alt: null });
    if (error) return errorState(dbErrorMessage(error));
    await removeMemoryObjects(supabase, [(data as { previous_path: string | null }).previous_path]);
    refresh(base);
    return { status: "success", message: "Cover removed." };
  }
  const file = formData.get("cover");
  if (!(file instanceof File) || !file.size) return errorState("Choose an image.");
  const processed = await processEventCover(file, `covers/${id}`);
  if (!processed.ok) return errorState(processed.message);
  if (!(await uploadMemoryObject(supabase, processed.path, processed.bytes))) return errorState("The cover couldn't be stored. Try again.");
  const { data, error } = await supabase.rpc("memory_admin_cover", { p_id: id, p_path: processed.path, p_alt: str(formData, "cover_alt") });
  if (error) {
    await removeMemoryObjects(supabase, [processed.path]);
    return errorState(dbErrorMessage(error));
  }
  await removeMemoryObjects(supabase, [(data as { previous_path: string | null }).previous_path]);
  refresh(base);
  return { status: "success", message: "Cover saved." };
}

export async function addItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("collection_id")).data;
  const values = formValues(formData);
  const book = str(formData, "book");
  const [sc, sv] = [num(formData, "chapter"), num(formData, "start_verse")];
  const ec = num(formData, "end_chapter") ?? sc;
  const ev = num(formData, "end_verse") ?? sv;
  if (!id || !/^[1-3A-Z][A-Z0-9]{2}$/.test(book) || !sc || !sv || !ec || !ev) return errorState("Choose a book, chapter, and verses.", { values });
  const supabase = await requireClient();
  const facts = await collectionFacts(supabase, id);
  if (!facts) return errorState("Collection not found.", { values });
  const licensed = facts.licensed ? await licensedPayload(supabase, facts.translation, { book, sc, sv, ec, ev }) : {};
  if ("error" in licensed) return errorState(licensed.error, { values });
  const { error } = await supabase.rpc("memory_admin_item_add", {
    p_collection: id,
    p: { book, sc, sv, ec, ev, title: str(formData, "title"), note: String(formData.get("note") ?? ""), hint: str(formData, "hint"), starts_on: str(formData, "starts_on"), ends_on: str(formData, "ends_on"), ...licensed },
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  refresh(base);
  return { status: "success", message: "provider" in licensed ? "Verse added. Its wording was checked with API.Bible; no text was stored." : "Verse added." };
}

export async function saveItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("item_id")).data;
  if (!id) return errorState("Verse not found.");
  const supabase = await requireClient();
  const { error } = await supabase.rpc("memory_admin_item_save", {
    p_item: id,
    p: { title: str(formData, "title"), note: String(formData.get("note") ?? ""), hint: str(formData, "hint"), starts_on: str(formData, "starts_on"), ends_on: str(formData, "ends_on") },
  });
  if (error) return errorState(dbErrorMessage(error));
  refresh(base);
  return { status: "success", message: "Saved." };
}

export async function itemOpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("item_id")).data;
  const op = str(formData, "op");
  if (!id) return errorState("Verse not found.");
  const supabase = await requireClient();
  // A licensed verse's current wording, fetched now (the database keeps no text to compare).
  let provider: unknown = null;
  const collection = uuid.safeParse(formData.get("collection_id")).data;
  if (op === "update_text" && collection) {
    const facts = await collectionFacts(supabase, collection, id);
    const p = facts?.passage;
    if (p?.source_kind === "api") {
      const licensed = await licensedPayload(supabase, p.translation.id, { book: p.book, sc: p.start_chapter, sv: p.start_verse, ec: p.end_chapter, ev: p.end_verse });
      if ("error" in licensed) return errorState(licensed.error);
      provider = "provider" in licensed ? licensed.provider : null;
    }
  }
  const call =
    op === "up" || op === "down"
      ? supabase.rpc("memory_admin_item_move", { p_item: id, p_direction: op === "up" ? -1 : 1 })
      : op === "remove"
        ? supabase.rpc("memory_admin_item_remove", { p_item: id })
        : op === "update_text"
          ? supabase.rpc("memory_admin_item_update_text", { p_item: id, p_reason: str(formData, "reason"), p_provider: provider })
          : null;
  if (!call) return errorState("Unknown action.");
  const { error } = await call;
  if (error) return errorState(dbErrorMessage(error));
  refresh(base);
  return { status: "success", message: op === "update_text" ? "Updated. Members will be asked whether to switch to the new text." : op === "remove" ? "Removed." : "Moved." };
}

export async function sequenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("collection_id")).data;
  const start = str(formData, "start");
  const days = Number(str(formData, "days") || 7);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return errorState("Choose a start date.");
  const supabase = await requireClient();
  const { error } = await supabase.rpc("memory_admin_sequence_fill", { p_collection: id, p_start: start, p_days: days });
  if (error) return errorState(dbErrorMessage(error));
  refresh(base);
  return { status: "success", message: "Dates filled in, one verse after another." };
}

export async function authorizeGroupAction(formData: FormData) {
  await requireApprovedMember("/admin/memory");
  const group = uuid.safeParse(formData.get("group_id")).data;
  if (!group) return;
  const supabase = await requireClient();
  await supabase.rpc("memory_admin_group_authorize", { p_group: group, p_on: formData.get("on") === "1", p_note: null });
  refresh("/admin/memory");
}

export async function saveChallengeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("id")).data ?? null;
  const values = formValues(formData);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_admin_challenge_save", {
    p_id: id,
    p: {
      group_id: str(formData, "group_id"),
      collection_id: str(formData, "collection_id"),
      title: str(formData, "title"),
      description: String(formData.get("description") ?? ""),
      starts_on: str(formData, "starts_on"),
      ends_on: str(formData, "ends_on"),
      goal_sessions: str(formData, "goal_sessions"),
      min_participants: str(formData, "min_participants"),
    },
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  refresh(base);
  if (!id) redirect(`${base}/challenges/${(data as { id: string }).id}`);
  return { status: "success", message: "Challenge saved." };
}

export async function challengeStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const base = baseFrom(formData);
  await requireApprovedMember(base);
  const id = uuid.safeParse(formData.get("id")).data;
  const op = str(formData, "op");
  if (!id) return errorState("Challenge not found.");
  const supabase = await requireClient();
  const { error } = await supabase.rpc("memory_admin_challenge_status", { p_id: id, p_action: op });
  if (error) return errorState(dbErrorMessage(error));
  refresh(base);
  return { status: "success", message: op === "end" ? "Challenge ended." : "Challenge canceled." };
}
