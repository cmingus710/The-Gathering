"use client";

import { Globe, ImagePlus, Lock, Send } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { createThreadAction } from "@/app/(member)/community/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { LIMITS } from "@/lib/community/format";
import { initialFormState } from "@/lib/forms";
import { AttachmentPicker } from "./attachment-picker";
import { AutoGrowTextarea, InitialsAvatar, useDraftGuard } from "./feed-bits";

export type ComposerPlace = { kind: "category" | "group"; id: string; name: string };

/**
 * "Share something…" at the top of the feed. Collapsed it is one line; it
 * opens to the existing posting fields: where to post (a church-wide
 * category or one of the member's groups, with who can read it), a title,
 * the message, and photos or videos. The draft is kept if posting fails, and
 * closing it with text or files asks first.
 */
export function FeedComposer({
  viewerName,
  places,
  initialPlace,
  returnTo,
}: {
  viewerName: string;
  places: ComposerPlace[];
  initialPlace: string | null;
  /** The feed to come back to after posting (validated by the action). */
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createThreadAction, initialFormState);
  const [place, setPlace] = useState(initialPlace ?? (places[0] ? `${places[0].kind}:${places[0].id}` : ""));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [clientKey] = useState(() => crypto.randomUUID());
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState(0);
  // "Photo/video" on the collapsed bar opens the composer and then the file chooser.
  const wantFiles = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const dirty = title.trim().length > 0 || body.trim().length > 0 || files > 0;
  useDraftGuard("new-post", dirty);

  useEffect(() => {
    if (!open) return;
    if (wantFiles.current) {
      wantFiles.current = false;
      formRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
    } else titleRef.current?.focus();
  }, [open]);

  const selected = places.find((p) => `${p.kind}:${p.id}` === place);

  if (!open) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-border bg-surface p-3 shadow-(--elev-card) sm:gap-3 sm:px-4">
        <InitialsAvatar name={viewerName} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="min-h-11 min-w-0 flex-1 truncate rounded-full border border-border bg-surface-muted/60 px-4 text-left text-[0.9375rem] text-text-secondary hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Share something with your church community…
        </button>
        <button
          type="button"
          onClick={() => {
            wantFiles.current = true;
            setOpen(true);
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-primary hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ImagePlus className="size-6" aria-hidden="true" />
          <span className="sr-only">Add photos or video to a new post</span>
        </button>
      </div>
    );
  }

  const fe = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={formAction} aria-labelledby={`${id}-heading`} className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <div className="flex items-center gap-3">
        <InitialsAvatar name={viewerName} />
        <h2 id={`${id}-heading`} className="font-semibold">
          New post
        </h2>
      </div>
      <FormMessage state={state} />
      <input type="hidden" name="clientKey" value={clientKey} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="categoryId" value={selected?.kind === "category" ? selected.id : ""} />
      <input type="hidden" name="groupId" value={selected?.kind === "group" ? selected.id : ""} />

      <div className="space-y-1">
        <label htmlFor={`${id}-place`} className="block text-meta font-semibold">
          Post to
        </label>
        <select
          id={`${id}-place`}
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          required
          aria-describedby={`${id}-audience`}
          className="block min-h-11 w-full rounded-control border border-border-strong/70 bg-surface px-3 text-base text-text focus-visible:outline-3 focus-visible:outline-primary"
        >
          <optgroup label="Church-wide">
            {places
              .filter((p) => p.kind === "category")
              .map((p) => (
                <option key={p.id} value={`category:${p.id}`}>
                  {p.name}
                </option>
              ))}
          </optgroup>
          {places.some((p) => p.kind === "group") ? (
            <optgroup label="Your groups (private)">
              {places
                .filter((p) => p.kind === "group")
                .map((p) => (
                  <option key={p.id} value={`group:${p.id}`}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          ) : null}
        </select>
        <p id={`${id}-audience`} className="flex items-start gap-1.5 text-[0.8125rem] text-text-secondary">
          {selected?.kind === "group" ? (
            <>
              <Lock className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" /> Private to {selected.name}. Only its current members can read it.
            </>
          ) : (
            <>
              <Globe className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" /> Church-wide: all approved members can read it. It&apos;s never public.
            </>
          )}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-title`} className="block text-meta font-semibold">
          Title
        </label>
        <input
          ref={titleRef}
          id={`${id}-title`}
          name="title"
          required
          minLength={3}
          maxLength={LIMITS.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={fe.title ? true : undefined}
          className="block min-h-11 w-full rounded-control border border-border-strong/70 bg-surface px-3.5 text-base text-text focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary"
        />
        {fe.title ? <p className="text-meta text-danger">{fe.title[0]}</p> : null}
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-body`} className="block text-meta font-semibold">
          Message
        </label>
        <AutoGrowTextarea
          id={`${id}-body`}
          name="body"
          required
          maxLength={LIMITS.thread}
          minRows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share something with your church community…"
          aria-invalid={fe.body ? true : undefined}
          aria-describedby={`${id}-format`}
        />
        {fe.body ? <p className="text-meta text-danger">{fe.body[0]}</p> : null}
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-meta text-text-secondary underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
            Formatting help
          </summary>
          <p id={`${id}-format`} className="pb-1 text-meta text-text-secondary">
            You can use **bold**, _italic_, lists, &gt; quotes, and links.
          </p>
        </details>
      </div>

      <AttachmentPicker compact onBusyChange={setUploading} onCountChange={setFiles} />

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (dirty && !window.confirm("Discard this post? Your text and any chosen photos or videos will be lost.")) return;
            setTitle("");
            setBody("");
            setOpen(false);
          }}
        >
          Cancel
        </Button>
        <SubmitButton size="sm" pendingText="Posting…" disabled={uploading || !selected} icon={<Send className="size-4" aria-hidden="true" />}>
          Post
        </SubmitButton>
      </div>
    </form>
  );
}
