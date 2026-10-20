import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Parses a public podcast feed (RSS 2.0 with the iTunes namespace, or
 * Atom) into plain metadata. Defensive by design:
 *   - documents with a DOCTYPE or ENTITY declaration are refused (no external
 *     entities, no entity expansion attacks); only XML's built-in entities
 *     are decoded;
 *   - descriptions are reduced to plain text (no HTML survives);
 *   - only https artwork and audio URLs are kept; links must be http(s);
 *   - at most 500 episodes; malformed episodes are skipped, not fatal.
 */
export type FeedEpisode = {
  guid: string;
  title: string;
  description: string;
  link: string | null;
  artwork_url: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  audio_url: string | null;
  audio_type: string | null;
  audio_length: number | null;
};

export type ParsedFeed = {
  title: string;
  description: string;
  author: string | null;
  artwork_url: string | null;
  website_url: string | null;
  episodes: FeedEpisode[];
  skipped: number;
};

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

const MAX_EPISODES = 500;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", bull: "•", middot: "·",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** HTML (as podcast publishers send it) → plain text with paragraph breaks. */
export function htmlToText(input: string, max = 8000): string {
  let s = String(input ?? "");
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template)[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, "\n").replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  // Decoding may reveal markup that was double-encoded: strip it again.
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  s = s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return text(o["#text"]);
    if ("__cdata" in o) return text(o.__cdata);
  }
  return "";
}

const attr = (v: unknown, name: string): string => {
  const o = (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | undefined;
  return o && typeof o === "object" ? text(o[`@_${name}`]) : "";
};

function httpsUrl(v: string): string | null {
  const s = v.trim();
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

function httpUrl(v: string): string | null {
  const s = v.trim();
  if (!s || s.length > 1000) return null;
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

/** itunes:duration: "3723", "62:03", or "1:02:03". */
export function parseDuration(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{1,6}(\.\d+)?$/.test(s)) {
    const n = Math.round(Number(s));
    return n > 0 && n <= 86400 ? n : null;
  }
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) return null;
  const n = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return n > 0 && n <= 86400 ? n : null;
}

function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  if (t < Date.UTC(1990, 0, 1) || t > Date.now() + 366 * 86_400_000) return null;
  return new Date(t).toISOString();
}

function decode(body: Buffer): string {
  let start = 0;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) start = 3;
  const head = body.subarray(start, start + 200).toString("latin1");
  const declared = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head)?.[1]?.toLowerCase();
  const label = declared && declared !== "utf-8" && declared !== "utf8" ? declared : "utf-8";
  try {
    return new TextDecoder(label, { fatal: false }).decode(body.subarray(start));
  } catch {
    return new TextDecoder("utf-8").decode(body.subarray(start));
  }
}

const ARRAYS = new Set(["item", "entry", "link", "enclosure", "category", "media:content", "itunes:category", "atom:link"]);

export function parseFeed(body: Buffer | string): ParsedFeed {
  const xml = typeof body === "string" ? body : decode(body);
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new FeedParseError("The feed uses XML features that aren't allowed (DOCTYPE or entity declarations).");
  }
  if (XMLValidator.validate(xml, { allowBooleanAttributes: true }) !== true) {
    throw new FeedParseError("The feed isn't valid XML.");
  }
  let doc: Record<string, unknown>;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      processEntities: true,
      htmlEntities: false,
      allowBooleanAttributes: true,
      isArray: (name) => ARRAYS.has(name),
    });
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new FeedParseError("The feed isn't valid XML.");
  }
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = (rss?.channel ?? (doc["rdf:RDF"] as Record<string, unknown> | undefined)?.channel) as Record<string, unknown> | undefined;
  const atom = doc.feed as Record<string, unknown> | undefined;
  if (channel) return parseRss(channel, (rss?.channel ? channel.item : (doc["rdf:RDF"] as Record<string, unknown>).item) as unknown[]);
  if (atom) return parseAtom(atom);
  throw new FeedParseError("This isn't an RSS or Atom podcast feed.");
}

function stableGuid(parts: { guid: string; title: string; date: string | null; enclosure: string | null; link: string | null }): string | null {
  if (parts.guid) return parts.guid.slice(0, 1000);
  // No <guid>: title + date stays the same when the publisher moves its files.
  if (parts.title && parts.date) return `title-date:${createHash("sha256").update(`${parts.title}\n${parts.date}`).digest("hex")}`;
  if (parts.enclosure) return `enclosure:${parts.enclosure}`;
  if (parts.link) return `link:${parts.link}`;
  return null;
}

