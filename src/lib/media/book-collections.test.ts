import { describe, expect, it } from "vitest";
import {
  applyTopicSuggestion,
  bookCount,
  bookInCollectionHref,
  collectionHref,
  normalizeTopicNames,
  parseBookQuery,
  parseCollection,
  returnCollection,
  suggestTopics,
} from "./book-collections";

const ID = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("book collections", () => {
  it("accepts only All Books or a topic id as a collection", () => {
    expect(parseCollection("all")).toBe("all");
    expect(parseCollection(ID.toUpperCase())).toBe(ID);
    for (const bad of ["", "ALL", "rob's-reads", `${ID}/x`, "../reading", undefined, ["all"]]) expect(parseCollection(bad)).toBeNull();
  });

  it("builds collection and book links that remember the collection", () => {
    expect(collectionHref("all")).toBe("/reading/collections/all");
    expect(collectionHref(ID, "rob's reads")).toBe(`/reading/collections/${ID}?q=rob%27s+reads`);
    expect(bookInCollectionHref(OTHER, ID)).toBe(`/reading/books/${OTHER}?from=${ID}`);
  });

  it("returns to a collection only when the book is in it", () => {
    const topics = [{ id: ID, name: "Rob's Reads" }];
    expect(returnCollection(ID, topics)).toEqual({ collection: ID, label: "Rob's Reads" });
    expect(returnCollection("all", topics)).toEqual({ collection: "all", label: "All Books" });
    expect(returnCollection(OTHER, topics)).toBeNull();
    expect(returnCollection("javascript:alert(1)", topics)).toBeNull();
    expect(returnCollection(null, topics)).toBeNull();
  });

  it("cleans search text", () => {
    expect(parseBookQuery("  rob's \n  reads ")).toBe("rob's reads");
    expect(parseBookQuery("x".repeat(100))).toHaveLength(80);
    expect(parseBookQuery(["a"])).toBe("");
  });

  it("counts books", () => {
    expect(bookCount(1)).toBe("1 book");
    expect(bookCount(0)).toBe("0 books");
    expect(bookCount(12)).toBe("12 books");
  });

  it("trims topic names and drops capitalization and spacing duplicates", () => {
    expect(normalizeTopicNames("  Rob's   Reads , rob's reads,\nClassics,, ROB'S READS ")).toEqual(["Rob's Reads", "Classics"]);
    expect(normalizeTopicNames(Array.from({ length: 30 }, (_, i) => `T${i}`).join(","))).toHaveLength(20);
  });

  it("suggests existing topics for the one being typed", () => {
    const topics = ["Classics", "Prayer", "Rob's Reads", "Reformation", "Church History"];
    expect(suggestTopics("r", topics)).toEqual(["Rob's Reads", "Reformation", "Prayer", "Church History"]);
    expect(suggestTopics("Classics, rob", topics)).toEqual(["Rob's Reads"]);
    expect(suggestTopics("Rob's Reads, r", topics)).toEqual(["Reformation", "Prayer", "Church History"]);
    expect(suggestTopics("rob's reads", topics)).toEqual(["Rob's Reads"]);
    expect(suggestTopics("Rob's Reads", topics)).toEqual([]);
    expect(suggestTopics("Classics, ", topics)).toEqual([]);
  });

  it("replaces the topic being typed with the suggestion", () => {
    expect(applyTopicSuggestion("rob", "Rob's Reads")).toBe("Rob's Reads, ");
    expect(applyTopicSuggestion("Classics, rob", "Rob's Reads")).toBe("Classics, Rob's Reads, ");
  });
});
