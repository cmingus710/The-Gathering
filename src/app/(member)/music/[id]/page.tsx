import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentDetail } from "@/components/media/content-detail";
import { isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Playlist" };

export default async function PlaylistPage({ params }: PageProps<"/music/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const page = await loadItemPage(supabase, id, ["playlist"]);
  if (!page) notFound();
  return (
    <>
      <p className="mb-4">
        <Link href="/music" className="font-semibold text-primary hover:underline">
          Music &amp; playlists
        </Link>
      </p>
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member origin={getSiteUrl()} />
    </>
  );
}
