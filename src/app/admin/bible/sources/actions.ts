"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { inspectPdf, PDF_MAX_BYTES, PdfError } from "@/lib/bible/pdf";
import { listApiBibles, type BibleListResult } from "@/lib/bible/source";
import { formatFromName, parseSourceFile } from "@/lib/bible/source-import";
import { CsvError } from "@/lib/bible/csv";
import { bibleUploadToken, downloadBibleObject, removeBibleObjects } from "@/lib/bible/storage";
import { getSupabasePublicConfig } from "@/lib/env";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Bible sources (bible.manage). Text files and PDFs go from the browser
 * straight to the private `bible` bucket with a one-time token; the server
 * then reads them back, as untrusted input, with size limits. Nothing an
 * import contains reaches members until a reviewed import is published.
 */
const UNAVAILABLE = "Bible sources are unavailable right now. Nothing was changed.";
const uuid = z.uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const MAX_TEXT_BYTES = 50 * 1024 * 1024;
const BATCH = 5000;

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------
export async function saveTranslationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const values = formValues(formData);
  const id = uuid.safeParse(formData.get("id")).data ?? null;
  const code = str(formData, "code").toUpperCase();
  if (!id && !/^[A-Z0-9][A-Z0-9-]{1,15}$/.test(code)) {
    return errorState("Use 2–16 capital letters, digits, or hyphens for the code (for example WEB).", { fieldErrors: { code: ["Use 2–16 capital letters, digits, or hyphens."] }, values });
  }
  const sourceUrl = str(formData, "source_url");
  if (sourceUrl && !/^https:\/\/[^\s]+$/.test(sourceUrl)) return errorState("The source link must start with https://.", { values });
  const credential = str(formData, "credential_env");
  if (credential && !/^[A-Z][A-Z0-9_]{2,63}$/.test(credential)) {
    return errorState("Enter the NAME of the server setting (for example API_BIBLE_KEY), never the key itself.", { values });
  }
  const bool = (k: string) => formData.get(k) === "on";
  const p: Record<string, unknown> = {
    name: str(formData, "name"),
    language: str(formData, "language") || "en",
    attribution: str(formData, "attribution").slice(0, 1000),
    copyright: str(formData, "copyright").slice(0, 2000),
    source_url: sourceUrl,
    source_notes: str(formData, "source_notes").slice(0, 2000),
    rights: str(formData, "rights") || "unverified",
    rights_notes: str(formData, "rights_notes").slice(0, 4000),
    allow_cache: bool("allow_cache"),
    cache_days: str(formData, "cache_days") || null,
    allow_copy: bool("allow_copy"),
    allow_print: bool("allow_print"),
    allow_export: bool("allow_export"),
    max_verses_per_view: str(formData, "max_verses_per_view") || null,
    tracking_required: bool("tracking_required"),
    confirm_rights: bool("confirm_rights"),
  };
  if (!id) {
    p.code = code;
    p.source_kind = str(formData, "source_kind") === "api" ? "api" : "database";
  }
  if (formData.has("provider_ref")) p.provider_ref = str(formData, "provider_ref");
  if (formData.has("credential_env")) p.credential_env = credential;
  const { data, error } = await rpc("bible_admin_translation_save", { p_id: id, p });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath("/admin/bible", "layout");
  if (!id) redirect(`/admin/bible/sources/${(data as { id: string }).id}`);
  return { status: "success", message: "Saved." };
}

/** The Bibles the named key can use, for choosing an API.Bible Bible ID. */
export async function listApiBiblesAction(credentialEnv: string): Promise<BibleListResult> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  return listApiBibles(String(credentialEnv ?? "").trim());
}

export async function translationStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const id = uuid.safeParse(formData.get("id")).data;
  const action = str(formData, "action");
  if (!id || !["activate", "retire", "make_default"].includes(action)) return errorState("Unknown action.");
  const { error } = await rpc("bible_admin_translation_status", { p_id: id, p_action: action, p_confirm: str(formData, "confirm") || null });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin/bible", "layout");
  revalidatePath("/bible", "layout");
  return { status: "success", message: action === "activate" ? "Active: members can read this translation." : action === "retire" ? "Retired." : "Now the church's default translation." };
}

