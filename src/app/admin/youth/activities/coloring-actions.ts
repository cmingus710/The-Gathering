"use server";

import { revalidatePath } from "next/cache";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { plainText } from "@/lib/youth/activities";
import { ART_SOURCE_KINDS, checkTemplate, type ArtSourceKind, type Attribution, type ColoringTemplate } from "@/lib/youth/coloring";
import { COLORING_DEMOS, DEMO_CREDIT, DEMO_TITLE_PREFIX } from "@/lib/youth/coloring-demos";
import { SVG_MAX_BYTES, checkColoringSvg } from "@/lib/youth/coloring-svg";

/**
 * Coloring pictures in the activity editor (youth.activities). An uploaded
 * SVG is checked here and only its rebuilt geometry is sent to the database
 * (which checks it again); the file itself is never stored. Ordinary line
 * art is uploaded through the artwork pipeline and used as a freehand-only
 * picture. Nothing here publishes anything.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const id = (fd: FormData, k: string) => (UUID.test(str(fd, k)) ? str(fd, k) : null);

async function guard() {
  await requireCapability(CAPABILITIES.youthActivities, "/admin/youth/activities");
  return createClient();
}

function refresh(activity?: string | null) {
  revalidatePath("/admin/youth/activities", "layout");
  if (activity) revalidatePath(`/youth/play/${activity}`);
}

const story = (fd: FormData) => plainText(str(fd, "story"), 1500, true);

function attributionFrom(fd: FormData): Attribution | string {
  const kind = str(fd, "source_kind");
  if (!ART_SOURCE_KINDS.includes(kind as ArtSourceKind)) return "Choose where the artwork came from.";
  const credit = plainText(str(fd, "source_credit"), 300);
  if (kind !== "original" && !credit) return "Name the artist or source for artwork that isn't original.";
  const url = str(fd, "source_url").trim();
  if (url && !/^https:\/\/[^\s<>"]+$/.test(url)) return "The source link must start with https://.";
  return { source_kind: kind as ArtSourceKind, credit, license: plainText(str(fd, "license"), 300), source_url: url || null };
}

export type ColoringCheckState = FormState & { errors?: string[]; warnings?: string[]; template?: ColoringTemplate };

/** Step 1: check an uploaded SVG and return the rebuilt picture for preview (nothing is saved). */
export async function checkColoringSvgAction(_prev: ColoringCheckState, fd: FormData): Promise<ColoringCheckState> {
  await guard();
  const values = formValues(fd);
  if (!id(fd, "activity")) return errorState("That activity wasn't found.");
  if (fd.get("rights_confirmed") !== "on") return errorState("Confirm the church may use this artwork.", { values });
  const attribution = attributionFrom(fd);
  if (typeof attribution === "string") return errorState(attribution, { values });
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return errorState("Choose an SVG file to check.", { values });
  if (file.size > SVG_MAX_BYTES) return errorState(`The SVG must be ${Math.round(SVG_MAX_BYTES / 1024)} KB or smaller.`, { values });
  const result = checkColoringSvg(new Uint8Array(await file.arrayBuffer()), { story: story(fd), attribution });
  if (!result.ok) return { status: "error", message: "This SVG can't be used as a tap-to-fill coloring picture.", errors: result.errors, values };
  return {
    status: "success",
    message: `Checked: ${result.template.regions.length} fillable ${result.template.regions.length === 1 ? "part" : "parts"}. Review the preview, then use it for the draft.`,
    warnings: result.warnings,
    template: result.template,
    values,
  };
}

async function setColoring(activity: string, template: ColoringTemplate | null): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Activities are unavailable right now. Nothing was changed.");
  const { data, error } = await supabase.rpc("youth_admin_activity_coloring_set", { p_id: activity, p_coloring: template });
  if (error) return errorState(dbErrorMessage(error, "The coloring picture couldn't be saved. Nothing was changed."));
  refresh(activity);
  const v = (data as { version?: number } | null)?.version;
  return {
    status: "success",
    message: template ? `Coloring picture saved to draft version ${v}. Members see it only once you publish.` : `Coloring picture removed from draft version ${v}.`,
  };
}

/** Step 2: save the checked picture to the draft (checked again here and in the database). */
export async function saveColoringTemplateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await guard();
  const activity = id(fd, "activity");
  if (!activity) return errorState("That activity wasn't found.");
  let raw: unknown;
  try {
    raw = JSON.parse(str(fd, "template"));
  } catch {
    return errorState("Check the SVG again, then save it.");
  }
  const t = checkTemplate(raw);
  if (!t.ok || t.value.mode !== "regions") return errorState(t.ok ? "Check the SVG again, then save it." : `The coloring picture ${t.problem}.`);
  return setColoring(activity, t.value);
}

