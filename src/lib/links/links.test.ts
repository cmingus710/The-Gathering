import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAnnouncementMarkdown } from "@/lib/announcements/markdown";
import { renderCommunityText } from "@/lib/community/format";
import { encodeDestination, escapeLinkText, findLinks, htmlToMarkdown, linkAt, markdownLink, pastedAddress, type HtmlNode } from "./markdown";
import { classifyHref, normalizeLinkInput } from "./policy";
import { renderLink } from "./render";
import { linkProblem, unsafeLinks } from "./validate";

afterEach(() => vi.unstubAllEnvs());

describe("link policy", () => {
  it("allows site pages, web pages, and checked email and phone links", () => {
    expect(classifyHref("/events?when=sunday#top")).toEqual({ kind: "internal", href: "/events?when=sunday#top" });
    expect(classifyHref("https://example.org/give")).toEqual({ kind: "web", href: "https://example.org/give" });
    expect(classifyHref("mailto:office@example.org?subject=Hello")).toEqual({ kind: "email", href: "mailto:office@example.org?subject=Hello" });
    expect(classifyHref("tel:+1-555-555-0100")).toEqual({ kind: "phone", href: "tel:+15555550100" });
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "blob:https://example.org/x",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "https://bank.example@evil.example",
    "https://user:pass@example.org",
    "mailto:not-an-address",
    "mailto:a@b.example%0abcc:x@y.example",
    "tel:call-me",
    "tel:12",
    "#section",
    "ftp://example.org",
  ])("refuses %j", (href) => {
    expect(classifyHref(href)).toBeNull();
  });

  it("treats this site's full addresses as its own pages", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.gathering.church");
    expect(classifyHref("https://www.gathering.church/prayer/abc?x=1#c")).toEqual({ kind: "internal", href: "/prayer/abc?x=1#c" });
    expect(classifyHref("https://gathering.church.evil.example/x")?.kind).toBe("web");
    expect(classifyHref("http://localhost:3000/events", ["http://localhost:3000"])).toEqual({ kind: "internal", href: "/events" });
  });

  it("turns what people type into a destination", () => {
    expect(normalizeLinkInput("www.example.org")).toMatchObject({ ok: true, href: "https://www.example.org" });
    expect(normalizeLinkInput("example.org/give?fund=2")).toMatchObject({ ok: true, href: "https://example.org/give?fund=2" });
    expect(normalizeLinkInput("office@example.org")).toMatchObject({ ok: true, kind: "email", href: "mailto:office@example.org" });
    expect(normalizeLinkInput("(555) 555-0100")).toMatchObject({ ok: true, kind: "phone", href: "tel:5555550100" });
    expect(normalizeLinkInput("+44 20 7946 0958")).toMatchObject({ ok: true, href: "tel:+442079460958" });
    expect(normalizeLinkInput("/events")).toMatchObject({ ok: true, kind: "internal" });
    expect(normalizeLinkInput("<https://example.org>")).toMatchObject({ ok: true, href: "https://example.org" });
  });

  it("explains refused input", () => {
    const js = normalizeLinkInput("javascript:alert(1)");
    expect(js.ok).toBe(false);
    if (!js.ok) expect(js.error).toContain("“javascript:”");
    expect(normalizeLinkInput("data:text/html,x").ok).toBe(false);
    expect(normalizeLinkInput("").ok).toBe(false);
    expect(normalizeLinkInput("not a link").ok).toBe(false);
    expect(normalizeLinkInput("12").ok).toBe(false);
  });
});

