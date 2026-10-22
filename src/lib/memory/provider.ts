import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiBiblePassageId } from "@/lib/bible/api-bible";
import { resolveText, type Fetcher } from "@/lib/bible/source";
import type { ProviderConfig, Translation, Verse } from "@/lib/bible/types";

/**
 * Memory verses in licensed API versions (migration 20261106000100). The
 * text is fetched here, on the server, through the existing API.Bible
 * integration (its in-memory cache only while unexpired), shown unchanged,
 * and never sent to the database: the database keeps the reference, the
 * passage ID, verse numbers, a word count, and a one-way fingerprint of the
 * exact wording. The fingerprint keeps a practice session on the wording the
 * member added, and shows when the source wording changed.
 *
 * Nothing here logs or stores the text; callers render it and drop it.
 */
export type Ref = { book: string; sc: number; sv: number; ec: number; ev: number };

/** What the database keeps for a licensed passage (no text). */
export type ProviderPayload = { fingerprint: string; verses: Array<[number, number]>; words: number; passage_id: string };

export type MemoryText =
  | { status: "stored" }
  | {
      status: "ok";
      translation: Translation;
      verses: Verse[];
      copyright: string | null;
      fumsId: string | null;
      payload: ProviderPayload;
    }
  | { status: "problem"; message: string }
  | { status: "unavailable"; message: string };

/**
 * One-way fingerprint of the exact wording: SHA-256 over "chapter:verse<TAB>text"
 * lines of the verses that have text. It can't be turned back into the text.
 */
export function fingerprintVerses(verses: Verse[]): string {
  const lines = verses
    .filter((v) => !v.o && v.t.trim())
    .map((v) => `${v.c}:${v.v}\t${v.t.normalize("NFC")}\n`)
    .join("");
  return createHash("sha256").update(lines, "utf8").digest("hex");
}

export function providerPayload(verses: Verse[], ref: Ref): ProviderPayload {
  const present = verses.filter((v) => !v.o && v.t.trim());
  return {
    fingerprint: fingerprintVerses(verses),
    verses: present.map((v) => [v.c, v.v]),
    words: present.reduce((n, v) => n + v.t.trim().split(/\s+/).length, 0),
    passage_id: apiBiblePassageId(ref.book, ref.sc, ref.sv, ref.ec, ref.ev),
  };
}

export function unavailableMessage(code: string): string {
  return `${code} is temporarily unavailable for memory practice. Try again later; no other version is used instead.`;
}

/**
 * The passage's text for a licensed version, fetched on the server.
 * "stored" for a stored-text version (the database has its text).
 */
export async function fetchMemoryText(supabase: SupabaseClient, translationId: string, ref: Ref, fetcher?: Fetcher): Promise<MemoryText> {
  const { data, error } = await supabase.rpc("bible_passage", {
    p_translation: translationId,
    p_book: ref.book,
    p_sc: ref.sc,
    p_sv: ref.sv,
    p_ec: ref.ec,
    p_ev: ref.ev,
  });
  if (error) {
    return error.code === "22023" || error.code === "P0002"
      ? { status: "problem", message: error.message }
      : { status: "unavailable", message: "Memory practice is unavailable right now. Try again later." };
  }
  const passage = data as { translation: Translation; provider: ProviderConfig | null } | null;
  if (!passage) return { status: "unavailable", message: "Memory practice is unavailable right now. Try again later." };
  if (passage.translation.source_kind !== "api") return { status: "stored" };
  const text = await resolveText(passage.translation, null, passage.provider, ref, fetcher);
  if (text.status !== "ok") return { status: "unavailable", message: unavailableMessage(passage.translation.code) };
  const payload = providerPayload(text.verses, ref);
  if (!payload.verses.length) return { status: "problem", message: `${passage.translation.code} has no text for that passage.` };
  if (payload.verses.length > 30) return { status: "problem", message: "Choose at most 30 verses for memory practice." };
  if (payload.words > 900) return { status: "problem", message: "That passage is too long for memory practice. Choose fewer verses." };
  return { status: "ok", translation: passage.translation, verses: text.verses, copyright: text.copyright, fumsId: text.fumsId, payload };
}

/** Verse numbers ("3:16") one list has and the other doesn't. */
export function verseDifferences(current: Array<[number, number]>, next: Array<[number, number]>) {
  const key = ([c, v]: [number, number]) => `${c}:${v}`;
  const a = new Set(current.map(key));
  const b = new Set(next.map(key));
  return { only_current: [...a].filter((x) => !b.has(x)), only_new: [...b].filter((x) => !a.has(x)) };
}
