/**
 * The member's own download: their journal as Markdown (readable anywhere)
 * or everything as JSON (journal plus reading plans, completions,
 * bookmarks, highlights, and reader settings). Built from data the database
 * returned to the owner; nothing is fetched for anyone else.
 */
export type ExportedEntry = {
  title: string;
  body: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  link: { kind: string; label?: string | null; plan_title?: string | null; title?: string | null; question?: string | null; translation_code?: string | null; available?: boolean } | null;
};

function linkLine(link: ExportedEntry["link"]): string | null {
  if (!link) return null;
  switch (link.kind) {
    case "passage":
      return `Passage: ${link.label ?? "a passage"}${link.translation_code ? ` (${link.translation_code})` : ""}`;
    case "assignment":
      return link.available && link.plan_title ? `Reading plan: ${link.plan_title}, ${link.label}` : "Reading plan: a reading that is no longer available";
    case "devotional":
    case "lesson":
      return link.available && link.title ? `${link.kind === "lesson" ? "Sunday lesson" : "Devotional"}: ${link.title}` : `A ${link.kind === "lesson" ? "Sunday lesson" : "devotional"} that is no longer available`;
    default:
      return null;
  }
}

export function journalMarkdown(entries: ExportedEntry[], exportedAt: string): string {
  const out = [`# My Journal`, ``, `Exported ${exportedAt.slice(0, 10)}. ${entries.length} ${entries.length === 1 ? "entry" : "entries"}.`, ``];
  for (const e of entries) {
    out.push(`---`, ``, `## ${e.title.trim() || "Untitled"}`, ``);
    const meta = [`Written ${e.created_at.slice(0, 10)}`, e.updated_at.slice(0, 10) !== e.created_at.slice(0, 10) ? `edited ${e.updated_at.slice(0, 10)}` : null, e.status === "archived" ? "archived" : null]
      .filter(Boolean)
      .join(", ");
    out.push(`*${meta}*`, ``);
    const link = linkLine(e.link);
    if (link) out.push(`> ${link}`, ``);
    if (e.link?.question) out.push(`> Question: ${e.link.question}`, ``);
    out.push(e.body.trim(), ``);
  }
  return out.join("\n");
}

/** A file name with the date ("my-journal-2026-10-20.md"). */
export function exportFileName(kind: "journal" | "reading", ext: "md" | "json", date: string): string {
  return `${kind === "journal" ? "my-journal" : "my-bible-reading"}-${date.slice(0, 10)}.${ext}`;
}
