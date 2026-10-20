"use client";

import { MessageCircleHeart, Pencil, Send, Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { addUpdateAction, commentAction, deleteCommentAction, deleteUpdateAction, editCommentAction, editUpdateAction } from "@/app/(member)/prayer/actions";
import { CommunityText } from "@/components/community/community-text";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { relativeTime } from "@/lib/community/format";
import { initialFormState, type FormState } from "@/lib/forms";
import { PRAYER_LIMITS } from "@/lib/prayer/format";
import type { PrayerComment, PrayerUpdate } from "@/lib/prayer/types";
import { CommentModeration, DialogAction } from "./controls";
import { PrayerReportDialog } from "./report-dialog";

function Edited({ at }: { at: string | null }) {
  return at ? <span className="text-text-secondary"> · edited</span> : null;
}

/** One comment. Authors edit/delete; others report; moderators in scope hide/restore. */
export function CommentItem({ c, requestId, canModerate, canEdit }: { c: PrayerComment; requestId: string; canModerate: boolean; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body ?? "");
  const [state, action] = useActionState(async (prev: FormState, fd: FormData) => {
    const r = await editCommentAction(prev, fd);
    if (r.status === "success") setEditing(false);
    return r;
  }, initialFormState);
  return (
    <article id={`comment-${c.id}`} tabIndex={-1} className="rounded-card border border-border bg-surface p-5 outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-2 text-meta">
        <span className="font-semibold">{c.status === "deleted" ? "Deleted" : (c.author ?? "Former member")}</span>
        {c.is_requester && c.status !== "deleted" && !c.anonymous ? <span className="rounded-full bg-primary-soft px-2 text-[0.75rem] font-semibold">Requester</span> : null}
        <time dateTime={c.created_at} className="text-text-secondary">
          {relativeTime(c.created_at)}
        </time>
        {c.status === "visible" ? <Edited at={c.edited_at} /> : null}
      </header>
      {c.status === "deleted" ? (
        <p className="italic text-text-secondary">This comment was deleted by its author.</p>
      ) : c.status === "hidden" ? (
        <p className="italic text-text-secondary">Hidden by a prayer moderator.</p>
      ) : editing ? (
        <form action={action} className="space-y-3">
          <FormMessage state={state} />
          <input type="hidden" name="commentId" value={c.id} />
          <input type="hidden" name="requestId" value={requestId} />
          <TextAreaField label="Edit your comment" name="body" required maxLength={PRAYER_LIMITS.comment} rows={3} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save
            </SubmitButton>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : c.body ? (
        <CommunityText source={c.body} />
      ) : null}
      {c.status !== "deleted" && !editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {c.mine && c.status === "visible" ? (
            <>
              {canEdit ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} icon={<Pencil className="size-4" aria-hidden="true" />}>
                  Edit
                </Button>
              ) : null}
              <DialogAction action={deleteCommentAction} hidden={{ commentId: c.id, requestId }} trigger="Delete" icon={<Trash2 className="size-4" aria-hidden="true" />} confirmVariant="danger" title="Delete your comment?" confirmLabel="Delete">
                <p>A “deleted” placeholder stays so the conversation still makes sense. Your words are removed.</p>
              </DialogAction>
            </>
          ) : null}
          {!c.mine && c.status === "visible" ? <PrayerReportDialog type="comment" id={c.id} what="this comment" /> : null}
          {canModerate && !c.mine ? <CommentModeration commentId={c.id} requestId={requestId} status={c.status} /> : null}
        </div>
      ) : null}
    </article>
  );
}

