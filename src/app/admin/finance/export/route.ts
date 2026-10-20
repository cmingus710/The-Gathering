import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getViewer } from "@/lib/auth/viewer";
import { centsToDecimal, toCsv } from "@/lib/giving/csv";
import { SOURCE_LABEL, STATUS_LABEL, dateRange, type FinancePayment } from "@/lib/giving/finance";
import { getChurchSettings } from "@/lib/settings/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** CSV export (finance.export). Cells are protected against formula injection. */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.state !== "signed-in" || !viewer.viewer.capabilities.has(CAPABILITIES.financeExport)) return new Response("Not authorized", { status: 403 });
  const supabase = await createClient();
  if (!supabase) return new Response("Unavailable", { status: 503 });
  const { settings } = await getChurchSettings();
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);
  const range = dateRange(p, settings.timezone);
  const filters = {
    from: range.fromUtc.toISOString(),
    to: range.toUtc.toISOString(),
    fund_id: /^[0-9a-f-]{36}$/i.test(p.fund ?? "") ? p.fund : "",
    source: ["stripe", "cash", "check"].includes(p.method ?? "") ? p.method : "",
    status: Object.keys(STATUS_LABEL).includes(p.status ?? "") ? p.status : "",
    q: (p.q ?? "").slice(0, 80),
  };
  const { data, error } = await supabase.rpc("finance_export", { p_filters: filters });
  if (error || !data) return new Response("Not authorized", { status: 403 });
  const date = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const rows = (data as FinancePayment[]).map((x) => [
    x.id, date(x.date), x.donor, x.donor_email ?? "", x.fund_name, SOURCE_LABEL[x.source], x.frequency ?? "", STATUS_LABEL[x.status],
    centsToDecimal(x.amount_cents), centsToDecimal(x.refunded_cents), x.disputed ? "yes" : "no",
    x.source === "stripe" && x.status === "succeeded" ? (x.fee_status === "known" ? centsToDecimal(x.fee_cents) : x.fee_status) : "",
    x.source === "stripe" ? (x.net_cents != null ? centsToDecimal(x.net_cents) : "") : centsToDecimal(x.amount_cents),
    x.check_reference ?? "", x.stripe_payment_intent_id ?? x.stripe_invoice_id ?? "",
  ]);
  const csv = toCsv(
    ["id", "date", "donor", "email", "fund", "method", "frequency", "status", "amount_usd", "refunded_usd", "disputed", "fee_usd", "net_before_refunds_usd", "check_reference", "stripe_reference"],
    rows,
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contributions-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
