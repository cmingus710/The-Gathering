import { exportFileName, journalMarkdown, type ExportedEntry } from "@/lib/journal/export";
import { NO_STORE, dbError, signedInClient } from "@/lib/journal/route";

export const dynamic = "force-dynamic";

/**
 * The member's own download (rate-limited in the database):
 *   ?scope=journal&format=md     My Journal as Markdown
 *   ?scope=journal&format=json   My Journal as JSON
 *   ?scope=reading               reading plans, completions, bookmarks,
 *                                highlights, reader settings (JSON)
 *   ?scope=all                   both (JSON)
 */
export async function GET(request: Request) {
  const caller = await signedInClient();
  if (caller instanceof Response) return caller;
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "journal";
  const format = url.searchParams.get("format") === "md" ? "md" : "json";
  const date = new Date().toISOString();
  const headers = (name: string, type: string) => ({ ...NO_STORE, "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` });

  if (scope === "reading" || scope === "all") {
    const reading = await caller.supabase.rpc("bible_my_reading_export");
    if (reading.error) return dbError(reading.error);
    let body: unknown = reading.data;
    if (scope === "all") {
      const journal = await caller.supabase.rpc("journal_export");
      if (journal.error) return dbError(journal.error);
      body = { reading: reading.data, journal: journal.data };
    }
    return new Response(JSON.stringify(body, null, 2), { headers: headers(exportFileName("reading", "json", date), "application/json; charset=utf-8") });
  }
  const { data, error } = await caller.supabase.rpc("journal_export");
  if (error) return dbError(error);
  const j = data as { exported_at: string; entries: ExportedEntry[] };
  if (format === "md") {
    return new Response(journalMarkdown(j.entries, j.exported_at), { headers: headers(exportFileName("journal", "md", date), "text/markdown; charset=utf-8") });
  }
  return new Response(JSON.stringify(j, null, 2), { headers: headers(exportFileName("journal", "json", date), "application/json; charset=utf-8") });
}
