"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { zonedLocalToUtc } from "@/lib/time";
import { isActivityKind, isDifficulty, parseScriptureRefs, plainText } from "@/lib/youth/activities";
import { YOUTH_BUCKET, processActivityArt, signActivityArt } from "@/lib/youth/activity-art";
import { compactConfig, parseGameConfig } from "@/lib/youth/games/config";
import { DEMO_ACTIVITIES } from "@/lib/youth/games/demos";

/**
 * Learn & Play administration (youth.activities). The database rechecks the
 * capability, validates and sanitizes every field, and keeps published
 * versions immutable; this file only shapes form fields and handles the
 * artwork file. Nothing here logs activity content.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const id = (fd: FormData, k: string) => (UUID.test(str(fd, k)) ? str(fd, k) : null);

async function guard() {
  await requireCapability(CAPABILITIES.youthActivities, "/admin/youth/activities");
  const supabase = await createClient();
  return supabase;
}

function refresh(activity?: string | null) {
  revalidatePath("/admin/youth/activities", "layout");
  if (activity) revalidatePath(`/youth/play/${activity}`);
  revalidatePath("/youth", "layout");
}

function ageField(v: string): number | "" | null {
  if (v.trim() === "") return "";
  const n = Number(v);
  return Number.isInteger(n) && n >= 2 && n <= 18 ? n : null;
}

/** The editor's fields as the database expects them (see youth.activity_content). */
async function contentFrom(fd: FormData): Promise<Record<string, unknown> | string> {
  const kind = str(fd, "kind");
  const difficulty = str(fd, "difficulty");
  if (!plainText(str(fd, "title"), 120)) return "Give the activity a title.";
  if (!isActivityKind(kind)) return "Choose an activity type.";
  if (!isDifficulty(difficulty)) return "Choose a difficulty.";
  const ageMin = ageField(str(fd, "age_min"));
  const ageMax = ageField(str(fd, "age_max"));
  if (ageMin === null || ageMax === null) return "Suggested ages must be whole numbers from 2 to 18.";
  const week = str(fd, "lesson_week");
  const { settings } = await getChurchSettings();
  const when = (k: string) => {
    const v = str(fd, k).trim();
    if (!v) return { ok: true as const, value: "" };
    const d = zonedLocalToUtc(v, settings.timezone);
    return d ? { ok: true as const, value: d.toISOString() } : { ok: false as const };
  };
  const from = when("available_from");
  const until = when("available_until");
  if (!from.ok || !until.ok) return "Enter the availability dates in full.";
  // The game editor's fields arrive as one value; it is reshaped here and checked again in the database.
  let config: Record<string, unknown> = {};
  const rawGame = str(fd, "game_config");
  if (rawGame) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawGame);
    } catch {
      return "The game's scenes or pairs couldn't be read. Reload the page and try again.";
    }
    const game = parseGameConfig(kind, parsed);
    if (game) config = compactConfig(game);
  }
  return {
    title: plainText(str(fd, "title"), 120),
    summary: plainText(str(fd, "summary"), 300),
    // Markdown: kept as written (minus control characters); rendered with raw HTML escaped.
    description: plainText(str(fd, "description"), 8000, true),
    kind,
    difficulty,
    age_min: ageMin,
    age_max: ageMax,
    bible_story: plainText(str(fd, "bible_story"), 160),
    scripture_refs: parseScriptureRefs(str(fd, "scripture_refs")),
    lesson_title: plainText(str(fd, "lesson_title"), 160),
    lesson_week: /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : "",
    cover_asset_id: id(fd, "cover_asset_id") ?? "",
    cover_alt: plainText(str(fd, "cover_alt"), 300),
    cover_decorative: fd.get("cover_decorative") === "on",
    content_source: str(fd, "content_source") || "original",
    content_credit: plainText(str(fd, "content_credit"), 500),
    change_note: plainText(str(fd, "change_note"), 300),
    available_from: from.value,
    available_until: until.value,
    config,
  };
}

export async function saveActivityAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Activities are unavailable right now. Nothing was changed.");
  const values = formValues(fd);
  const content = await contentFrom(fd);
  if (typeof content === "string") return errorState(content, { values });
  const existing = id(fd, "id");
  const { data, error } = await supabase.rpc("youth_admin_activity_save", { p_id: existing, p: content });
  if (error) return errorState(dbErrorMessage(error, "The activity couldn't be saved. Nothing was changed."), { values });
  const saved = data as { id: string; version: number };
  const groups = fd.getAll("groups").map(String).filter((g) => UUID.test(g));
  const { error: groupError } = await supabase.rpc("youth_admin_activity_groups_set", { p_id: saved.id, p_groups: groups });
  refresh(saved.id);
  if (!existing) redirect(`/admin/youth/activities/${saved.id}?created=1`);
  if (groupError) return errorState(dbErrorMessage(groupError, "The draft was saved, but the groups couldn't be changed."), { values });
  return { status: "success", message: `Draft version ${saved.version} saved. Members still see the published version until you publish.` };
}

