import { getViewer } from "@/lib/auth/viewer";
import { statementResponse } from "@/lib/giving/statement-response";
import { statementIsFinal, type StatementData } from "@/lib/giving/statement-pdf";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The signed-in account's own annual statement (PDF). */
export async function GET(_request: Request, ctx: RouteContext<"/giving/statement/[year]">) {
  const { year } = await ctx.params;
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return new Response("Not found", { status: 404 });
  const viewer = await getViewer();
  if (viewer.state !== "signed-in") return new Response("Sign in required", { status: 401 });
  const supabase = await createClient();
  if (!supabase) return new Response("Unavailable", { status: 503 });
  const { data, error } = await supabase.rpc("my_giving_statement", { p_year: y });
  if (error || !data) return new Response("Unavailable", { status: 503 });
  const statement = data as StatementData;
  // Members only receive statements once they are approved for release.
  if (!statementIsFinal(statement)) return new Response("Statements are not available yet", { status: 404 });
  return statementResponse(statement, `giving-statement-${y}.pdf`);
}
