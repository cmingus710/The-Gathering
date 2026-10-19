import { ArrowLeft, Bell, BellOff, Lock, Pencil, Pin, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunityText } from "@/components/community/community-text";
import { ReplyComposer } from "@/components/community/composer";
import { LiveRefresh } from "@/components/community/live-refresh";
import { ThreadModeration } from "@/components/community/moderation-controls";
import { PostItem } from "@/components/community/post-item";
import { ReactionBar } from "@/components/community/reaction-bar";
import { ReportDialog } from "@/components/community/report-dialog";
import { ToggleForm } from "@/components/community/toggle-form";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeleteThreadButton } from "@/components/community/delete-thread-button";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { exactTime, relativeTime, renderCommunityText } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { ThreadDetail } from "@/lib/community/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { followAction, muteAction, replyAction } from "../../actions";

export const metadata: Metadata = { title: "Discussion" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function ThreadPage({ params, searchParams }: PageProps<"/community/t/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/community/t/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const n = Math.min(Math.max(Number(sp.n) || 30, 30), 100);
  const [thread, { settings }] = await Promise.all([
    tryCommunityRpc<ThreadDetail>("community_thread", { p_id: id, p_limit: n }),
    getChurchSettings(),
  ]);
  // Missing, hidden, or in a group the member isn't in: all the same "not found".
  if (!thread) notFound();
  const tz = settings.timezone;
  const deleted = thread.status === "deleted";
  const back = thread.group ? { href: `/groups/${thread.group.id}`, label: thread.group.name } : thread.category ? { href: `/community/c/${thread.category.id}`, label: thread.category.name } : { href: "/community", label: "Community" };

  return (
    <>
      <LiveRefresh />
      <Link href={back.href} className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> {back.label}
      </Link>
      {sp.posted ? <Alert tone="success" title="Your discussion is posted." className="mb-4" /> : null}
      {sp.edited ? <Alert tone="success" title="Your changes are saved." className="mb-4" /> : null}

      <article aria-labelledby="thread-title" className="space-y-4">
        <header>
          <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-[0.08em] text-text-secondary">
            {thread.audience === "group" ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <Lock className="size-3.5" aria-hidden="true" /> Private group discussion · {thread.group?.name}
              </span>
            ) : (
              <span>Church-wide · {thread.category?.name}</span>
            )}
            {thread.pinned ? (
              <span className="inline-flex items-center gap-1">
                <Pin className="size-3.5" aria-hidden="true" /> Pinned
              </span>
            ) : null}
            {thread.locked ? (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3.5" aria-hidden="true" /> Locked
              </span>
            ) : null}
          </p>
          <h1 id="thread-title" className={`text-[1.75rem] font-bold leading-tight sm:text-[2rem] ${deleted ? "italic text-text-secondary" : ""}`}>
            {deleted ? "This discussion was deleted by its author" : thread.title}
          </h1>
          {!deleted ? (
            <p className="mt-2 text-[0.95rem] text-text-secondary">
              {thread.author ?? "Former member"} ·{" "}
              <time dateTime={thread.created_at} title={exactTime(thread.created_at, tz)}>
                {relativeTime(thread.created_at)}
              </time>
              {thread.edited_at ? " · edited" : ""}
            </p>
          ) : null}
        </header>

        {thread.status === "hidden" ? (
          <Alert tone="warning" title="Hidden by a moderator">
            Members can&apos;t see this discussion. You can see it because you moderate it.
          </Alert>
        ) : null}
        {thread.group_archived ? <Alert tone="info" title="This group is archived, so its discussions are read-only." /> : null}

        {!deleted && thread.body ? (
          <Card>
            <CommunityText source={thread.body} />
            {thread.reactions ? (
              <div className="mt-4">
                <ReactionBar type="thread" id={thread.id} initial={thread.reactions} disabled={!thread.can_reply} />
              </div>
            ) : null}
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <ToggleForm
            action={followAction}
            hidden={{ threadId: thread.id, on: String(!thread.following) }}
            label={thread.following ? "Following" : "Follow"}
            pressed={thread.following}
            icon={thread.following ? <Bell className="size-4" aria-hidden="true" /> : <BellOff className="size-4" aria-hidden="true" />}
            description={thread.following ? "Stop notifications about new replies" : "Get notified about new replies"}
          />
          <ToggleForm
            action={muteAction}
            hidden={{ type: "thread", id: thread.id, on: String(!thread.muted), path: `/community/t/${thread.id}` }}
            label={thread.muted ? "Muted" : "Mute"}
            pressed={thread.muted}
            icon={<BellOff className="size-4" aria-hidden="true" />}
            description={thread.muted ? "Unmute notifications for this discussion" : "Mute all notifications for this discussion"}
          />
          {thread.mine && thread.status === "visible" ? (
            <>
              {!thread.locked ? (
                <ButtonLink href={`/community/t/${thread.id}/edit`} variant="ghost" size="sm" icon={<Pencil className="size-4" aria-hidden="true" />}>
                  Edit
                </ButtonLink>
              ) : null}
              <DeleteThreadButton threadId={thread.id} back={back.href} hasReplies={thread.reply_count > 0} icon={<Trash2 className="size-4" aria-hidden="true" />} />
            </>
          ) : null}
          {!thread.mine && thread.status === "visible" ? <ReportDialog type="thread" ids={[thread.id]} what="this discussion" /> : null}
        </div>

        {thread.can_moderate && !deleted ? (
          <Card>
            <h2 className="mb-3 text-[0.95rem] font-bold uppercase tracking-[0.08em]">Moderation</h2>
            <ThreadModeration threadId={thread.id} pinned={thread.pinned} locked={thread.locked} status={thread.status} />
          </Card>
        ) : null}
      </article>

      <section aria-labelledby="replies-heading" className="mt-10">
        <h2 id="replies-heading" className="mb-3 text-[0.95rem] font-bold uppercase tracking-[0.08em]">
          {thread.reply_count === 1 ? "1 reply" : `${thread.reply_count} replies`}
        </h2>
        {thread.posts.length ? (
          <ol className="space-y-3">
            {thread.posts.map((p) => (
              <li key={p.id}>
                <PostItem
                  post={p}
                  html={p.body ? renderCommunityText(p.body) : null}
                  threadId={thread.id}
                  when={relativeTime(p.created_at)}
                  exact={exactTime(p.created_at, tz)}
                  canModerate={thread.can_moderate}
                  canInteract={thread.can_reply}
                />
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-card bg-surface px-5 py-4 text-text-secondary">No replies yet.</p>
        )}
        {thread.has_more ? (
          <div className="mt-4">
            {n < 100 ? (
              <ButtonLink href={`/community/t/${thread.id}?n=${n + 30}`} variant="secondary" size="sm" scroll={false}>
                Show more replies
              </ButtonLink>
            ) : (
              <p className="text-text-secondary">This discussion is very long; the first 100 replies are shown.</p>
            )}
          </div>
        ) : null}

        <div className="mt-8">
          {thread.can_reply ? (
            <Card>
              <ReplyComposer threadId={thread.id} action={replyAction} />
            </Card>
          ) : deleted || thread.status === "hidden" ? null : thread.locked ? (
            <Alert tone="info" title="This discussion is locked, so it can't take new replies." />
          ) : thread.group_archived ? null : (
            <Alert tone="info" title="You can reply after accepting the community guidelines.">
              <Link href={`/community/guidelines?next=/community/t/${thread.id}`} className="font-semibold text-primary underline">
                Read the guidelines
              </Link>
              {" "}(or, if a moderator paused your posting, you can still read along).
            </Alert>
          )}
        </div>
      </section>
    </>
  );
}
