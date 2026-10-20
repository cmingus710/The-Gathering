import { Info } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { SOURCE_LABEL, dateRange } from "@/lib/giving/finance";
import { formatCents } from "@/lib/giving/money";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { DateRangeForm } from "./date-range-form";
import { FinanceNav, TestModeNotice } from "./finance-nav";

export const metadata: Metadata = { title: "Giving" };

type Summary = Record<string, number> & {
  by_fund: Array<{ fund_name: string; gross_cents: number; count: number }>;
  by_source: Array<{ source: string; gross_cents: number; count: number }>;
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <p className="text-meta font-semibold text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint ? <p className="mt-1 text-sm text-text-secondary">{hint}</p> : null}
    </div>
  );
}

export default async function FinanceOverview({ searchParams }: PageProps<"/admin/finance">) {
  const viewer = await requireCapability(CAPABILITIES.financeView, "/admin/finance");
  const [{ settings }, params, supabase] = await Promise.all([getChurchSettings(), searchParams, requireClient()]);
  const range = dateRange(params, settings.timezone);
  const { data, error } = await supabase.rpc("finance_summary", { p_from: range.fromUtc.toISOString(), p_to: range.toUtc.toISOString() });
  const s = data as Summary | null;

  return (
    <>
      <PageHeader eyebrow="Administration" title="Giving" description="Contribution totals for the selected dates (church time zone)." />
      <TestModeNotice />
      <FinanceNav current="/admin/finance" capabilities={viewer.capabilities} />
      <DateRangeForm action="/admin/finance" from={range.from} to={range.to} />
      {error || !s ? (
        <Alert tone="error" title="Totals couldn't be loaded right now." />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Gross received" value={formatCents(Number(s.gross_cents))} hint={`${s.gift_count} gift(s)`} />
            <Stat label="Refunded" value={formatCents(Number(s.refunded_cents))} />
            <Stat label="Lost to disputes" value={formatCents(Number(s.disputed_lost_cents))} hint={Number(s.disputed_open_cents) ? `${formatCents(Number(s.disputed_open_cents))} currently disputed` : undefined} />
            <Stat
              label="Processing fees"
              value={formatCents(Number(s.fees_cents))}
              hint={Number(s.fees_pending_count) ? `Fee pending or unavailable for ${s.fees_pending_count} gift(s)` : "Actual fees reported by Stripe"}
            />
            <Stat label="Net proceeds" value={formatCents(Number(s.net_cents))} hint="Gross − fees − refunds − lost disputes" />
            <Stat label="Pending" value={formatCents(Number(s.pending_cents))} hint={`${s.pending_count} payment(s) awaiting confirmation; not counted above`} />
          </div>
          <Alert tone="info" title="Net proceeds are not bank deposits." live={false}>
            Stripe pays out to the bank on its own schedule, often combining several days. Payouts and transfers are not gifts
            and aren&apos;t recorded here; see Payouts in the Stripe Dashboard. Cash and check gifts have no processing fees.
          </Alert>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <SectionHeading>By fund</SectionHeading>
              {s.by_fund.length ? (
                <table className="w-full text-left">
                  <thead className="text-sm text-text-secondary">
                    <tr>
                      <th className="py-2 font-semibold">Fund</th>
                      <th className="py-2 text-right font-semibold">Gifts</th>
                      <th className="py-2 text-right font-semibold">Gross</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {s.by_fund.map((f) => (
                      <tr key={f.fund_name}>
                        <td className="py-2">{f.fund_name}</td>
                        <td className="py-2 text-right">{f.count}</td>
                        <td className="py-2 text-right">{formatCents(Number(f.gross_cents))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-text-secondary">No gifts in this period.</p>
              )}
            </Card>
            <Card>
              <SectionHeading>By method</SectionHeading>
              {s.by_source.length ? (
                <ul className="divide-y divide-border">
                  {s.by_source.map((x) => (
                    <li key={x.source} className="flex justify-between py-2">
                      <span>{SOURCE_LABEL[x.source] ?? x.source}</span>
                      <span>
                        {x.count} · {formatCents(Number(x.gross_cents))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-text-secondary">No gifts in this period.</p>
              )}
              <p className="mt-3 flex items-start gap-2 text-sm text-text-secondary">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {s.active_commitments} active recurring gift(s).
              </p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
