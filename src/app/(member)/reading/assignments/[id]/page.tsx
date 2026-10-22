import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ContentDetail } from "@/components/media/content-detail";
import { isUuid, readingHref } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reading assignment" };

/**
 * Old assignment address (bookmarks, notifications, the home page). The
 * assignment is loaded first, so the database decides whether the member
 * may see it (and its book) before anything is revealed or redirected.
 * When the book is visible, the member goes to the book's reading page with
 * this assignment selected; otherwise (or before 20261104000100 is applied)
 * the assignment is shown on its own, as before.
 */
export default async function AssignmentPage({ params }: PageProps<"/reading/assignments/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const page = await loadItemPage(supabase, id, ["assignment"]);
  if (!page) notFound();
  const book = page.item.book;
  if (book) {
    const { error } = await supabase.rpc("media_reading_plan", { p_book: book.id });
    if (!error) redirect(readingHref(book.id, id));
  }
  return (
    <>
      <p className="mb-4">
        <Link href="/reading" className="font-semibold text-primary hover:underline">
          Church reading
        </Link>
      </p>
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member origin={getSiteUrl()} />
    </>
  );
}
