import { Marked, type Tokens } from "marked";
import { isSafeHref } from "@/lib/announcements/markdown";

/**
 * Community posts and replies use a smaller Markdown subset than
 * announcements: bold, italic, strikethrough, links, lists, quotes, and
 * code. Nothing unsafe is ever emitted, so no HTML sanitizer is needed:
 * - raw HTML is escaped and shown as text;
 * - headings render as bold paragraphs (posts can't shout over the page);
 * - images render as their alt text (attachments are deferred);
 * - links are kept only for http(s), mailto, and same-site paths, open with
 *   rel="nofollow ugc noopener noreferrer", and anything else becomes text;
 * - tables and horizontal rules render as plain text.
 * Direct messages are plain text (no Markdown at all).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_COMMUNITY_PROTOCOL = /^(https?:|mailto:)/i;

export function isSafeCommunityHref(href: string): boolean {
  if (!isSafeHref(href)) return false;
  const trimmed = href.trim();
  if (trimmed.startsWith("/")) return true;
  if (!SAFE_COMMUNITY_PROTOCOL.test(trimmed.replace(/[\u0000- ]/g, ""))) return false;
  if (/^https?:/i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      // No credentials in links (e.g. https://bank.example@evil.example).
      return !url.username && !url.password;
    } catch {
      return false;
    }
  }
  return true;
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    heading({ tokens }: Tokens.Heading) {
      return `<p><strong>${this.parser.parseInline(tokens)}</strong></p>\n`;
    },
    link({ href, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      if (!href || !isSafeCommunityHref(href)) return text;
      const external = /^(https?:|mailto:)/i.test(href.trim());
      const rel = external ? ` rel="nofollow ugc noopener noreferrer"` : "";
      return `<a href="${escapeHtml(href.trim())}"${rel}>${text}</a>`;
    },
    image({ text }: Tokens.Image) {
      return escapeHtml(text);
    },
    table(token: Tokens.Table) {
      return `<p>${escapeHtml(token.raw)}</p>\n`;
    },
    hr() {
      return "";
    },
  },
});

export function renderCommunityText(source: string): string {
  return marked.parse(source ?? "") as string;
}

export const LIMITS = {
  title: 160,
  thread: 10000,
  reply: 5000,
  message: 4000,
  reportDetails: 1000,
} as const;

/** Relative "time ago" for lists, with the exact time in the title attribute. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
}

export function exactTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
}
