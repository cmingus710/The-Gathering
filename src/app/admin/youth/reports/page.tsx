import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { ReportList, type YouthReport } from "@/components/youth/reports";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Safeguarding reports" };

export default async function SafeguardingPage() {
  await requireCapability(CAPABILITIES.youthSafeguarding, "/admin/youth/reports");
  const { data, failed } = await youthRead<YouthReport[]>("youth_reports", { p_status: "open" });
  return (
    <>
      <PageHeader
        title="Safeguarding reports"
        description="Every open youth report you may review, including reports about leaders of groups you don't lead. You never see reports you made or that are about you. Evidence is cleared 180 days after a report is resolved."
      />
      {failed || !data ? <Alert tone="error" title="Reports couldn't be loaded right now." /> : <ReportList reports={data} />}
    </>
  );
}
