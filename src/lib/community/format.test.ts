import { describe, expect, it } from "vitest";
import { isSafeCommunityHref, relativeTime, renderCommunityText } from "./format";

describe("renderCommunityText", () => {
  it("keeps the allowed formatting", () => {
    const html = renderCommunityText("**bold** _italic_ ~~gone~~\n\n- one\n- two\n\n> quoted\n\n`code`");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<code>code</code>");
  });

  it("escapes raw HTML, scripts, and event handlers", () => {
    const html = renderCommunityText('<script>alert(1)</script><img src=x onerror="alert(1)"><iframe src="https://evil.example"></iframe>');
    expect(html).not.toMatch(/<script|<img|<iframe/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops dangerous links but keeps their text", () => {
    for (const href of ["javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "tel:+15555550100", "//evil.example/x", "https://user:pass@evil.example"]) {
      const html = renderCommunityText(`[click](${href})`);
      expect(html, href).not.toContain("<a ");
      expect(html).toContain("click");
    }
  });

  it("marks external links nofollow ugc and keeps same-site links plain", () => {
    expect(renderCommunityText("[site](https://example.org/a)")).toContain('rel="nofollow ugc noopener noreferrer"');
    expect(renderCommunityText("[events](/events)")).toContain('<a href="/events">');
  });

  it("renders headings as bold paragraphs and images as alt text", () => {
    expect(renderCommunityText("# Loud")).toBe("<p><strong>Loud</strong></p>\n");
    const img = renderCommunityText("![a picture](https://example.org/x.png)");
    expect(img).not.toContain("<img");
    expect(img).toContain("a picture");
  });

  it("autolinks only safe URLs", () => {
    expect(renderCommunityText("see https://example.org")).toContain('href="https://example.org"');
    expect(isSafeCommunityHref("mailto:office@example.org")).toBe(true);
    expect(isSafeCommunityHref("ftp://example.org")).toBe(false);
  });
});

describe("relativeTime", () => {
  it("describes recent times in words", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(relativeTime("2026-10-20T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-20T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-10-20T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-19T10:00:00Z", now)).toBe("yesterday");
  });
});
