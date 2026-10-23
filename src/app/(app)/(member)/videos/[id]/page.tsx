import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentDetail } from "@/components/media/content-detail";
import { BackLink } from "@/components/ui/back-link";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Video" };

/** One published video: player, description, topics, and where else it appears. */
export default async function VideoPage({ params }: PageProps<"/videos/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const [, page] = await Promise.all([requireApprovedMember(`/videos/${id}`), loadItemPage(supabase, id, ["video"])]);
  if (!page) notFound();
  return (
    <>
      <BackLink route="/videos/[id]" />
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member />
    </>
  );
}
