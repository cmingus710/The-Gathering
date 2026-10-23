import { Marked, type TokenizerAndRendererExtension, type Tokens } from "marked";
import { classifyHref } from "@/lib/links/policy";
import { renderLink } from "@/lib/links/render";
import { ANY_MENTION_SOURCE, type MentionRef } from "./mentions";

/**
 * Community posts and replies use a smaller Markdown subset than
 * announcements: bold, italic, strikethrough, links, lists, quotes, and
 * code. Nothing unsafe is ever emitted, so no HTML sanitizer is needed:
 * - raw HTML is escaped and shown as text;
 * - headings render as bold paragraphs (posts can't shout over the page);
 * - Markdown images render as their alt text (photos and videos are
 *   separate attachments, served through an access-checked route);
 * - links follow the shared link policy (lib/links): same-site pages, web
 *   pages (in a new tab, rel="nofollow ugc noopener noreferrer"), and
 *   checked email and phone links; anything else becomes text;
 * - tables and horizontal rules render as plain text;
 * - @mentions render as "@Name" in the mention style, using the current
 *   name the server sends with the post (`mentions`): a person
 *   (`@[Name](mention:<id>)`) links to their directory entry only when
 *   they're listed, and a group (`@[Name](group:<id>)`) links to its page
 *   only when the reader may see it, marked with a group icon and "(group)"
 *   for screen readers. Otherwise it's a label that can't be clicked; a
 *   mention the server didn't send (never recorded, or someone who can't be
 *   shown any more) is plain text with the name as written. Nothing in the
 *   markup becomes HTML.
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

/** Whether a link destination may be used in community text (see lib/links/policy). */
export function isSafeCommunityHref(href: string): boolean {
  return classifyHref(href) !== null;
}

type MentionToken = Tokens.Generic & { label: string; id: string; kind: "member" | "group" };

// Set only for the duration of one synchronous parse (see renderCommunityText).
let currentMentions: Map<string, MentionRef> | null = null;

const mentionExtension: TokenizerAndRendererExtension = {
  name: "mention",
  level: "inline",
  start(src: string) {
    const i = src.indexOf("@[");
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = new RegExp(`^${ANY_MENTION_SOURCE}`).exec(src);
    if (!m) return undefined;
    return { type: "mention", raw: m[0], label: m[1], id: m[3].toLowerCase(), kind: m[2] === "group" ? "group" : "member" };
  },
  renderer(token) {
    const { label, id, kind } = token as MentionToken;
    const ref = currentMentions?.get(`${kind}:${id}`);
    const name = escapeHtml(`@${ref?.name ?? label}`);
    if (kind === "group") {
      const inner = `${name}<span class="sr-only"> (group)</span>`;
      if (ref?.listed && ref.name) return `<a href="/groups/${escapeHtml(id)}" class="mention mention-group">${inner}</a>`;
      return ref ? `<span class="mention mention-group">${inner}</span>` : name;
    }
    if (ref?.listed) return `<a href="/directory/${escapeHtml(id)}" class="mention">${name}</a>`;
    return ref?.name ? `<span class="mention">${name}</span>` : name;
  },
};

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
      return renderLink(href, this.parser.parseInline(tokens), { ugc: true });
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
  extensions: [mentionExtension],
});

/**
 * Renders a post, comment, or other community text. `mentions` (from the
 * post or comment's own data) decides how each @mention is shown; without
 * it every mention is plain "@Name" text.
 */
export function renderCommunityText(source: string, opts: { mentions?: MentionRef[] | null } = {}): string {
  currentMentions = new Map((opts.mentions ?? []).map((m) => [`${m.kind === "group" ? "group" : "member"}:${m.id.toLowerCase()}`, m]));
  try {
    return marked.parse(source ?? "") as string;
  } finally {
    currentMentions = null;
  }
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
