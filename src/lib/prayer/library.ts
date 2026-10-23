/**
 * Prayer Library: shapes returned by the prayer_library_* functions, and
 * the wording and small helpers its pages share. The database is the
 * authority for every rule (who can read, edit, save, report, moderate);
 * these only decide what to show.
 */
export const LIBRARY_LIMITS = { title: 120, body: 6000, source: 200, url: 500, report: 1000, topics: 8, purposes: 4, uses: 7 } as const;

export type CategoryKind = "topic" | "purpose" | "use";
export type Category = { id: string; kind: CategoryKind; name: string };
export type LibraryStatus = "draft" | "published" | "archived";
export type Origin = "original" | "shared";

export type LibraryCard = {
  id: string;
  title: string;
  excerpt: string;
  status: LibraryStatus;
  hidden: boolean;
  mod_archived: boolean;
  mine: boolean;
  contributor: string;
  origin: Origin;
  source_name: string | null;
  categories: Category[];
  saved: boolean;
  published_at: string | null;
  updated_at: string;
  edited_at: string | null;
  created_at: string;
  /** Keyset position in the list it came from (published_at, or updated_at under My prayers). */
  cursor_at?: string;
};

export type LibraryPage = { items: LibraryCard[]; has_more: boolean };

export type LibraryPrayer = LibraryCard & {
  body: string;
  source_url: string | null;
  scripture_refs: string[];
  archived_at: string | null;
  can_edit: boolean;
  can_save: boolean;
  can_report: boolean;
  reported: boolean;
  can_moderate: boolean;
  posting_restricted: boolean;
};

export type LibraryMeta = { categories: Category[]; can_moderate: boolean; can_manage: boolean; posting_restricted: boolean };

export type AdminCategory = Category & { sort_order: number; archived: boolean; published_count: number };

export type LibraryReportRow = { id: string; reason: string; status: string; created_at: string; title: string | null; reported: string };

export type LibraryReportDetail = {
  id: string;
  reason: string;
  details: string | null;
  status: "reviewing" | "actioned" | "dismissed";
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  reporter: string;
  reported: string;
  evidence: { title: string; body: string; contributor: string; origin: Origin; source_name: string | null; source_url: string | null } | null;
  prayer_id: string | null;
  current: { status: LibraryStatus; hidden: boolean; mod_archived: boolean } | null;
  log: Array<{ action: string; actor: string; reason: string | null; at: string }>;
};

export type ModeratedItem = {
  id: string;
  title: string;
  contributor: string;
  state: "hidden" | "archived";
  mine: boolean;
  at: string;
  last: { actor: string; reason: string | null } | null;
};

export const LIBRARY_VIEWS = ["library", "mine", "saved"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export const LIBRARY_VIEW_LABEL: Record<LibraryView, string> = { library: "All prayers", mine: "My prayers", saved: "Saved prayers" };

export const KIND_LABEL: Record<CategoryKind, string> = { topic: "Topic", purpose: "Purpose", use: "Intended use" };
export const KIND_PLURAL: Record<CategoryKind, string> = { topic: "Topics", purpose: "Purposes", use: "Intended uses" };
export const KINDS: CategoryKind[] = ["topic", "purpose", "use"];

export const STATUS_LABEL: Record<LibraryStatus, string> = { draft: "Draft", published: "Published", archived: "Archived" };

export const ORIGIN_LABEL: Record<Origin, string> = {
  original: "My own prayer",
  shared: "Shared from another author or source",
};

export const LIBRARY_REPORT_REASONS = [
  { value: "inappropriate", label: "Inappropriate or unkind" },
  { value: "permission", label: "Shared without permission" },
  { value: "privacy", label: "Shares someone's private information" },
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
] as const;

export const SHARING_REMINDER =
  "Share prayers you wrote, or ones you have permission to share, and name the author or source when it isn't yours. Leave out other people's names, health details, and anything private.";

/** Confirmation after a moderator action (the page it lands on shows it). */
export const MODERATION_DONE: Record<string, string> = {
  hide: "Hidden. Members can no longer find or open it.",
  archive: "Archived. Members can no longer find or open it.",
  restore: "Restored to the library.",
};

export function reasonLabel(value: string): string {
  return LIBRARY_REPORT_REASONS.find((r) => r.value === value)?.label ?? value;
}

/** Keyset cursor for "Show older prayers": the last card's position, exactly as returned, and its id. */
export function encodeLibraryCursor(card: Pick<LibraryCard, "id" | "cursor_at">): string | null {
  return card.cursor_at ? `${card.cursor_at}~${card.id}` : null;
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function decodeLibraryCursor(value: unknown): { before: string; beforeId: string } | null {
  if (typeof value !== "string") return null;
  const m = CURSOR.exec(value);
  return m && !Number.isNaN(Date.parse(m[1])) ? { before: m[1], beforeId: m[2] } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A category filter from the address bar: a known id of that kind, or null. */
export function pickCategory(value: unknown, categories: Category[], kind: CategoryKind): string | null {
  return typeof value === "string" && UUID.test(value) && categories.some((c) => c.id === value && c.kind === kind) ? value : null;
}

/**
 * Plain text from the library's Markdown subset, for copying: links become
 * "text (address)", emphasis and list markers are dropped, line breaks kept.
 */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) => (text === href ? href : `${text} (${href})`))
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The text "Copy prayer" puts on the clipboard: title, the prayer, and its
 * attribution (the original author or source, who shared it, and any
 * Scripture), so a copy never loses where it came from.
 */
export function copyText(p: Pick<LibraryPrayer, "title" | "body" | "origin" | "source_name" | "source_url" | "contributor" | "scripture_refs">, churchName: string): string {
  const lines = [p.title, "", markdownToPlain(p.body), ""];
  if (p.origin === "shared") {
    const source = p.source_name?.trim() || "Another author or source";
    lines.push(`— ${source}${p.source_url ? ` (${p.source_url})` : ""}`);
    lines.push(`Shared by ${p.contributor} · ${churchName} Prayer Library`);
  } else {
    lines.push(`— ${p.contributor}${p.source_name?.trim() ? `, ${p.source_name.trim()}` : ""}${p.source_url ? ` (${p.source_url})` : ""}`);
    lines.push(`${churchName} Prayer Library`);
  }
  if (p.scripture_refs.length) lines.push(`Scripture: ${p.scripture_refs.join("; ")}`);
  return lines.join("\n");
}
