"use client";

/* eslint-disable @next/next/no-img-element -- short-lived signed URLs and local previews, never through the image optimizer */
import { useActionState, useEffect, useId, useState, type ReactNode } from "react";
import {
  activityStatusAction,
  createDemoActivitiesAction,
  removeActivityArtAction,
  saveActivityAction,
  updateActivityArtAction,
  uploadActivityArtAction,
} from "@/app/admin/youth/activities/actions";
import type { ButtonVariant } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { ACCEPT } from "@/lib/media/files";
import { ACTIVITY_KINDS, ART_SOURCES, CONTENT_SOURCES, DIFFICULTIES, isDifficulty } from "@/lib/youth/activities";
import { GameConfigEditor } from "./games/game-editor";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function ActionForm({
  action,
  hidden,
  children,
  submit,
  pendingText = "Saving…",
  variant = "primary",
  className,
}: {
  action: Action;
  hidden?: Record<string, string | null | undefined>;
  children?: ReactNode;
  submit: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [state, run] = useActionState(action, initialFormState);
  return (
    <form action={run} className={cn("space-y-4", className)}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={v} />))}
      <FormMessage state={state} />
      {children}
      <SubmitButton pendingText={pendingText} variant={variant} size="sm">
        {submit}
      </SubmitButton>
    </form>
  );
}

export type EditorDefaults = {
  title: string;
  summary: string;
  description: string;
  kind: string;
  difficulty: string;
  age_min: number | null;
  age_max: number | null;
  bible_story: string;
  scripture_refs: string[];
  lesson_title: string;
  lesson_week: string | null;
  cover_asset_id: string | null;
  cover_alt: string;
  cover_decorative: boolean;
  content_source: string;
  content_credit: string;
  change_note: string;
  /** datetime-local values in the church time zone. */
  available_from: string;
  available_until: string;
  /** The version's game, if any (edited with the game editor, never as text). */
  config?: Record<string, unknown>;
};

export type ArtChoice = { id: string; url: string | null; alt: string; source: string };

/**
 * The activity editor. Saving always writes the draft: a published activity
 * keeps serving its published version until the draft is published.
 */
