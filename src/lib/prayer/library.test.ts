import { describe, expect, it } from "vitest";
import {
  copyText,
  decodeLibraryCursor,
  encodeLibraryCursor,
  filterCollections,
  libraryExcerpt,
  markdownToPlain,
  pickCategory,
  prayerHref,
  returnCollection,
  type Category,
} from "./library";

const ID = "6f1c0a4e-2b3d-4c5e-8f90-1a2b3c4d5e6f";

describe("library cursor", () => {
  it("round-trips the exact database time and id", () => {
    const c = encodeLibraryCursor({ id: ID, cursor_at: "2026-10-23T12:34:56.123456+00:00" });
    expect(decodeLibraryCursor(c)).toEqual({ before: "2026-10-23T12:34:56.123456+00:00", beforeId: ID });
  });
  it("refuses malformed cursors", () => {
    expect(decodeLibraryCursor("yesterday~" + ID)).toBeNull();
    expect(decodeLibraryCursor("2026-10-23T12:34:56Z~not-an-id")).toBeNull();
    expect(decodeLibraryCursor(["2026-10-23T12:34:56Z~" + ID])).toBeNull();
    expect(encodeLibraryCursor({ id: ID })).toBeNull();
  });
});

describe("pickCategory", () => {
  const cats: Category[] = [
    { id: ID, kind: "topic", name: "Family" },
    { id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", kind: "purpose", name: "Comfort" },
  ];
  it("accepts only a known id of the right kind", () => {
    expect(pickCategory(ID, cats, "topic")).toBe(ID);
    expect(pickCategory(ID, cats, "purpose")).toBeNull();
    expect(pickCategory("1f1c0a4e-2b3d-4c5e-8f90-1a2b3c4d5e6f", cats, "topic")).toBeNull();
    expect(pickCategory("Family", cats, "topic")).toBeNull();
    expect(pickCategory(undefined, cats, "topic")).toBeNull();
  });
});

describe("markdownToPlain", () => {
  it("keeps the words and link addresses, drops formatting", () => {
    expect(markdownToPlain("Lord, **hear** our _prayer_.\n\n- for [our town](https://example.org)\n- for https://example.org/x\n\n\n\nAmen")).toBe(
      "Lord, hear our prayer.\n\n• for our town (https://example.org)\n• for https://example.org/x\n\nAmen",
    );
  });
  it("leaves snake_case and lone asterisks alone", () => {
    expect(markdownToPlain("a_b_c and 2 * 3")).toBe("a_b_c and 2 * 3");
  });
});

describe("copyText", () => {
  const base = { title: "Evening prayer", body: "Keep us, **Lord**.", contributor: "Ann Rivers", scripture_refs: [] as string[], source_url: null };
  it("credits the original source and the member who shared it", () => {
    expect(copyText({ ...base, origin: "shared", source_name: "Book of Common Prayer", source_url: "https://example.org/bcp" }, "The Gathering")).toBe(
      "Evening prayer\n\nKeep us, Lord.\n\n— Book of Common Prayer (https://example.org/bcp)\nShared by Ann Rivers · The Gathering Prayer Library",
    );
  });
  it("credits the contributor for an original prayer, with Scripture", () => {
    expect(copyText({ ...base, origin: "original", source_name: null, scripture_refs: ["Psalm 4:8", "John 14:27"] }, "Grace Church")).toBe(
      "Evening prayer\n\nKeep us, Lord.\n\n— Ann Rivers\nGrace Church Prayer Library\nScripture: Psalm 4:8; John 14:27",
    );
  });
  it("never drops attribution when a shared prayer has no named source", () => {
    expect(copyText({ ...base, origin: "shared", source_name: "  " }, "Grace Church")).toContain("— Another author or source");
  });
});

describe("libraryExcerpt", () => {
  it("never shows HTML tags, entities, or Markdown markers", () => {
    expect(libraryExcerpt("<p>Lord, <strong>hear</strong> us &amp; keep us.</p><br/>**Amen**")).toBe("Lord, hear us & keep us. Amen");
    expect(libraryExcerpt('<div class="x">Peace</div>&nbsp;&quot;be&quot; &#39;still&#39;')).toBe(`Peace "be" 'still'`);
    expect(libraryExcerpt("_Grace_ before [meals](https://example.org) &lt;b&gt;")).toBe("Grace before meals");
  });
  it("keeps hyphens inside words and plain text as it is", () => {
    expect(libraryExcerpt("A God-given day, well-loved.")).toBe("A God-given day, well-loved.");
    expect(libraryExcerpt("x".repeat(400)).length).toBeLessThanOrEqual(240);
  });
});

describe("collection helpers", () => {
  const collections = [
    { id: ID, name: "Morning Prayers", description: "To begin the day.", is_general: false },
    { id: "0f1c0a4e-2b3d-4c5e-8f90-1a2b3c4d5e6f", name: "General prayers", description: "Prayers that don't fit another collection yet.", is_general: true },
  ];
  it("finds collections by every typed word in their name or description", () => {
    expect(filterCollections(collections, "").map((c) => c.name)).toEqual(["Morning Prayers", "General prayers"]);
    expect(filterCollections(collections, "morn").map((c) => c.name)).toEqual(["Morning Prayers"]);
    expect(filterCollections(collections, "begin day").map((c) => c.name)).toEqual(["Morning Prayers"]);
    expect(filterCollections(collections, "fit  PRAYERS").map((c) => c.name)).toEqual(["General prayers"]);
    expect(filterCollections(collections, "evening")).toEqual([]);
  });
  it("returns to a collection only when the prayer is in it", () => {
    expect(returnCollection(ID, { id: ID, name: "Morning Prayers" })).toEqual({ id: ID, name: "Morning Prayers" });
    expect(returnCollection(ID.toUpperCase(), { id: ID, name: "Morning Prayers" })).toEqual({ id: ID, name: "Morning Prayers" });
    expect(returnCollection("0f1c0a4e-2b3d-4c5e-8f90-1a2b3c4d5e6f", { id: ID, name: "Morning Prayers" })).toBeNull();
    expect(returnCollection(ID, null)).toBeNull();
    expect(returnCollection(["x"], { id: ID, name: "Morning Prayers" })).toBeNull();
    expect(prayerHref(ID, ID)).toBe(`/prayer/library/${ID}?from=${ID}`);
    expect(prayerHref(ID)).toBe(`/prayer/library/${ID}`);
  });
});
