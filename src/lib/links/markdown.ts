import { classifyHref } from "./policy";

/**
 * Links are stored in each module's existing Markdown as `[text](address)`;
 * nobody types that syntax: the link dialog, paste, and the link bar write
 * and change it. These helpers build, find, and convert it.
 */

/** Characters that would end or break a Markdown link destination, percent-encoded (nothing else, so nothing is encoded twice). */
export function encodeDestination(href: string): string {
  return href.replace(/[\s()<>\\]/g, (c) => (c === " " ? "%20" : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`));
}

/** Link text with its brackets escaped and on one line; formatting inside it (**bold**) is kept. */
export function escapeLinkText(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replace(/(\\)?([[\]])/g, (m, escaped: string | undefined, c: string) => (escaped ? m : `\\${c}`));
}

export function unescapeLinkText(text: string): string {
  return text.replace(/\\([[\]])/g, "$1");
}

export function markdownLink(text: string, href: string): string {
  const label = text.trim() || href.replace(/^(mailto|tel):/i, "");
  return `[${escapeLinkText(label)}](${encodeDestination(href)})`;
}

export type LinkSpan = {
  start: number;
  end: number;
  /** The link text as shown (escapes removed). */
  text: string;
  /** The link text as written, formatting and escapes included. */
  rawText: string;
  href: string;
  /** A bare address that renders as a link by itself (no brackets). */
  bare: boolean;
};

// [text](destination "optional title"): text may hold escaped characters but
// no unescaped brackets (the dialog escapes them); the destination may be
// <angle-bracketed>, or hold one level of balanced parentheses.
const BRACKET_LINK = /(!|@)?\[((?:\\.|[^\\[\]\n])*)\]\((<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;
const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>[\]()]+/gi;

/** Every link in the text, in order: `[text](address)` links and bare web addresses. Images and @mentions are not links. */
export function findLinks(source: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  // Images and mentions aren't links, but addresses inside them aren't bare links either.
  const taken: Array<{ start: number; end: number }> = [];
  for (const m of source.matchAll(BRACKET_LINK)) {
    taken.push({ start: m.index, end: m.index + m[0].length });
    if (m[1]) continue;
    const destination = m[3].startsWith("<") ? m[3].slice(1, -1) : m[3];
    spans.push({ start: m.index, end: m.index + m[0].length, rawText: m[2], text: unescapeLinkText(m[2]), href: destination.replace(/\\(.)/g, "$1"), bare: false });
  }
  for (const m of source.matchAll(BARE_URL)) {
    const url = m[0].replace(/[.,;:!?'"*_~]+$/, "");
    const start = m.index;
    const end = start + url.length;
    if (taken.some((s) => start < s.end && end > s.start)) continue;
    if (start > 0 && /[\w@/]/.test(source[start - 1])) continue;
    spans.push({ start, end, rawText: url, text: url, href: /^www\./i.test(url) ? `https://${url}` : url, bare: true });
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** The link the caret or selection is in, if any (a caret just outside the brackets is not in it). */
export function linkAt(source: string, start: number, end: number): LinkSpan | null {
  return findLinks(source).find((s) => (start === end ? start > s.start && start < s.end : start >= s.start && end <= s.end)) ?? null;
}

/** A pasted or typed single address (http, https, www., mailto:), or null. */
export function pastedAddress(text: string): string | null {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^www\./i.test(value)) return classifyHref(`https://${value}`)?.href ?? null;
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return null;
  return classifyHref(value)?.href ?? null;
}

/** The parts of a DOM node that converting pasted HTML needs (a real Node satisfies it). */
export type HtmlNode = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<HtmlNode>;
  getAttribute?: (name: string) => string | null;
};

const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "HEAD", "TITLE", "META", "LINK", "IMG", "PICTURE", "VIDEO", "AUDIO", "SVG", "CANVAS", "BUTTON", "SELECT", "INPUT", "TEXTAREA"]);
const PARAGRAPH = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "TABLE", "PRE", "FIGURE"]);
const LINE = new Set(["DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "TR", "DT", "DD", "ADDRESS"]);

/**
 * Pasted HTML as the editor's Markdown: links become `[text](address)` when
 * their address is allowed (and plain text when not), bold and italic are
 * kept, paragraphs, line breaks, and list items become lines; every other
 * tag, attribute, script, style, image, and embed is dropped. Nothing from
 * the HTML is ever inserted as HTML.
 */
export function htmlToMarkdown(root: HtmlNode, origins: Array<string | null | undefined> = []): string {
  const walk = (node: HtmlNode, inLink: boolean, list: { ordered: boolean; n: number } | null): string => {
    if (node.nodeType === 3) return (node.textContent ?? "").replace(/\s+/g, " ");
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return "";
    const tag = node.nodeName.toUpperCase();
    if (SKIP.has(tag)) return "";
    if (tag === "BR") return "\n";
    const nextList = tag === "UL" || tag === "OL" ? { ordered: tag === "OL", n: 0 } : list;
    const inner = Array.from(node.childNodes)
      .map((c) => walk(c, inLink || tag === "A", nextList))
      .join("");
    if (tag === "A") {
      const text = inner.replace(/\s+/g, " ").trim();
      const link = !inLink ? classifyHref(node.getAttribute?.("href") ?? "", origins) : null;
      if (!link) return inner;
      if (link.kind === "web" && (!text || text === link.href)) return link.href;
      return markdownLink(text || link.href, link.href);
    }
    if (tag === "STRONG" || tag === "B") return wrap(inner, "**");
    if (tag === "EM" || tag === "I") return wrap(inner, "*");
    if (tag === "LI") {
      const n = list ? ++list.n : 1;
      return `\n${list?.ordered ? `${n}.` : "-"} ${inner.trim()}`;
    }
    if (PARAGRAPH.has(tag)) return `\n\n${inner.trim()}\n\n`;
    if (LINE.has(tag)) return `\n${inner}\n`;
    return inner;
  };
  return walk(root, false, null)
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(/^[ \t]+(?![-\d])/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

/** True when pasted HTML holds at least one link worth converting. */
export function hasHtmlLinks(html: string): boolean {
  return /<a\s[^>]*href\s*=/i.test(html);
}
