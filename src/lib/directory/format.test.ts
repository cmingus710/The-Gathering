import { describe, expect, it } from "vitest";
import { cityLine, formatBirthday, initials, mailtoHref, parsePage, parseQuery, telHref } from "./format";

describe("directory formatting", () => {
  it("formats month/day birthdays without a year", () => {
    expect(formatBirthday(2, 29)).toBe("February 29");
    expect(formatBirthday(null, 4)).toBeNull();
    expect(formatBirthday(13, 1)).toBeNull();
  });

  it("builds initials for the photo fallback", () => {
    expect(initials("Alice Example")).toBe("AE");
    expect(initials("  mary ann  smith ")).toBe("MS");
    expect(initials("Cher")).toBe("C");
    expect(initials("")).toBe("?");
  });

  it("builds safe tel: and mailto: links only for usable values", () => {
    expect(telHref("(555) 010-0100")).toBe("tel:5550100100");
    expect(telHref("+1 555 010 0100")).toBe("tel:+15550100100");
    expect(telHref("12")).toBeNull();
    expect(mailtoHref("person@example.test")).toBe("mailto:person@example.test");
    expect(mailtoHref("javascript:alert(1)")).toBeNull();
    expect(mailtoHref('a@b.c"><script>')).toBeNull();
  });

  it("joins city, state, and postal code", () => {
    expect(cityLine("Testville", "TS")).toBe("Testville, TS");
    expect(cityLine("Testville", "TS", "00001")).toBe("Testville, TS 00001");
    expect(cityLine(null, null)).toBeNull();
  });

  it("bounds page numbers and search text from the URL", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(["2"])).toBe(1);
    expect(parseQuery("  hello ")).toBe("hello");
    expect(parseQuery("x".repeat(200))).toHaveLength(80);
    expect(parseQuery(undefined)).toBe("");
  });
});
