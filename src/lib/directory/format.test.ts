import { describe, expect, it } from "vitest";
import { addressQuery, cityLine, dialable, formatBirthday, initials, mailtoHref, mapLinks, parsePage, parseQuery, smsHref, telHref } from "./format";

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

describe("contact actions", () => {
  it("dials international numbers without changing what is stored", () => {
    const stored = "+44 (0)20 7946 0958";
    expect(telHref(stored)).toBe("tel:+442079460958");
    expect(smsHref(stored)).toBe("sms:+442079460958");
    expect(stored).toBe("+44 (0)20 7946 0958");
    expect(dialable("+1 (555) 010-0100")).toBe("+15550100100");
    expect(dialable("0 (20) 7946 0958")).toBe("02079460958");
  });

  it("refuses numbers that can't be dialled", () => {
    expect(telHref("123")).toBeNull();
    expect(smsHref("+1234567890123456")).toBeNull();
    expect(smsHref("")).toBeNull();
  });

  it("only builds mailto for plain addresses", () => {
    expect(mailtoHref("a@b.c?cc=evil@x.y")).toBeNull();
    expect(mailtoHref("a@b.c&body=x")).toBeNull();
    expect(mailtoHref(" person@example.test ")).toBe("mailto:person@example.test");
  });

  it("encodes addresses into HTTPS map links", () => {
    const q = addressQuery(["12 Elm St #4", null, "Springfield", "IL", "62701"]);
    expect(q).toBe("12 Elm St #4, Springfield, IL, 62701");
    const links = mapLinks(q)!;
    expect(links.map).toBe("https://www.google.com/maps/search/?api=1&query=12%20Elm%20St%20%234%2C%20Springfield%2C%20IL%2C%2062701");
    expect(links.directions.startsWith("https://www.google.com/maps/dir/?api=1&destination=")).toBe(true);
    expect(links.apple.startsWith("https://maps.apple.com/?daddr=")).toBe(true);
    for (const href of Object.values(links)) {
      expect(href).not.toMatch(/[\s#<>"]/);
      expect(new URL(href).protocol).toBe("https:");
    }
  });

  it("strips control characters and refuses empty addresses", () => {
    expect(addressQuery(["\u0000", "  "])).toBeNull();
    expect(mapLinks(null)).toBeNull();
    expect(addressQuery(["1 Main\nSt"])).toBe("1 Main St");
  });
});
