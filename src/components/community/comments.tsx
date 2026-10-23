"use client";

import { ChevronUp, EyeOff, Flag, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { deleteReplyAction, editReplyAction, modPostAction, replyAction } from "@/app/(app)/(member)/community/actions";
import { loadCommentsAction } from "@/app/(app)/(member)/community/feed-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { exactTime, LIMITS, relativeTime } from "@/lib/community/format";
import type { FeedCursor, RenderedComment } from "@/lib/community/types";
import { initialFormState, type FormState } from "@/lib/forms";
import { ActionMenu, type MenuItem } from "./action-menu";
import { AttachmentGallery } from "./attachment-gallery";
import { AttachmentPicker } from "./attachment-picker";
import { InitialsAvatar, reveal, useDraftGuard } from "./feed-bits";
import { MentionTextarea } from "@/components/mentions/mention-textarea";
import { reasonField } from "./moderation-controls";
import { ReactionPicker, ReactionSummary, useReactions } from "./reaction-picker";
import { useCommunityRealtime } from "./realtime-provider";
import { ReportDialog } from "./report-dialog";

/**
 * Comments under one post, opened in place. Newest first (as the database
 * orders them), with "Load older comments" continuing from a cursor. The
 * composer sits at the top; a posted comment appears there and the count
 * updates without reloading the feed. The panel stays mounted (hidden) when
 * collapsed, so a draft and chosen files survive closing and reopening.
 */
export function CommentsPanel({
  threadId,
  open,
  timeZone,
  target,
  locked,
  status,
  onCount,
  onCollapse,
  focusComposer,
}: {
  threadId: string;
  open: boolean;
  timeZone: string;
  /** A comment to reveal (from a notification link). */
  target?: string | null;
  locked: boolean;
  status: "visible" | "hidden" | "deleted";
  onCount: (count: number) => void;
  onCollapse: () => void;
  /** Changes when the member pressed "Comment", to move focus to the composer. */
  focusComposer: number;
}) {
  const [items, setItems] = useState<RenderedComment[]>([]);
  const [cursor, setCursor] = useState<FeedCursor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [canReply, setCanReply] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [pending, start] = useTransition();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const load = useCallback(
    (opts: { cursor?: FeedCursor | null; through?: string | null; mode: "replace" | "append" | "merge" }) =>
      new Promise<boolean>((resolve) => {
        start(async () => {
          setError(null);
          const res = await loadCommentsAction({ threadId, cursor: opts.cursor ?? null, through: opts.through ?? null });
          if (!res.ok) {
            setError(res.message);
            resolve(false);
            return;
          }
          if (!res.data) {
            setUnavailable(true);
            setLoaded(true);
            resolve(false);
            return;
          }
          const page = res.data;
          setCanReply(page.can_reply);
          setCanModerate(page.can_moderate);
          onCount(page.count);
          setItems((prev) => {
            if (opts.mode === "append") return dedupe([...prev, ...page.items]);
            if (opts.mode === "merge") return dedupe([...page.items, ...prev]);
            return page.items;
          });
          if (opts.mode !== "merge") setCursor(page.next_cursor);
          if (opts.through && opts.mode === "replace") setTargetMissing(!page.target_found);
          setLoaded(true);
          resolve(true);
        });
      }),
    [threadId, onCount],
  );

  // First open: the newest page (extended through a linked comment).
  const started = useRef(false);
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    void load({ through: target ?? null, mode: "replace" }).then((ok) => {
      if (ok && target) requestAnimationFrame(() => reveal(document.getElementById(`comment-${target}`)));
    });
  }, [open, target, load]);

  // "Comment" asks for the composer; it may only appear once the first page loads.
  const focusWanted = useRef(0);
  useEffect(() => {
    if (!focusComposer || !open || focusWanted.current === focusComposer || !composerRef.current) return;
    focusWanted.current = focusComposer;
    composerRef.current.focus();
  }, [focusComposer, open, canReply]);

  // Live: on a community signal, pick up comments newer than the newest shown.
  const { version } = useCommunityRealtime();
  const newestId = items[0]?.id ?? null;
  const lastVersion = useRef(version);
  useEffect(() => {
    if (version === lastVersion.current) return;
    lastVersion.current = version;
    if (open && loaded && !unavailable) void load({ through: newestId, mode: newestId ? "merge" : "replace" });
    // Only a new signal should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const oldestId = items.length ? items[items.length - 1].id : null;
  /** After an edit or moderation: reload everything shown so far, in place. */
  const reloadShown = useCallback(() => void load({ through: oldestId, mode: "replace" }), [load, oldestId]);

  return (
    <section hidden={!open} aria-label="Comments" className="border-t border-border px-4 pb-3 pt-3 sm:px-5">
      {unavailable ? (
        <p className="py-2 text-meta text-text-secondary">These comments aren&apos;t available anymore.</p>
      ) : (
        <>
          {canReply ? (
            <CommentComposer
              threadId={threadId}
              inputRef={composerRef}
              onPosted={async (id) => {
                await load({ through: items[0]?.id ?? id, mode: "merge" });
                requestAnimationFrame(() => document.getElementById(`comment-${id}`)?.focus());
              }}
            />
          ) : loaded && status === "visible" ? (
            <p className="mb-2 text-meta text-text-secondary">
              {locked ? (
                "This post is locked, so it can't take new comments."
              ) : (
                <>
                  You can comment after accepting the{" "}
                  <Link href={`/community/guidelines?next=/community/t/${threadId}`} className="font-semibold text-primary underline">
                    community guidelines
                  </Link>{" "}
                  (or when a moderator&apos;s pause on your posting ends).
                </>
              )}
            </p>
          ) : null}

          {targetMissing ? (
            <p role="status" className="mt-2 rounded-control bg-surface-muted px-3 py-2 text-meta text-text-secondary">
              The comment you followed isn&apos;t available anymore. It may have been deleted or removed.
            </p>
          ) : null}

          {items.length ? (
            <ol id={listId} className="mt-3 space-y-3" aria-label="Comments, newest first">
              {items.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  threadId={threadId}
                  timeZone={timeZone}
                  canModerate={canModerate}
                  canInteract={canReply}
                  highlight={c.id === target}
                  onChanged={reloadShown}
                  onRemoved={(id) => {
                    setItems((list) => list.filter((x) => x.id !== id));
                    void load({ through: oldestId === id ? null : oldestId, mode: "replace" });
                  }}
                />
              ))}
            </ol>
          ) : loaded && !pending && !error ? (
            <p className="mt-2 text-meta text-text-secondary">No comments yet.</p>
          ) : null}

          {!loaded && pending ? (
            <p role="status" className="mt-2 text-meta text-text-secondary">
              Loading comments…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-meta text-danger">
              {error}{" "}
              <button type="button" className="font-semibold underline" onClick={() => void load({ cursor, mode: items.length ? "append" : "replace" })}>
                Try again
              </button>
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {cursor ? (
              <Button variant="ghost" size="sm" loading={pending} loadingText="Loading…" onClick={() => void load({ cursor, mode: "append" })} aria-controls={listId}>
                Load older comments
              </Button>
            ) : (
              <span />
            )}
            <Button variant="ghost" size="sm" onClick={onCollapse} icon={<ChevronUp className="size-4" aria-hidden="true" />}>
              Hide comments
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function dedupe(list: RenderedComment[]): RenderedComment[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/** Compact comment box: grows as you type; photos and videos behind a small button. */
function CommentComposer({
  threadId,
  inputRef,
  onPosted,
}: {
  threadId: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onPosted: (id: string) => Promise<void>;
}) {
  const [state, formAction] = useActionState(replyAction, initialFormState);
  const [body, setBody] = useState("");
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState(0);
  const [pickerKey, setPickerKey] = useState(0);
  const handled = useRef<FormState | null>(null);
  const id = useId();
  useDraftGuard(`comment-${threadId}`, body.trim().length > 0 || files > 0);

  useEffect(() => {
    if (state.status !== "success" || handled.current === state) return;
    handled.current = state;
    setBody("");
    setClientKey(crypto.randomUUID());
    setPickerKey((k) => k + 1);
    setUploading(false);
    setFiles(0);
    if (state.values?.postId) void onPosted(state.values.postId);
  }, [state, onPosted]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="threadId" value={threadId} />
      <input type="hidden" name="clientKey" value={clientKey} />
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <p role="status" className="sr-only">
        {state.status === "success" ? "Comment posted." : ""}
      </p>
      <label htmlFor={`${id}-body`} className="sr-only">
        Write a comment
      </label>
      <div className="flex items-end gap-2">
        <MentionTextarea
          ref={inputRef}
          id={`${id}-body`}
          name="body"
          required
          maxLength={LIMITS.reply}
          placeholder="Write a comment…"
          value={body}
          onValueChange={setBody}
          place={{ module: "community", threadId }}
          aria-describedby={`${id}-format`}
          aria-invalid={state.fieldErrors?.body ? true : undefined}
          className="rounded-[1.25rem] bg-surface-muted/60"
        />
        <SubmitButton size="sm" pendingText="Posting…" disabled={uploading} icon={<Send className="size-4" aria-hidden="true" />} className="shrink-0">
          <span className="max-[400px]:sr-only">Post</span>
          <span className="sr-only"> comment</span>
        </SubmitButton>
      </div>
      <p id={`${id}-format`} className="sr-only">
        You can use **bold**, _italic_, lists, quotes, and links. Type @ and a name to mention someone or a group.
      </p>
      <AttachmentPicker key={pickerKey} compact onBusyChange={setUploading} onCountChange={setFiles} />
    </form>
  );
}

function CommentItem({
  comment: c,
  threadId,
  timeZone,
  canModerate,
  canInteract,
  highlight,
  onChanged,
  onRemoved,
}: {
  comment: RenderedComment;
  threadId: string;
  timeZone: string;
  canModerate: boolean;
  canInteract: boolean;
  highlight: boolean;
  onChanged: () => void;
  onRemoved: (id: string) => void;
}) {
  const reactions = useReactions("post", c.id, c.reactions);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body ?? "");
  const [editState, editAction] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await editReplyAction(prev, fd);
    if (result.status === "success") {
      setEditing(false);
      onChanged();
    }
    return result;
  }, initialFormState);
  const [deleteState, deleteAction] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await deleteReplyAction(prev, fd);
    if (result.status === "success") onRemoved(c.id);
    return result;
  }, initialFormState);
  const [modState, modAction] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await modPostAction(prev, fd);
    if (result.status === "success") onChanged();
    return result;
  }, initialFormState);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const reportRef = useRef<HTMLDialogElement>(null);
  const hideRef = useRef<HTMLDialogElement>(null);
  const restoreRef = useRef<HTMLDialogElement>(null);
  const author = c.author ?? "Former member";
  const visible = c.status === "visible";

  const menu: MenuItem[] = [];
  if (c.mine && visible && canInteract) menu.push({ key: "edit", label: "Edit comment", icon: <Pencil className="size-4" aria-hidden="true" />, onSelect: () => setEditing(true) });
  if (c.mine && visible) menu.push({ key: "delete", label: "Delete comment", icon: <Trash2 className="size-4" aria-hidden="true" />, dialog: "delete", danger: true });
  if (!c.mine && visible) menu.push({ key: "report", label: "Report comment", icon: <Flag className="size-4" aria-hidden="true" />, dialog: "report" });
  if (canModerate && !c.mine && visible) menu.push({ key: "hide", label: "Hide comment", icon: <EyeOff className="size-4" aria-hidden="true" />, dialog: "hide", danger: true });
  if (canModerate && !c.mine && c.status === "hidden")
    menu.push({ key: "restore", label: "Restore comment", icon: <RotateCcw className="size-4" aria-hidden="true" />, dialog: "restore" });

  const failure = [editState, deleteState, modState].find((s) => s.status === "error" && !editing);

  return (
    <li
      id={`comment-${c.id}`}
      tabIndex={-1}
      aria-label={`Comment from ${author}`}
      className={cn("flex gap-2 rounded-card outline-none focus-visible:ring-2 focus-visible:ring-primary", highlight && "bg-primary-soft/50 p-1.5 ring-1 ring-primary/40")}
    >
      <InitialsAvatar name={c.author} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1">
          <div className={cn("min-w-0 rounded-[1.125rem] px-3.5 py-2", editing ? "w-full" : "max-w-full", c.status === "hidden" ? "border border-dashed border-danger/60 bg-danger-soft/40" : "bg-surface-muted")}>
            <p className="text-meta font-semibold leading-snug">{author}</p>
            {c.status === "hidden" ? <p className="text-[0.8125rem] font-semibold text-danger">Hidden by a moderator (only moderators see this)</p> : null}
            {editing ? (
              <form action={editAction} className="mt-1 space-y-2">
                <FormMessage state={editState} />
                <input type="hidden" name="postId" value={c.id} />
                <input type="hidden" name="threadId" value={threadId} />
                <label htmlFor={`edit-${c.id}`} className="sr-only">
                  Edit your comment
                </label>
                <MentionTextarea
                  id={`edit-${c.id}`}
                  name="body"
                  required
                  maxLength={LIMITS.reply}
                  value={draft}
                  onValueChange={setDraft}
                  place={{ module: "community", threadId }}
                  autoFocus
                  minRows={2}
                />
                <div className="flex gap-2">
                  <SubmitButton size="sm" pendingText="Saving…">
                    Save
                  </SubmitButton>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDraft(c.body ?? "");
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : c.html ? (
              <div className="prose-gathering break-words text-[0.9375rem]" dangerouslySetInnerHTML={{ __html: c.html }} />
            ) : null}
          </div>
          {menu.length && !editing ? <ActionMenu
              label={`Actions for comment from ${author}`}
              items={menu}
              onDialog={(d) => ({ delete: deleteRef, report: reportRef, hide: hideRef, restore: restoreRef })[d]?.current?.showModal()}
              className="-mr-2 shrink-0"
            /> : null}
        </div>
        {!editing ? <AttachmentGallery items={c.attachments} className="mt-2 max-w-sm" /> : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1 pl-1 text-[0.8125rem] text-text-secondary">
          <time dateTime={c.created_at} title={exactTime(c.created_at, timeZone)}>
            {relativeTime(c.created_at)}
          </time>
          {c.edited_at && visible ? <span>· edited</span> : null}
          {visible && c.reactions ? (
            <>
              <span aria-hidden="true">·</span>
              <ReactionPicker state={reactions} disabled={!canInteract} size="sm" what={`the comment from ${author}`} />
              <ReactionSummary reactions={reactions.reactions} />
            </>
          ) : null}
        </div>
        {failure ? <FormMessage state={failure} /> : null}
      </div>

      <ConfirmDialog trigger={null} dialogRef={deleteRef} title="Delete your comment?" confirmLabel="Delete comment" formAction={deleteAction} hidden={{ postId: c.id, threadId }}>
        Its text and any photos or videos are removed.
      </ConfirmDialog>
      {!c.mine ? <ReportDialog type="post" ids={[c.id]} what="this comment" dialogRef={reportRef} /> : null}
      {canModerate && !c.mine ? (
        <>
          <ConfirmDialog
            trigger={null}
            dialogRef={hideRef}
            title="Hide this comment?"
            confirmLabel="Hide comment"
            formAction={modAction}
            hidden={{ postId: c.id, threadId, op: "hide" }}
            fields={reasonField(true)}
          >
            Members will no longer see it. The author is told.
          </ConfirmDialog>
          <ConfirmDialog
            trigger={null}
            dialogRef={restoreRef}
            title="Restore this comment?"
            confirmLabel="Restore"
            formAction={modAction}
            hidden={{ postId: c.id, threadId, op: "restore" }}
            fields={reasonField(true)}
          />
        </>
      ) : null}
    </li>
  );
}
