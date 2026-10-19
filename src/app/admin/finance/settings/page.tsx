import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { FinanceNav, TestModeNotice } from "../finance-nav";
import { SettingsForm } from "../finance-forms";

export const metadata: Metadata = { title: "Giving settings" };

type Settings = {
  min_amount_cents: number; max_amount_cents: number; acknowledgment_message: string; statement_org_name: string | null;
  statement_org_address: string | null; statement_tax_id: string | null; statement_wording: string | null; statement_approved: boolean;
};

export default async function GivingSettingsPage() {
  const viewer = await requireCapability(CAPABILITIES.financeView, "/admin/finance/settings");
  const supabase = await requireClient();
  const { data } = await supabase.rpc("finance_settings");
  const s = data as Settings;
  return (
    <>
      <PageHeader eyebrow="Giving" title="Giving settings" description="Amount limits, acknowledgment wording, and annual statement details." />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/settings" capabilities={viewer.capabilities} />
      <Card>
        <SettingsForm
          readOnly={!viewer.capabilities.has(CAPABILITIES.financeManage)}
          initial={{
            minAmount: (s.min_amount_cents / 100).toFixed(2),
            maxAmount: (s.max_amount_cents / 100).toFixed(2),
            acknowledgment: s.acknowledgment_message,
            orgName: s.statement_org_name ?? "",
            orgAddress: s.statement_org_address ?? "",
            taxId: s.statement_tax_id ?? "",
            wording: s.statement_wording ?? "",
            approved: s.statement_approved,
          }}
        />
      </Card>
    </>
  );
}
