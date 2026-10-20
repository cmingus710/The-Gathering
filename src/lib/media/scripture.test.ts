import { describe, expect, it } from "vitest";
import { bookOf, normalizeReference, parseReferenceList } from "./scripture";

describe("scripture references", () => {
  it("normalizes book names, abbreviations, numbered books, and passages", () => {
    expect(normalizeReference("jn 3:16-18")).toBe("John 3:16–18");
    expect(normalizeReference("John 3:16")).toBe("John 3:16");
    expect(normalizeReference("1 cor 13")).toBe("1 Corinthians 13");
    expect(normalizeReference("II Kings 2:1–11")).toBe("2 Kings 2:1–11");
    expect(normalizeReference("First John 4:7")).toBe("1 John 4:7");
    expect(normalizeReference("Ps. 23")).toBe("Psalms 23");
    expect(normalizeReference("Song of Solomon 2")).toBe("Song of Songs 2");
    expect(normalizeReference("Rom 8:28-9:1")).toBe("Romans 8:28–9:1");
    expect(normalizeReference("Matthew 5:3-12, 14")).toBe("Matthew 5:3–12, 14");
    expect(normalizeReference("Ruth")).toBe("Ruth");
  });

  it("rejects unknown books and malformed passages rather than guessing", () => {
    expect(normalizeReference("Hezekiah 3:1")).toBeNull();
    expect(normalizeReference("John 3:16 <script>")).toBeNull();
    expect(normalizeReference("")).toBeNull();
    const { refs, invalid } = parseReferenceList("jn 3:16; Hezekiah 1\n1 pet 2:9; jn 3:16");
    expect(refs).toEqual(["John 3:16", "1 Peter 2:9"]);
    expect(invalid).toEqual(["Hezekiah 1"]);
  });

  it("finds the book of a canonical reference without confusing numbered books", () => {
    expect(bookOf("1 John 3:1")).toBe("1 John");
    expect(bookOf("John 3:1")).toBe("John");
    expect(bookOf("Song of Songs 2")).toBe("Song of Songs");
  });
});
