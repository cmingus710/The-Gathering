"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability, requireCapability } from "@/lib/auth/viewer";
import { isValidTimeZone, isValidYmd } from "@/lib/bible/dates";
import { parsePlanCsv, PLAN_IMPORT_LIMITS, type RowIssue } from "@/lib/bible/plan-import";
import { parsePassages, toDb } from "@/lib/bible/reference";
import { removeBibleObjects, uploadBibleObject } from "@/lib/bible/storage";
import { processEventCover } from "@/lib/events/images";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { QUESTION_LIMITS, readQuestions } from "@/lib/questions";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Reading plans are unavailable right now. Nothing was changed.";
const uuid = z.uuid();
const PLAN_MANAGERS = [CAPABILITIES.readingEdit, CAPABILITIES.readingPublish];

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error(UNAVAILABLE);
  return supabase;
}
async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const planPath = (id: string) => `/admin/bible/plans/${id}`;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
export async function savePlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAnyCapability(PLAN_MANAGERS, "/admin/bible");
  const values = formValues(formData);
  const id = uuid.safeParse(formData.get("id")).data ?? null;
  const title = str(formData, "title");
  if (!title || title.length > 120) return errorState("Enter a title of up to 120 characters.", { fieldErrors: { title: ["Enter a title of up to 120 characters."] }, values });
  const tz = str(formData, "timezone");
  if (tz && !isValidTimeZone(tz)) return errorState("Choose a valid time zone.", { values });
  const payload: Record<string, unknown> = {
    title,
    description: str(formData, "description").slice(0, 4000),
    audience_note: str(formData, "audience_note").slice(0, 120),
    cover_alt: str(formData, "cover_alt").slice(0, 300),
  };
  if (formData.has("translation_id")) payload.translation_id = str(formData, "translation_id");
  if (formData.has("mode")) payload.mode = str(formData, "mode");
  if (formData.has("timezone")) payload.timezone = tz;
  if (formData.has("audience")) {
    payload.audience = str(formData, "audience") === "group" ? "group" : "members";
    payload.group_id = payload.audience === "group" ? str(formData, "group_id") || null : null;
  }
  const key = uuid.safeParse(formData.get("client_key")).data ?? null;
  const { data, error } = await rpc("bible_admin_plan_save", { p_id: id, p: payload, p_client_key: id ? null : key });
  if (error) return errorState(dbErrorMessage(error), { values });
  const plan = data as { id: string };
  revalidatePath("/admin/bible", "layout");
  revalidatePath("/bible", "layout");
  if (!id) redirect(planPath(plan.id));
  return { status: "success", message: "Plan details saved." };
}

export async function coverAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAnyCapability(PLAN_MANAGERS, "/admin/bible");
  const id = uuid.safeParse(formData.get("id")).data;
  const file = formData.get("cover");
  if (!id) return errorState("Plan not found.");
  const supabase = await db();
  if (formData.get("remove") === "1") {
    const { data, error } = await supabase.rpc("bible_admin_plan_cover", { p_id: id, p_path: null, p_alt: null });
    if (error) return errorState(dbErrorMessage(error));
    await removeBibleObjects(supabase, [(data as { previous_path: string | null }).previous_path]);
    revalidatePath(planPath(id));
    return { status: "success", message: "Cover removed." };
  }
  if (!(file instanceof File) || !file.size) return errorState("Choose an image.");
  const processed = await processEventCover(file, `covers/${id}`);
  if (!processed.ok) return errorState(processed.message);
  if (!(await uploadBibleObject(supabase, processed.path, processed.bytes, "image/webp"))) return errorState("The cover couldn't be stored. Try again.");
  const { data, error } = await supabase.rpc("bible_admin_plan_cover", { p_id: id, p_path: processed.path, p_alt: str(formData, "cover_alt") });
  if (error) {
    await removeBibleObjects(supabase, [processed.path]);
    return errorState(dbErrorMessage(error));
  }
  await removeBibleObjects(supabase, [(data as { previous_path: string | null }).previous_path]);
  revalidatePath(planPath(id));
  revalidatePath("/bible", "layout");
  return { status: "success", message: "Cover saved." };
}

export async function planStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.readingPublish, "/admin/bible");
  const id = uuid.safeParse(formData.get("id")).data;
  const action = str(formData, "action");
  if (!id || !["publish", "archive", "restore", "feature", "unfeature"].includes(action)) return errorState("Unknown action.");
  const { error } = await rpc("bible_admin_plan_status", { p_id: id, p_action: action, p_confirm: str(formData, "confirm") || null });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin/bible", "layout");
  revalidatePath("/bible", "layout");
  revalidatePath("/home");
  const done: Record<string, string> = { publish: "Published.", archive: "Archived.", restore: "Restored.", feature: "Now the featured church plan.", unfeature: "No longer featured." };
  return { status: "success", message: done[action] };
}

