import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookAccess } from "./book-access";

const KINDLE = "https://www.amazon.com/dp/B0123ABCDE";
const AUDIBLE = "https://www.audible.com/pd/B0123ABCDE";
const render = (kindleUrl: string | null, audibleUrl: string | null) => renderToStaticMarkup(createElement(BookAccess, { kindleUrl, audibleUrl }));
const links = (html: string) => [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, "") }));

describe("BookAccess (Read on Kindle / Listen on Audible)", () => {
  it("shows both buttons together, Kindle first and primary", () => {
    const html = render(KINDLE, AUDIBLE);
    const [kindle, audible] = links(html);
    expect(links(html)).toHaveLength(2);
    expect(kindle.text).toBe("Read on Kindle (opens Amazon in a new tab)");
    expect(kindle.attrs).toContain(`href="${KINDLE}"`);
    expect(kindle.attrs).toContain("bg-cta");
    expect(audible.text).toBe("Listen on Audible (opens Audible in a new tab)");
    expect(audible.attrs).toContain(`href="${AUDIBLE}"`);
    expect(audible.attrs).not.toContain("bg-cta");
    expect(html).toContain("Opens Amazon and Audible with your own account.");
  });

  it("shows only Kindle when only the Kindle link exists", () => {
    const html = render(KINDLE, null);
    expect(links(html).map((l) => l.text)).toEqual(["Read on Kindle (opens Amazon in a new tab)"]);
    expect(html).not.toMatch(/Listen on Audible|audible\.com|Audible app/);
  });

  it("shows only Audible, as the primary button, when only the Audible link exists", () => {
    const html = render(null, AUDIBLE);
    const all = links(html);
    expect(all.map((l) => l.text)).toEqual(["Listen on Audible (opens Audible in a new tab)"]);
    expect(all[0].attrs).toContain("bg-cta");
    expect(html).not.toMatch(/Read on Kindle|amazon\.|Opens Amazon/);
  });

  it("renders nothing when neither link exists", () => {
    expect(render(null, null)).toBe("");
  });

  it("opens links externally and safely, stacks on phones, and doesn't promise the app opens", () => {
    const html = render(KINDLE, AUDIBLE);
    for (const l of links(html)) {
      expect(l.attrs).toContain('target="_blank"');
      expect(l.attrs).toContain('rel="noopener noreferrer"');
    }
    expect(html).toContain("flex flex-col gap-2 sm:flex-row");
    expect(html).toContain("may offer to open it");
    expect(html).not.toMatch(/will open the (Kindle|Audible) app|kindle:\/\//i);
  });
});
