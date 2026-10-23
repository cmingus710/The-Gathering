import { describe, expect, it } from "vitest";
import { isSafeHref, markdownExcerpt, renderAnnouncementMarkdown as render } from "./markdown";

describe("announcement markdown", () => {
  it("renders the supported formatting", () => {
    const html = render("## Welcome\n\n**Bold** and *italic*\n\n- one\n- two\n\n[Site](https://example.org)");
    expect(html).toContain("<h3>Welcome</h3>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('<a href="https://example.org" target="_blank" rel="noopener noreferrer nofollow" class="link-external">Site<span class="sr-only"> (opens in a new tab)</span></a>');
  });

  it("escapes raw HTML, including script and event handlers", () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\nHello <b onclick="x()">there</b>');
    expect(html).not.toMatch(/<script|<img|<b /i);
    expect(html).toContain("&lt;script&gt;");
  });

  it.each([
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](java\tscript:alert(1))",
    "[x](data:text/html;base64,PHNjcmlwdD4=)",
    "[x](vbscript:msgbox)",
    "[x](//evil.example)",
  ])("drops unsafe link %s", (src) => {
    const html = render(src);
    expect(html).not.toContain("<a");
    expect(html).toContain("x");
  });

  it("does not render inline images", () => {
    const html = render("![tracking pixel](https://evil.example/p.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("tracking pixel");
  });

  it("escapes attribute-breaking characters in safe links", () => {
    const html = render('[x](https://example.org/?q="><script>)');
    expect(html).not.toContain("<script>");
  });

  it("allows site-relative, mailto, and tel links", () => {
    expect(isSafeHref("/events")).toBe(true);
    expect(isSafeHref("mailto:office@example.org")).toBe(true);
    expect(isSafeHref("tel:+15555550100")).toBe(true);
  });

  it("refuses relative links that browsers would turn into another site", () => {
    for (const href of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "\t//evil.example"]) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(false);
    }
    const html = render("[Church form](</\t/evil.example/login>)");
    expect(html).not.toContain("<a");
    expect(html).toContain("Church form");
  });

  it("builds plain excerpts", () => {
    expect(markdownExcerpt("## Hi\n\n**Join** us [here](https://x.org)")).toBe("Hi Join us here");
    expect(markdownExcerpt("a".repeat(300), 20)).toHaveLength(20);
  });
});
