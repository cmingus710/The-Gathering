import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getViewer } from "@/lib/auth/viewer";
import type { StatementData } from "@/lib/giving/statement-pdf";
import { statementResponse } from "@/lib/giving/statement-response";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Finance: a donor's statement for a year (drafts allowed, watermarked). */
export async function GET(_request: Request, ctx: RouteContext<"/admin/finance/statements/[profileId]/[year]">) {
  const { profileId, year } = await ctx.params;
  const y = Number(year);
  if (!/^[0-9a-f-]{36}$/i.test(profileId) || !Number.isInteger(y) || y < 2000 || y > 2100) return new Response("Not found", { status: 404 });
  const viewer = await getViewer();
  if (viewer.state !== "signed-in" || !viewer.viewer.capabilities.has(CAPABILITIES.financeView)) return new Response("Not authorized", { status: 403 });
  const supabase = await createClient();
  if (!supabase) return new Response("Unavailable", { status: 503 });
  const { data, error } = await supabase.rpc("finance_statement_data", { p_profile: profileId, p_year: y });
  if (error || !data) return new Response("Not authorized", { status: 403 });
  return statementResponse(data as StatementData, `giving-statement-${y}.pdf`);
}
