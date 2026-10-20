/**
 * Trusted parsing of external media links. Only the providers below are
 * accepted, only from their own hostnames, and only the identifiers are
 * kept: embed URLs are rebuilt from those identifiers, so no arbitrary
 * iframe code, script, or attribute ever comes from an administrator or a
 * feed. Formats follow each provider's official embed documentation
 * (YouTube IFrame Player API, Vimeo Player, Spotify Embeds, Apple Podcasts
 * embed), checked 2026-10-20; see docs/media-limitations.md.
 */

export type VideoRef = { provider: "youtube"; id: string } | { provider: "vimeo"; id: string; hash: string | null };
export type SpotifyKind = "playlist" | "show" | "episode" | "album" | "track";
export type SpotifyRef = { provider: "spotify"; kind: SpotifyKind; id: string };
export type ApplePodcastRef = { provider: "apple"; country: string; slug: string; showId: string; episodeId: string | null };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const VIMEO_HASH = /^[A-Za-z0-9]{6,20}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

function parseUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw || raw.length > 1000) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) return null;
    return url;
  } catch {
    return null;
  }
}

const host = (url: URL) => url.hostname.toLowerCase().replace(/\.$/, "");

export function parseYouTube(input: string): VideoRef | null {
  const url = parseUrl(input);
  if (!url) return null;
  const h = host(url);
  let id: string | null = null;
  if (h === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com"].includes(h)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? { provider: "youtube", id } : null;
}

export function parseVimeo(input: string): VideoRef | null {
  const url = parseUrl(input);
  if (!url) return null;
  const h = host(url);
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  let hash: string | null = url.searchParams.get("h");
  if (h === "player.vimeo.com" && parts[0] === "video") {
    id = parts[1];
  } else if (h === "vimeo.com" || h === "www.vimeo.com") {
    // vimeo.com/<id>, vimeo.com/<id>/<hash> (unlisted), vimeo.com/channels/<name>/<id>
    const idx = parts.findIndex((p) => VIMEO_ID.test(p));
    if (idx >= 0) {
      id = parts[idx];
      if (!hash && parts[idx + 1] && VIMEO_HASH.test(parts[idx + 1])) hash = parts[idx + 1];
    }
  }
  if (!id || !VIMEO_ID.test(id)) return null;
  if (hash && !VIMEO_HASH.test(hash)) hash = null;
  return { provider: "vimeo", id, hash };
}

export function parseVideoUrl(input: string): VideoRef | null {
  return parseYouTube(input) ?? parseVimeo(input);
}

/** open.spotify.com/[intl-xx/]<kind>/<id>, with or without tracking query. */
export function parseSpotify(input: string, allowed: readonly SpotifyKind[] = ["playlist", "show", "episode"]): SpotifyRef | null {
  const url = parseUrl(input);
  if (!url || url.protocol !== "https:" || host(url) !== "open.spotify.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("intl-")) parts.shift();
  if (parts[0] === "embed") parts.shift();
  const [kind, id] = parts as [SpotifyKind | undefined, string | undefined];
  if (!kind || !id || !allowed.includes(kind) || !SPOTIFY_ID.test(id)) return null;
  return { provider: "spotify", kind, id };
}

/** podcasts.apple.com/<cc>/podcast/<slug>/id<digits>[?i=<episode digits>] */
export function parseApplePodcasts(input: string): ApplePodcastRef | null {
  const url = parseUrl(input);
  if (!url || url.protocol !== "https:" || host(url) !== "podcasts.apple.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const [country, section, slug, idPart] = parts;
  if (!country || !/^[a-z]{2}$/.test(country) || section !== "podcast") return null;
  const show = /^id(\d{4,15})$/.exec(idPart ?? slug ?? "");
  const cleanSlug = idPart ? slug : "podcast";
  if (!show || !cleanSlug || !/^[a-z0-9-]{1,120}$/i.test(cleanSlug)) return null;
  const episode = url.searchParams.get("i");
  return { provider: "apple", country, slug: cleanSlug, showId: show[1], episodeId: episode && /^\d{4,20}$/.test(episode) ? episode : null };
}

export type ProviderShowRef = SpotifyRef | ApplePodcastRef;

export function parsePodcastProvider(input: string): ProviderShowRef | null {
  return parseSpotify(input, ["show", "episode"]) ?? parseApplePodcasts(input);
}

/** A stable reference string stored for a provider show (spotify:show:<id>, apple:us:slug:id[:episode]). */
export function providerRefString(ref: ProviderShowRef): string {
  return ref.provider === "spotify"
    ? `spotify:${ref.kind}:${ref.id}`
    : `apple:${ref.country}:${ref.slug}:${ref.showId}${ref.episodeId ? `:${ref.episodeId}` : ""}`;
}

export function parseProviderRefString(ref: string | null | undefined): ProviderShowRef | null {
  if (!ref) return null;
  const p = ref.split(":");
  if (p[0] === "spotify" && p.length === 3 && SPOTIFY_ID.test(p[2]) && ["show", "episode", "playlist"].includes(p[1])) {
    return { provider: "spotify", kind: p[1] as SpotifyKind, id: p[2] };
  }
  if (p[0] === "apple" && (p.length === 4 || p.length === 5) && /^[a-z]{2}$/.test(p[1]) && /^[a-z0-9-]{1,120}$/i.test(p[2]) && /^\d{4,15}$/.test(p[3])) {
    return { provider: "apple", country: p[1], slug: p[2], showId: p[3], episodeId: p[4] && /^\d{4,20}$/.test(p[4]) ? p[4] : null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Embed URLs (rebuilt from identifiers only) and their external fallbacks
// ---------------------------------------------------------------------------
export type Embed = {
  provider: "youtube" | "vimeo" | "spotify" | "apple";
  /** iframe src */
  src: string;
  /** "Open in …" fallback, always available */
  openUrl: string;
  openLabel: string;
  /** Permissions granted to the iframe (nothing else). */
  allow: string;
  /** Optional sandbox tokens (Apple's embed requires these). */
  sandbox?: string;
  /** Intrinsic height for audio players; null for 16:9 video. */
  height: number | null;
};

/** Origins whose postMessage events the player coordinator accepts. */
export const EMBED_ORIGINS = {
  youtube: ["https://www.youtube-nocookie.com", "https://www.youtube.com"],
  vimeo: ["https://player.vimeo.com"],
  spotify: ["https://open.spotify.com"],
  apple: ["https://embed.podcasts.apple.com"],
} as const;

/** Hosts allowed in the Content-Security-Policy frame-src for media pages. */
export const EMBED_FRAME_HOSTS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://open.spotify.com", "https://embed.podcasts.apple.com"];

export function videoEmbed(ref: VideoRef, opts: { origin?: string | null; autoplay?: boolean } = {}): Embed {
  if (ref.provider === "youtube") {
    // Privacy-enhanced mode; enablejsapi lets the page pause it when another
    // player starts. origin restricts which page may control it.
    const q = new URLSearchParams({ enablejsapi: "1", rel: "0", playsinline: "1", modestbranding: "1" });
    if (opts.origin) q.set("origin", opts.origin);
    if (opts.autoplay) q.set("autoplay", "1");
    return {
      provider: "youtube",
      src: `https://www.youtube-nocookie.com/embed/${ref.id}?${q}`,
      openUrl: `https://www.youtube.com/watch?v=${ref.id}`,
      openLabel: "Open in YouTube",
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
      height: null,
    };
  }
  const q = new URLSearchParams({ dnt: "1", playsinline: "1", title: "0", byline: "0", portrait: "0" });
  if (ref.hash) q.set("h", ref.hash);
  if (opts.autoplay) q.set("autoplay", "1");
  return {
    provider: "vimeo",
    src: `https://player.vimeo.com/video/${ref.id}?${q}`,
    openUrl: ref.hash ? `https://vimeo.com/${ref.id}/${ref.hash}` : `https://vimeo.com/${ref.id}`,
    openLabel: "Open in Vimeo",
    allow: "autoplay; fullscreen; picture-in-picture; encrypted-media",
    height: null,
  };
}

export function spotifyEmbed(ref: SpotifyRef): Embed {
  return {
    provider: "spotify",
    src: `https://open.spotify.com/embed/${ref.kind}/${ref.id}?utm_source=generator`,
    openUrl: `https://open.spotify.com/${ref.kind}/${ref.id}`,
    openLabel: "Open in Spotify",
    allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    height: ref.kind === "playlist" || ref.kind === "album" || ref.kind === "show" ? 452 : 232,
  };
}

export function appleEmbed(ref: ApplePodcastRef): Embed {
  const path = `${ref.country}/podcast/${ref.slug}/id${ref.showId}${ref.episodeId ? `?i=${ref.episodeId}` : ""}`;
  return {
    provider: "apple",
    src: `https://embed.podcasts.apple.com/${path}`,
    openUrl: `https://podcasts.apple.com/${path}`,
    openLabel: "Open in Apple Podcasts",
    allow: "autoplay; encrypted-media; fullscreen; clipboard-write",
    sandbox: "allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation",
    height: ref.episodeId ? 175 : 450,
  };
}

export function providerEmbed(ref: ProviderShowRef): Embed {
  return ref.provider === "spotify" ? spotifyEmbed(ref) : appleEmbed(ref);
}

// ---------------------------------------------------------------------------
// Audible: an outbound link only (never embedded or synchronized)
// ---------------------------------------------------------------------------
const AUDIBLE_HOSTS = new Set([
  "audible.com", "www.audible.com", "audible.co.uk", "www.audible.co.uk", "audible.ca", "www.audible.ca",
  "audible.com.au", "www.audible.com.au", "audible.de", "www.audible.de", "audible.fr", "www.audible.fr",
  "audible.it", "www.audible.it", "audible.es", "www.audible.es", "audible.in", "www.audible.in",
  "audible.co.jp", "www.audible.co.jp",
]);

/** Normalized https Audible URL (tracking query removed), or null. */
export function normalizeAudibleUrl(input: string): string | null {
  const url = parseUrl(input);
  if (!url || url.protocol !== "https:" || !AUDIBLE_HOSTS.has(host(url))) return null;
  if (!/^\/[A-Za-z0-9/_.\-%]*$/.test(url.pathname) || url.pathname === "/") return null;
  return `https://${host(url)}${url.pathname}`;
}

/** https only, no credentials; for website and artwork links shown to members. */
export function safeHttpsUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const url = parseUrl(input);
  return url && url.protocol === "https:" ? url.toString() : null;
}

/** http(s) only, no credentials (feed addresses may still be plain http). */
export function safeHttpUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const url = parseUrl(input);
  return url ? url.toString() : null;
}
