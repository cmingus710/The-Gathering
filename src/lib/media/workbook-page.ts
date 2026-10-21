import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveText } from "@/lib/bible/source";
import type { PassagePayload, Translation, Verse } from "@/lib/bible/types";
import { signPaths } from "./storage";
import { scripturePassages, type Workbook, type WorkbookBlock } from "./workbook";

/**
 * Scripture text for one block, from the member's Bible version (their
 * preference, else the church default). Text comes from the database or the
 * licensed provider through resolveText on the server; nothing is ever
 * substituted. A passage longer than the translation allows on one page,
 * or one that can't be read, is shown as the reference with a link to the
 * Bible reader instead.
 */
export type BlockScripture =
  | { status: "ok"; translation: Translation; passages: Array<{ label: string; verses: Verse[]; book: string; chapter: number; multiChapter: boolean }>; fumsIds: string[]; copyright: string | null }
  | { status: "unavailable"; reason: string; link: string | null };

export type WorkbookPage = {
  workbook: Workbook;
  scripture: Record<string, BlockScripture>;
  urls: Map<string, string>;
  /** Versions whose text is shown (for attribution). */
  translations: Translation[];
  fums: string[];
};

const READER = (code: string, book: string, chapter: number) => `/bible/read/${code}/${book}/${chapter}`;

async function blockScripture(supabase: SupabaseClient, b: WorkbookBlock, translation: Translation | null): Promise<BlockScripture> {
  const passages = scripturePassages(b.scripture_ref);
  if (!translation) return { status: "unavailable", reason: "No Bible version is set up yet.", link: null };
  if (!passages) return { status: "unavailable", reason: "This reference can't be shown as text here.", link: "/bible" };
  const link = READER(translation.code, passages[0].book, passages[0].sc);
  const out: Extract<BlockScripture, { status: "ok" }>["passages"] = [];
  const fumsIds: string[] = [];
  let copyright: string | null = null;
  let total = 0;
  for (const p of passages) {
    const { data, error } = await supabase.rpc("bible_passage", { p_translation: translation.id, p_book: p.book, p_sc: p.sc, p_sv: p.sv, p_ec: p.ec, p_ev: p.ev });
    if (error || !data) {
      const tooLong = error?.code === "22023" && /longer than/i.test(error.message ?? "");
      return {
        status: "unavailable",
        reason: tooLong ? `This passage is longer than ${translation.code} allows on one page.` : "This passage isn't available in your Bible version.",
        link,
      };
    }
    const payload = data as PassagePayload;
    const text = await resolveText(payload.translation, payload.verses, payload.provider, { book: p.book, sc: p.sc, sv: p.sv, ec: p.ec, ev: p.ev });
    if (text.status !== "ok") {
      return { status: "unavailable", reason: "The scripture source isn't available right now. Nothing else is shown in its place.", link };
    }
    total += text.verses.length;
    // The per-view limit applies to the whole block, whatever the source.
    if (total > translation.max_verses_per_view) {
      return { status: "unavailable", reason: `This passage is longer than ${translation.code} allows on one page.`, link };
    }
    if (text.fumsId) fumsIds.push(text.fumsId);
    if (text.copyright && text.copyright !== translation.copyright) copyright = text.copyright;
    out.push({ label: payload.label, verses: text.verses, book: p.book, chapter: p.sc, multiChapter: p.ec !== p.sc });
  }
  return { status: "ok", translation, passages: out, fumsIds, copyright };
}

/**
 * Loads a workbook for its page: the member's own (p_preview false) or the
 * editor's preview of the member projection (p_preview true). Returns null
 * when it isn't available to the caller.
 */
export async function loadWorkbookPage(supabase: SupabaseClient, itemId: string, preview: boolean): Promise<WorkbookPage | { error: string; code?: string } | null> {
  const { data, error } = await supabase.rpc("media_lesson_workbook", { p_item: itemId, p_preview: preview });
  if (error?.code === "P0002") return null;
  if (error) return { error: error.code === "42501" ? "Workbooks are for approved adult members." : "This workbook couldn't be loaded right now.", code: error.code };
  const workbook = data as Workbook;

  const scriptureBlocks = workbook.blocks.filter((b) => b.kind === "scripture");
  let translation: Translation | null = null;
  if (scriptureBlocks.length) {
    const { data: list } = await supabase.rpc("bible_translations");
    const v = (list as { default_id: string | null; preferred_id: string | null; items: Translation[] } | null) ?? { default_id: null, preferred_id: null, items: [] };
    translation = v.items.find((t) => t.id === v.preferred_id) ?? v.items.find((t) => t.id === v.default_id) ?? v.items[0] ?? null;
  }
  const scripture: Record<string, BlockScripture> = {};
  await Promise.all(
    scriptureBlocks.map(async (b) => {
      scripture[b.id] = await blockScripture(supabase, b, translation);
    }),
  );
  const urls = await signPaths(
    supabase,
    workbook.blocks.flatMap((b) => (b.kind === "image" && b.asset ? [b.asset.variant_path ?? b.asset.path] : [])),
  );
  const fums = Object.values(scripture).flatMap((s) => (s.status === "ok" ? s.fumsIds : []));
  const shown = translation && Object.values(scripture).some((x) => x.status === "ok") ? [translation] : [];
  return { workbook, scripture, urls, translations: shown, fums };
}