const STATUS_MESSAGES: Record<string, string> = {
  ready: "Marked ready for preview. Members still can't see it.",
  unready: "Back to draft.",
  publish: "Published. Members who may play it see this version now; earlier progress stays with the version it was made on.",
  archive: "Archived. Members no longer see it; versions and progress are kept.",
  restore: "Restored.",
  discard_draft: "Unpublished changes discarded.",
};

export async function activityStatusAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Activities are unavailable right now. Nothing was changed.");
  const activity = id(fd, "id");
  const action = str(fd, "action");
  if (!activity || !(action in STATUS_MESSAGES)) return errorState("That action isn't available.");
  if (action === "publish" && fd.get("reviewed") !== "on") return errorState("Confirm you've checked the activity against its Scripture references.");
  const { error } = await supabase.rpc("youth_admin_activity_status", { p_id: activity, p_action: action, p_confirm: str(fd, "confirm").trim() || null });
  if (error) return errorState(dbErrorMessage(error, "That couldn't be changed right now. Nothing was changed."));
  refresh(activity);
  return { status: "success", message: STATUS_MESSAGES[action] };
}

/** Reserve, upload, and finish one artwork from the form's fields; undone if any step fails. */
async function storeArt(supabase: NonNullable<Awaited<ReturnType<typeof guard>>>, activity: string, fd: FormData) {
  if (fd.get("rights_confirmed") !== "on") return { ok: false as const, message: "Confirm the church may use this artwork." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, message: "Choose an image to upload." };
  const art = await processActivityArt(file);
  if (!art.ok) return { ok: false as const, message: art.message };

  const { data: begun, error } = await supabase.rpc("youth_admin_activity_asset_begin", {
    p_activity: activity,
    p: {
      alt: plainText(str(fd, "alt"), 300),
      source_kind: str(fd, "source_kind"),
      source_credit: plainText(str(fd, "source_credit"), 300),
      license: plainText(str(fd, "license"), 300),
      source_url: str(fd, "source_url").trim(),
      rights_confirmed: true,
    },
  });
  if (error) return { ok: false as const, message: dbErrorMessage(error, "The artwork couldn't be saved. Nothing was changed.") };
  const reserved = begun as { id: string; path: string };
  const up = await supabase.storage.from(YOUTH_BUCKET).upload(reserved.path, art.bytes, { contentType: "image/webp", upsert: false, cacheControl: "300" });
  if (up.error) {
    await supabase.rpc("youth_admin_activity_asset_cancel", { p_asset: reserved.id });
    return { ok: false as const, message: "The upload didn't finish. Please try again." };
  }
  const { error: finishError } = await supabase.rpc("youth_admin_activity_asset_finish", {
    p_asset: reserved.id,
    p: { width: art.width, height: art.height, bytes: art.bytes.byteLength },
  });
  if (finishError) {
    await supabase.storage.from(YOUTH_BUCKET).remove([reserved.path]);
    await supabase.rpc("youth_admin_activity_asset_cancel", { p_asset: reserved.id });
    return { ok: false as const, message: dbErrorMessage(finishError, "The artwork couldn't be saved. Nothing was changed.") };
  }
  return { ok: true as const, ...reserved };
}

/**
 * Upload artwork from the editor: re-encode through the media pipeline,
 * reserve the path (recording the description, source, and rights
 * confirmation), upload with the editor's own session (Storage RLS accepts
 * only the reserved path), then mark it ready. Optionally make it the
 * draft's cover.
 */