export async function duplicatePlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.readingEdit, "/admin/bible");
  const id = uuid.safeParse(formData.get("id")).data;
  if (!id) return errorState("Plan not found.");
  const shift = Number(str(formData, "shift_days") || 0);
  if (!Number.isInteger(shift) || Math.abs(shift) > 800) return errorState("Shift dates by a whole number of days (at most 800).");
  const { data, error } = await rpc("bible_admin_plan_duplicate", {
    p_id: id,
    p_title: str(formData, "title") || null,
    p_new_version: formData.get("new_version") === "on",
    p_shift_days: shift,
  });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin/bible", "layout");
  redirect(planPath((data as { id: string }).id));
}

export async function deletePlanAction(formData: FormData) {
  await requireCapability(CAPABILITIES.readingEdit, "/admin/bible");
  const id = uuid.safeParse(formData.get("id")).data;
  if (!id) return;
  const supabase = await db();
  const { data, error } = await supabase.rpc("bible_admin_plan_delete", { p_id: id });
  if (!error) await removeBibleObjects(supabase, [(data as { cover_path: string | null }).cover_path]);
  revalidatePath("/admin/bible", "layout");
  redirect(error ? `${planPath(id)}?error=delete` : "/admin/bible?notice=deleted");
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------
/** Day fields from the editor form, with passages parsed and checked. */
function dayPayload(formData: FormData, mode: string): { ok: true; p: Record<string, unknown> } | { ok: false; message: string; field?: string } {
  const kind = str(formData, "kind") || "reading";
  if (!["reading", "rest", "catch_up"].includes(kind)) return { ok: false, message: "Choose the kind of day." };
  const p: Record<string, unknown> = { kind, heading: str(formData, "heading").slice(0, 160), notes: str(formData, "notes").slice(0, 4000) };
  if (mode === "calendar") {
    const d = str(formData, "day_date");
    if (!isValidYmd(d)) return { ok: false, message: "Choose a real date.", field: "day_date" };
    p.day_date = d;
  } else {
    const n = Number(str(formData, "day_number"));
    if (!Number.isInteger(n) || n < 1 || n > 2000) return { ok: false, message: "Enter a day number from 1 to 2000.", field: "day_number" };
    p.day_number = n;
  }
  const passages = str(formData, "passages");
  if (kind !== "rest" && passages) {
    const parsed = parsePassages(passages);
    if (!parsed.ok) return { ok: false, message: parsed.error, field: "passages" };
    p.passages = parsed.passages.map(toDb);
  } else {
    p.passages = [];
  }
  const questions = readQuestions(formData, "questions", QUESTION_LIMITS.day);
  if (!questions.ok) return { ok: false, message: questions.message, field: "questions" };
  p.questions = questions.questions;
  p.discussion_thread_id = str(formData, "discussion_thread_id") || null;
  p.links = formData.getAll("links").map(String).filter((x) => uuid.safeParse(x).success).slice(0, 10);
  return { ok: true, p };
}

export async function saveDayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.readingEdit, "/admin/bible");
  const values = formValues(formData);
  const planId = uuid.safeParse(formData.get("plan_id")).data;
  const dayId = uuid.safeParse(formData.get("day_id")).data ?? null;
  if (!planId) return errorState("Plan not found.");
  const built = dayPayload(formData, str(formData, "mode"));
  if (!built.ok) return errorState(built.message, { values, fieldErrors: built.field ? { [built.field]: [built.message] } : undefined });
  const { error } = await rpc("bible_admin_day_save", { p_plan: planId, p_day: dayId, p: built.p });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath(planPath(planId), "layout");
  if (formData.get("then") === "back") redirect(planPath(planId));
  return { status: "success", message: dayId ? "Day saved." : "Day added." };
}

export async function deleteDayAction(formData: FormData) {
  await requireCapability(CAPABILITIES.readingEdit, "/admin/bible");
  const planId = uuid.safeParse(formData.get("plan_id")).data;
  const dayId = uuid.safeParse(formData.get("day_id")).data;
  if (planId && dayId) await rpc("bible_admin_day_delete", { p_day: dayId });
  if (planId) {
    revalidatePath(planPath(planId), "layout");
    redirect(planPath(planId));
  }
}

/** Changes a day of a published plan: a new revision, with a reason. */
export async function reviseDayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.readingPublish, "/admin/bible");
  const values = formValues(formData);
  const planId = uuid.safeParse(formData.get("plan_id")).data;
  const dayId = uuid.safeParse(formData.get("day_id")).data;
  if (!planId || !dayId) return errorState("Day not found.");
  const built = dayPayload(formData, str(formData, "mode"));
  if (!built.ok) return errorState(built.message, { values, fieldErrors: built.field ? { [built.field]: [built.message] } : undefined });
  const confirm = formData.get("correct_past") === "on" ? "correct-past" : formData.get("confirm") === "on" ? "revise" : null;
  const { data, error } = await rpc("bible_admin_day_revise", { p_day: dayId, p: built.p, p_reason: str(formData, "reason"), p_confirm: confirm });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath(planPath(planId), "layout");
  revalidatePath("/bible", "layout");
  const r = data as { revision: number; notified: number; material: boolean };
  return { status: "success", message: `Saved as revision ${r.revision}.${r.material ? ` ${r.notified} ${r.notified === 1 ? "member was" : "members were"} told about the change.` : ""}` };
}