// ---------------------------------------------------------------------------
// Uploads (text imports and reference PDFs)
// ---------------------------------------------------------------------------
export type UploadBegin =
  | { ok: true; id: string; path: string; token: string; supabaseUrl: string; publishableKey: string; contentType: string }
  | { ok: false; message: string };

export async function beginTextImport(input: { translationId: string; name: string; size: number; clientKey: string }): Promise<UploadBegin> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const config = getSupabasePublicConfig();
  const supabase = await createClient();
  if (!supabase || !config) return { ok: false, message: UNAVAILABLE };
  const format = formatFromName(input.name);
  if (!format) return { ok: false, message: "Upload a .csv, .tsv, or verse-per-line .txt file." };
  if (!uuid.safeParse(input.translationId).success || !uuid.safeParse(input.clientKey).success) return { ok: false, message: "That upload request wasn't valid." };
  if (input.size < 1 || input.size > MAX_TEXT_BYTES) return { ok: false, message: "The file must be smaller than 50 MB." };
  const { data, error } = await supabase.rpc("bible_admin_import_begin", {
    p_translation: input.translationId,
    p_format: format,
    p_name: input.name.slice(0, 200),
    p_size: input.size,
    p_client_key: input.clientKey,
  });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The upload couldn't be started.") };
  const begun = data as { id: string; path: string };
  const token = await bibleUploadToken(supabase, begun.path);
  if (!token) return { ok: false, message: "Storage didn't accept the upload. Try again in a moment." };
  const contentType = format === "csv" ? "text/csv" : format === "tsv" ? "text/tab-separated-values" : "text/plain";
  return { ok: true, id: begun.id, path: begun.path, token, supabaseUrl: config.url, publishableKey: config.publishableKey, contentType };
}

/** Reads the uploaded file back, parses it, and stages every line for review. */
export async function processTextImport(importId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const supabase = await createClient();
  if (!supabase || !uuid.safeParse(importId).success) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("bible_admin_import_processing", { p_id: importId });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "This import can't be processed now.") };
  const imp = data as { path: string; format: "csv" | "tsv" | "vpl" };
  const fail = async (message: string) => {
    await supabase.rpc("bible_admin_import_finish", { p_id: importId, p_error: message });
    return { ok: false as const, message };
  };
  const bytes = await downloadBibleObject(supabase, imp.path, MAX_TEXT_BYTES);
  if (!bytes) return fail("The uploaded file couldn't be read back (missing or too large).");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("The file isn't UTF-8 text. Save it as UTF-8 and upload it again.");
  }
  let rows;
  try {
    rows = parseSourceFile(text, imp.format);
  } catch (e) {
    return fail(e instanceof CsvError ? `${e.message}${e.line ? ` (line ${e.line})` : ""}` : "The file couldn't be read.");
  }
  if (!rows.length) return fail("The file has no verses.");
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error: stageError } = await supabase.rpc("bible_admin_import_stage", { p_id: importId, p_rows: rows.slice(i, i + BATCH) });
    if (stageError) return fail("Staging stopped part way. Nothing was published; upload the file again.");
  }
  const { error: finishError } = await supabase.rpc("bible_admin_import_finish", { p_id: importId, p_error: null });
  if (finishError) return { ok: false, message: dbErrorMessage(finishError) };
  revalidatePath("/admin/bible/sources", "layout");
  return { ok: true };
}

export async function acceptLinesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const id = uuid.safeParse(formData.get("import_id")).data;
  if (!id) return errorState("Import not found.");
  const lines = formData.getAll("line").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5000);
  if (!lines.length) return errorState("Select at least one line.");
  const accept = formData.get("accept") === "1";
  const { error } = await rpc("bible_admin_import_accept", { p_id: id, p_lines: lines, p_accept: accept });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath(`/admin/bible/sources/imports/${id}`);
  return { status: "success", message: accept ? `Accepted ${lines.length} line${lines.length > 1 ? "s" : ""}.` : "Undone." };
}

export async function publishImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const id = uuid.safeParse(formData.get("import_id")).data;
  if (!id) return errorState("Import not found.");
  const { data, error } = await rpc("bible_admin_import_publish", {
    p_id: id,
    p_confirm: str(formData, "confirm"),
    p_acknowledge_missing: formData.get("acknowledge_missing") === "on",
    p_note: str(formData, "note") || null,
  });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin/bible", "layout");
  revalidatePath("/bible", "layout");
  const r = data as { verses: number; plan_passage_problems: number };
  return {
    status: "success",
    message: `Published ${r.verses.toLocaleString("en-US")} verses.${r.plan_passage_problems ? ` ${r.plan_passage_problems} plan passages no longer match this text; check those plans.` : ""}`,
  };
}

