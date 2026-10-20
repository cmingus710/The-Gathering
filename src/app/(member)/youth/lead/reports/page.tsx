import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { ReportList, type YouthReport } from "@/components/youth/reports";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Youth reports" };

export default async function ReportsPage() {
  await requireApprovedMember("/youth/lead/reports");
  const { data, failed } = await youthRead<YouthReport[]>("youth_reports", { p_status: "open" });
  return (
    <>
      <PageHeader
        eyebrow="Leading"
        title="Reports"
        description="Reports about posts in your groups. Reports about a leader go to safeguarding reviewers outside that leader's groups, never to the leader."
      />
      {failed || !data ? <Alert tone="error" title="Reports couldn't be loaded right now." /> : <ReportList reports={data} />}
    </>
  );
}
