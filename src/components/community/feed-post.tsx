"use client";

import { Bell, BellOff, EyeOff, ExternalLink, Flag, Lock, LockOpen, MessageCircle, Pencil, Pin, PinOff, RotateCcw, Trash2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useActionState, useCallback, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { deleteThreadAction, followAction, modThreadAction, muteAction } from "@/app/(member)/community/actions";
import { loadPostAction } from "@/app/(member)/community/feed-actions";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { exactTime, relativeTime } from "@/lib/community/format";
import type { RenderedPost } from "@/lib/community/types";
import { initialFormState, type FormState } from "@/lib/forms";
import { ActionMenu, type MenuItem } from "./action-menu";
import { AttachmentGallery } from "./attachment-gallery";
import { CommentsPanel } from "./comments";
import { InitialsAvatar } from "./feed-bits";
import { reasonField } from "./moderation-controls";
import { ReactionPicker, ReactionSummary, useReactions } from "./reaction-picker";
import { ReportDialog } from "./report-dialog";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

/**
 * One original post in the feed: author, time, and place; the title once,
 * the text (long posts expand in place with "See more"), photos and videos;
 * a reaction summary and comment count; React and Comment; and everything
 * else in the three-dot menu, shown only as the database says the member
 * may (each action is checked again on the server).
 */
export function FeedPostCard({
  post: initial,
  timeZone,
  initiallyOpen = false,
  target,
  deleteBack = "/community",
  onGone,
  headingLevel = 2,
}: {
  post: RenderedPost;
  timeZone: string;
  /** Comments open from the start (permalink). */
  initiallyOpen?: boolean;
  /** A comment to reveal (from a notification link). */
  target?: string | null;
  deleteBack?: string;
  /** The post can no longer be shown (hidden or deleted). */
  onGone?: (id: string) => void;
  headingLevel?: 1 | 2;
}) {
  const [post, setPost] = useState(initial);
  const [count, setCount] = useState(initial.comment_count);
  const [open, setOpen] = useState(initiallyOpen);
  const [mounted, setMounted] = useState(initiallyOpen);
  const [focusComposer, setFocusComposer] = useState(0);
  const [status, setStatus] = useState<FormState>(initialFormState);
  const [, start] = useTransition();
  const reactions = useReactions("thread", post.id, post.reactions);
  const id = useId();
  const deleteRef = useRef<HTMLDialogElement>(null);
  const reportRef = useRef<HTMLDialogElement>(null);
  const lockRef = useRef<HTMLDialogElement>(null);
  const hideRef = useRef<HTMLDialogElement>(null);
  const restoreRef = useRef<HTMLDialogElement>(null);

  /** Re-read this post (current access rules) after an action. */
  const refresh = useCallback(() => {
    start(async () => {
      const res = await loadPostAction(post.id);
      if (!res.ok) return;
      if (!res.data || res.data.status === "deleted") onGone?.(post.id);
      else {
        setPost(res.data);
        setCount(res.data.comment_count);
      }
    });
  }, [post.id, onGone]);

  const run = (action: Action, values: Record<string, string>) =>
    start(async () => {
      const result = await action(initialFormState, form(values));
      setStatus(result);
      if (result.status === "success") refresh();
    });
  const withResult = (action: Action) => async (prev: FormState, fd: FormData) => {
    const result = await action(prev, fd);
    setStatus(result);
    if (result.status === "success") refresh();
    return result;
  };
  const [, modAction] = useActionState(withResult(modThreadAction), initialFormState);
  const [, deleteAction] = useActionState(withResult(deleteThreadAction), initialFormState);

  const visible = post.status === "visible";
  const author = post.author ?? "Former member";
  const place = post.group ? post.group.name : (post.category?.name ?? "Community");
  const what = post.title ? `the post “${post.title}”` : "this post";

  const menu: MenuItem[] = [
    {
      key: "follow",
      label: post.following ? "Unfollow" : "Follow",
      icon: post.following ? <BellOff className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />,
      onSelect: () => run(followAction, { threadId: post.id, on: String(!post.following) }),
    },
    {
      key: "mute",
      label: post.muted ? "Unmute notifications" : "Mute notifications",
      icon: <VolumeX className="size-4" aria-hidden="true" />,
      onSelect: () => run(muteAction, { type: "thread", id: post.id, on: String(!post.muted) }),
    },
  ];
  if (post.mine && visible && !post.locked) menu.push({ key: "edit", label: "Edit post", icon: <Pencil className="size-4" aria-hidden="true" />, href: `/community/t/${post.id}/edit` });
  if (post.mine && visible) menu.push({ key: "delete", label: "Delete post", icon: <Trash2 className="size-4" aria-hidden="true" />, dialog: "delete", danger: true });
  if (!post.mine && visible) menu.push({ key: "report", label: "Report post", icon: <Flag className="size-4" aria-hidden="true" />, dialog: "report" });
  if (post.can_moderate && visible)
    menu.push({
      key: "pin",
      label: post.pinned ? "Unpin" : "Pin",
      icon: post.pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />,
      onSelect: () => run(modThreadAction, { threadId: post.id, op: post.pinned ? "unpin" : "pin" }),
    });
  if (post.can_moderate)
    menu.push(
      post.locked
        ? { key: "lock", label: "Unlock comments", icon: <LockOpen className="size-4" aria-hidden="true" />, onSelect: () => run(modThreadAction, { threadId: post.id, op: "unlock" }) }
        : { key: "lock", label: "Lock comments", icon: <Lock className="size-4" aria-hidden="true" />, dialog: "lock" },
    );
  if (post.can_moderate && visible) menu.push({ key: "hide", label: "Hide post", icon: <EyeOff className="size-4" aria-hidden="true" />, dialog: "hide", danger: true });
  if (post.can_moderate && post.status === "hidden") menu.push({ key: "restore", label: "Restore post", icon: <RotateCcw className="size-4" aria-hidden="true" />, dialog: "restore" });
  if (headingLevel === 2) menu.push({ key: "open", label: "Open post", icon: <ExternalLink className="size-4" aria-hidden="true" />, href: `/community/t/${post.id}` });

  const Heading = headingLevel === 1 ? "h1" : "h2";
  const commentLabel = count === 1 ? "1 comment" : `${count} comments`;
  const toggleComments = (focus: boolean) => {
    setMounted(true);
    if (focus) {
      setOpen(true);
      setFocusComposer((n) => n + 1);
    } else setOpen((o) => !o);
  };

  if (post.status === "deleted") {
    return (
      <article className="rounded-card border border-border bg-surface px-4 py-5 text-text-secondary sm:px-5">
        <Heading className="text-[1.0625rem] font-semibold italic">This post was deleted by its author.</Heading>
      </article>
    );
  }

  return (
    <article id={`post-${post.id}`} aria-labelledby={`${id}-title`} className="rounded-card border border-border bg-surface shadow-(--elev-card)">
      <header className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <InitialsAvatar name={post.author} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-snug">{author}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] leading-snug text-text-secondary">
            <time dateTime={post.created_at} title={exactTime(post.created_at, timeZone)}>
              {relativeTime(post.created_at)}
            </time>
            {post.edited_at ? <span>· edited</span> : null}
            <span aria-hidden="true">·</span>
            {post.group ? (
              <span className="inline-flex items-center gap-1 font-semibold text-primary">
                <Lock className="size-3" aria-hidden="true" />
                <span className="sr-only">Private group: </span>
                {place}
              </span>
            ) : (
              <span>{place}</span>
            )}
            {post.pinned ? (
              <span className="inline-flex items-center gap-0.5">
                · <Pin className="size-3" aria-hidden="true" /> Pinned
              </span>
            ) : null}
            {post.locked ? (
              <span className="inline-flex items-center gap-0.5">
                · <Lock className="size-3" aria-hidden="true" /> Locked
              </span>
            ) : null}
          </p>
        </div>
        <ActionMenu
          label={`Actions for ${what}`}
          items={menu}
          onDialog={(d) => ({ delete: deleteRef, report: reportRef, lock: lockRef, hide: hideRef, restore: restoreRef })[d]?.current?.showModal()}
          className="-mr-2 -mt-1"
        />
      </header>

      <div className="px-4 pt-3 sm:px-5">
        {post.status === "hidden" ? (
          <p className="mb-2 rounded-control border border-dashed border-danger/60 bg-danger-soft/40 px-3 py-2 text-meta font-semibold text-danger">
            Hidden by a moderator. Members can&apos;t see this post; you can because you moderate it.
          </p>
        ) : null}
        {post.group_archived ? <p className="mb-2 text-meta text-text-secondary">This group is archived, so its posts are read-only.</p> : null}
        <Heading id={`${id}-title`} className="text-[1.0625rem] font-semibold leading-snug">
          {headingLevel === 2 ? (
            <Link href={`/community/t/${post.id}`} className="hover:underline">
              {post.title}
            </Link>
          ) : (
            post.title
          )}
        </Heading>
        {post.html ? <ExpandableBody html={post.html} /> : null}
        <AttachmentGallery items={post.attachments} className="mt-3" />
      </div>

      <div className="flex min-h-10 items-center justify-between gap-2 px-4 pt-2 sm:px-5">
        <ReactionSummary reactions={reactions.reactions} />
        {count > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={mounted ? `${id}-comments` : undefined}
            onClick={() => toggleComments(false)}
            className="ml-auto inline-flex min-h-11 items-center rounded-control px-2 text-meta text-text-secondary hover:text-text hover:underline focus-visible:outline-3 focus-visible:outline-primary"
          >
            {commentLabel}
          </button>
        ) : null}
      </div>

      <div className="mx-4 grid grid-cols-2 gap-1 border-t border-border py-1 sm:mx-5">
        {reactions.reactions ? (
          <ReactionPicker state={reactions} disabled={!post.can_reply} what={what} />
        ) : (
          <span />
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={mounted ? `${id}-comments` : undefined}
          onClick={() => toggleComments(true)}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control px-3 text-[0.9375rem] font-semibold text-text-secondary hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          Comment
          <span className="sr-only"> on {what}</span>
        </button>
      </div>

      <p role="status" className={status.status === "error" ? "px-4 pb-2 text-meta text-danger sm:px-5" : "sr-only"}>
        {status.message ?? ""}
      </p>

      {mounted ? (
        <div id={`${id}-comments`}>
          <CommentsPanel
            threadId={post.id}
            open={open}
            timeZone={timeZone}
            target={target}
            locked={post.locked}
            status={post.status}
            onCount={setCount}
            onCollapse={() => setOpen(false)}
            focusComposer={focusComposer}
          />
        </div>
      ) : null}

      {post.mine && visible ? (
        <ConfirmDialog trigger={null} dialogRef={deleteRef} title="Delete your post?" confirmLabel="Delete post" formAction={deleteAction} hidden={{ threadId: post.id, back: deleteBack }}>
          {count > 0 ? "Its title and text are erased. Others’ comments stay, under a “deleted” note." : "It will be removed completely."}
        </ConfirmDialog>
      ) : null}
      {!post.mine && visible ? <ReportDialog type="thread" ids={[post.id]} what="this post" dialogRef={reportRef} /> : null}
      {post.can_moderate ? (
        <>
          <ConfirmDialog
            trigger={null}
            dialogRef={lockRef}
            title="Lock comments on this post?"
            confirmLabel="Lock"
            formAction={modAction}
            hidden={{ threadId: post.id, op: "lock" }}
            fields={reasonField(false)}
          >
            No one can comment or edit until it&apos;s unlocked. It stays readable.
          </ConfirmDialog>
          <ConfirmDialog
            trigger={null}
            dialogRef={hideRef}
            title="Hide this post?"
            confirmLabel="Hide post"
            formAction={modAction}
            hidden={{ threadId: post.id, op: "hide" }}
            fields={reasonField(true)}
          >
            Members will no longer see it. The text is kept so it can be restored, and the author is told.
          </ConfirmDialog>
          <ConfirmDialog
            trigger={null}
            dialogRef={restoreRef}
            title="Restore this post?"
            confirmLabel="Restore"
            formAction={modAction}
            hidden={{ threadId: post.id, op: "restore" }}
            fields={reasonField(true)}
          />
        </>
      ) : null}
    </article>
  );
}

/** Long text is clipped to a few lines with "See more", which expands in place. */
function ExpandableBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 4);
  }, [html]);
  return (
    <div className="mt-1.5">
      <div
        ref={ref}
        id={id}
        className={cn("prose-gathering break-words text-[0.9875rem]", !expanded && "max-h-[11.5rem] overflow-hidden", !expanded && long && "[mask-image:linear-gradient(to_bottom,black_70%,transparent)]")}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {long ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 min-h-11 rounded-control font-semibold text-primary hover:underline focus-visible:outline-3 focus-visible:outline-primary"
        >
          {expanded ? "See less" : "See more"}
        </button>
      ) : null}
    </div>
  );
}