export async function discardImportAction(formData: FormData) {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const id = uuid.safeParse(formData.get("import_id")).data;
  const supabase = await createClient();
  if (!id || !supabase) return;
  const { data, error } = await supabase.rpc("bible_admin_import_discard", { p_id: id });
  if (!error && (await removeBibleObjects(supabase, [(data as { path: string }).path]))) {
    await supabase.rpc("bible_admin_objects_deleted", { p_kind: "import", p_id: id });
  }
  revalidatePath("/admin/bible/sources", "layout");
  redirect("/admin/bible/sources");
}

export async function beginReferenceUpload(input: {
  name: string;
  size: number;
  type: string;
  clientKey: string;
  translationLabel: string;
  source: string;
  attribution: string;
  rightsStatement: string;
  confirmRights: boolean;
}): Promise<UploadBegin> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const config = getSupabasePublicConfig();
  const supabase = await createClient();
  if (!supabase || !config) return { ok: false, message: UNAVAILABLE };
  if (!/\.pdf$/i.test(input.name)) return { ok: false, message: "Choose a PDF file." };
  if (input.size < 1 || input.size > PDF_MAX_BYTES) return { ok: false, message: "The PDF must be smaller than 50 MB." };
  if (!input.translationLabel.trim() || !input.source.trim()) return { ok: false, message: "Enter the translation name and where the file came from." };
  if (input.rightsStatement.trim().length < 10) return { ok: false, message: "Describe the permission the church has for this file." };
  if (!uuid.safeParse(input.clientKey).success) return { ok: false, message: "That upload request wasn't valid." };
  const { data, error } = await supabase.rpc("bible_admin_reference_begin", {
    p: {
      translation_label: input.translationLabel.slice(0, 120),
      source: input.source.slice(0, 300),
      attribution: input.attribution.slice(0, 1000),
      rights_statement: input.rightsStatement.slice(0, 2000),
      confirm_rights: input.confirmRights,
      name: input.name.slice(0, 200),
      size: input.size,
    },
    p_client_key: input.clientKey,
  });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The upload couldn't be started.") };
  const begun = data as { id: string; path: string };
  const token = await bibleUploadToken(supabase, begun.path);
  if (!token) return { ok: false, message: "Storage didn't accept the upload. Try again in a moment." };
  return { ok: true, id: begun.id, path: begun.path, token, supabaseUrl: config.url, publishableKey: config.publishableKey, contentType: "application/pdf" };
}

/** Checks the uploaded PDF (signature, size, pages, text layer). No text is extracted. */
export async function processReference(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const supabase = await createClient();
  if (!supabase || !uuid.safeParse(id).success) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("bible_admin_reference_processing", { p_id: id });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "This file can't be processed now.") };
  const path = (data as { path: string }).path;
  const bytes = await downloadBibleObject(supabase, path, PDF_MAX_BYTES);
  let result: { pages: number; textLayer: string } | null = null;
  let message: string | null = null;
  if (!bytes) message = "The uploaded file couldn't be read back.";
  else {
    try {
      result = await inspectPdf(bytes);
    } catch (e) {
      message = e instanceof PdfError ? e.message : "The PDF couldn't be read.";
    }
  }
  await supabase.rpc("bible_admin_reference_complete", { p_id: id, p_pages: result?.pages ?? null, p_text_layer: result?.textLayer ?? null, p_error: message });
  if (message) await removeBibleObjects(supabase, [path]);
  revalidatePath("/admin/bible/sources");
  return message ? { ok: false, message } : { ok: true };
}

export async function removeReferenceAction(formData: FormData) {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const id = uuid.safeParse(formData.get("id")).data;
  const supabase = await createClient();
  if (!id || !supabase) return;
  const { data, error } = await supabase.rpc("bible_admin_reference_remove", { p_id: id });
  if (!error && (await removeBibleObjects(supabase, [(data as { path: string }).path]))) {
    await supabase.rpc("bible_admin_objects_deleted", { p_kind: "reference", p_id: id });
  }
  revalidatePath("/admin/bible/sources");
}
