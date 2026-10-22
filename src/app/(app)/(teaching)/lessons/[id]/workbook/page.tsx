import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PRIVACY_COPY, RemovedAnswers, WorkbookView } from "@/components/media/workbook-view";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { deleteWorkbookAction } from "@/lib/media/workbook-actions";
import { loadWorkbookPage } from "@/lib/media/workbook-page";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lesson workbook" };

/**
 * A member's private workbook for a lesson: the lesson's blocks in order
 * (never teacher-only content) with their own answers and notes.
 */
export default async function WorkbookPage({ params, searchParams }: PageProps<"/lessons/[id]/workbook">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const viewer = await requireApprovedMember(`/lessons/${id}/workbook`);
  const supabase = await requireClient();
  const page = await loadWorkbookPage(supabase, id, false);
  if (!page) notFound();
  if ("error" in page) return <Alert tone="error" title={page.error} />;
  const { workbook } = page;

  return (
    <>
      <div className="-mt-1 mb-3 flex flex-wrap items-center justify-between gap-x-4 sm:mb-4">
        {/* A lesson that's no longer available can't be opened; its workbook then belongs to My workbooks. */}
        <BackLink route="/lessons/[id]/workbook" params={{ id: workbook.available ? id : null }} inRow />
        {workbook.available ? (
          <Link href="/lessons/workbooks" className="inline-flex min-h-11 items-center text-meta font-semibold text-primary hover:underline">
            My workbooks
          </Link>
        ) : null}
      </div>
      {sp.error === "delete" ? <Alert tone="error" title="Your answers couldn't be deleted right now. Try again." className="mb-6" /> : null}
      {workbook.available ? (
        <WorkbookView page={page} userId={viewer.id} origin={getSiteUrl()} />
      ) : (
        <div className="space-y-6">
          <h1 className="font-display text-display font-semibold">Your workbook</h1>
          <Alert tone="info" title="This lesson isn't available any more.">
            Your answers and notes are still here, only for you. {PRIVACY_COPY}
          </Alert>
          <RemovedAnswers answers={workbook.answers} itemId={id} />
          {workbook.note?.body.trim() ? (
            <section aria-labelledby="old-note" className="space-y-2">
              <h2 id="old-note" className="text-lg font-semibold">
                My notes
              </h2>
              <p className="whitespace-pre-wrap rounded-card border border-border bg-surface p-4">{workbook.note.body}</p>
            </section>
          ) : null}
          <ConfirmDialog trigger="Delete my answers" title="Delete your answers and notes for this lesson?" confirmLabel="Delete" formAction={deleteWorkbookAction} hidden={{ item: id }}>
            This can&apos;t be undone.
          </ConfirmDialog>
        </div>
      )}
    </>
  );
}
