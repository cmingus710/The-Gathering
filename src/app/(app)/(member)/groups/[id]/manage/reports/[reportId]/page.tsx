import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportDetailView } from "@/components/community/report-detail";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { ReportDetail } from "@/lib/community/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Report" };

export default async function GroupReportPage({ params }: PageProps<"/groups/[id]/manage/reports/[reportId]">) {
  const { id, reportId } = await params;
  await requireApprovedMember(`/groups/${id}/manage/reports/${reportId}`);
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(reportId)) notFound();
  // The database allows only reports in this leader's group that aren't about a leader.
  const [report, { settings }] = await Promise.all([tryCommunityRpc<ReportDetail>("community_mod_report", { p_id: reportId }), getChurchSettings()]);
  if (!report || report.group_id !== id) notFound();
  return (
    <>
      <BackLink route="/groups/[id]/manage/reports/[reportId]" params={{ id }} />
      <PageHeader title="Review report" description="Opening this report is recorded. Act only within this group." />
      <ReportDetailView report={report} tz={settings.timezone} />
    </>
  );
}
