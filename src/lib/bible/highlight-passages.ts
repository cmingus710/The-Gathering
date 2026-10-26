import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HighlightColor } from "./format";
import { textKey, type PassageRef } from "./highlights";
import { resolveText } from "./source";
import type { PassagePayload, Translation, Verse } from "./types";

/**
 * My Journal · Scripture Highlights: the member's highlights grouped into
 * passages (public.bible_highlight_passages, 20261126000100), and each
 * passage's text as available now.
 *
 * Only references and colors are stored. Text comes, when shown, from the
 * same place the reader gets it: stored (published) text from the
 * database, licensed text from API.Bible through resolveText and its
 * permitted in-memory cache. Nothing here stores, logs, or caches text
 * anywhere else; a passage whose text can't load keeps its reference and
 * says so, and no other translation is ever shown in its place.
 */
export type HighlightPassage = {
  key: string;
  translation: { id: string; code: string; name: string; available: boolean };
  book: string;
  book_name: string;
  chapter: number;
  start_verse: number;
  end_verse: number;
  label: string;
  color: HighlightColor;
  created_at: string;
  updated_at: string;
  verses: Array<{ verse: number; revision: number }>;
};

export type HighlightFilters = {
  color?: HighlightColor | null;
  translation_id?: string | null;
  ref?: { book: string; sc?: number | null; sv?: number | null; ec?: number | null; ev?: number | null } | null;
  sort?: "recent" | "bible";
  limit?: number;
  offset?: number;
};

export type HighlightPage = {
  total: number;
  items: HighlightPassage[];
  translations: Array<{ id: string; code: string; name: string }>;
  colors: HighlightColor[];
};


export type PassageText =
  | {
      status: "ok";
      translation: Pick<Translation, "code" | "name" | "attribution" | "copyright" | "source_url" | "allow_copy" | "allow_print">;
      verses: Verse[];
      copyright: string | null;
      fumsId: string | null;
    }
  | { status: "unavailable"; message: string };

export async function loadHighlightPassages(supabase: SupabaseClient, filters: HighlightFilters): Promise<{ ok: true; page: HighlightPage } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("bible_highlight_passages", { p: filters });
  if (error) return { ok: false, message: error.code === "22023" ? error.message : "Your highlights couldn't be loaded right now." };
  return { ok: true, page: data as HighlightPage };
}

async function loadOne(supabase: SupabaseClient, p: PassageRef): Promise<PassageText> {
  const { data, error } = await supabase.rpc("bible_passage", {
    p_translation: p.translation_id,
    p_book: p.book,
    p_sc: p.chapter,
    p_sv: p.start_verse,
    p_ec: p.chapter,
    p_ev: p.end_verse,
  });
  if (error?.code === "P0002") return { status: "unavailable", message: "This translation isn't available any more, so its text can't be shown. Your highlight is kept." };
  if (error) return { status: "unavailable", message: error.code === "22023" ? error.message : "The passage couldn't be loaded right now." };
  const payload = data as PassagePayload;
  const text = await resolveText(payload.translation, payload.verses, payload.provider, { book: p.book, sc: p.chapter, sv: p.start_verse, ec: p.chapter, ev: p.end_verse });
  if (text.status !== "ok") {
    return {
      status: "unavailable",
      message:
        text.reason === "outage"
          ? `${payload.translation.code} isn't responding right now. Try again in a little while; no other translation is shown instead.`
          : `${payload.translation.code} can't be reached from here right now, so its text can't be shown. Your highlight is kept.`,
    };
  }
  return { status: "ok", translation: payload.translation, verses: text.verses, copyright: text.copyright, fumsId: text.fumsId };
}

/** Each passage's text now, a few at a time. */
export async function loadPassageTexts(supabase: SupabaseClient, refs: PassageRef[]): Promise<Record<string, PassageText>> {
  const unique = [...new Map(refs.map((r) => [textKey(r), r])).values()].slice(0, 50);
  const out: Record<string, PassageText> = {};
  for (let i = 0; i < unique.length; i += 5) {
    const batch = unique.slice(i, i + 5);
    const results = await Promise.all(batch.map((r) => loadOne(supabase, r).catch((): PassageText => ({ status: "unavailable", message: "The passage couldn't be loaded right now." }))));
    batch.forEach((r, j) => (out[textKey(r)] = results[j]));
  }
  return out;
}

export function refOf(p: HighlightPassage): PassageRef {
  return { translation_id: p.translation.id, book: p.book, chapter: p.chapter, start_verse: p.start_verse, end_verse: p.end_verse };
}