describe("link markdown", () => {
  it("builds links without double-encoding", () => {
    expect(markdownLink("Sign up", "https://example.org/a?b=1&c=%20d")).toBe("[Sign up](https://example.org/a?b=1&c=%20d)");
    expect(encodeDestination("https://en.wikipedia.org/wiki/Grace_(name)")).toBe("https://en.wikipedia.org/wiki/Grace_%28name%29");
    expect(markdownLink("", "mailto:office@example.org")).toBe("[office@example.org](mailto:office@example.org)");
    expect(markdownLink("", "https://example.org")).toBe("[https://example.org](https://example.org)");
  });

  it("escapes brackets in link text but keeps formatting", () => {
    expect(escapeLinkText("**Read** [this]")).toBe("**Read** \\[this\\]");
    expect(escapeLinkText("already \\[escaped\\]")).toBe("already \\[escaped\\]");
    expect(escapeLinkText("two\nlines")).toBe("two lines");
    const html = renderCommunityText(markdownLink("**Read** [this]", "https://example.org"));
    expect(html).toContain("<strong>Read</strong> [this]");
  });

  it("round-trips what it builds", () => {
    const text = `Before ${markdownLink("Grace [notes]", "https://en.wikipedia.org/wiki/Grace_(name)")} after`;
    const [span] = findLinks(text);
    expect(span).toMatchObject({ text: "Grace [notes]", href: "https://en.wikipedia.org/wiki/Grace_%28name%29", bare: false });
    expect(text.slice(span.start, span.end)).toBe(markdownLink("Grace [notes]", "https://en.wikipedia.org/wiki/Grace_(name)"));
    expect(renderAnnouncementMarkdown(text)).toContain('href="https://en.wikipedia.org/wiki/Grace_%28name%29"');
  });

  it("finds links and bare addresses, but not images or mentions", () => {
    const text = "See [the form](/forms/1), ![pic](https://x.example/p.png), @[Ann](mention:6f1c0a52-8d0e-4c8f-9a7a-3b1f6d2c9e10) and https://example.org/a.";
    const spans = findLinks(text);
    expect(spans.map((s) => [s.text, s.bare])).toEqual([
      ["the form", false],
      ["https://example.org/a", true],
    ]);
  });

  it("knows which link the caret is in", () => {
    const text = "Hi [there](https://example.org) you";
    expect(linkAt(text, 5, 5)?.text).toBe("there");
    expect(linkAt(text, 3, 3)).toBeNull();
    expect(linkAt(text, 31, 31)).toBeNull();
    expect(linkAt(text, 4, 9)?.href).toBe("https://example.org");
    expect(linkAt(text, 0, 9)).toBeNull();
  });

  it("recognizes a pasted address", () => {
    expect(pastedAddress(" https://example.org/x \n")).toBe("https://example.org/x");
    expect(pastedAddress("www.example.org")).toBe("https://www.example.org");
    expect(pastedAddress("mailto:office@example.org")).toBe("mailto:office@example.org");
    expect(pastedAddress("javascript:alert(1)")).toBeNull();
    expect(pastedAddress("two words")).toBeNull();
    expect(pastedAddress("/events")).toBeNull();
  });
});

function el(tag: string, attrs: Record<string, string>, ...children: Array<HtmlNode | string>): HtmlNode {
  const nodes = children.map((c) => (typeof c === "string" ? { nodeType: 3, nodeName: "#text", textContent: c, childNodes: [] } : c));
  return { nodeType: 1, nodeName: tag.toUpperCase(), textContent: null, childNodes: nodes, getAttribute: (n) => attrs[n] ?? null };
}

describe("pasted HTML", () => {
  it("keeps safe links, bold, italic, and lines, and drops everything else", () => {
    const doc = el(
      "body",
      {},
      el("p", {}, "Join ", el("a", { href: "https://example.org/sign-up", onclick: "steal()" }, el("b", {}, "the retreat")), " now."),
      el("script", {}, "alert(1)"),
      el("p", {}, el("a", { href: "javascript:alert(1)" }, "Click me"), " or ", el("a", { href: "mailto:office@example.org" }, "email us")),
      el("ul", {}, el("li", {}, "One"), el("li", {}, el("i", {}, "Two"))),
      el("iframe", { src: "https://video.example/embed" }),
      el("img", { src: "https://x.example/p.png", alt: "x" }),
      el("p", {}, el("a", { href: "https://example.org/plain" }, "https://example.org/plain")),
    );
    expect(htmlToMarkdown(doc)).toBe(
      "Join [**the retreat**](https://example.org/sign-up) now.\n\nClick me or [email us](mailto:office@example.org)\n\n- One\n- *Two*\n\nhttps://example.org/plain",
    );
  });

  it("makes this site's links into its own pages", () => {
    const doc = el("body", {}, el("a", { href: "https://church.example/events/5" }, "Picnic"));
    expect(htmlToMarkdown(doc, ["https://church.example"])).toBe("[Picnic](/events/5)");
  });
});

