import { Flag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { REPORT_REASONS, type GroupDetail, type ReportSummary } from "@/lib/community/types";

export const metadata: Metadata = { title: "Group reports" };

export default async function GroupReportsPage({ params, searchParams }: PageProps<"/groups/[id]/manage/reports">) {
  const { id } = await params;
  await requireApprovedMember(`/groups/${id}/manage/reports`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const status = sp.status === "closed" ? "closed" : "open";
  const group = await tryCommunityRpc<GroupDetail>("community_group", { p_id: id });
  if (!group || group.my_role !== "leader") notFound();
  const reports = await tryCommunityRpc<ReportSummary[]>("community_mod_reports", { p_status: status, p_group: id });
  if (!reports) notFound();
  return (
    <>
      <BackLink route="/groups/[id]/manage/reports" params={{ id }} label={`Manage ${group.name}`} />
      <PageHeader title="Reports in this group" description="Only reports about this group's discussions. Reports about a leader are reviewed by community moderators." />
      <nav aria-label="Report status" className="mb-4 flex gap-2">
        <Link href={`/groups/${id}/manage/reports`} aria-current={status === "open" ? "page" : undefined} className="rounded-full px-4 py-2 font-semibold aria-[current=page]:bg-surface-muted">
          Open
        </Link>
        <Link href={`/groups/${id}/manage/reports?status=closed`} aria-current={status === "closed" ? "page" : undefined} className="rounded-full px-4 py-2 font-semibold aria-[current=page]:bg-surface-muted">
          Closed
        </Link>
      </nav>
      {reports.length ? (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id}>
              <Link href={`/groups/${id}/manage/reports/${r.id}`} className="block rounded-card border border-border bg-surface px-5 py-4 hover:bg-surface-muted">
                <span className="block font-semibold">{REPORT_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}</span>
                <span className="block text-meta text-text-secondary">
                  {r.target_type === "thread" ? "Discussion" : "Reply"} by {r.reported} · {relativeTime(r.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Flag className="size-6" aria-hidden="true" />} title={status === "open" ? "No open reports" : "No closed reports"} />
      )}
    </>
  );
}
