import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentDetail } from "@/components/media/content-detail";
import { isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { teachingViewer } from "@/lib/media/viewer";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sunday lesson" };

export default async function LessonPage({ params }: PageProps<"/lessons/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [viewer, supabase] = await Promise.all([teachingViewer(), requireClient()]);
  const page = await loadItemPage(supabase, id, ["lesson"]);
  if (!page) notFound();
  return (
    <>
      <p className="mb-4">
        <Link href="/lessons" className="font-semibold text-primary hover:underline">
          All Sunday lessons
        </Link>
      </p>
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member={viewer.member} origin={getSiteUrl()} />
    </>
  );
}