export function UpdateItem({ u, requestId, canEdit }: { u: PrayerUpdate; requestId: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(u.body);
  const [state, action] = useActionState(async (prev: FormState, fd: FormData) => {
    const r = await editUpdateAction(prev, fd);
    if (r.status === "success") setEditing(false);
    return r;
  }, initialFormState);
  return (
    <li className="relative border-l-2 border-primary pl-4">
      <p className="text-meta text-text-secondary">
        <span className="font-semibold text-text">{u.kind === "answered" ? "Answered" : "Update"}</span> · {u.author} ·{" "}
        <time dateTime={u.created_at}>{new Date(u.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</time>
        <Edited at={u.edited_at} />
      </p>
      {editing ? (
        <form action={action} className="mt-2 space-y-3">
          <FormMessage state={state} />
          <input type="hidden" name="updateId" value={u.id} />
          <input type="hidden" name="requestId" value={requestId} />
          <TextAreaField label="Edit update" name="body" required maxLength={PRAYER_LIMITS.update} rows={3} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save
            </SubmitButton>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-1">
          <CommunityText source={u.body} />
        </div>
      )}
      {!editing ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {u.mine && canEdit ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} icon={<Pencil className="size-4" aria-hidden="true" />}>
                Edit
              </Button>
              <DialogAction action={deleteUpdateAction} hidden={{ updateId: u.id, requestId }} trigger="Delete" icon={<Trash2 className="size-4" aria-hidden="true" />} confirmVariant="danger" title="Delete this update?" confirmLabel="Delete" />
            </>
          ) : null}
          {!u.mine ? <PrayerReportDialog type="update" id={u.id} what="this update" /> : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Comment box. Keeps the draft (in component state only) if posting fails.
 * The requester of an anonymous request comments as "The requester" unless
 * they choose to show their name, which is explained first.
 */
export function CommentComposer({ requestId, anonymousRequester }: { requestId: string; anonymousRequester: boolean }) {
  const [state, action] = useActionState(commentAction, initialFormState);
  const [body, setBody] = useState("");
  const [named, setNamed] = useState(false);
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const status = useRef<HTMLParagraphElement>(null);
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.status !== "success" || handled.current === state) return;
    handled.current = state;
    setBody("");
    setNamed(false);
    setClientKey(crypto.randomUUID());
    const el = state.values?.commentId ? document.getElementById(`comment-${state.values.commentId}`) : null;
    (el ?? status.current)?.focus();
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="clientKey" value={clientKey} />
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <p ref={status} tabIndex={-1} role="status" className="sr-only outline-none">
        {state.status === "success" ? state.message : ""}
      </p>
      <TextAreaField label="Share encouragement" name="body" required maxLength={PRAYER_LIMITS.comment} rows={3} value={body} onChange={(e) => setBody(e.target.value)} hint="Keep it kind and brief. Only people who can read this request will see it." />
      {anonymousRequester ? (
        <div className="space-y-2">
          <CheckboxField label="Show my name on this comment" name="named" checked={named} onChange={(e) => setNamed(e.target.checked)} hint="Your request is anonymous. By default your comments show as “The requester”." />
          {named ? (
            <p role="note" className="rounded-tile border border-primary bg-primary-soft px-4 py-2 text-meta">
              Your name will appear on this comment. Readers may be able to tell that you wrote the request.
            </p>
          ) : null}
        </div>
      ) : null}
      <SubmitButton size="sm" pendingText="Posting…" icon={<MessageCircleHeart className="size-4" aria-hidden="true" />}>
        Post comment
      </SubmitButton>
    </form>
  );
}

export function UpdateComposer({ requestId, anonymous }: { requestId: string; anonymous: boolean }) {
  const [state, action] = useActionState(addUpdateAction, initialFormState);
  const [body, setBody] = useState("");
  const [answered, setAnswered] = useState(false);
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.status !== "success" || handled.current === state) return;
    handled.current = state;
    setBody("");
    setAnswered(false);
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <FormMessage state={state} />
      <TextAreaField label="Add a dated update" name="body" required maxLength={PRAYER_LIMITS.update} rows={3} value={body} onChange={(e) => setBody(e.target.value)} hint={anonymous ? "Updates show as “The requester”, never your name." : "Updates are shown with today's date."} />
      <CheckboxField label="This prayer was answered" name="answered" checked={answered} onChange={(e) => setAnswered(e.target.checked)} />
      <SubmitButton size="sm" pendingText="Posting…" icon={<Send className="size-4" aria-hidden="true" />}>
        Post update
      </SubmitButton>
    </form>
  );
}
