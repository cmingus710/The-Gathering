import { classifyHref } from "./policy";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The HTML for one link in rendered content, shared by the announcement and
 * Community renderers. `inner` is the already-rendered link text.
 * - A destination the link policy refuses renders as its text only.
 * - Pages in The Gathering are plain same-site links (the app opens them
 *   with its own navigation; see ProseLinkNavigation).
 * - Web pages open in a new tab with rel="noopener noreferrer" (plus
 *   "nofollow ugc" for what members write), so the page and anything being
 *   written on it stay put; screen readers hear "opens in a new tab".
 * - Email and phone links stay in place (the device's mail or phone app opens).
 */
export function renderLink(href: string | null | undefined, inner: string, opts: { ugc?: boolean; title?: string | null } = {}): string {
  const link = href ? classifyHref(href) : null;
  if (!link) return inner;
  const title = opts.title ? ` title="${escapeAttr(opts.title)}"` : "";
  if (link.kind === "internal") return `<a href="${escapeAttr(link.href)}"${title}>${inner}</a>`;
  const rel = opts.ugc ? "nofollow ugc noopener noreferrer" : "noopener noreferrer nofollow";
  if (link.kind === "web") {
    return `<a href="${escapeAttr(link.href)}"${title} target="_blank" rel="${rel}" class="link-external">${inner}<span class="sr-only"> (opens in a new tab)</span></a>`;
  }
  return `<a href="${escapeAttr(link.href)}"${title}${opts.ugc ? ` rel="${rel}"` : ""}>${inner}</a>`;
}
