import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentDetail } from "@/components/media/content-detail";
import { BackLink } from "@/components/ui/back-link";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Playlist" };

export default async function PlaylistPage({ params }: PageProps<"/music/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const [, page] = await Promise.all([requireApprovedMember(`/music/${id}`), loadItemPage(supabase, id, ["playlist"])]);
  if (!page) notFound();
  return (
    <>
      <BackLink route="/music/[id]" />
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member origin={getSiteUrl()} />
    </>
  );
}
