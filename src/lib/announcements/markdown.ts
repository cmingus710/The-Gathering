import { Marked, type Tokens } from "marked";
import { classifyHref } from "@/lib/links/policy";
import { renderLink } from "@/lib/links/render";

/**
 * Renders the announcement Markdown subset to safe HTML, identically on the
 * server and in the admin preview.
 *
 * Safety model (no HTML sanitizer needed because nothing unsafe is emitted):
 * - Raw HTML in the source is escaped and shown as text.
 * - Links follow the shared link policy (lib/links): same-site pages, web
 *   pages (opening in a new tab), and checked email and phone links; any
 *   other destination renders as its text.
 * - Inline images are not rendered (announcements have one vetted image field).
 * - Headings are shifted down one level; the page owns the <h1>.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Whether a link destination may be used (see lib/links/policy). */
export function isSafeHref(href: string): boolean {
  return classifyHref(href) !== null;
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
      return renderLink(href, this.parser.parseInline(tokens), { title });
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
    .replace(/\[((?:\\.|[^\]\\])*)\]\((?:<[^>]*>|[^)]*)\)/g, (_, text: string) => text.replace(/\\([[\]])/g, "$1"))
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
