import type { ItemCard } from "./types";

/**
 * Book collections: a book's topics ("Organize → Topics") group it into
 * collections on the Books page. There is no separate collection record; the
 * database (media_book_collections / media_books) returns only topics with a
 * book the reader can open, with counts and covers for those books alone.
 */
export type CollectionCover = NonNullable<ItemCard["cover"]>;
export type CollectionSummary = { id: string; name: string; count: number; covers: CollectionCover[] };
export type BookCollections = { all: { count: number; covers: CollectionCover[] }; collections: CollectionSummary[] };
export type CollectionBooks = { collection: { id: string; name: string } | null; q: string | null; total: number; books: ItemCard[] };

/** The address segment for All Books; every other collection is its topic id. */
export const ALL_BOOKS = "all";
export const ALL_BOOKS_LABEL = "All Books";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A collection address segment: "all" or a topic id. Anything else is not a collection. */
export function parseCollection(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === ALL_BOOKS) return ALL_BOOKS;
  return UUID.test(value) ? value.toLowerCase() : null;
}

/** A search box value: trimmed, single-spaced, at most 80 characters. */
export function parseBookQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

export function collectionHref(collection: string, q?: string | null): string {
  const base = `/reading/collections/${encodeURIComponent(collection)}`;
  return q ? `${base}?${new URLSearchParams({ q })}` : base;
}

/** A book opened from a collection: the book page links back to that collection. */
export function bookInCollectionHref(bookId: string, collection: string): string {
  return `/reading/books/${bookId}?${new URLSearchParams({ from: collection })}`;
}

/**
 * The collection a book page was opened from, for its back link: All Books,
 * or one of this book's own topics (so the link never names a collection the
 * book isn't in). Otherwise null, and the page goes back to Books.
 */
export function returnCollection(from: unknown, topics: Array<{ id: string; name: string }>): { collection: string; label: string } | null {
  const key = parseCollection(from);
  if (!key) return null;
  if (key === ALL_BOOKS) return { collection: ALL_BOOKS, label: ALL_BOOKS_LABEL };
  const topic = topics.find((t) => t.id.toLowerCase() === key);
  return topic ? { collection: topic.id, label: topic.name } : null;
}

export function bookCount(n: number): string {
  return `${n} ${n === 1 ? "book" : "books"}`;
}

/**
 * Topic names as an administrator typed them (comma or line separated):
 * trimmed, inner whitespace collapsed, and duplicates that differ only in
 * capitalization or spacing dropped (the first spelling wins). The database
 * applies the same rule and reuses an existing topic's own spelling.
 */
export function normalizeTopicNames(value: string, limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const name = raw.replace(/[\s   ﻿]+/g, " ").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Suggestions for the topic being typed (the text after the last comma):
 * existing topics that start with it first, then ones containing it, leaving
 * out topics already listed in the field.
 */
export function suggestTopics(value: string, topics: string[], limit = 8): string[] {
  const parts = value.split(",");
  const typed = parts[parts.length - 1].replace(/\s+/g, " ").trim();
  const current = typed.toLowerCase();
  if (!current) return [];
  const chosen = new Set(parts.slice(0, -1).map((p) => p.replace(/\s+/g, " ").trim().toLowerCase()));
  // An exact match is still offered in its saved spelling ("rob's reads" → "Rob's Reads").
  const pool = topics.filter((t) => !chosen.has(t.toLowerCase()) && t !== typed);
  const starts = pool.filter((t) => t.toLowerCase().startsWith(current));
  const contains = pool.filter((t) => !t.toLowerCase().startsWith(current) && t.toLowerCase().includes(current));
  return [...starts, ...contains].slice(0, limit);
}

/** The field's value with the topic being typed replaced by `topic`, ready for the next one. */
export function applyTopicSuggestion(value: string, topic: string): string {
  const parts = value.split(",");
  parts[parts.length - 1] = parts.length > 1 ? ` ${topic}` : topic;
  return `${parts.join(",")}, `;
}
