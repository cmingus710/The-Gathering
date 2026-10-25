"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, type FormState } from "@/lib/forms";
import { COLLECTION_COVER_BUCKET, processCollectionCover } from "@/lib/prayer/collection-covers";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Prayer Library collections (settings.manage, checked here and again in the
 * database): create, rename, describe, reorder, cover, archive, and move
 * prayers between collections. Moving prayers never changes their owner,
 * dates, or publication state, and nothing here notifies anyone.
 */
const UNAVAILABLE = "The Prayer Library is unavailable right now. Nothing was changed.";
const LIST = "/admin/prayer/library/collections";
const uuid = z.uuid();

function refresh(id?: string | null) {
  revalidatePath(LIST, "layout");
  revalidatePath("/prayer/library", "layout");
  if (id) revalidatePath(`${LIST}/${id}`);
}

const detailsSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(80, "Keep the name to 80 characters."),
  description: z.string().trim().max(300, "Keep the description to 300 characters."),
  coverAlt: z.string().trim().max(200, "Keep the image description to 200 characters."),
});

function parseDetails(formData: FormData) {
  const values = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    coverAlt: String(formData.get("coverAlt") ?? ""),
  };
  const parsed = detailsSchema.safeParse(values);
  const fieldErrors: Record<string, string[]> = {};
  if (!parsed.success) for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
  return { values, parsed, fieldErrors };
}

export async function createCollectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const { values, parsed, fieldErrors } = parseDetails(formData);
  if (!parsed.success) return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase.rpc("prayer_library_collection_save", {
    p_id: null,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_cover_alt: null,
  });
  if (error || !data) return errorState(dbErrorMessage(error, "The collection couldn't be created."), { values });
  refresh();
  redirect(`${LIST}/${data as string}?created=1`);
}

/**
 * Name, description, and cover in one save. A new cover image (cropped in
 * the browser, checked and re-encoded here) replaces the old one, whose file
 * is then deleted; "Remove the cover" goes back to the plain folder.
 */
export async function saveCollectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const id = uuid.safeParse(formData.get("collectionId")).data;
  if (!id) return errorState("That collection wasn't found.");
  const { values, parsed, fieldErrors } = parseDetails(formData);
  if (!parsed.success) return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  const file = formData.get("cover");
  const newCover = file instanceof File && file.size > 0 ? file : null;
  const removeCover = !newCover && formData.get("removeCover") === "on";
  let uploaded: string | null = null;
  if (newCover) {
    const processed = await processCollectionCover(newCover, id);
    if (!processed.ok) return errorState(processed.message, { values, fieldErrors: { cover: [processed.message] } });
    const { error } = await supabase.storage.from(COLLECTION_COVER_BUCKET).upload(processed.path, processed.bytes, { contentType: "image/webp", upsert: false });
    if (error) return errorState("The cover couldn't be uploaded. Nothing was saved.", { values });
    uploaded = processed.path;
  }

  const { error } = await supabase.rpc("prayer_library_collection_save", {
    p_id: id,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_cover_alt: parsed.data.coverAlt,
  });
  if (error) {
    if (uploaded) await supabase.storage.from(COLLECTION_COVER_BUCKET).remove([uploaded]);
    return errorState(dbErrorMessage(error, "The collection couldn't be saved."), { values });
  }
  if (uploaded || removeCover) {
    const { data: previous, error: coverError } = await supabase.rpc("prayer_library_collection_cover", {
      p_id: id,
      p_path: uploaded,
      p_alt: uploaded ? parsed.data.coverAlt : null,
    });
    if (coverError) {
      if (uploaded) await supabase.storage.from(COLLECTION_COVER_BUCKET).remove([uploaded]);
      return errorState(dbErrorMessage(coverError, "The details were saved, but the cover couldn't be changed."), { values });
    }
    if (typeof previous === "string" && previous) await supabase.storage.from(COLLECTION_COVER_BUCKET).remove([previous]);
  }
  refresh(id);
  return { status: "success", message: uploaded ? "Saved, with the new cover." : removeCover ? "Saved. The cover was removed." : "Saved." };
}

/** One place up or down among the active collections (members see this order). */
export async function moveCollectionAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const id = uuid.safeParse(formData.get("collectionId")).data;
  const direction = formData.get("direction");
  if (!id || (direction !== "up" && direction !== "down")) return;
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.rpc("prayer_library_collection_move", { p_id: id, p_direction: direction });
  refresh(id);
}

/**
 * Archive (moving its prayers to `reassignTo` first when it still holds any)
 * or restore. The database refuses to archive while prayers would be left
 * without a collection, and never archives General prayers.
 */
export async function archiveCollectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const id = uuid.safeParse(formData.get("collectionId")).data;
  if (!id) return errorState("That collection wasn't found.");
  const archive = formData.get("archived") === "true";
  const target = uuid.safeParse(formData.get("reassignTo")).data ?? null;
  if (archive && formData.get("confirm") !== "on") return errorState("Confirm that you've reviewed the prayers in this collection.", { fieldErrors: { confirm: ["Check this box to continue."] } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("prayer_library_collection_archive", { p_id: id, p_archived: archive, p_reassign_to: archive ? target : null });
  if (error) return errorState(dbErrorMessage(error, "That change couldn't be saved."));
  refresh(id);
  if (target) refresh(target);
  const moved = Number(data ?? 0);
  return {
    status: "success",
    message: archive
      ? `Archived.${moved ? ` ${moved} ${moved === 1 ? "prayer was" : "prayers were"} moved first.` : ""} Members no longer see it.`
      : "Restored. Members see it again once it holds a published prayer.",
  };
}

/** Moves the chosen prayers (one or many) to another active collection. */
export async function reassignPrayersAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const from = uuid.safeParse(formData.get("collectionId")).data ?? null;
  const ids = formData.getAll("prayer").map(String).filter((v) => uuid.safeParse(v).success);
  const target = uuid.safeParse(formData.get("target")).data;
  if (!ids.length) return errorState("Choose at least one prayer to move.");
  if (!target) return errorState("Choose the collection to move them to.", { fieldErrors: { target: ["Choose a collection."] } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("prayer_library_reassign", { p_ids: ids, p_collection: target });
  if (error) return errorState(dbErrorMessage(error, "Those prayers couldn't be moved."));
  refresh(from);
  refresh(target);
  for (const id of ids) revalidatePath(`/prayer/library/${id}`);
  const moved = Number(data ?? 0);
  return { status: "success", message: moved ? `Moved ${moved} ${moved === 1 ? "prayer" : "prayers"}.` : "Nothing needed moving." };
}
