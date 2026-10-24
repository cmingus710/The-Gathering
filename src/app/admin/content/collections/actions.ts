"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability, requireCapability } from "@/lib/auth/viewer";
import { morningEveningMeta, prepareMorningEvening, storedReport } from "@/lib/devotionals/source";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { isUuid } from "@/lib/media/format";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "The content service is unavailable. Nothing was saved.";
const BATCH = 100;
const BASE = "/admin/content/collections";

/**
 * Imports the pinned Morning & Evening file: dry run (refuses on any
 * problem), then a staging import, then one all-or-nothing apply in the
 * database. If anything fails, nothing reaches the readings and the import
 * is recorded as failed with the reason. Readings never trigger notices.
 */
export async function importMorningEveningAction(): Promise<FormState> {
  await requireCapability(CAPABILITIES.contentPublish, `${BASE}/import`);
  const prepared = await prepareMorningEvening();
  if (!prepared.ok) return errorState(prepared.message);
  if (!prepared.report.ok) return errorState("The dry run found problems (see the report). Nothing was imported.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);

  const begun = await supabase.rpc("media_admin_collection_import_begin", {
    p_meta: morningEveningMeta(),
    p_report: storedReport(prepared.report),
    p_expected: prepared.readings.length,
  });
  if (begun.error || !begun.data) return errorState(dbErrorMessage(begun.error, "The import couldn't start. Nothing was imported."));
  const { import_id: importId, collection_id: collectionId } = begun.data as { import_id: string; collection_id: string };

  const fail = async (message: string) => {
    await supabase.rpc("media_admin_collection_import_close", { p_import: importId, p_status: "failed", p_error: message });
    revalidatePath(BASE, "layout");
    return errorState(`${message} Nothing was imported; the collection is unchanged.`);
  };
  for (let i = 0; i < prepared.readings.length; i += BATCH) {
    const { error } = await supabase.rpc("media_admin_collection_import_rows", { p_import: importId, p_rows: prepared.readings.slice(i, i + BATCH) });
    if (error) return fail(`Staging stopped at reading ${i + 1} of ${prepared.readings.length}: ${dbErrorMessage(error, "the database refused a reading")}.`);
  }
  const applied = await supabase.rpc("media_admin_collection_import_apply", { p_import: importId });
  if (applied.error) return fail(`The import couldn't be applied: ${dbErrorMessage(applied.error, "the database refused it")}.`);
  revalidatePath(BASE, "layout");
  redirect(`${BASE}/${collectionId}?imported=${importId}`);
}

export async function discardImportAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.contentPublish, BASE);
  const id = formData.get("import_id");
  const collection = formData.get("collection_id");
  if (!isUuid(id) || !isUuid(collection)) redirect(BASE);
  const supabase = await createClient();
  if (supabase) await supabase.rpc("media_admin_collection_import_close", { p_import: id, p_status: "discarded", p_error: "Discarded by an editor." });
  revalidatePath(BASE, "layout");
  redirect(`${BASE}/${collection}`);
}

export async function collectionStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.contentPublish, BASE);
  const id = formData.get("id");
  const action = String(formData.get("action") ?? "");
  if (!isUuid(id) || !["publish", "unpublish", "hide", "show"].includes(action)) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("media_admin_collection_status", { p_id: id, p_action: action });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/", "layout");
  redirect(`${BASE}/${id}?saved=${action}`);
}

export async function saveCollectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], BASE);
  const values = formValues(formData);
  const id = formData.get("id");
  if (!isUuid(id)) return errorState("That collection couldn't be found.");
  const title = String(formData.get("title") ?? "").trim();
  const subtitle = String(formData.get("subtitle") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const audience = String(formData.get("audience") ?? "members");
  const groupId = audience === "group" ? String(formData.get("group_id") ?? "") : "";
  const fieldErrors: Record<string, string[]> = {};
  if (title.length < 1 || title.length > 120) fieldErrors.title = ["Give it a title (up to 120 characters)."];
  if (subtitle.length > 160) fieldErrors.subtitle = ["Keep the card line under 160 characters."];
  if (description.length > 4000) fieldErrors.description = ["Keep the description under 4,000 characters."];
  if (!["members", "group"].includes(audience)) fieldErrors.audience = ["Choose who can see it."];
  if (audience === "group" && !isUuid(groupId)) fieldErrors.group_id = ["Choose a group."];
  if (Object.keys(fieldErrors).length) return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("media_admin_collection_save", {
    p_id: id,
    p: {
      title,
      subtitle,
      description,
      audience,
      group_id: groupId || null,
      cover_asset_id: isUuid(formData.get("cover_asset_id")) ? formData.get("cover_asset_id") : null,
      cover_alt: String(formData.get("cover_alt") ?? "").trim().slice(0, 500),
    },
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath("/", "layout");
  redirect(`${BASE}/${id}?saved=details`);
}

export async function saveReadingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], BASE);
  const values = formValues(formData);
  const id = formData.get("id");
  const collection = formData.get("collection_id");
  const revision = Number(formData.get("revision"));
  if (!isUuid(id) || !isUuid(collection) || !Number.isInteger(revision)) return errorState("That reading couldn't be found.");
  const body = String(formData.get("body") ?? "");
  const keyVerse = String(formData.get("key_verse") ?? "");
  const ref = String(formData.get("scripture_ref") ?? "");
  const fieldErrors: Record<string, string[]> = {};
  if (!body.trim() || body.length > 20_000) fieldErrors.body = ["The text is required (20,000 characters at most)."];
  if (keyVerse.length > 1000) fieldErrors.key_verse = ["Keep the key verse under 1,000 characters."];
  if (ref.length > 120) fieldErrors.scripture_ref = ["Keep the reference under 120 characters."];
  if (Object.keys(fieldErrors).length) return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("media_admin_collection_reading_save", {
    p_id: id,
    p_key_verse: keyVerse,
    p_scripture_ref: ref,
    p_body: body,
    p_base_revision: revision,
  });
  if (error) return errorState(error.code === "40001" ? (error.message ?? "This reading changed meanwhile. Reload it.") : dbErrorMessage(error), { values });
  revalidatePath("/", "layout");
  redirect(`${BASE}/${collection}/readings/${id}?saved=1`);
}

/** Back to the imported text, or to a newer import's text for a reading that had a conflict. */
export async function restoreReadingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], BASE);
  const id = formData.get("id");
  const collection = formData.get("collection_id");
  const revision = Number(formData.get("revision"));
  const importId = formData.get("import_id");
  if (!isUuid(id) || !isUuid(collection) || !Number.isInteger(revision)) return errorState("That reading couldn't be found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("media_admin_collection_reading_restore", {
    p_id: id,
    p_base_revision: revision,
    p_import: isUuid(importId) ? importId : null,
  });
  if (error) return errorState(error.code === "40001" ? (error.message ?? "This reading changed meanwhile. Reload it.") : dbErrorMessage(error));
  revalidatePath("/", "layout");
  redirect(`${BASE}/${collection}/readings/${id}?saved=restored`);
}

export async function removeCollectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.contentPublish, BASE);
  const id = formData.get("id");
  if (!isUuid(id)) return errorState("That collection couldn't be found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("media_admin_collection_remove", { p_id: id, p_confirm: String(formData.get("confirm") ?? "").trim() });
  if (error) return errorState(dbErrorMessage(error));
  const r = data as { readings: number };
  revalidatePath("/", "layout");
  redirect(`${BASE}?removed=${r.readings}`);
}
