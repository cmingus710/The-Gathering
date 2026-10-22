"use client";

import { CircleAlert, Globe, Lock, Send } from "lucide-react";
import { useActionState, useState } from "react";
import { AttachmentPicker } from "@/components/community/attachment-picker";
import { MentionTextarea, type MentionPlace } from "@/components/community/mention-textarea";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/components/ui/cn";
import { SubmitButton } from "@/components/ui/submit-button";
import { LIMITS } from "@/lib/community/format";
import { initialFormState, type FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** Who will see a post, shown before posting. */
export function AudienceNotice({ audience, place }: { audience: "church" | "group"; place: string }) {
  return (
    <p className="flex items-start gap-2 rounded-card border border-border bg-surface-muted px-4 py-3 text-meta">
      {audience === "group" ? <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /> : <Globe className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />}
      <span>
        {audience === "group" ? (
          <>
            <strong>Private to {place}.</strong> Only the group&apos;s current members can read it.
          </>
        ) : (
          <>
            <strong>Church-wide in {place}.</strong> All approved members can read it. It&apos;s never public.
          </>
        )}
      </span>
    </p>
  );
}

const FORMAT_HINT = "You can use **bold**, _italic_, lists, > quotes, and links. Type @ and a name to mention someone.";

/**
 * New or edited discussion. Fields are controlled, so the text survives a
 * failed save (and React's automatic form reset). A fresh idempotency key
 * per draft means a retried submit can never post twice. New discussions
 * can carry photos and videos (`attachments`); edits keep the ones posted.
 * The message box suggests people to @mention for the post's place (its
 * category or group, from `hidden`, or the post itself when editing).
 */
export function ThreadComposer({
  action,
  audience,
  place,
  hidden,
  initial,
  submitLabel,
  attachments = false,
}: {
  action: Action;
  audience: "church" | "group";
  place: string;
  hidden: Record<string, string>;
  initial?: { title: string; body: string };
  submitLabel: string;
  attachments?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [clientKey] = useState(() => crypto.randomUUID());
  const [uploading, setUploading] = useState(false);
  const fe = state.fieldErrors ?? {};
  const mentionPlace: MentionPlace = hidden.threadId
    ? { threadId: hidden.threadId }
    : { categoryId: hidden.categoryId || null, groupId: hidden.groupId || null };
  const bodyError = fe.body?.[0];
  return (
    <form action={formAction} className="space-y-5">
      <AudienceNotice audience={audience} place={place} />
      <FormMessage state={state} />
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="clientKey" value={clientKey} />
      <TextField label="Title" name="title" required minLength={3} maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} error={fe.title} />
      <div className="space-y-1.5">
        <label htmlFor="field-body" className="block font-semibold text-text">
          Message
        </label>
        <p id="field-body-hint" className="text-meta text-text-secondary">
          {FORMAT_HINT}
        </p>
        <MentionTextarea
          id="field-body"
          name="body"
          required
          maxLength={LIMITS.thread}
          minRows={8}
          value={body}
          onValueChange={setBody}
          place={mentionPlace}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? "field-body-hint field-body-error" : "field-body-hint"}
          className={cn("min-h-32 leading-relaxed", bodyError && "border-danger")}
        />
        {bodyError ? (
          <p id="field-body-error" className="flex items-start gap-1.5 text-meta font-medium text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">Error: </span>
              {bodyError}
            </span>
          </p>
        ) : null}
      </div>
      {attachments ? <AttachmentPicker onBusyChange={setUploading} /> : null}
      <SubmitButton pendingText="Posting…" icon={<Send className="size-4" aria-hidden="true" />} disabled={uploading}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
