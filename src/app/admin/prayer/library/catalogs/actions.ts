"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, type FormState } from "@/lib/forms";
import { CATALOG_LIMITS, CATALOG_STATUSES, catalogMeta, storedCatalogReport } from "@/lib/prayer/catalog";
import { prepareCatholicOnline } from "@/lib/prayer/catalog-source";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Prayer link catalogues (settings.manage, checked here and again in the
 * database): import the pinned Catholic Online catalogue, name and describe
 * a catalogue, publish or archive it, publish or unpublish its links, and
 * archive a topic.
 *
 * No prayer text is ever read, written, or sent by anything here: a
 * catalogue holds titles, the source's topic labels, and addresses. Nothing
 * here notifies anyone.
 */
const UNAVAILABLE = "The Prayer Library is unavailable right now. Nothing was changed.";
const LIST = "/admin/prayer/library/catalogs";
const uuid = z.uuid();

function refresh(id?: string | null) {
  revalidatePath(LIST, "layout");
  revalidatePath("/prayer/library", "layout");
  if (id) {
    revalidatePath(`${LIST}/${id}`);
    revalidatePath(`/prayer/library/catalogs/${id}`);
  }
}

/**
 * The whole import: the dry run first (it refuses on any problem), then the
 * staged import — open, stage the topics, stage the links in batches, and
 * one all-or-nothing apply in the database. If anything fails, nothing
 * reaches the catalogue and the import is recorded as failed with the reason.
 *
 * Every imported link arrives unpublished and the catalogue arrives as a
 * draft, so members see nothing until someone publishes.
 */
export async function importCatalogAction(): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const prepared = await prepareCatholicOnline();
  if (!prepared.ok) return errorState(prepared.message);
  if (!prepared.report.ok) return errorState("The dry run found problems (see the report). Nothing was imported.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);

  const begun = await supabase.rpc("prayer_link_import_begin", {
    p_meta: catalogMeta(),
    p_report: storedCatalogReport(prepared.report),
    p_expected: prepared.links.length,
  });
  if (begun.error || !begun.data) return errorState(dbErrorMessage(begun.error, "The import couldn't start. Nothing was imported."));
  const { import_id: importId, catalog_id: catalogId } = begun.data as { import_id: string; catalog_id: string };

  const fail = async (message: string) => {
    await supabase.rpc("prayer_link_import_close", { p_import: importId, p_status: "failed", p_error: message });
    refresh(catalogId);
    return errorState(`${message} Nothing was imported; the prayer category is unchanged.`);
  };

  const topics = await supabase.rpc("prayer_link_import_topics", { p_import: importId, p_topics: prepared.topics });
  if (topics.error) return fail(`Staging the topics stopped: ${dbErrorMessage(topics.error, "the database refused a topic")}.`);

  for (let i = 0; i < prepared.links.length; i += CATALOG_LIMITS.batch) {
    const { error } = await supabase.rpc("prayer_link_import_rows", {
      p_import: importId,
      p_rows: prepared.links.slice(i, i + CATALOG_LIMITS.batch),
    });
    if (error) return fail(`Staging stopped at prayer ${i + 1} of ${prepared.links.length}: ${dbErrorMessage(error, "the database refused a prayer link")}.`);
  }

  const applied = await supabase.rpc("prayer_link_import_apply", { p_import: importId });
  if (applied.error) return fail(`The import couldn't be applied: ${dbErrorMessage(applied.error, "the database refused it")}.`);
  refresh(catalogId);
  redirect(`${LIST}/${catalogId}?imported=1`);
}

export async function discardCatalogImportAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const importId = uuid.safeParse(formData.get("importId")).data;
  const catalogId = uuid.safeParse(formData.get("catalogId")).data;
  if (!importId || !catalogId) redirect(LIST);
  const supabase = await createClient();
  if (supabase) await supabase.rpc("prayer_link_import_close", { p_import: importId, p_status: "discarded", p_error: "Discarded by a settings manager." });
  refresh(catalogId);
  redirect(`${LIST}/${catalogId}?discarded=1`);
}

const detailsSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(80, "Keep the name to 80 characters."),
  description: z.string().trim().max(500, "Keep the description to 500 characters."),
  sortOrder: z.coerce.number().int("Use a whole number.").min(0, "Use 0 or more.").max(1000000, "Use 1,000,000 or less."),
});

export async function saveCatalogAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const id = uuid.safeParse(formData.get("catalogId")).data;
  if (!id) return errorState("That prayer category wasn't found.");
  const values = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    sortOrder: String(formData.get("sortOrder") ?? "1000"),
  };
  const parsed = detailsSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("prayer_link_catalog_save", {
    p_id: id,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_sort_order: parsed.data.sortOrder,
  });
  if (error) return errorState(dbErrorMessage(error, "The prayer category couldn't be saved."), { values });
  refresh(id);
  return { status: "success", message: "Saved." };
}

const DONE: Record<string, string> = {
  published: "Published. Members can see this prayer category now.",
  draft: "Back to a draft. Members can't see it.",
  archived: "Archived. Members can't see it.",
};

export async function catalogStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const id = uuid.safeParse(formData.get("catalogId")).data;
  const status = String(formData.get("status") ?? "");
  if (!id) return errorState("That prayer category wasn't found.");
  if (!(CATALOG_STATUSES as readonly string[]).includes(status)) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_link_catalog_status", { p_id: id, p_status: status });
  if (error) return errorState(dbErrorMessage(error, "That couldn't be changed."));
  refresh(id);
  return { status: "success", message: DONE[status] };
}

/** Publish or unpublish the links whose checkboxes are ticked on this page. */
export async function publishLinksAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const catalogId = uuid.safeParse(formData.get("catalogId")).data;
  const on = String(formData.get("publish") ?? "") === "on";
  const ids = formData.getAll("link").map(String).filter((v) => uuid.safeParse(v).success);
  if (!catalogId) return errorState("That prayer category wasn't found.");
  if (!ids.length) return errorState("Tick at least one prayer first.");
  if (ids.length > 500) return errorState("Choose at most 500 prayers at a time.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("prayer_link_set_published", { p_ids: ids, p_published: on });
  if (error) return errorState(dbErrorMessage(error, "Those prayers couldn't be changed."));
  refresh(catalogId);
  const changed = Number((data as { changed?: number } | null)?.changed ?? 0);
  return {
    status: "success",
    message: changed
      ? `${on ? "Published" : "Unpublished"} ${changed.toLocaleString("en-US")} ${changed === 1 ? "prayer" : "prayers"}.`
      : "Nothing needed changing (prayers the source no longer lists stay hidden).",
  };
}

/** Publish or unpublish every link in the catalogue, or in one topic. */
export async function publishAllAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const catalogId = uuid.safeParse(formData.get("catalogId")).data;
  const topic = uuid.safeParse(formData.get("topicId")).data ?? null;
  const on = String(formData.get("publish") ?? "") === "on";
  if (!catalogId) return errorState("That prayer category wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("prayer_link_publish_all", { p_catalog: catalogId, p_topic: topic, p_published: on });
  if (error) return errorState(dbErrorMessage(error, "Those prayers couldn't be changed."));
  refresh(catalogId);
  const changed = Number((data as { changed?: number } | null)?.changed ?? 0);
  return {
    status: "success",
    message: changed
      ? `${on ? "Published" : "Unpublished"} ${changed.toLocaleString("en-US")} ${changed === 1 ? "prayer" : "prayers"}.`
      : "Nothing needed changing.",
  };
}

export async function archiveCatalogTopicAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const catalogId = uuid.safeParse(formData.get("catalogId")).data;
  const id = uuid.safeParse(formData.get("topicId")).data;
  const archived = String(formData.get("archived") ?? "") === "on";
  if (!catalogId || !id) return errorState("That topic wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_link_topic_archive", { p_id: id, p_archived: archived });
  if (error) return errorState(dbErrorMessage(error, "That topic couldn't be changed."));
  refresh(catalogId);
  return { status: "success", message: archived ? "Archived. It has left the member filters." : "Restored." };
}
