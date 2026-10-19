import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { SOURCE_LABEL, STATUS_LABEL, dateRange, type FinanceFund, type FinancePayment } from "@/lib/giving/finance";
import { formatCents } from "@/lib/giving/money";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { DateRangeForm } from "../date-range-form";
import { FinanceNav, TestModeNotice } from "../finance-nav";

export const metadata: Metadata = { title: "Contributions" };
const PAGE = 50;
const select = "min-h-11 rounded-control border border-border-strong bg-surface px-3";

function fee(p: FinancePayment) {
  if (p.source !== "stripe" || p.status !== "succeeded") return "—";
  if (p.fee_status === "known" && p.fee_cents != null) return formatCents(p.fee_cents);
  return p.fee_status === "unavailable" ? "Unavailable" : "Pending";
}

export default async function ContributionsPage({ searchParams }: PageProps<"/admin/finance/contributions">) {
  const viewer = await requireCapability(CAPABILITIES.financeView, "/admin/finance/contributions");
  const [{ settings }, params, supabase] = await Promise.all([getChurchSettings(), searchParams, requireClient()]);
  const range = dateRange(params, settings.timezone);
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 80) : "");
  const page = Math.max(1, Number.parseInt(str("page") || "1", 10) || 1);
  const filters = {
    from: range.fromUtc.toISOString(),
    to: range.toUtc.toISOString(),
    fund_id: /^[0-9a-f-]{36}$/i.test(str("fund")) ? str("fund") : "",
    source: ["stripe", "cash", "check"].includes(str("method")) ? str("method") : "",
    status: Object.keys(STATUS_LABEL).includes(str("status")) ? str("status") : "",
    q: str("q"),
    limit: PAGE,
    offset: (page - 1) * PAGE,
  };
  const [{ data, error }, { data: funds }] = await Promise.all([
    supabase.rpc("finance_contributions", { p_filters: filters }),
    supabase.rpc("finance_funds"),
  ]);
  const result = data as { total: number; rows: FinancePayment[] } | null;
  const qs = new URLSearchParams({ from: range.from, to: range.to, fund: filters.fund_id, method: filters.source, status: filters.status, q: filters.q });
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="Giving"
        title="Contributions"
        actions={
          viewer.capabilities.has(CAPABILITIES.financeExport) ? (
            <a href={`/admin/finance/export?${qs}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-muted px-4 font-semibold">
              <Download className="size-4" aria-hidden="true" /> Export CSV
            </a>
          ) : null
        }
      />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/contributions" capabilities={viewer.capabilities} />
      <DateRangeForm action="/admin/finance/contributions" from={range.from} to={range.to}>
        <div>
          <label htmlFor="f-fund" className="block text-sm font-semibold">
            Fund
          </label>
          <select id="f-fund" name="fund" defaultValue={filters.fund_id} className={select}>
            <option value="">All funds</option>
            {((funds as FinanceFund[] | null) ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.active ? "" : " (archived)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-method" className="block text-sm font-semibold">
            Method
          </label>
          <select id="f-method" name="method" defaultValue={filters.source} className={select}>
            <option value="">All</option>
            <option value="stripe">Online</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="block text-sm font-semibold">
            Status
          </label>
          <select id="f-status" name="status" defaultValue={filters.status} className={select}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-q" className="block text-sm font-semibold">
            Donor
          </label>
          <input id="f-q" name="q" defaultValue={filters.q} placeholder="Name or email" className={select} />
        </div>
      </DateRangeForm>

      {error || !result ? (
        <Alert tone="error" title="Contributions couldn't be loaded right now." />
      ) : !result.rows.length ? (
        <EmptyState title="No contributions match these filters" />
      ) : (
        <>
          <p className="mb-2 text-[0.95rem] text-text-secondary">{result.total} record(s)</p>
          <div className="overflow-x-auto rounded-card bg-surface">
            <table className="w-full min-w-[56rem] text-left text-[0.95rem]">
              <thead className="border-b border-border text-sm text-text-secondary">
                <tr>
                  {["Date", "Donor", "Fund", "Method", "Status", "Amount", "Refunded", "Fee", "Net"].map((h, i) => (
                    <th key={h} scope="col" className={`px-4 py-3 font-semibold ${i >= 5 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/admin/finance/contributions/${p.id}`} className="font-semibold text-primary hover:underline">
                        {formatDate(p.date, settings.timezone)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{p.donor}</td>
                    <td className="px-4 py-3">{p.fund_name}</td>
                    <td className="px-4 py-3">
                      {SOURCE_LABEL[p.source]}
                      {p.frequency && p.frequency !== "one_time" ? " · recurring" : ""}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={p.status === "succeeded" ? (p.disputed ? "danger" : "success") : p.status === "pending" ? "warning" : "neutral"}>
                        {p.disputed ? "Disputed" : STATUS_LABEL[p.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">{formatCents(p.amount_cents)}</td>
                    <td className="px-4 py-3 text-right">{p.refunded_cents ? formatCents(p.refunded_cents) : "—"}</td>
                    <td className="px-4 py-3 text-right">{fee(p)}</td>
                    <td className="px-4 py-3 text-right">
                      {p.status !== "succeeded" ? "—" : p.source !== "stripe" ? formatCents(p.amount_cents - p.refunded_cents) : p.net_cents != null ? formatCents(p.net_cents - p.refunded_cents) : "Pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between">
              {page > 1 ? <ButtonLink href={`/admin/finance/contributions?${qs}&page=${page - 1}`} variant="secondary" size="sm">Previous</ButtonLink> : <span />}
              <span className="text-[0.95rem] text-text-secondary">
                Page {page} of {pages}
              </span>
              {page < pages ? <ButtonLink href={`/admin/finance/contributions?${qs}&page=${page + 1}`} variant="secondary" size="sm">Next</ButtonLink> : <span />}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