/** Uses uploaded line art (a re-encoded image) as a freehand-only picture. */
export async function setLineArtAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Activities are unavailable right now. Nothing was changed.");
  const activity = id(fd, "activity");
  const asset = id(fd, "asset");
  if (!activity) return errorState("That activity wasn't found.");
  if (!asset) return errorState("Choose the line art to use.");
  if (fd.get("freehand_ok") !== "on") return errorState("Confirm you understand this picture is freehand-only.");
  const { data, error } = await supabase.rpc("youth_admin_activity", { p_id: activity });
  if (error) return errorState(dbErrorMessage(error, "The activity couldn't be loaded."));
  const a = data as { assets: Array<{ id: string; width: number; height: number; source_kind: ArtSourceKind; source_credit: string; license: string; source_url: string | null }> };
  const x = a.assets.find((y) => y.id === asset);
  if (!x || !x.width || !x.height) return errorState("That artwork wasn't found. Upload it under Artwork first.");
  const k = 1000 / Math.max(x.width, x.height);
  const template: ColoringTemplate = {
    format: 1,
    mode: "freehand",
    width: Math.max(100, Math.round(x.width * k)),
    height: Math.max(100, Math.round(x.height * k)),
    regions: [],
    lines: [],
    line_art_asset_id: x.id,
    story: story(fd),
    // The artwork's own recorded source, so its attribution travels with the picture.
    attribution: { source_kind: x.source_kind, credit: x.source_credit, license: x.license, source_url: x.source_url },
  };
  const t = checkTemplate(template);
  if (!t.ok) return errorState(`The coloring picture ${t.problem}.`);
  return setColoring(activity, t.value);
}

export async function removeColoringAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const activity = id(fd, "activity");
  if (!activity) return errorState("That activity wasn't found.");
  return setColoring(activity, null);
}

/**
 * Adds the demonstration pictures as unpublished drafts (skipping any whose
 * draft already exists). Editors review, change, or archive them; nothing is
 * published.
 */
export async function createDemoDraftsAction(): Promise<FormState> {
  const supabase = await guard();
  if (!supabase) return errorState("Activities are unavailable right now. Nothing was changed.");
  const { data: list, error: listError } = await supabase.rpc("youth_admin_activities", { p_status: null });
  if (listError) return errorState(dbErrorMessage(listError, "The activities couldn't be loaded. Nothing was changed."));
  const existing = new Set(((list ?? []) as Array<{ title: string }>).map((a) => a.title));
  let made = 0;
  for (const demo of COLORING_DEMOS) {
    const title = `${DEMO_TITLE_PREFIX}${demo.title}`;
    if (existing.has(title)) continue;
    const checked = checkColoringSvg(demo.svg, { story: demo.story, attribution: { source_kind: "original", credit: DEMO_CREDIT, license: "", source_url: null } });
    if (!checked.ok) return errorState(`The demonstration picture "${demo.title}" didn't pass the checks: ${checked.errors[0]}`);
    const { data, error } = await supabase.rpc("youth_admin_activity_save", {
      p_id: null,
      p: {
        title,
        summary: demo.summary,
        description: "A demonstration coloring picture. Review the artwork, the story summary, and the Scripture references before publishing.",
        kind: "drawing",
        difficulty: "beginner",
        age_min: demo.age_min,
        age_max: demo.age_max,
        bible_story: demo.bible_story,
        scripture_refs: demo.scripture_refs,
        content_source: "original",
        content_credit: DEMO_CREDIT,
        change_note: "Demonstration draft",
      },
    });
    if (error) return errorState(dbErrorMessage(error, `"${demo.title}" couldn't be created.${made ? ` ${made} other demonstration drafts were added.` : ""}`));
    const { error: setError } = await supabase.rpc("youth_admin_activity_coloring_set", { p_id: (data as { id: string }).id, p_coloring: checked.template });
    if (setError) return errorState(dbErrorMessage(setError, `"${demo.title}" was created, but its picture couldn't be added.`));
    made++;
  }
  refresh();
  return made
    ? { status: "success", message: `Added ${made} demonstration ${made === 1 ? "draft" : "drafts"}. They're unpublished: review each one before publishing.` }
    : { status: "success", message: "The demonstration drafts are already here." };
}
