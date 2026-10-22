import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentDetail } from "@/components/media/content-detail";
import { BackLink } from "@/components/ui/back-link";
import { isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { teachingViewer } from "@/lib/media/viewer";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

// A generic title: content may be limited to members or a group.
export const metadata: Metadata = { title: "Devotional" };

export default async function DevotionalPage({ params }: PageProps<"/devotionals/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [viewer, supabase] = await Promise.all([teachingViewer(), requireClient()]);
  const page = await loadItemPage(supabase, id, ["devotional"]);
  if (!page) notFound();
  return (
    <>
      <BackLink route="/devotionals/[id]" />
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member={viewer.member} origin={getSiteUrl()} />
    </>
  );
}
