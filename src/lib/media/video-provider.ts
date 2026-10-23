import "server-only";
import type { ProviderStatus } from "./types";
import type { VideoRef } from "./embeds";
import { safeFetch, SafeFetchError } from "./safe-fetch";

/**
 * Server-side calls to YouTube and Vimeo for library videos: thumbnails
 * (fetched by the app server and passed on after an access check, so a
 * member's browser contacts the provider only when they press Play) and
 * oEmbed availability checks. Only fixed provider hosts are contacted, built
 * from parsed identifiers; nothing is downloaded except the thumbnail image,
 * and video files are never fetched or re-hosted.
 */

const THUMB_MAX_BYTES = 1024 * 1024;
const THUMB_TYPES = new Set(["image/jpeg", "image/webp", "image/png"]);
const THUMB_TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;

type Thumb = { body: Buffer; type: string };
const cache = new Map<string, { at: number; thumb: Thumb | null }>();

/** YouTube serves stills for every public, unlisted, or embeddable video by ID. */
export function youtubeThumbCandidates(id: string): string[] {
  return [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`];
}

/** Vimeo thumbnails come from oEmbed; only its image host is accepted. */
export function vimeoThumbUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 500) return null;
  try {
    const url = new URL(input);
    return url.protocol === "https:" && url.hostname === "i.vimeocdn.com" && !url.username && !url.password && !url.port ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<Thumb | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 6000, maxBytes: THUMB_MAX_BYTES, maxRedirects: 1 });
    const type = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (res.status !== 200 || !THUMB_TYPES.has(type) || !res.body.length) return null;
    return { body: res.body, type };
  } catch {
    return null;
  }
}

/** The video's thumbnail, or null when the provider has none (callers show a plain placeholder). */
export async function videoThumbnail(provider: "youtube" | "vimeo", ref: string, vimeoThumb: string | null): Promise<Thumb | null> {
  const key = `${provider}:${ref}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.thumb ? THUMB_TTL_MS : MISS_TTL_MS)) return hit.thumb;
  let thumb: Thumb | null = null;
  if (provider === "youtube") {
    for (const url of youtubeThumbCandidates(ref)) {
      thumb = await fetchImage(url);
      if (thumb) break;
    }
  } else {
    const url = vimeoThumbUrl(vimeoThumb);
    thumb = url ? await fetchImage(url) : null;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), thumb });
  return thumb;
}

export type VideoCheck = { status: ProviderStatus; title: string | null; thumb: string | null };

/** oEmbed endpoint for a parsed reference (never a user-supplied URL). */
export function oembedUrl(ref: VideoRef): string {
  if (ref.provider === "youtube") {
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ref.id}`)}`;
  }
  const page = ref.hash ? `https://vimeo.com/${ref.id}/${ref.hash}` : `https://vimeo.com/${ref.id}`;
  return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(page)}`;
}

/** Maps an oEmbed HTTP status: 401/403 mean the owner blocks embedding (or it's private); 400/404 mean it's gone. */
export function statusFromHttp(status: number): ProviderStatus {
  if (status === 200) return "ok";
  if (status === 401 || status === 403) return "not_embeddable";
  if (status === 400 || status === 404) return "unavailable";
  return "error";
}

/** Asks the provider whether the video can be embedded, and its title. Network trouble is "error", never "unavailable". */
export async function checkVideo(ref: VideoRef): Promise<VideoCheck> {
  try {
    const res = await safeFetch(oembedUrl(ref), { timeoutMs: 6000, maxBytes: 64 * 1024, maxRedirects: 2, headers: { accept: "application/json" } });
    const status = statusFromHttp(res.status);
    if (status !== "ok") return { status, title: null, thumb: null };
    const data = JSON.parse(res.body.toString("utf8")) as { title?: unknown; thumbnail_url?: unknown };
    const title = typeof data.title === "string" ? data.title.trim().slice(0, 160) || null : null;
    return { status, title, thumb: ref.provider === "vimeo" ? vimeoThumbUrl(data.thumbnail_url) : null };
  } catch (error) {
    if (error instanceof SafeFetchError && error.code === "http" && error.status) return { status: statusFromHttp(error.status), title: null, thumb: null };
    return { status: "error", title: null, thumb: null };
  }
}
