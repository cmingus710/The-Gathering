"use client";

import { EyeOff, Globe, Lock, Send, ShieldCheck, UserRound, Users } from "lucide-react";
import { useActionState, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CommunityText } from "@/components/community/community-text";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { ANONYMOUS_NOTICE, AUDIENCE_LABEL, audienceDescription, isNarrowing, PRAYER_LIMITS } from "@/lib/prayer/format";
import type { Audience, GroupOption } from "@/lib/prayer/types";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

const AUDIENCE_ICON: Record<Audience, ReactNode> = {
  church: <Globe className="size-4" aria-hidden="true" />,
  group: <Users className="size-4" aria-hidden="true" />,
  team: <ShieldCheck className="size-4" aria-hidden="true" />,
  private: <Lock className="size-4" aria-hidden="true" />,
};

const FORMAT_HINT = "You can use **bold**, _italic_, lists, and links. Attachments aren't available yet.";

export type ComposerInitial = {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  groupId: string | null;
  anonymous: boolean;
  commentsEnabled: boolean;
};

/**
 * New or edited prayer request. Fields are controlled (state only, never
 * browser storage), so text survives a failed save. The preview shows
 * exactly what readers will see. Sharing or widening the audience opens a
 * confirmation naming the new audience; the server refuses without it.
 */
