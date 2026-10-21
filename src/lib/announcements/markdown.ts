import { Marked, type Tokens } from "marked";

/**
 * Renders the announcement Markdown subset to safe HTML, identically on the
 * server and in the admin preview.
 *
 * Safety model (no HTML sanitizer needed because nothing unsafe is emitted):
 * - Raw HTML in the source is escaped and shown as text.
 * - Links are kept only for http(s), mailto, tel, and same-site paths.
 * - Inline images are not rendered (announcements have one vetted image field).
 * - Headings are shifted down one level; the page owns the <h1>.
 */
const SAFE_PROTOCOL = /^(https?:|mailto:|tel:)/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  // Browsers drop tabs and newlines inside URLs, so "/\t/evil.example" would
  // become the protocol-relative "//evil.example". No real link needs them.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) return true;
  // Strip characters browsers ignore inside schemes (e.g. "java\tscript:").
  const normalized = trimmed.replace(/[\u0000- ]/g, "");
  return SAFE_PROTOCOL.test(normalized);
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    heading({ tokens, depth }: Tokens.Heading) {
      const level = Math.min(depth + 1, 4);
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
    },
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      if (!href || !isSafeHref(href)) return text;
      const external = /^https?:/i.test(href.trim());
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      const rel = external ? ` rel="noopener noreferrer nofollow"` : "";
      return `<a href="${escapeHtml(href.trim())}"${titleAttr}${rel}>${text}</a>`;
    },
    image({ text }: Tokens.Image) {
      return escapeHtml(text);
    },
  },
});

export function renderAnnouncementMarkdown(source: string): string {
  return marked.parse(source ?? "") as string;
}

/** Plain-text excerpt for cards and previews. */
export function markdownExcerpt(source: string, maxLength = 180): string {
  const text = (source ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
