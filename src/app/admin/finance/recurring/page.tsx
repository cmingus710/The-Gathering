import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { FREQUENCY_LABEL, formatCents, type Frequency } from "@/lib/giving/money";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { FinanceNav, TestModeNotice } from "../finance-nav";

export const metadata: Metadata = { title: "Recurring gifts" };

type Row = { id: string; donor: string; amount_cents: number; fund_name: string; frequency: Frequency; status: string; next_payment_at: string | null; created_at: string; payments_count: number };
const FILTERS = [
  { key: "active", label: "Active" },
  { key: "past_due", label: "Payment failed" },
  { key: "ended", label: "Ended" },
  { key: "", label: "All" },
];

export default async function RecurringPage({ searchParams }: PageProps<"/admin/finance/recurring">) {
  const viewer = await requireCapability(CAPABILITIES.financeView, "/admin/finance/recurring");
  const [{ settings }, params, supabase] = await Promise.all([getChurchSettings(), searchParams, requireClient()]);
  const status = FILTERS.find((f) => f.key === params.status)?.key ?? "active";
  const { data, error } = await supabase.rpc("finance_commitments", { p_status: status || null });
  const rows = (data as Row[] | null) ?? [];

  return (
    <>
      <PageHeader eyebrow="Giving" title="Recurring gifts" description="Commitments are separate from payments: only received payments count as contributions." />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/recurring" capabilities={viewer.capabilities} />
      <ul className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <li key={f.label}>
            <Link href={`/admin/finance/recurring?status=${f.key}`} aria-current={status === f.key ? "page" : undefined}
              className={cn("flex min-h-11 items-center rounded-full border px-4 font-semibold", status === f.key ? "border-text bg-text text-background" : "border-border-strong bg-surface")}>
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
      {error ? <Alert tone="error" title="Recurring gifts couldn't be loaded." /> : !rows.length ? <EmptyState title="No recurring gifts in this list" /> : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-5 py-4">
              <span>
                <span className="block font-semibold">{c.donor} · {formatCents(c.amount_cents)} {FREQUENCY_LABEL[c.frequency].toLowerCase()}</span>
                <span className="block text-[0.95rem] text-text-secondary">
                  {c.fund_name} · started {formatDate(c.created_at, settings.timezone)} · {c.payments_count} received
                  {c.next_payment_at ? ` · next ${formatDate(c.next_payment_at, settings.timezone)}` : ""}
                </span>
              </span>
              <Badge tone={c.status === "active" ? "success" : c.status === "past_due" ? "danger" : "neutral"}>{c.status.replace("_", " ")}</Badge>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
