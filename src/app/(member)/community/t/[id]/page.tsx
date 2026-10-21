import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackToFeed } from "@/components/community/back-to-feed";
import { FeedPostCard } from "@/components/community/feed-post";
import { Alert } from "@/components/ui/alert";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { renderCommunityText } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { FeedPost } from "@/lib/community/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Post" };

const UUID = /^[0-9a-f-]{36}$/;

/**
 * One post on its own page (shared links and notification links). It is
 * the same card as in the feed with comments already open; ?comment=<id>
 * reveals that comment even when it's older than the first page.
 */
export default async function ThreadPage({ params, searchParams }: PageProps<"/community/t/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/community/t/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const comment = typeof sp.comment === "string" && UUID.test(sp.comment) ? sp.comment : null;
  const [post, { settings }] = await Promise.all([tryCommunityRpc<FeedPost>("community_feed_post", { p_id: id }), getChurchSettings()]);
  const back = post?.group ? `/community?group=${post.group.id}` : "/community";

  return (
    <div className="mx-auto max-w-[40rem]">
      <BackToFeed href={back} />
      {sp.posted ? <Alert tone="success" title="Your post is shared." className="mb-4" /> : null}
      {sp.edited ? <Alert tone="success" title="Your changes are saved." className="mb-4" /> : null}
      {post ? (
        <FeedPostCard
          post={{ ...post, html: post.body ? renderCommunityText(post.body) : null }}
          timeZone={settings.timezone}
          initiallyOpen
          target={comment}
          deleteBack={back}
          headingLevel={1}
        />
      ) : (
        // Missing, hidden, or in a group the member isn't in: all the same answer.
        <div className="rounded-card border border-border bg-surface px-5 py-8 text-center">
          <h1 className="text-[1.0625rem] font-semibold">This post isn&apos;t available</h1>
          <p className="mt-1 text-text-secondary">It may have been deleted or removed, or it&apos;s in a group you&apos;re not part of.</p>
          <Link href="/community" className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary underline">
            Back to Community
          </Link>
        </div>
      )}
    </div>
  );
}