function parseRss(channel: Record<string, unknown>, rawItems: unknown[] | undefined): ParsedFeed {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const episodes: FeedEpisode[] = [];
  let skipped = 0;
  for (const raw of items.slice(0, MAX_EPISODES * 2)) {
    if (episodes.length >= MAX_EPISODES) break;
    const it = raw as Record<string, unknown>;
    const title = htmlToText(text(it.title), 300);
    const enclosure = (it.enclosure as unknown[] | undefined)?.[0];
    const audioRaw = enclosure ? attr(enclosure, "url") : "";
    const audioType = enclosure ? attr(enclosure, "type").toLowerCase() : "";
    const isAudio = !audioType || audioType.startsWith("audio/");
    const audio = isAudio ? httpsUrl(audioRaw) : null;
    const date = parseDate(text(it.pubDate) || text(it["dc:date"]));
    const link = httpUrl(text((it.link as unknown[] | undefined)?.[0] ?? it.link));
    const guid = stableGuid({ guid: text(it.guid).trim(), title, date, enclosure: httpUrl(audioRaw), link });
    if (!title || !guid) {
      skipped++;
      continue;
    }
    const lengthRaw = enclosure ? attr(enclosure, "length") : "";
    episodes.push({
      guid,
      title,
      description: htmlToText(text(it["content:encoded"]) || text(it.description) || text(it["itunes:summary"])),
      link,
      artwork_url: httpsUrl(attr(it["itunes:image"], "href")),
      published_at: date,
      duration_seconds: parseDuration(text(it["itunes:duration"])),
      audio_url: audio,
      audio_type: audio ? (audioType || null)?.slice(0, 80) ?? null : null,
      audio_length: audio && /^\d{1,15}$/.test(lengthRaw) ? Number(lengthRaw) : null,
    });
  }
  const image = channel.image as Record<string, unknown> | undefined;
  return {
    title: htmlToText(text(channel.title), 160),
    description: htmlToText(text(channel.description) || text(channel["itunes:summary"]), 4000),
    author: htmlToText(text(channel["itunes:author"]) || text(channel.managingEditor), 160) || null,
    artwork_url: httpsUrl(attr(channel["itunes:image"], "href")) ?? httpsUrl(text(image?.url)),
    website_url: httpUrl(text((channel.link as unknown[] | undefined)?.find((l) => typeof l === "string" || text(l)) ?? "")),
    episodes,
    skipped: skipped + Math.max(0, items.length - MAX_EPISODES * 2),
  };
}

function atomLink(links: unknown[] | undefined, rel: string): Record<string, unknown> | undefined {
  return (links ?? []).find((l) => {
    const r = attr(l, "rel") || "alternate";
    return r === rel;
  }) as Record<string, unknown> | undefined;
}

function parseAtom(feed: Record<string, unknown>): ParsedFeed {
  const entries = Array.isArray(feed.entry) ? feed.entry : [];
  const episodes: FeedEpisode[] = [];
  let skipped = 0;
  for (const raw of entries.slice(0, MAX_EPISODES * 2)) {
    if (episodes.length >= MAX_EPISODES) break;
    const e = raw as Record<string, unknown>;
    const links = e.link as unknown[] | undefined;
    const title = htmlToText(text(e.title), 300);
    const enc = atomLink(links, "enclosure");
    const encType = enc ? attr(enc, "type").toLowerCase() : "";
    const audio = enc && (!encType || encType.startsWith("audio/")) ? httpsUrl(attr(enc, "href")) : null;
    const date = parseDate(text(e.published) || text(e.updated));
    const link = httpUrl(attr(atomLink(links, "alternate"), "href"));
    const guid = stableGuid({ guid: text(e.id).trim(), title, date, enclosure: enc ? httpUrl(attr(enc, "href")) : null, link });
    if (!title || !guid) {
      skipped++;
      continue;
    }
    const len = enc ? attr(enc, "length") : "";
    episodes.push({
      guid,
      title,
      description: htmlToText(text(e.content) || text(e.summary)),
      link,
      artwork_url: httpsUrl(attr(e["itunes:image"], "href")),
      published_at: date,
      duration_seconds: parseDuration(text(e["itunes:duration"])),
      audio_url: audio,
      audio_type: audio ? encType.slice(0, 80) || null : null,
      audio_length: audio && /^\d{1,15}$/.test(len) ? Number(len) : null,
    });
  }
  const authorObj = feed.author as Record<string, unknown> | undefined;
  return {
    title: htmlToText(text(feed.title), 160),
    description: htmlToText(text(feed.subtitle), 4000),
    author: htmlToText(text(authorObj?.name), 160) || null,
    artwork_url: httpsUrl(text(feed.logo) || text(feed.icon)),
    website_url: httpUrl(attr(atomLink(feed.link as unknown[] | undefined, "alternate"), "href")),
    episodes,
    skipped,
  };
}
