import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportDetailView } from "@/components/community/report-detail";
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
      <Link href={`/groups/${id}/manage/reports`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Reports
      </Link>
      <PageHeader title="Review report" description="Opening this report is recorded. Act only within this group." />
      <ReportDetailView report={report} tz={settings.timezone} />
    </>
  );
}
