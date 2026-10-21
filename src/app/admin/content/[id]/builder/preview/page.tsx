import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkbookView } from "@/components/media/workbook-view";
import { Alert } from "@/components/ui/alert";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { loadWorkbookPage } from "@/lib/media/workbook-page";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Workbook preview" };

/**
 * The member workbook exactly as members receive it: the same database
 * projection (media_lesson_workbook in preview mode), which never includes
 * teacher-only blocks or teacher notes. Drafts included; no answers.
 */
export default async function WorkbookPreviewPage({ params }: PageProps<"/admin/content/[id]/builder/preview">) {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const page = await loadWorkbookPage(supabase, id, true);
  if (!page) notFound();
  if ("error" in page) return <Alert tone="error" title={page.error} />;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 space-y-3">
        <p>
          <Link href={`/admin/content/${id}/builder`} className="font-semibold text-primary hover:underline">
            Back to the lesson builder
          </Link>
        </p>
        <Alert tone="info" title="Preview of the member workbook">
          This is exactly what members receive. Teacher-only blocks and teacher notes aren&apos;t part of it. Answer boxes are disabled here, and
          members&apos; answers are never shown to teachers or administrators.
        </Alert>
      </div>
      <WorkbookView page={page} userId={null} origin={getSiteUrl()} />
    </div>
  );
}
