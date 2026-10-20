/**
 * Writes the church's public podcast feed (RSS 2.0 + the iTunes and Atom
 * namespaces). The database decides which episodes are eligible
 * (media_public_feed); this only formats them. Enclosure and artwork URLs
 * are stable app URLs that redirect to short-lived storage links when
 * fetched, so the feed never contains expiring or member-only links.
 */
export type PublicFeedData = {
  show: {
    id: string;
    title: string;
    description: string;
    author: string | null;
    website_url: string | null;
    language: string;
    category: string;
    explicit: boolean;
    owner_email: string | null;
    updated_at: string;
    artwork: { asset_id: string; mime: string; width: number | null; height: number | null } | null;
  };
  episodes: Array<{
    id: string;
    title: string;
    summary: string;
    body: string;
    publish_at: string;
    episode_number: number | null;
    season_number: number | null;
    audio: { asset_id: string; mime: string; size_bytes: number | null; duration_seconds: number | null } | null;
  }>;
};

const XML_INVALID = /[^\u0009\u000a\u000d -퟿-�\u{10000}-\u{10ffff}]/gu;

export function xmlEscape(s: string): string {
  return String(s ?? "")
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Markdown body → plain text for feed descriptions (no HTML is emitted). */
export function markdownToPlain(md: string, max = 4000): string {
  const s = String(md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function hms(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const t = Math.round(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const rfc822 = (iso: string) => new Date(iso).toUTCString();

export function buildPodcastFeed(data: PublicFeedData, site: string): string {
  const base = site.replace(/\/+$/, "");
  const s = data.show;
  const feedUrl = `${base}/podcast/feed.xml`;
  const link = s.website_url ?? `${base}/podcasts/shows/${s.id}`;
  const artwork = s.artwork ? `${base}/api/podcast/artwork/${s.artwork.asset_id}` : null;
  const [category, sub] = s.category.split(/\s*>\s*/);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
  );
  lines.push("<channel>");
  lines.push(`<title>${xmlEscape(s.title)}</title>`);
  lines.push(`<link>${xmlEscape(link)}</link>`);
  lines.push(`<atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml"/>`);
  lines.push(`<description>${xmlEscape(s.description || s.title)}</description>`);
  lines.push(`<language>${xmlEscape(s.language)}</language>`);
  lines.push(`<lastBuildDate>${rfc822(data.episodes[0]?.publish_at ?? s.updated_at)}</lastBuildDate>`);
  lines.push(`<generator>The Gathering</generator>`);
  if (s.author) lines.push(`<itunes:author>${xmlEscape(s.author)}</itunes:author>`);
  lines.push(`<itunes:summary>${xmlEscape(s.description || s.title)}</itunes:summary>`);
  lines.push(`<itunes:explicit>${s.explicit ? "true" : "false"}</itunes:explicit>`);
  lines.push(`<itunes:type>episodic</itunes:type>`);
  if (sub) lines.push(`<itunes:category text="${xmlEscape(category)}"><itunes:category text="${xmlEscape(sub)}"/></itunes:category>`);
  else lines.push(`<itunes:category text="${xmlEscape(category)}"/>`);
  if (s.owner_email || s.author) {
    lines.push("<itunes:owner>");
    if (s.author) lines.push(`<itunes:name>${xmlEscape(s.author)}</itunes:name>`);
    if (s.owner_email) lines.push(`<itunes:email>${xmlEscape(s.owner_email)}</itunes:email>`);
    lines.push("</itunes:owner>");
  }
  if (artwork) {
    lines.push(`<itunes:image href="${xmlEscape(artwork)}"/>`);
    lines.push(`<image><url>${xmlEscape(artwork)}</url><title>${xmlEscape(s.title)}</title><link>${xmlEscape(link)}</link></image>`);
  }
  for (const e of data.episodes) {
    if (!e.audio) continue;
    const description = markdownToPlain(e.body) || e.summary || e.title;
    const enclosure = `${base}/api/podcast/episodes/${e.id}/audio`;
    lines.push("<item>");
    lines.push(`<title>${xmlEscape(e.title)}</title>`);
    lines.push(`<guid isPermaLink="false">${xmlEscape(`gathering-episode-${e.id}`)}</guid>`);
    lines.push(`<link>${xmlEscape(`${base}/podcasts/episodes/${e.id}`)}</link>`);
    lines.push(`<pubDate>${rfc822(e.publish_at)}</pubDate>`);
    lines.push(`<description>${xmlEscape(description)}</description>`);
    if (e.summary) lines.push(`<itunes:summary>${xmlEscape(e.summary)}</itunes:summary>`);
    lines.push(
      `<enclosure url="${xmlEscape(enclosure)}" length="${Math.max(0, Math.round(e.audio.size_bytes ?? 0))}" type="${xmlEscape(e.audio.mime)}"/>`,
    );
    const d = hms(e.audio.duration_seconds);
    if (d) lines.push(`<itunes:duration>${d}</itunes:duration>`);
    if (e.episode_number != null) lines.push(`<itunes:episode>${e.episode_number}</itunes:episode>`);
    if (e.season_number != null) lines.push(`<itunes:season>${e.season_number}</itunes:season>`);
    lines.push(`<itunes:episodeType>full</itunes:episodeType>`);
    lines.push("</item>");
  }
  lines.push("</channel>");
  lines.push("</rss>");
  return `${lines.join("\n")}\n`;
}