export async function addPublishedDayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.readingPublish, "/admin/bible");
  const values = formValues(formData);
  const planId = uuid.safeParse(formData.get("plan_id")).data;
  if (!planId) return errorState("Plan not found.");
  const built = dayPayload(formData, str(formData, "mode"));
  if (!built.ok) return errorState(built.message, { values, fieldErrors: built.field ? { [built.field]: [built.message] } : undefined });
  const { error } = await rpc("bible_admin_day_add", { p_plan: planId, p: built.p, p_reason: str(formData, "reason") });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath(planPath(planId), "layout");
  revalidatePath("/bible", "layout");
  return { status: "success", message: "Day added." };
}

export async function retireDayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.readingPublish, "/admin/bible");
  const planId = uuid.safeParse(formData.get("plan_id")).data;
  const dayId = uuid.safeParse(formData.get("day_id")).data;
  if (!planId || !dayId) return errorState("Day not found.");
  const confirm = formData.get("correct_past") === "on" ? "correct-past" : formData.get("confirm") === "on" ? "revise" : null;
  const { error } = await rpc("bible_admin_day_retire", { p_day: dayId, p_reason: str(formData, "reason"), p_confirm: confirm });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath(planPath(planId), "layout");
  revalidatePath("/bible", "layout");
  redirect(`${planPath(planId)}?notice=retired`);
}

// ---------------------------------------------------------------------------
// CSV import (draft plans): parse and validate, store the preview, then
// apply on confirmation in one transaction.
// ---------------------------------------------------------------------------
export async function importStageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.readingEdit, "/admin/bible");
  const planId = uuid.safeParse(formData.get("plan_id")).data;
  const file = formData.get("file");
  if (!planId) return errorState("Plan not found.");
  if (!(file instanceof File) || !file.size) return errorState("Choose a CSV file.");
  if (file.size > PLAN_IMPORT_LIMITS.maxBytes) return errorState("The file must be smaller than 1 MB.");
  if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return errorState("Upload a .csv file (download the template to start).");
  const supabase = await db();
  const { data: plan, error: planError } = await supabase.rpc("bible_admin_plan", { p_id: planId });
  if (planError || !plan) return errorState(dbErrorMessage(planError, "Plan not found."));
  const p = plan as { mode: "calendar" | "personal"; translation_id: string; status: string };
  if (p.status !== "draft") return errorState("Imports go into a draft plan. Create a new version to rework a published plan.");
  const text = await file.text();
  const result = parsePlanCsv(text, p.mode);
  // Check every passage against the plan's translation in the database.
  const refs = result.rows.flatMap((r) => r.passages.map((x) => ({ row: r.row, ref: x })));
  const dbErrors: RowIssue[] = [];
  for (let i = 0; i < refs.length; i += 2000) {
    const chunk = refs.slice(i, i + 2000);
    const { data, error } = await supabase.rpc("bible_admin_validate_refs", { p_translation: p.translation_id, p_refs: chunk.map((c) => c.ref) });
    if (error) return errorState(dbErrorMessage(error, "The passages couldn't be checked right now. Nothing was imported."));
    (data as Array<{ ok: boolean; problem: string | null }>).forEach((v, j) => {
      if (!v.ok) dbErrors.push({ row: chunk[j].row, message: `${v.problem} (${chunk[j].ref.book} ${chunk[j].ref.sc}${chunk[j].ref.sv ? `:${chunk[j].ref.sv}` : ""})` });
    });
  }
  const errors = [...result.errors, ...dbErrors].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  const badRows = new Set(dbErrors.map((e) => e.row));
  const rows = result.rows.filter((r) => !badRows.has(r.row));
  const { data, error } = await supabase.rpc("bible_admin_plan_import_stage", {
    p_plan: planId,
    p_file_name: file.name.slice(0, 200),
    p_rows: rows,
    p_errors: errors.slice(0, 500),
    p_warnings: result.warnings.slice(0, 100),
  });
  if (error) return errorState(dbErrorMessage(error));
  redirect(`${planPath(planId)}/import/${data as string}`);
}

export async function importApplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.readingEdit, "/admin/bible");
  const planId = uuid.safeParse(formData.get("plan_id")).data;
  const importId = uuid.safeParse(formData.get("import_id")).data;
  const mode = str(formData, "mode");
  if (!planId || !importId) return errorState("Import not found.");
  if (mode !== "add" && mode !== "replace") return errorState("Choose whether to add to or replace the draft's days.");
  if (formData.get("confirm") !== "on") return errorState("Confirm the import.");
  const { error } = await rpc("bible_admin_plan_import_apply", { p_id: importId, p_mode: mode, p_confirm: mode });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath(planPath(planId), "layout");
  redirect(`${planPath(planId)}?notice=imported`);
}

export async function importDiscardAction(formData: FormData) {
  await requireCapability(CAPABILITIES.readingEdit, "/admin/bible");
  const planId = uuid.safeParse(formData.get("plan_id")).data;
  const importId = uuid.safeParse(formData.get("import_id")).data;
  if (importId) await rpc("bible_admin_plan_import_discard", { p_id: importId });
  if (planId) redirect(planPath(planId));
}