export function ActivityEditorForm({
  activityId,
  defaults,
  art,
  groups,
  groupIds,
  timeZoneLabel,
}: {
  activityId: string | null;
  defaults: EditorDefaults;
  art: ArtChoice[];
  groups: Array<{ id: string; name: string }>;
  groupIds: string[];
  timeZoneLabel: string;
}) {
  const [state, run] = useActionState(saveActivityAction, initialFormState);
  const v = (k: keyof EditorDefaults) => state.values?.[k] ?? (Array.isArray(defaults[k]) ? (defaults[k] as string[]).join("\n") : String(defaults[k] ?? ""));
  const [cover, setCover] = useState(defaults.cover_asset_id ?? "");
  const [source, setSource] = useState(defaults.content_source || "original");
  const [kind, setKind] = useState(v("kind") || "story");
  const [difficulty, setDifficulty] = useState(v("difficulty") || "beginner");
  const fieldset = "space-y-4 rounded-card border border-border p-4 sm:p-5";
  const legend = "px-1 font-semibold";
  return (
    <form action={run} className="space-y-6">
      {activityId ? <input type="hidden" name="id" value={activityId} /> : null}
      <FormMessage state={state} />

      <fieldset className={fieldset}>
        <legend className={legend}>The activity</legend>
        <TextField label="Title" name="title" defaultValue={v("title")} maxLength={120} required />
        <TextField label="Card text" name="summary" hint="One or two sentences shown on the activity card." defaultValue={v("summary")} maxLength={300} optional />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Type" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} hint="Puzzle can be Put the Story in Order; Matching can be Bible Match.">
            {ACTIVITY_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Difficulty" name="difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} hint="Beginner, Growing, or Challenge.">
            {DIFFICULTIES.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}: {d.hint}
              </option>
            ))}
          </SelectField>
        </div>
        <fieldset className="space-y-2">
          <legend className="font-semibold">Suggested ages</legend>
          <p className="text-meta text-text-secondary">Shown as guidance only. Nobody is refused because of age. From 11 up, cards use the older-youth style.</p>
          <div className="grid grid-cols-2 gap-4">
            <TextField label="From" name="age_min" type="number" inputMode="numeric" min={2} max={18} defaultValue={v("age_min")} optional />
            <TextField label="To" name="age_max" type="number" inputMode="numeric" min={2} max={18} defaultValue={v("age_max")} optional />
          </div>
        </fieldset>
        <TextAreaField
          label="Description"
          name="description"
          rows={6}
          maxLength={8000}
          defaultValue={v("description")}
          optional
          hint="Markdown: **bold**, *italic*, lists, and links. HTML isn't allowed and is never shown as HTML."
        />
      </fieldset>

      <GameConfigEditor
        kind={kind}
        difficulty={isDifficulty(difficulty) ? difficulty : "beginner"}
        initial={defaults.config ?? {}}
        art={art}
        activityId={activityId}
      />

      <fieldset className={fieldset}>
        <legend className={legend}>Bible connection</legend>
        <TextField label="Bible story" name="bible_story" defaultValue={v("bible_story")} maxLength={160} optional />
        <TextAreaField label="Scripture references" name="scripture_refs" rows={3} defaultValue={v("scripture_refs")} hint="One per line, up to 10 (for example Genesis 6:9-22)." optional />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Lesson it connects to" name="lesson_title" defaultValue={v("lesson_title")} maxLength={160} optional />
          <TextField label="Week of the lesson" name="lesson_week" type="date" defaultValue={v("lesson_week")} hint="Any day that week. Shows under This Week's Lesson." optional />
        </div>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Cover</legend>
        {art.length === 0 ? (
          <p className="text-meta text-text-secondary">
            {activityId ? "Upload artwork below to use it as the cover. Without one, the card shows the built-in illustration for its type." : "Save the draft first, then upload artwork. Without a cover, the card shows the built-in illustration for its type."}
          </p>
        ) : (
          <div role="radiogroup" aria-label="Cover artwork" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className={cn("flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-tile border p-2 text-center text-meta", cover === "" ? "border-primary bg-primary-soft" : "border-border")}>
              <input type="radio" name="cover_asset_id" value="" checked={cover === ""} onChange={() => setCover("")} className="size-5" />
              Built-in illustration
            </label>
            {art.map((a) => (
              <label key={a.id} className={cn("flex cursor-pointer flex-col gap-2 rounded-tile border p-2 text-meta", cover === a.id ? "border-primary bg-primary-soft" : "border-border")}>
                {a.url ? <img src={a.url} alt="" className="aspect-[5/4] w-full rounded-control object-cover" /> : null}
                <span className="flex items-center gap-2">
                  <input type="radio" name="cover_asset_id" value={a.id} checked={cover === a.id} onChange={() => setCover(a.id)} className="size-5 shrink-0" />
                  <span className="line-clamp-2">{a.alt || "No description yet"}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <TextField
          label="Cover description"
          name="cover_alt"
          defaultValue={v("cover_alt")}
          maxLength={300}
          optional
          hint="What the picture shows, for people who can't see it. Leave empty to use the artwork's own description."
        />
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="cover_decorative" defaultChecked={defaults.cover_decorative} className="size-5" />
          <span>The cover is decorative (it adds nothing the title doesn&apos;t say)</span>
        </label>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Where the content came from</legend>
        <SelectField label="Written content" name="content_source" value={source} onChange={(e) => setSource(e.target.value)}>
          {CONTENT_SOURCES.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          label={source === "original" ? "Notes (optional)" : "Source and permission"}
          name="content_credit"
          rows={2}
          maxLength={500}
          defaultValue={v("content_credit")}
          hint={source === "original" ? "Who wrote it, if you'd like to record that." : "Who made it, where it came from, and the license or permission that lets the church use it."}
          required={source !== "original"}
        />
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Who and when</legend>
        {groups.length ? (
          <fieldset className="space-y-2">
            <legend className="font-semibold">Youth groups</legend>
            <p className="text-meta text-text-secondary">None chosen: every child whose guardian may practice with them. Chosen: only children enrolled in one of these groups.</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {groups.map((g) => (
                <label key={g.id} className="flex min-h-11 items-center gap-3">
                  <input type="checkbox" name="groups" value={g.id} defaultChecked={groupIds.includes(g.id)} className="size-5" />
                  <span>{g.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Available from" name="available_from" type="datetime-local" defaultValue={v("available_from")} hint={timeZoneLabel} optional />
          <TextField label="Available until" name="available_until" type="datetime-local" defaultValue={v("available_until")} hint={timeZoneLabel} optional />
        </div>
        <TextField label="What changed (for the version history)" name="change_note" defaultValue={v("change_note")} maxLength={300} optional />
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Saving…">{activityId ? "Save draft" : "Create draft"}</SubmitButton>
        <p className="text-meta text-text-secondary">Members don&apos;t see drafts.</p>
      </div>
    </form>
  );
}

/** One lifecycle step (ready, publish, archive…), with the typed confirmation when it needs one. */
export function ActivityStatusForm({
  activityId,
  action,
  submit,
  confirmWord,
  variant = "secondary",
  children,
}: {
  activityId: string;
  action: string;
  submit: string;
  confirmWord?: string;
  variant?: ButtonVariant;
  children?: ReactNode;
}) {
  const fid = useId();
  return (
    <ActionForm action={activityStatusAction} hidden={{ id: activityId, action }} submit={submit} variant={variant} className="space-y-3">
      {children}
      {confirmWord ? <TextField id={`${fid}-confirm`} label={`Type "${confirmWord}" to confirm`} name="confirm" autoComplete="off" required /> : null}
    </ActionForm>
  );
}

/** Upload artwork from this device, with its description and where it came from. */
export function ActivityArtUpload({ activityId, maxMb }: { activityId: string; maxMb: number }) {
  const fid = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [kind, setKind] = useState("original");
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  return (
    <ActionForm action={uploadActivityArtAction} hidden={{ activity: activityId }} submit="Upload artwork" pendingText="Uploading…">
      <div className="space-y-1.5">
        <label htmlFor={`${fid}-file`} className="block font-semibold">
          Image
        </label>
        <p id={`${fid}-hint`} className="text-meta text-text-secondary">
          JPEG, PNG, WebP, or HEIC up to {maxMb} MB, at least 200 pixels on each side. It&apos;s re-encoded and its hidden details (like location) are removed. SVG and animated
          images aren&apos;t accepted.
        </p>
        <input
          id={`${fid}-file`}
          name="file"
          type="file"
          accept={ACCEPT.image}
          required
          aria-describedby={`${fid}-hint`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
          className="block w-full min-h-12 rounded-control border border-border-strong bg-surface px-3 py-2 file:mr-3 file:min-h-9 file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:font-semibold"
        />
        {preview ? <img src={preview} alt="" className="mt-2 max-h-48 rounded-tile border border-border object-contain" /> : null}
      </div>
      <TextField id={`${fid}-alt`} label="Description" name="alt" maxLength={300} hint="What the picture shows, for people who can't see it." optional />
      <SelectField id={`${fid}-kind`} label="Where it came from" name="source_kind" value={kind} onChange={(e) => setKind(e.target.value)}>
        {ART_SOURCES.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </SelectField>
      <TextField id={`${fid}-credit`} label="Artist or source" name="source_credit" maxLength={300} required={kind !== "original"} optional={kind === "original"} />
      <TextField id={`${fid}-license`} label="License or permission" name="license" maxLength={300} hint="For example the license name, or who gave permission and when." optional />
      <TextField id={`${fid}-url`} label="Source link" name="source_url" type="url" inputMode="url" placeholder="https://" maxLength={500} optional />
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" name="rights_confirmed" required className="mt-1 size-5 shrink-0" />
        <span>I confirm this artwork is original or appropriately licensed, and the church may use it here.</span>
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="use_as_cover" defaultChecked className="size-5" />
        <span>Use it as the draft&apos;s cover</span>
      </label>
    </ActionForm>
  );
}

/** Edit an uploaded artwork's description and source, or remove it if no published version uses it. */
export function ActivityArtItem({
  activityId,
  asset,
  url,
  locked,
  inDraft,
}: {
  activityId: string;
  asset: { id: string; alt: string; source_kind: string; source_credit: string; license: string; source_url: string | null; rights_confirmed_by: string | null; rights_confirmed_at: string };
  url: string | null;
  locked: boolean;
  /** Used by a scene or card in the draft's game. */
  inDraft?: boolean;
}) {
  const fid = useId();
  const label = ART_SOURCES.find(([k]) => k === asset.source_kind)?.[1] ?? asset.source_kind;
  return (
    <li className="grid gap-4 rounded-card border border-border p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
      {url ? <img src={url} alt={asset.alt} className="aspect-[5/4] w-full rounded-tile object-cover" /> : <div className="aspect-[5/4] rounded-tile bg-surface-muted" />}
      <div className="space-y-3">
        <p className="text-meta text-text-secondary">
          {label}
          {asset.rights_confirmed_by ? ` · rights confirmed by ${asset.rights_confirmed_by}` : ""}
        </p>
        <ActionForm action={updateActivityArtAction} hidden={{ asset: asset.id, activity: activityId }} submit="Save details" variant="secondary" className="space-y-3">
          <TextField id={`${fid}-alt`} label="Description" name="alt" defaultValue={asset.alt} maxLength={300} optional />
          <TextField id={`${fid}-credit`} label="Artist or source" name="source_credit" defaultValue={asset.source_credit} maxLength={300} optional={asset.source_kind === "original"} />
          <TextField id={`${fid}-license`} label="License or permission" name="license" defaultValue={asset.license} maxLength={300} optional />
          <TextField id={`${fid}-url`} label="Source link" name="source_url" type="url" defaultValue={asset.source_url ?? ""} maxLength={500} optional />
        </ActionForm>
        {locked ? (
          <p className="text-meta text-text-secondary">Part of a published version, so it&apos;s kept.</p>
        ) : inDraft ? (
          <p className="text-meta text-text-secondary">Used in the draft&apos;s game. Choose another picture there before removing it.</p>
        ) : (
          <ActionForm action={removeActivityArtAction} hidden={{ asset: asset.id, activity: activityId }} submit="Remove artwork" pendingText="Removing…" variant="danger-outline" />
        )}
      </div>
    </li>
  );
}

/** Add the demonstration games as private drafts. */
export function DemoActivitiesForm() {
  return <ActionForm action={createDemoActivitiesAction} submit="Add demonstration drafts" pendingText="Adding…" variant="secondary" className="space-y-3" />;
}
