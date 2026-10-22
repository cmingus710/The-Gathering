import { NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentDetail } from "@/components/media/content-detail";
import { PRIVACY_COPY } from "@/components/media/workbook-view";
import { isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { teachingViewer } from "@/lib/media/viewer";
import type { Workbook } from "@/lib/media/workbook";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sunday lesson" };

export default async function LessonPage({ params }: PageProps<"/lessons/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [viewer, supabase] = await Promise.all([teachingViewer(), requireClient()]);
  const [page, wb] = await Promise.all([
    loadItemPage(supabase, id, ["lesson"]),
    // Approved adult members only; the database refuses everyone else.
    viewer.member ? supabase.rpc("media_lesson_workbook", { p_item: id, p_preview: false }) : Promise.resolve(null),
  ]);
  if (!page) notFound();
  const workbook = wb && !wb.error ? (wb.data as Workbook) : null;
  const questions = workbook?.blocks.filter((b) => b.answerable).length ?? 0;
  const answered = workbook?.answers.filter((a) => a.state !== "removed" && a.body.trim()).length ?? 0;
  return (
    <>
      <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/lessons" className="font-semibold text-primary hover:underline">
          All Sunday lessons
        </Link>
        {workbook ? (
          <Link href="/lessons/workbooks" className="font-semibold text-primary hover:underline">
            My workbooks
          </Link>
        ) : null}
      </p>
      {workbook && (workbook.blocks.length || workbook.answers.length || workbook.note) ? (
        <Link href={`/lessons/${id}/workbook`} className="interactive mb-6 flex items-center gap-3 rounded-card border border-primary bg-primary-soft p-4 hover:bg-surface-muted/60">
          <NotebookPen className="size-6 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Open workbook</span>
            <span className="block text-meta text-text-secondary">
              {questions ? `${answered} of ${questions} question${questions === 1 ? "" : "s"} answered. ` : ""}
              {PRIVACY_COPY}
            </span>
          </span>
        </Link>
      ) : null}
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member={viewer.member} origin={getSiteUrl()} />
    </>
  );
}
