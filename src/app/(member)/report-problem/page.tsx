import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { sanitizePagePath } from "@/lib/feedback/report";
import { ReportProblemForm } from "./report-form";

export const metadata: Metadata = { title: "Report a problem" };

export default async function ReportProblemPage({ searchParams }: PageProps<"/report-problem">) {
  await requireApprovedMember("/report-problem");
  const { from } = await searchParams;
  const pagePath = sanitizePagePath(from);
  return (
    <>
      <PageHeader
        title="Report a problem"
        description="Something not working, confusing, or showing you something it shouldn't? Tell the church administrators. Reports are private to them and never posted to the community."
      />
      <div className="max-w-xl">
        <ReportProblemForm pagePath={pagePath} />
      </div>
    </>
  );
}
