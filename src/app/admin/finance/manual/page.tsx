import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { todayIn, type FinanceFund } from "@/lib/giving/finance";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { FinanceNav, TestModeNotice } from "../finance-nav";
import { RecordManualForm } from "../finance-forms";

export const metadata: Metadata = { title: "Record a cash or check gift" };
type Donor = { id: string; name: string; email: string };

export default async function ManualGiftPage({ searchParams }: PageProps<"/admin/finance/manual">) {
  const viewer = await requireCapability(CAPABILITIES.financeRecord, "/admin/finance/manual");
  const [{ settings }, params, supabase] = await Promise.all([getChurchSettings(), searchParams, requireClient()]);
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const donorId = typeof params.donor === "string" && /^[0-9a-f-]{36}$/i.test(params.donor) ? params.donor : null;
  const [{ data: funds }, search] = await Promise.all([
    supabase.rpc("finance_funds"),
    q || donorId ? supabase.rpc("finance_donor_search", { p_query: q || "" }) : Promise.resolve({ data: [] }),
  ]);
  const results = (search.data as Donor[] | null) ?? [];
  let donor: Donor | null = null;
  if (donorId) {
    const found = (((await supabase.rpc("finance_donor_search", { p_query: q || "" })).data as Donor[] | null) ?? []).find((d) => d.id === donorId);
    donor = found ?? null;
  }

  return (
    <>
      <PageHeader eyebrow="Giving" title="Record a cash or check gift" description="Manual gifts are marked as cash or check and kept separate from online payments. Never record bank account numbers or check images." />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/manual" capabilities={viewer.capabilities} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <SectionHeading>Gift</SectionHeading>
          <RecordManualForm funds={(funds as FinanceFund[] | null) ?? []} donor={donor} today={todayIn(settings.timezone)} formToken={randomUUID()} />
        </Card>
        <Card>
          <SectionHeading>Donor (optional)</SectionHeading>
          <p className="mb-3 text-meta text-text-secondary">Link a member account so the gift appears in their history. Otherwise enter a name, or leave it unidentified.</p>
          <form action="/admin/finance/manual" className="mb-3 flex gap-2">
            <label htmlFor="donor-q" className="sr-only">Search members</label>
            <input id="donor-q" name="q" defaultValue={q} placeholder="Name or email" className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
            <button type="submit" className="min-h-11 rounded-full border border-border bg-surface-muted px-4 font-semibold">Search</button>
          </form>
          <ul className="divide-y divide-border">
            {results.map((d) => (
              <li key={d.id} className="py-2">
                <Link href={`/admin/finance/manual?q=${encodeURIComponent(q)}&donor=${d.id}`} aria-current={donor?.id === d.id ? "true" : undefined} className="block font-semibold text-primary hover:underline">
                  {d.name}
                </Link>
                <span className="text-sm text-text-secondary">{d.email}</span>
              </li>
            ))}
          </ul>
          {donor ? <Link href="/admin/finance/manual" className="mt-3 inline-block font-semibold text-primary underline">Clear donor</Link> : null}
        </Card>
      </div>
    </>
  );
}
