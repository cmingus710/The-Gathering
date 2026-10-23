"use client";

import { AtSign, CircleAlert, EyeOff, Globe, Lock, Send, ShieldCheck, UserRound, Users } from "lucide-react";
import { useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { prayerMentionCheckAction, type MentionCheck } from "@/app/(app)/(member)/mention-actions";
import { CommunityText } from "@/components/community/community-text";
import { MentionTextarea } from "@/components/mentions/mention-textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { parseMentions, removeMention, serializeMentions, type Mention } from "@/lib/community/mentions";
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

const FORMAT_HINT = "You can use **bold**, _italic_, and lists. Add a link with the Link button, or paste an address over selected words. Type @ and a name to mention someone or a group who can see it. Attachments aren't available yet.";

/** Why a chosen mention can't stay with the chosen audience. */
function problemText(m: Mention, audienceLabel: string): string {
  return m.kind === "group"
    ? `@${m.name} can't be mentioned in a request shared with ${audienceLabel}. Only groups in the group directory, or the group it's shared with, can be.`
    : `@${m.name} can't see a request shared with ${audienceLabel}, so they can't be mentioned. Mentioning someone never shares the request with them.`;
}

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
 *
 * @mentions: the audience stays in view next to the text, and mentioning
 * never changes it. When the audience changes, the chosen people and groups
 * are checked against it (prayer_mention_check) and anything that wouldn't
 * fit is explained, with a way to remove it, before saving; the server
 * checks again and never widens the audience to make a mention fit.
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
  const audienceLabel = audience === "group" ? (groupName ?? "your group") : AUDIENCE_LABEL[audience].toLowerCase();

  // Check the chosen mentions against the chosen audience.
  const { text: plainBody, mentions } = useMemo(() => parseMentions(body), [body]);
  const people = [...new Set(mentions.filter((m) => m.kind !== "group").map((m) => m.id))];
  const mentionedGroups = [...new Set(mentions.filter((m) => m.kind === "group").map((m) => m.id))];
  const checkKey = mentions.length ? JSON.stringify([audience, target.groupId, anonymous, people, mentionedGroups]) : "";
  const [check, setCheck] = useState<{ key: string; result: MentionCheck } | null>(null);
  useEffect(() => {
    if (!checkKey) return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await prayerMentionCheckAction({ audience, groupId: target.groupId || null, anonymous, people: people.slice(0, 10), groups: mentionedGroups.slice(0, 10) }).catch(() => null);
      if (current && result) setCheck({ key: checkKey, result });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // The inputs are all in checkKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);
  const result = checkKey && check?.key === checkKey ? check.result : null;
  const blocked = !result
    ? []
    : result.unavailable === "team"
      ? mentions
      : mentions.filter((m) => (m.kind === "group" ? result.groups : result.people).includes(m.id));
  const quiet = result && !result.unavailable ? mentions.filter((m) => m.kind === "group" && result.quiet.includes(m.id)) : [];
  const problemRef = useRef<HTMLDivElement>(null);
  const removeOne = (m: Mention) => {
    const next = removeMention(plainBody, mentions, m);
    setBody(serializeMentions(next.text, next.mentions));
  };

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (blocked.length) {
      e.preventDefault();
      problemRef.current?.focus();
      return;
    }
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
        <div className="space-y-1.5">
          <label htmlFor="field-body" className="block font-semibold text-text">
            Your request
          </label>
          <p id="field-body-hint" className="text-meta text-text-secondary">
            {FORMAT_HINT}
          </p>
          <MentionTextarea
            id="field-body"
            name="body"
            required
            maxLength={PRAYER_LIMITS.body}
            minRows={7}
            value={body}
            onValueChange={setBody}
            place={{ module: "prayer", audience, groupId: audience === "group" ? groupId || null : null, anonymous }}
            aria-invalid={fe.body ? true : undefined}
            aria-describedby={fe.body ? "field-body-hint field-body-audience field-body-error" : "field-body-hint field-body-audience"}
            className={cn("min-h-32 leading-relaxed", fe.body && "border-danger")}
          />
          <p id="field-body-audience" className="flex items-start gap-1.5 text-meta text-text-secondary">
            <span className="mt-0.5 shrink-0 text-primary">{AUDIENCE_ICON[audience]}</span>
            <span>
              <strong className="text-text">Seen by {audienceLabel}.</strong>{" "}
              {audience === "team"
                ? "Mentions aren't available on confidential requests."
                : audience === "private"
                  ? "Mentions are checked and sent only when you share it."
                  : "Mentioning someone lets them know about this request. It doesn't share it with anyone else, or say the request is about them."}
            </span>
          </p>
          {fe.body ? (
            <p id="field-body-error" className="flex items-start gap-1.5 text-meta font-medium text-danger">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="sr-only">Error: </span>
                {fe.body[0]}
              </span>
            </p>
          ) : null}
          {blocked.length ? (
            <div ref={problemRef} tabIndex={-1} role="alert" className="space-y-2 rounded-tile border border-danger bg-surface px-4 py-3 text-meta outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <p className="font-semibold text-danger">
                {result?.unavailable === "team" ? "Confidential requests can't mention anyone. Remove these mentions or choose another audience:" : "Fix these mentions before saving:"}
              </p>
              <ul className="space-y-1.5">
                {blocked.map((m) => (
                  <li key={`${m.kind ?? "member"}-${m.id}-${m.start}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{result?.unavailable === "team" ? `@${m.name}` : problemText(m, audienceLabel)}</span>
                    <Button size="sm" variant="secondary" onClick={() => removeOne(m)}>
                      Remove @{m.name}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-text-secondary">Nothing has been saved yet, and the audience is never widened to make a mention fit.</p>
            </div>
          ) : null}
          {quiet.length ? (
            <ul className="space-y-1 text-meta text-text-secondary">
              {quiet.map((m) => (
                <li key={`quiet-${m.id}-${m.start}`} className="flex items-start gap-1.5">
                  <Users className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    @{m.name} will be mentioned without notifying anyone{anonymous ? ": groups aren't notified from anonymous requests." : "."}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

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
          <div className="mt-3">
            {body.trim() ? (
              <CommunityText source={body} mentions={mentions.map((m) => ({ id: m.id, name: m.name, listed: false, kind: m.kind }))} />
            ) : (
              <p className="text-text-secondary">Your request will appear here.</p>
            )}
          </div>
          {mentions.length ? (
            <p className="mt-2 flex items-center gap-1.5 text-meta text-text-secondary">
              <AtSign className="size-3.5" aria-hidden="true" />
              Mentioned people and groups are told about it if they can already see it.
            </p>
          ) : null}
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
