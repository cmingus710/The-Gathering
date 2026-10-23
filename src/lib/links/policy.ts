/**
 * The one rule for hyperlinks in everything members and editors write:
 * announcements, devotionals, lessons and lesson blocks, Community posts and
 * comments, and prayer requests, updates, and comments. The renderers, the
 * link dialog, paste handling, and every save action use it, so a link that
 * saves is a link that renders and the other way around.
 *
 * Allowed:
 * - pages in The Gathering ("/events", or this site's own full address,
 *   which is stored and shown as the path so it opens inside the app);
 * - web pages (http and https, never with a user name or password in them);
 * - email addresses (mailto:) and phone numbers (tel:), checked for shape.
 * Everything else (javascript:, data:, vbscript:, file:, blob:, protocol-
 * relative "//host", backslashes, control characters, …) is refused. Nothing
 * here fetches the destination; a link to restricted content is only an
 * address, and the page it opens checks access as always.
 */
export type LinkKind = "internal" | "web" | "email" | "phone";
export type SafeLink = { kind: LinkKind; href: string };

// Browsers drop tabs and newlines inside URLs, so "/\t/evil.example" would
// become the protocol-relative "//evil.example". No real link needs them.
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@<>()[\]\\,;:"'`]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;
const PHONE = /^\+?\(?[0-9][0-9().\-\s]*$/;

/** This site's origin (from NEXT_PUBLIC_SITE_URL), whose full addresses count as internal. */
export function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function phoneDigits(value: string): string | null {
  if (!PHONE.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 15 ? `${value.trim().startsWith("+") ? "+" : ""}${digits}` : null;
}

/**
 * The checked, normalized form of a link destination as written in the
 * content, or null when it can't be used. `origins` are further addresses
 * to treat as this site (the browser's own origin in the editor).
 */
export function classifyHref(raw: string, origins: Array<string | null | undefined> = []): SafeLink | null {
  const href = raw.trim();
  if (!href || CONTROL.test(href)) return null;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.includes("\\") ? { kind: "internal", href } : null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1].toLowerCase();
  if (scheme === "http" || scheme === "https") {
    if (/\s|\\/.test(href)) return null;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.username || url.password || !url.hostname) return null;
    const site = [siteOrigin(), ...origins].filter(Boolean);
    if (site.includes(url.origin)) return { kind: "internal", href: `${url.pathname}${url.search}${url.hash}` };
    return { kind: "web", href };
  }
  if (scheme === "mailto") {
    const rest = href.slice(7);
    const [address, query] = [rest.split("?")[0], rest.includes("?") ? rest.slice(rest.indexOf("?")) : ""];
    let decoded: string;
    try {
      decoded = decodeURIComponent(address);
    } catch {
      return null;
    }
    if (!EMAIL.test(decoded) || /\s/.test(query)) return null;
    return { kind: "email", href: `mailto:${address}${query}` };
  }
  if (scheme === "tel") {
    let decoded: string;
    try {
      decoded = decodeURIComponent(href.slice(4));
    } catch {
      return null;
    }
    const number = phoneDigits(decoded);
    return number ? { kind: "phone", href: `tel:${number}` } : null;
  }
  return null;
}

export type LinkInputResult = ({ ok: true } & SafeLink) | { ok: false; error: string };

export const LINK_HELP = "Use a web address (https://…), a page in The Gathering (such as /events), an email address, or a phone number.";

/**
 * What a person typed in the link dialog, made into a destination: a full
 * address is checked as it is; "www.example.org" or "example.org/give"
 * becomes https://…; an email address becomes mailto:, a phone number tel:.
 */
export function normalizeLinkInput(input: string, origins: Array<string | null | undefined> = []): LinkInputResult {
  const value = input.trim().replace(/^<(.*)>$/, "$1").trim();
  if (!value) return { ok: false, error: "Enter where the link should go." };
  const direct = classifyHref(value, origins);
  if (direct) return { ok: true, ...direct };
  if (EMAIL.test(value)) return { ok: true, kind: "email", href: `mailto:${value}` };
  const number = phoneDigits(value);
  if (number && number.replace("+", "").length >= 7) return { ok: true, kind: "phone", href: `tel:${number}` };
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(value)?.[1];
  if (scheme && !/^(https?|mailto|tel)$/i.test(scheme)) return { ok: false, error: `Links starting with “${scheme}:” can't be used. ${LINK_HELP}` };
  if (!/\s/.test(value) && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(value)) {
    const web = classifyHref(`https://${value}`, origins);
    if (web) return { ok: true, ...web };
  }
  return { ok: false, error: `That doesn't look like a link address. ${LINK_HELP}` };
}

/** Short, readable form of a destination for the editor ("example.org/give", "office@church.org"). */
export function describeHref(link: SafeLink): string {
  switch (link.kind) {
    case "internal":
      return `The Gathering: ${link.href}`;
    case "email":
      return link.href.slice(7).split("?")[0];
    case "phone":
      return link.href.slice(4);
    case "web":
      try {
        const url = new URL(link.href);
        const rest = `${url.pathname}${url.search}`.replace(/\/$/, "");
        return `${url.host.replace(/^www\./, "")}${rest}`;
      } catch {
        return link.href;
      }
  }
}
