import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportDetailView } from "@/components/community/report-detail";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { ReportDetail } from "@/lib/community/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({ params }: PageProps<"/admin/moderation/[id]">) {
  const { id } = await params;
  await requireCapability(CAPABILITIES.communityModerate, `/admin/moderation/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [report, { settings }] = await Promise.all([tryCommunityRpc<ReportDetail>("community_mod_report", { p_id: id }), getChurchSettings()]);
  if (!report) notFound();
  return (
    <>
      <Link href="/admin/moderation" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Moderation
      </Link>
      <PageHeader title="Review report" description="Opening this report is recorded in the moderation log." />
      <ReportDetailView report={report} tz={settings.timezone} />
    </>
  );
}
