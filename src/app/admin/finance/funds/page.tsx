import type { Metadata } from "next";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import type { FinanceFund } from "@/lib/giving/finance";
import { requireClient } from "@/lib/supabase/server";
import { FinanceNav, TestModeNotice } from "../finance-nav";
import { FundForm } from "../finance-forms";

export const metadata: Metadata = { title: "Funds" };

export default async function FundsPage() {
  const viewer = await requireCapability(CAPABILITIES.financeView, "/admin/finance/funds");
  const supabase = await requireClient();
  const { data } = await supabase.rpc("finance_funds");
  const funds = (data as FinanceFund[] | null) ?? [];
  const canManage = viewer.capabilities.has(CAPABILITIES.financeManage);
  return (
    <>
      <PageHeader eyebrow="Giving" title="Funds" description="Each gift goes to one fund. Renaming or archiving a fund never changes past gifts." />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/funds" capabilities={viewer.capabilities} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <SectionHeading>Funds</SectionHeading>
          <ul className="divide-y divide-border">
            {funds.map((f) => (
              <li key={f.id}>
                {canManage ? <FundForm fund={f} /> : (
                  <p className="py-3"><span className="font-semibold">{f.name}</span>{f.active ? "" : " (archived)"}</p>
                )}
                <p className="pb-3 text-sm text-text-secondary">{f.gift_count} received gift(s){f.active ? "" : " · archived: hidden from donors"}</p>
              </li>
            ))}
          </ul>
        </Card>
        {canManage ? (
          <Card>
            <SectionHeading>Add a fund</SectionHeading>
            <FundForm />
          </Card>
        ) : null}
      </div>
    </>
  );
}