export function RequestComposer({ action, groups, initial }: { action: Action; groups: GroupOption[]; initial?: ComposerInitial }) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const [title, setTitle] = useState(v?.title ?? initial?.title ?? "");
  const [body, setBody] = useState(v?.body ?? initial?.body ?? "");
  const [audience, setAudience] = useState<Audience>((v?.audience as Audience) || initial?.audience || "church");
  const [groupId, setGroupId] = useState(v?.groupId ?? initial?.groupId ?? groups[0]?.id ?? "");
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? false);
  const [commentsEnabled, setCommentsEnabled] = useState(initial?.commentsEnabled ?? true);
  const [confirmed, setConfirmed] = useState("");
  const [clientKey] = useState(() => crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitle = useId();
  const fe = state.fieldErrors ?? {};
  const groupName = groups.find((g) => g.id === groupId)?.name ?? null;
  const target = { audience, groupId: audience === "group" ? groupId : null };
  const needsConfirm = audience !== "private" && (!initial || !isNarrowing({ audience: initial.audience, groupId: initial.groupId }, target));
  const wasPublic = initial && initial.audience !== "private";

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (needsConfirm && confirmed !== audience) {
      e.preventDefault();
      dialogRef.current?.showModal();
    }
  }

  function confirm() {
    setConfirmed(audience);
    dialogRef.current?.close();
    // Let the hidden field update before submitting.
    window.setTimeout(() => formRef.current?.requestSubmit(), 0);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <form ref={formRef} action={formAction} onSubmit={onSubmit} className="space-y-6">
        <FormMessage state={state} />
        {initial ? <input type="hidden" name="requestId" value={initial.id} /> : null}
        <input type="hidden" name="clientKey" value={clientKey} />
        <input type="hidden" name="confirm" value={confirmed === audience ? audience : ""} />

        <TextField label="Title" name="title" required minLength={3} maxLength={PRAYER_LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} error={fe.title} hint="A few words. Avoid names or details you haven't been given permission to share." />
        <TextAreaField label="Your request" name="body" required maxLength={PRAYER_LIMITS.body} rows={7} value={body} onChange={(e) => setBody(e.target.value)} error={fe.body} hint={FORMAT_HINT} />

        <fieldset className="space-y-2">
          <legend className="mb-1 font-semibold">Who can see it?</legend>
          {(["church", "group", "team", "private"] as Audience[]).map((a) => {
            const disabled = a === "group" && groups.length === 0;
            return (
              <label key={a} className={`flex cursor-pointer items-start gap-3 rounded-tile border px-4 py-3 ${audience === a ? "border-primary bg-primary-soft" : "border-border bg-surface"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
                <input type="radio" name="audience" value={a} checked={audience === a} disabled={disabled} onChange={() => setAudience(a)} className="mt-1 size-5 accent-primary" />
                <span>
                  <span className="flex items-center gap-1.5 font-semibold">
                    {AUDIENCE_ICON[a]} {AUDIENCE_LABEL[a]}
                  </span>
                  <span className="block text-meta text-text-secondary">
                    {disabled ? "You aren't in an active group yet." : audienceDescription(a, a === "group" ? groupName : null)}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {audience === "group" && groups.length ? (
          <SelectField label="Which group?" name="groupId" value={groupId} onChange={(e) => setGroupId(e.target.value)} error={fe.groupId}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
        ) : null}

        <div className="space-y-3">
          <CheckboxField label="Hide my name" name="anonymous" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} hint={ANONYMOUS_NOTICE} />
          {initial?.anonymous && !anonymous ? (
            <p className="rounded-tile border border-primary bg-primary-soft px-4 py-2 text-meta">Turning this off shows your name on this request to everyone who can read it.</p>
          ) : null}
          <CheckboxField label="Allow encouraging comments" name="commentsEnabled" checked={commentsEnabled} onChange={(e) => setCommentsEnabled(e.target.checked)} hint="You can turn comments off at any time." />
        </div>

        {wasPublic && needsConfirm ? (
          <p className="rounded-tile border border-border bg-surface-muted px-4 py-3 text-meta">
            Widening the audience doesn&apos;t share earlier comments and updates: they stay visible only to the people who could read them when they were written.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingText="Saving…" icon={<Send className="size-4" aria-hidden="true" />}>
            {audience === "private" ? "Save private draft" : initial && initial.audience !== "private" ? "Save changes" : "Share request"}
          </SubmitButton>
        </div>
      </form>

      <aside aria-label="Preview" className="space-y-2 lg:sticky lg:top-6 lg:self-start">
        <p className="text-meta font-semibold uppercase tracking-wide text-text-secondary">Preview: how readers will see it</p>
        <div className="rounded-card border border-border bg-surface p-5 shadow-(--elev-card)">
          <p className="mb-2 flex items-center gap-1.5 text-meta font-semibold text-primary">
            {AUDIENCE_ICON[audience]} {audience === "group" ? (groupName ?? "Your group") : AUDIENCE_LABEL[audience]}
          </p>
          <h2 className="font-display text-xl font-semibold leading-snug">{title.trim() || "Your title"}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-meta text-text-secondary">
            {anonymous ? <EyeOff className="size-3.5" aria-hidden="true" /> : <UserRound className="size-3.5" aria-hidden="true" />}
            {anonymous ? "Anonymous" : "Your name"} · just now
          </p>
          <div className="mt-3">{body.trim() ? <CommunityText source={body} /> : <p className="text-text-secondary">Your request will appear here.</p>}</div>
          <p className="mt-3 text-meta text-text-secondary">{commentsEnabled ? "Comments on" : "Comments off"}</p>
        </div>
      </aside>

      <dialog ref={dialogRef} aria-labelledby={dialogTitle} className="m-auto w-[min(30rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-6 text-text shadow-(--elev-lift) backdrop:bg-black/50">
        <h2 id={dialogTitle} className="font-display text-xl font-semibold">
          Share with {audience === "group" ? (groupName ?? "your group") : AUDIENCE_LABEL[audience].toLowerCase()}?
        </h2>
        <p className="mt-2 text-text-secondary">{audienceDescription(audience, groupName)}</p>
        {anonymous ? <p className="mt-2 text-text-secondary">Your name will be hidden from readers.</p> : <p className="mt-2 text-text-secondary">Your name will be shown.</p>}
        <p className="mt-2 text-meta text-text-secondary">It won&apos;t be posted anywhere else. You can narrow the audience, archive, or delete it later.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => dialogRef.current?.close()} autoFocus>
            Go back
          </Button>
          <Button size="sm" onClick={confirm}>
            Yes, share it
          </Button>
        </div>
      </dialog>
    </div>
  );
}
