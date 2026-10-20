import "server-only";
import { safeFetch } from "@/lib/media/safe-fetch";
import { apiBibleBase, apiBiblePassageId, apiBiblePassageUrl, parseApiBiblePassage } from "./api-bible";
import type { ProviderConfig, Translation, Verse } from "./types";

/**
 * Turns a chapter or passage from the database into text to show.
 *
 *   database  verses come with the payload (published, reviewed text)
 *   api       fetched from the licensed provider on the server, with the key
 *             read from the environment variable the translation names
 *             (never sent to the browser, never logged)
 *
 * Outages and misconfiguration return "unavailable" with a reason; nothing
 * is ever substituted (no other translation, no cached text from another
 * translation, no generated text). Caching follows the translation's
 * permission: when allowed, an in-memory copy is kept for at most
 * cache_days on this server instance, keyed by translation and text version;
 * otherwise nothing is kept.
 */
export type TextResult =
  | { status: "ok"; verses: Verse[]; fumsId: string | null; copyright: string | null }
  | { status: "unavailable"; reason: "not_configured" | "outage" | "rejected" };

type Range = { book: string; sc: number; sv: number | null; ec: number; ev: number | null };

const cache = new Map<string, { at: number; ttl: number; value: Extract<TextResult, { status: "ok" }> }>();
const CACHE_MAX = 500;

export type Fetcher = typeof safeFetch;

export async function resolveText(
  translation: Pick<Translation, "id" | "text_version">,
  verses: Verse[] | null,
  provider: ProviderConfig | null,
  range: Range,
  fetcher: Fetcher = safeFetch,
): Promise<TextResult> {
  if (verses) return { status: "ok", verses, fumsId: null, copyright: null };
  if (!provider || provider.provider !== "api_bible") return { status: "unavailable", reason: "not_configured" };
  const key = process.env[provider.credential_env];
  const base = apiBibleBase(process.env.API_BIBLE_BASE_URL);
  if (!key || !base) return { status: "unavailable", reason: "not_configured" };

  const passageId = apiBiblePassageId(range.book, range.sc, range.sv, range.ec, range.ev);
  const cacheKey = `${translation.id}:${translation.text_version}:${passageId}`;
  if (provider.cache_days) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
    if (hit) cache.delete(cacheKey);
  }
  try {
    const res = await fetcher(apiBiblePassageUrl(base, provider.ref, passageId), {
      timeoutMs: 8000,
      maxBytes: 2 * 1024 * 1024,
      maxRedirects: 0,
      headers: { "api-key": key, accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) return { status: "unavailable", reason: "not_configured" };
    if (res.status === 400 || res.status === 404) return { status: "unavailable", reason: "rejected" };
    if (res.status !== 200) return { status: "unavailable", reason: "outage" };
    const parsed = parseApiBiblePassage(JSON.parse(res.body.toString("utf8")), range.book, range.sc);
    const value = { status: "ok" as const, ...parsed };
    if (provider.cache_days) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { at: Date.now(), ttl: provider.cache_days * 86_400_000, value });
    }
    return value;
  } catch {
    // Timeouts, network errors, blocked addresses, and malformed responses
    // alike. Never log the URL, key, or body.
    return { status: "unavailable", reason: "outage" };
  }
}

/** Tests only. */
export function clearTextCache() {
  cache.clear();
}