export async function uploadActivityArtAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Uploads are unavailable right now. Nothing was changed.");
  const values = formValues(fd);
  const activity = id(fd, "activity");
  if (!activity) return errorState("That activity wasn't found.");
  const stored = await storeArt(supabase, activity, fd);
  if (!stored.ok) return errorState(stored.message, { values });
  const reserved = stored;

  if (fd.get("use_as_cover") === "on") {
    const { data: current } = await supabase.rpc("youth_admin_activity", { p_id: activity });
    const a = current as { draft: Record<string, unknown> | null; published: Record<string, unknown> | null; available_from: string | null; available_until: string | null } | null;
    const base = a?.draft ?? a?.published;
    if (base) {
      const { error: coverError } = await supabase.rpc("youth_admin_activity_save", {
        p_id: activity,
        p: { ...base, cover_asset_id: reserved.id, cover_alt: "", available_from: a?.available_from ?? "", available_until: a?.available_until ?? "" },
      });
      refresh(activity);
      if (coverError) return errorState(dbErrorMessage(coverError, "The artwork was uploaded, but it couldn't be set as the cover."));
      return { status: "success", message: "Artwork uploaded and set as the draft's cover. Publish when you're ready." };
    }
  }
  refresh(activity);
  return { status: "success", message: "Artwork uploaded." };
}

export async function updateActivityArtAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Activities are unavailable right now. Nothing was changed.");
  const asset = id(fd, "asset");
  if (!asset) return errorState("That artwork wasn't found.");
  const { error } = await supabase.rpc("youth_admin_activity_asset_update", {
    p_asset: asset,
    p: { alt: plainText(str(fd, "alt"), 300), source_credit: plainText(str(fd, "source_credit"), 300), license: plainText(str(fd, "license"), 300), source_url: str(fd, "source_url").trim() },
  });
  if (error) return errorState(dbErrorMessage(error, "The artwork details couldn't be saved."));
  refresh(id(fd, "activity"));
  return { status: "success", message: "Artwork details saved." };
}

export async function removeActivityArtAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Activities are unavailable right now. Nothing was changed.");
  const asset = id(fd, "asset");
  if (!asset) return errorState("That artwork wasn't found.");
  const { data, error } = await supabase.rpc("youth_admin_activity_asset_remove", { p_asset: asset });
  if (error) return errorState(dbErrorMessage(error, "The artwork couldn't be removed."));
  const path = (data as { path?: string } | null)?.path;
  if (path) await supabase.storage.from(YOUTH_BUCKET).remove([path]);
  refresh(id(fd, "activity"));
  return { status: "success", message: "Artwork removed." };
}

export type GameArtUpload = { ok: true; asset: { id: string; url: string | null; alt: string; source: string } } | { ok: false; message: string };

/**
 * Upload a picture from a scene or pair in the game editor (same pipeline,
 * rights record, and checks as the artwork form). It isn't used anywhere
 * until the draft is saved with it.
 */
export async function uploadGameArtAction(fd: FormData): Promise<GameArtUpload> {
  const supabase = await guard();
  if (!supabase) return { ok: false, message: "Uploads are unavailable right now. Nothing was changed." };
  const activity = id(fd, "activity");
  if (!activity) return { ok: false, message: "Save the draft first, then add pictures." };
  const stored = await storeArt(supabase, activity, fd);
  if (!stored.ok) return stored;
  const url = (await signActivityArt(supabase, [stored.path])).get(stored.path) ?? null;
  refresh(activity);
  return { ok: true, asset: { id: stored.id, url, alt: plainText(str(fd, "alt"), 300), source: str(fd, "source_kind") } };
}

/**
 * Adds the demonstration activities (src/lib/youth/games/demos.ts) as private
 * drafts, skipping any whose title is already in the list. Nothing is
 * published: an editor reviews each against its Scripture references first.
 */
export async function createDemoActivitiesAction(): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Activities are unavailable right now. Nothing was changed.");
  const { data: list, error: listError } = await supabase.rpc("youth_admin_activities", { p_status: null });
  if (listError) return errorState(dbErrorMessage(listError, "Activities couldn't be loaded right now. Nothing was changed."));
  const existing = new Set(((list ?? []) as Array<{ title: string }>).map((a) => a.title));
  let made = 0;
  for (const d of DEMO_ACTIVITIES) {
    if (existing.has(d.title)) continue;
    const content = Object.fromEntries(Object.entries(d).filter(([k]) => k !== "key" && k !== "config"));
    const { error } = await supabase.rpc("youth_admin_activity_save", { p_id: null, p: { ...content, config: compactConfig(d.config) } });
    if (error) return errorState(dbErrorMessage(error, `"${d.title}" couldn't be created.${made ? ` ${made} other demonstration drafts were.` : ""}`));
    made++;
  }
  refresh();
  if (!made) return { status: "success", message: "The demonstration drafts are already in the list." };
  return { status: "success", message: `${made} demonstration ${made === 1 ? "draft" : "drafts"} added. Check each against its Scripture references before publishing.` };
}
