import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentDetail } from "@/components/media/content-detail";
import { isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Church book" };

export default async function BookPage({ params }: PageProps<"/reading/books/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const page = await loadItemPage(supabase, id, ["book"]);
  if (!page) notFound();
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
