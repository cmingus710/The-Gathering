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
    for (const href of ["javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "tel:+15555550100", "//evil.example/x", "/\t/evil.example/x", "https://user:pass@evil.example"]) {
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

describe("renderCommunityText mentions", () => {
  const ann = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const ben = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  it("links a listed member with their current name", () => {
    const html = renderCommunityText(`Thanks @[Ann Rivers](mention:${ann})!`, { mentions: [{ id: ann, name: "Annie Rivers", listed: true }] });
    expect(html).toBe(`<p>Thanks <a href="/directory/${ann}" class="mention">@Annie Rivers</a>!</p>\n`);
  });

  it("shows a label that can't be clicked when the member isn't listed, and plain text when not recorded or can't be shown", () => {
    expect(renderCommunityText(`@[Ben Rowe](mention:${ben})`, { mentions: [{ id: ben, name: "Ben Rowe", listed: false }] })).toBe('<p><span class="mention">@Ben Rowe</span></p>\n');
    expect(renderCommunityText(`@[Ben Rowe](mention:${ben})`)).toBe("<p>@Ben Rowe</p>\n");
    expect(renderCommunityText(`@[Former Name](mention:${ben})`, { mentions: [{ id: ben, name: null, listed: false }] })).toBe("<p>@Former Name</p>\n");
  });

  it("never turns a label into HTML", () => {
    const html = renderCommunityText(`@[<img src=x onerror=alert(1)>](mention:${ann})`, { mentions: [{ id: ann, name: "<b>x</b>", listed: true }] });
    expect(html).not.toMatch(/<img|<b>/);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("leaves email addresses and hand-typed @names alone and keeps formatting around mentions", () => {
    const html = renderCommunityText(`**Hi @[Ann](mention:${ann})**, write to office@example.org or @ben`, { mentions: [{ id: ann, name: "Ann", listed: true }] });
    expect(html).toContain(`<strong>Hi <a href="/directory/${ann}" class="mention">@Ann</a></strong>`);
    expect(html).toContain('href="mailto:office@example.org"');
    expect(html).toContain("or @ben");
    expect(html.match(/class="mention"/g)).toHaveLength(1);
  });
});

describe("renderCommunityText group mentions", () => {
  const choir = "3b241101-e2bb-4255-8caf-4136c566a962";
  const ann = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("links a group the reader may see, marked as a group, with its current name", () => {
    const html = renderCommunityText(`Thanks @[Choir](group:${choir})`, { mentions: [{ id: choir, kind: "group", name: "Sanctuary Choir", listed: true }] });
    expect(html).toBe(`<p>Thanks <a href="/groups/${choir}" class="mention mention-group">@Sanctuary Choir<span class="sr-only"> (group)</span></a></p>\n`);
  });

  it("shows a group the reader can't see as a label, never a link", () => {
    const html = renderCommunityText(`@[Group](group:${choir})`, { mentions: [{ id: choir, kind: "group", name: null, listed: false }] });
    expect(html).toBe('<p><span class="mention mention-group">@Group<span class="sr-only"> (group)</span></span></p>\n');
    expect(renderCommunityText(`@[Choir](group:${choir})`)).toBe("<p>@Choir</p>\n");
  });

  it("never confuses a group and a person with the same id", () => {
    const html = renderCommunityText(`@[Ann](mention:${ann}) @[Choir](group:${ann})`, { mentions: [{ id: ann, name: "Ann", listed: true }] });
    expect(html).toContain(`<a href="/directory/${ann}" class="mention">@Ann</a>`);
    expect(html).toContain("@Choir</p>");
  });

  it("escapes group labels", () => {
    const html = renderCommunityText(`@[<script>x</script>](group:${choir})`, { mentions: [{ id: choir, kind: "group", name: "<i>y</i>", listed: true }] });
    expect(html).not.toMatch(/<script|<i>/);
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
