import { bookByCode } from "./books";
import type { Verse } from "./types";

/**
 * API.Bible (American Bible Society) adapter: request building and response
 * parsing, kept free of I/O so it can be tested with recorded shapes.
 *
 * Not verified against the live service from this environment (its
 * documentation and API hosts were unreachable here). It follows the
 * published v1 REST shape: GET /v1/bibles/{bibleId}/passages/{passageId}
 * with an `api-key` header, `content-type=text`, verse numbers in the text
 * as "[16]", and `meta.fumsId` for the required usage tracking. Confirm the
 * current base URL, parameters, terms, and FUMS requirements before
 * activating an API translation (docs/bible-sources.md).
 */
export const API_BIBLE_HOSTS = ["rest.api.bible", "api.scripture.api.bible"] as const;
export const API_BIBLE_DEFAULT_BASE = "https://rest.api.bible/v1";

/** "JHN.3.16-JHN.3.21", "PSA.23", "GEN.1-GEN.2". */
export function apiBiblePassageId(book: string, sc: number, sv: number | null, ec: number, ev: number | null): string {
  const start = sv === null ? `${book}.${sc}` : `${book}.${sc}.${sv}`;
  if (sv === null && ev === null && ec === sc) return start;
  const end = ev === null ? `${book}.${ec}` : `${book}.${ec}.${ev}`;
  return `${start}-${end}`;
}

/** The base URL from configuration, only if it is one of the provider's hosts over https. */
export function apiBibleBase(configured: string | undefined): string | null {
  const raw = (configured || API_BIBLE_DEFAULT_BASE).replace(/\/+$/, "");
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    if (!(API_BIBLE_HOSTS as readonly string[]).includes(u.hostname)) return null;
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

export function apiBiblePassageUrl(base: string, bibleId: string, passageId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(bibleId) || !/^[0-9A-Z.\-]{3,40}$/.test(passageId)) throw new Error("Invalid passage request.");
  const params = new URLSearchParams({
    "content-type": "text",
    "include-notes": "false",
    "include-titles": "false",
    "include-chapter-numbers": "false",
    "include-verse-numbers": "true",
    "include-verse-spans": "false",
  });
  return `${base}/bibles/${encodeURIComponent(bibleId)}/passages/${encodeURIComponent(passageId)}?${params}`;
}

export type ApiBibleResult = { verses: Verse[]; copyright: string | null; fumsId: string | null };

/**
 * Splits the provider's text into verses at its "[n]" markers. Chapter
 * numbers follow the requested range: a marker lower than the previous one
 * starts the next chapter. Text is used exactly as returned (whitespace
 * trimmed). Anything unexpected is an error, never a guess.
 */
export function parseApiBiblePassage(json: unknown, book: string, sc: number): ApiBibleResult {
  const data = (json as { data?: { content?: unknown; copyright?: unknown } })?.data;
  const meta = (json as { meta?: { fumsId?: unknown; fumsToken?: unknown } })?.meta;
  if (!data || typeof data.content !== "string") throw new Error("The scripture service returned an unexpected response.");
  if (!bookByCode(book)) throw new Error("Unknown book.");
  const verses: Verse[] = [];
  let chapter = sc;
  let last = 0;
  const re = /\[(\d{1,3})\]\s*([\s\S]*?)(?=\s*\[\d{1,3}\]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(data.content))) {
    const v = Number(m[1]);
    if (v <= last) chapter += 1;
    last = v;
    const t = m[2].replace(/[ \t]+/g, " ").trim();
    verses.push({ c: chapter, v, t, o: t === "", h: null, p: false, q: false });
  }
  if (!verses.length) throw new Error("The scripture service returned no verses.");
  return {
    verses,
    copyright: typeof data.copyright === "string" ? data.copyright : null,
    fumsId: typeof meta?.fumsId === "string" ? meta.fumsId : typeof meta?.fumsToken === "string" ? meta.fumsToken : null,
  };
}
