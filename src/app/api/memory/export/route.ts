import { NO_STORE, dbError, signedInClient } from "@/lib/memory/route";

export const dynamic = "force-dynamic";

/** The member's own practice data as JSON (verses, results, badges). */
export async function GET() {
  const caller = await signedInClient();
  if (caller instanceof Response) return caller;
  const { data, error } = await caller.supabase.rpc("memory_export");
  if (error) return dbError(error);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { ...NO_STORE, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="memory-verses-${date}.json"` },
  });
}