describe("rendered links", () => {
  it("opens web pages in a new tab and keeps the rest in place", () => {
    expect(renderLink("https://example.org", "x")).toBe(
      '<a href="https://example.org" target="_blank" rel="noopener noreferrer nofollow" class="link-external">x<span class="sr-only"> (opens in a new tab)</span></a>',
    );
    expect(renderLink("/events", "x")).toBe('<a href="/events">x</a>');
    expect(renderLink("tel:+15555550100", "x")).toBe('<a href="tel:+15555550100">x</a>');
    expect(renderLink("javascript:alert(1)", "x")).toBe("x");
    expect(renderLink("https://example.org", "x", { ugc: true })).toContain('rel="nofollow ugc noopener noreferrer"');
  });

  it("renders this site's full addresses as app pages", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.gathering.church");
    expect(renderCommunityText("[Prayer](https://www.gathering.church/prayer/1)")).toContain('<a href="/prayer/1">Prayer</a>');
  });

  it("autolinks pasted bare addresses", () => {
    expect(renderCommunityText("See https://example.org/a.")).toContain('<a href="https://example.org/a" target="_blank"');
    expect(renderAnnouncementMarkdown("Email office@example.org")).toContain('href="mailto:office@example.org"');
  });

  it("never shows raw HTML or attribute breakouts", () => {
    const html = renderAnnouncementMarkdown('[x](https://example.org/?q="><script>alert(1)</script>)');
    expect(html).not.toContain("<script>");
    expect(renderCommunityText('<a href="https://example.org">x</a>')).toContain("&lt;a href=");
  });

  it("keeps mentions next to links unchanged", () => {
    const id = "6f1c0a52-8d0e-4c8f-9a7a-3b1f6d2c9e10";
    const html = renderCommunityText(`@[Ann Rivers](mention:${id}) shared [the form](https://example.org/f)`, { mentions: [{ id, name: "Ann Rivers", listed: true }] });
    expect(html).toContain(`<a href="/directory/${id}" class="mention">@Ann Rivers</a>`);
    expect(html).toContain('href="https://example.org/f"');
  });
});

describe("server link check", () => {
  it("accepts allowed links and mentions", () => {
    expect(linkProblem("[a](/events) [b](https://example.org) [c](mailto:o@example.org) [d](tel:+15555550100) https://x.example")).toBeNull();
    expect(linkProblem("@[Ann](mention:6f1c0a52-8d0e-4c8f-9a7a-3b1f6d2c9e10) and @[Youth](group:6f1c0a52-8d0e-4c8f-9a7a-3b1f6d2c9e11)")).toBeNull();
    expect(linkProblem("No links at all.")).toBeNull();
  });

  it("names refused links, wherever they are", () => {
    expect(unsafeLinks("[a](javascript:alert(1))")).toEqual(["javascript:alert(1)"]);
    expect(unsafeLinks("- item [a](data:text/html,x)\n\n> quote [b](vbscript:x)")).toEqual(["data:text/html,x", "vbscript:x"]);
    expect(unsafeLinks("[ref link][r]\n\n[r]: javascript:alert(1)")).toEqual(["javascript:alert(1)"]);
    expect(unsafeLinks("| a |\n| - |\n| [x](//evil.example) |")).toEqual(["//evil.example"]);
    expect(linkProblem("[a](javascript:alert(1))")).toContain("“javascript:alert(1)”");
  });
});
