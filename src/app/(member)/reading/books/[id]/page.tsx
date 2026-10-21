import { CalendarDays, GraduationCap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookProgressForm } from "@/components/media/book-progress-form";
import { ContentDetail } from "@/components/media/content-detail";
import { formatDay, isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Church book" };

type BookExtras = {
  kindle_url: string | null;
  reading_starts_on: string | null;
  reading_ends_on: string | null;
  related_lesson: { id: string; title: string } | null;
  progress: { status: "want" | "reading" | "finished"; position: string | null; updated_at: string } | null;
};

export default async function BookPage({ params }: PageProps<"/reading/books/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const page = await loadItemPage(supabase, id, ["book"]);
  if (!page) notFound();
  // Phase 13 extras; the page still works (without them) before the migration is applied.
  const { data } = await supabase.rpc("media_book_extras", { p_item: id });
  const extras = (data as BookExtras | null) ?? null;
  const dates =
    extras?.reading_starts_on || extras?.reading_ends_on
      ? [extras.reading_starts_on ? formatDay(extras.reading_starts_on) : null, extras.reading_ends_on ? formatDay(extras.reading_ends_on) : null]
          .filter(Boolean)
          .join(" – ")
      : null;

  const panel = extras ? (
    <section aria-labelledby="my-reading-heading" className="space-y-4 rounded-card border border-border bg-surface p-5">
      <h2 id="my-reading-heading" className="font-semibold">
        My reading
      </h2>
      {dates ? (
        <p className="flex items-center gap-2 text-meta">
          <CalendarDays className="size-4 text-primary" aria-hidden="true" />
          <span>
            Church reading: <span className="font-semibold">{dates}</span>
          </span>
        </p>
      ) : null}
      {extras.related_lesson ? (
        <p className="flex items-center gap-2 text-meta">
          <GraduationCap className="size-4 text-primary" aria-hidden="true" />
          <span>
            Related lesson:{" "}
            <Link href={`/lessons/${extras.related_lesson.id}`} className="font-semibold text-primary hover:underline">
              {extras.related_lesson.title}
            </Link>
          </span>
        </p>
      ) : null}
      <BookProgressForm id={id} progress={extras.progress} />
      <p className="text-meta text-text-secondary">
        Your progress and notes are private. For notes, use <span className="font-semibold">Write privately</span> above; they&apos;re kept in My Journal.
      </p>
    </section>
  ) : null;

  return (
    <>
      <p className="mb-4">
        <Link href="/reading" className="font-semibold text-primary hover:underline">
          Church reading
        </Link>
      </p>
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member origin={getSiteUrl()} book={{ kindleUrl: extras?.kindle_url ?? null, panel }} />
    </>
  );
}
