"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { deleteReplyAction, editReplyAction } from "@/app/(member)/community/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { LIMITS } from "@/lib/community/format";
import type { Attachment, Post } from "@/lib/community/types";
import { initialFormState, type FormState } from "@/lib/forms";
import { AttachmentGallery } from "./attachment-gallery";
import { PostModeration } from "./moderation-controls";
import { ReactionBar } from "./reaction-bar";
import { ReportDialog } from "./report-dialog";

/**
 * One reply. `html` is rendered on the server by the safe community
 * renderer. Authors can edit or delete; others can react and report;
 * moderators (in scope) get hide/restore.
 */
export function PostItem({
  post,
  html,
  threadId,
  when,
  exact,
  canModerate,
  canInteract,
  attachments,
}: {
  post: Post;
  html: string | null;
  threadId: string;
  when: string;
  exact: string;
  canModerate: boolean;
  canInteract: boolean;
  /** Photos and videos, only when the viewer may see them (rechecked when each file loads). */
  attachments?: Attachment[];
}) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await editReplyAction(prev, formData);
    if (result.status === "success") setEditing(false);
    return result;
  }, initialFormState);
  const [deleteState, deleteAction] = useActionState(deleteReplyAction, initialFormState);
  const [body, setBody] = useState(post.body ?? "");
  const editRef = useRef<HTMLDivElement>(null);

  return (
    <article id={`post-${post.id}`} tabIndex={-1} aria-label={post.author ? `Reply from ${post.author}` : "Reply"} className="rounded-card border border-border bg-surface p-5 outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-2 text-meta">
        <span className="font-semibold">{post.author ?? (post.status === "deleted" ? "Deleted" : "Former member")}</span>
        <time dateTime={post.created_at} title={exact} className="text-text-secondary">
          {when}
        </time>
        {post.edited_at && post.status === "visible" ? <span className="text-text-secondary">· edited</span> : null}
      </header>

      {post.status === "deleted" ? (
        <p className="italic text-text-secondary">This reply was deleted by its author.</p>
      ) : post.status === "hidden" && !canModerate ? (
        <p className="italic text-text-secondary">Removed by a moderator.</p>
      ) : editing ? (
        <div ref={editRef}>
          <form action={editAction} className="space-y-3">
            <FormMessage state={editState} />
            <input type="hidden" name="postId" value={post.id} />
            <input type="hidden" name="threadId" value={threadId} />
            <TextAreaField label="Edit your reply" name="body" required maxLength={LIMITS.reply} rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus error={editState.fieldErrors?.body} />
            <div className="flex gap-2">
              <SubmitButton size="sm" pendingText="Saving…">
                Save
              </SubmitButton>
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {post.status === "hidden" ? <p className="mb-2 text-meta font-semibold text-danger">Hidden by a moderator (only moderators see this)</p> : null}
          {html ? <div className="prose-gathering break-words" dangerouslySetInnerHTML={{ __html: html }} /> : null}
          <AttachmentGallery items={attachments} className="mt-3" />
        </>
      )}

      {post.status === "visible" && !editing ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {post.reactions ? <ReactionBar type="post" id={post.id} initial={post.reactions} disabled={!canInteract} /> : <span />}
          <div className="flex flex-wrap gap-1">
            {post.mine ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} icon={<Pencil className="size-4" aria-hidden="true" />}>
                  Edit<span className="sr-only"> your reply</span>
                </Button>
                <ConfirmDialog
                  triggerVariant="ghost"
                  trigger={<><Trash2 className="size-4" aria-hidden="true" /> Delete<span className="sr-only"> your reply</span></>}
                  title="Delete your reply?"
                  confirmLabel="Delete reply"
                  formAction={deleteAction}
                  hidden={{ postId: post.id, threadId }}
                >
                  Its text is erased. A &ldquo;deleted&rdquo; note stays so the conversation still makes sense.
                </ConfirmDialog>
              </>
            ) : (
              <ReportDialog type="post" ids={[post.id]} what="this reply" />
            )}
          </div>
        </div>
      ) : null}
      {deleteState.status === "error" ? <FormMessage state={deleteState} /> : null}
      {canModerate && !post.mine ? (
        <div className="mt-3 border-t border-border pt-3">
          <PostModeration postId={post.id} threadId={threadId} status={post.status} />
        </div>
      ) : null}
    </article>
  );
}
