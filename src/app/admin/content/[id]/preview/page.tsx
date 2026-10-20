import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudienceBadge, StateBadge } from "@/components/media/badges";
import { ContentDetail } from "@/components/media/content-detail";
import { Alert } from "@/components/ui/alert";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { prepareDetail } from "@/lib/media/pages";
import type { ItemAdmin, ItemDetail } from "@/lib/media/types";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Preview" };

/** Shapes the editor's copy like the member page (no bookmarks, progress, or related lists). */
function asDetail(i: ItemAdmin): ItemDetail {
  return {
    id: i.id,
    kind: i.kind,
    title: i.title,
    summary: i.summary,
    audience: i.audience,
    featured: i.featured,
    publish_at: i.publish_at,
    devotional_on: i.devotional_on,
    delivered_on: i.delivered_on,
    starts_on: i.starts_on,
    ends_on: i.ends_on,
    episode_number: i.episode_number,
    season_number: i.season_number,
    book_author: i.book_author,
    book_current: i.book_current,
    spotify_id: i.spotify_id,
    scripture_refs: i.scripture_refs,
    tags: i.tags,
    cover: i.cover,
    series: i.series,
    show: i.show ? { id: i.show.id, title: i.show.title } : null,
    book: i.book ? { id: i.book.id, title: i.book.title, book_author: null } : null,
    people: i.people,
    media: null,
    bookmarked: false,
    completed: false,
    body: i.body,
    notes: i.notes,
    questions: i.questions,
    instructions: i.instructions,
    attribution: i.attribution,
    audible_url: i.audible_url,
    group_name: i.group_name,
    topics: i.topics,
    attachments: i.attachments.filter((a) => a.status === "ready"),
    related: [],
    discussion: i.discussion ? { thread_id: i.discussion.thread_id, title: i.discussion.title, replies: 0, group: i.discussion.group } : null,
    progress: {},
    assignments: null,
  };
}

export default async function PreviewContentPage({ params }: PageProps<"/admin/content/[id]/preview">) {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_admin_item", { p_id: id });
  if (error || !data) notFound();
  const item = data as ItemAdmin;
  const page = await prepareDetail(supabase, asDetail(item));
  return (
    <>
      <div className="mb-6 space-y-3">
        <p>
          <Link href={`/admin/content/${id}`} className="font-semibold text-primary hover:underline">
            Back to editing
          </Link>
        </p>
        <Alert tone="info" title="Preview">
          <span className="flex flex-wrap items-center gap-2">
            This is how it will look. <StateBadge state={item.state} /> <AudienceBadge audience={item.audience} groupName={item.group_name} />
          </span>
          {item.audience === "public" ? (
            <span className="mt-1 block">Visitors see only files marked for public use; members-only files and the discussion link are hidden from them.</span>
          ) : null}
        </Alert>
      </div>
      <ContentDetail item={page.item} urls={page.urls} transcripts={page.transcripts} member origin={getSiteUrl()} preview />
    </>
  );
}
