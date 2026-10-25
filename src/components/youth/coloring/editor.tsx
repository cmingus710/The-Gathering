"use client";

/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { useActionState, useId, useState } from "react";
import {
  checkColoringSvgAction,
  createDemoDraftsAction,
  removeColoringAction,
  saveColoringTemplateAction,
  setLineArtAction,
  type ColoringCheckState,
} from "@/app/admin/youth/activities/coloring-actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { ART_SOURCES } from "@/lib/youth/activities";
import type { ColoringTemplate } from "@/lib/youth/coloring";
import { ColoringPreview } from "./picture";

function PictureSummary({ t, lineArtUrl }: { t: ColoringTemplate; lineArtUrl?: string | null }) {
  const source = ART_SOURCES.find(([k]) => k === t.attribution.source_kind)?.[1] ?? t.attribution.source_kind;
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <ColoringPreview t={t} lineArtUrl={lineArtUrl} className="overflow-hidden rounded-tile border border-border bg-white" />
      <div className="space-y-2 text-meta">
        <p>
          {t.mode === "regions" ? (
            <Badge tone="success">Tap-to-fill · {t.regions.length} parts</Badge>
          ) : (
            <Badge tone="warning">Freehand only: no tap-to-fill</Badge>
          )}
        </p>
        <p>
          <span className="font-semibold">Artwork: </span>
          {source}
          {t.attribution.credit ? ` · ${t.attribution.credit}` : ""}
          {t.attribution.license ? ` · ${t.attribution.license}` : ""}
          {t.attribution.source_url ? ` · ${t.attribution.source_url}` : ""}
        </p>
        <p>
          <span className="font-semibold">Story summary: </span>
          {t.story || <span className="text-danger">None yet. Add one: it&apos;s the text alternative to the picture.</span>}
        </p>
        {t.mode === "regions" ? (
          <details>
            <summary className="min-h-11 cursor-pointer font-semibold">Part names (what keyboard and screen reader users hear)</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-6">
              {t.regions.map((r) => (
                <li key={r.id}>{r.label}</li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function Attribution({ fid, defaults }: { fid: string; defaults?: Record<string, string> }) {
  const [kind, setKind] = useState(defaults?.source_kind || "original");
  return (
    <>
      <SelectField id={`${fid}-kind`} label="Where the artwork came from" name="source_kind" value={kind} onChange={(e) => setKind(e.target.value)}>
        {ART_SOURCES.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </SelectField>
      <TextField id={`${fid}-credit`} label="Artist or source" name="source_credit" defaultValue={defaults?.source_credit} maxLength={300} required={kind !== "original"} optional={kind === "original"} hint="Kept with the picture and shown to members." />
      <TextField id={`${fid}-license`} label="License or permission" name="license" defaultValue={defaults?.license} maxLength={300} optional />
      <TextField id={`${fid}-url`} label="Source link" name="source_url" type="url" inputMode="url" placeholder="https://" defaultValue={defaults?.source_url} maxLength={500} optional />
    </>
  );
}

/**
 * The editor's Coloring picture section: the draft's current picture, an
 * SVG upload that is checked and previewed before it's used, and ordinary
 * line art as an explicitly freehand-only picture.
 */
export function ColoringEditor({
  activityId,
  kind,
  current,
  currentLineArtUrl,
  art,
}: {
  activityId: string;
  kind: string;
  current: ColoringTemplate | null;
  currentLineArtUrl: string | null;
  art: Array<{ id: string; url: string | null; alt: string }>;
}) {
  const fid = useId();
  const [checked, check] = useActionState<ColoringCheckState, FormData>(checkColoringSvgAction, initialFormState);
  const [saved, save] = useActionState(saveColoringTemplateAction, initialFormState);
  const [removed, remove] = useActionState(removeColoringAction, initialFormState);
  const [lineArt, applyLineArt] = useActionState(setLineArtAction, initialFormState);
  const [pick, setPick] = useState(current?.line_art_asset_id ?? art[0]?.id ?? "");
  const fieldset = "space-y-4 rounded-card border border-border p-4 sm:p-5";

  if (kind !== "drawing" && !current) {
    return <p className="text-meta text-text-secondary">Set the type to Drawing &amp; coloring and save the draft to add a coloring picture.</p>;
  }
  return (
    <div className="space-y-6">
      <FormMessage state={saved} />
      <FormMessage state={removed} />
      <FormMessage state={lineArt} />
      {current ? (
        <div className={fieldset}>
          <h3 className="font-semibold">Current picture</h3>
          <PictureSummary t={current} lineArtUrl={currentLineArtUrl} />
          <form action={remove}>
            <input type="hidden" name="activity" value={activityId} />
            <SubmitButton variant="danger-outline" size="sm" pendingText="Removing…">
              Remove the coloring picture
            </SubmitButton>
          </form>
        </div>
      ) : (
        <p className="text-meta text-text-secondary">No coloring picture yet. Until there is one, members see only Mark finished.</p>
      )}

      <form action={check} className={fieldset}>
        <h3 className="font-semibold">Tap-to-fill picture (SVG)</h3>
        <input type="hidden" name="activity" value={activityId} />
        <details className="text-meta">
          <summary className="min-h-11 cursor-pointer font-semibold text-primary">How to prepare the SVG</summary>
          <ul className="mt-1 list-disc space-y-1 pl-6 text-text-secondary">
            <li>Give each part children can tap to fill <code>data-region=&quot;Name&quot;</code>, for example <code>data-region=&quot;Rainbow, red stripe&quot;</code>. A group of shapes can be one part.</li>
            <li>Everything else drawn (outlines, details, dark dots) becomes line art on top of the coloring. Colors in the file are ignored: parts start white.</li>
            <li>Convert text to paths. Scripts, links, embedded images, fonts, styles, gradients, filters, and animation aren&apos;t accepted; the file is refused rather than cleaned.</li>
            <li>The file itself is never stored or shown: only the checked shapes are kept. Up to {512} KB and 300 parts.</li>
            <li>A photo or scanned drawing can&apos;t become tap-to-fill. Upload it under Artwork and use it as a freehand-only picture below.</li>
          </ul>
        </details>
        {checked.status === "error" ? (
          <Alert tone="error" title={checked.message ?? "This SVG can't be used."}>
            {checked.errors?.length ? (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {checked.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor={`${fid}-svg`} className="block font-semibold">
            SVG file
          </label>
          <input
            id={`${fid}-svg`}
            name="file"
            type="file"
            accept=".svg,image/svg+xml"
            required
            className="block w-full min-h-12 rounded-control border border-border-strong bg-surface px-3 py-2 file:mr-3 file:min-h-9 file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:font-semibold"
          />
        </div>
        <TextAreaField
          id={`${fid}-story`}
          label="Short story summary"
          name="story"
          rows={4}
          maxLength={1500}
          defaultValue={checked.values?.story ?? current?.story ?? ""}
          hint="The story in a few plain sentences, shown with the picture as its text alternative. Check it against the Scripture references."
        />
        <Attribution fid={`${fid}-svg-attr`} defaults={checked.values} />
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="rights_confirmed" required className="mt-1 size-5 shrink-0" />
          <span>I confirm this artwork is original or appropriately licensed, and the church may use it here.</span>
        </label>
        <SubmitButton variant="secondary" size="sm" pendingText="Checking…">
          Check and preview
        </SubmitButton>
      </form>

      {checked.status === "success" && checked.template ? (
        <div className={cn(fieldset, "border-primary")}>
          <h3 className="font-semibold">Preview</h3>
          <Alert tone="success" title={checked.message ?? "Checked."}>
            {checked.warnings?.length ? (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {checked.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
          <PictureSummary t={checked.template} />
          <form action={save}>
            <input type="hidden" name="activity" value={activityId} />
            <input type="hidden" name="template" value={JSON.stringify(checked.template)} />
            <SubmitButton size="sm" pendingText="Saving…">
              {current ? "Replace the draft's picture with this one" : "Use this picture for the draft"}
            </SubmitButton>
          </form>
        </div>
      ) : null}

      <form action={applyLineArt} className={fieldset}>
        <h3 className="font-semibold">Freehand-only picture (line art image)</h3>
        <input type="hidden" name="activity" value={activityId} />
        <p className="text-meta text-text-secondary">
          Ordinary line art (JPEG, PNG, WebP, or HEIC) uploaded under Artwork. Children color it with the brush; it has no parts, so it can&apos;t be tap-filled and
          &quot;stay inside the lines&quot; isn&apos;t available. Its recorded source is kept as the picture&apos;s attribution.
        </p>
        {art.length ? (
          <div role="radiogroup" aria-label="Line art" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {art.map((a) => (
              <label key={a.id} className={cn("flex cursor-pointer flex-col gap-2 rounded-tile border p-2 text-meta", pick === a.id ? "border-primary bg-primary-soft" : "border-border")}>
                {a.url ? <img src={a.url} alt="" className="aspect-[5/4] w-full rounded-control bg-white object-contain" /> : null}
                <span className="flex items-center gap-2">
                  <input type="radio" name="asset" value={a.id} checked={pick === a.id} onChange={() => setPick(a.id)} className="size-5 shrink-0" />
                  <span className="line-clamp-2">{a.alt || "No description yet"}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-meta">Upload the line art under Artwork first.</p>
        )}
        <TextAreaField id={`${fid}-fstory`} label="Short story summary" name="story" rows={4} maxLength={1500} defaultValue={current?.story ?? ""} hint="Shown with the picture as its text alternative." />
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="freehand_ok" required className="mt-1 size-5 shrink-0" />
          <span>I understand this picture is freehand-only: children can&apos;t tap to fill it.</span>
        </label>
        <SubmitButton variant="secondary" size="sm" pendingText="Saving…" disabled={!art.length}>
          Use as a freehand-only picture
        </SubmitButton>
      </form>
    </div>
  );
}

/** On the activity list: add the demonstration pictures as unpublished drafts. */
export function DemoDraftsButton() {
  const [state, run] = useActionState(createDemoDraftsAction, initialFormState);
  return (
    <form action={run} className="space-y-3">
      <FormMessage state={state} />
      <p className="text-meta text-text-secondary">
        Three original demonstration coloring pictures (Noah&apos;s rainbow, a shepherd and his sheep, five loaves and two fish), added as unpublished drafts to review.
      </p>
      <SubmitButton variant="secondary" size="sm" pendingText="Adding…">
        Add demonstration coloring drafts
      </SubmitButton>
    </form>
  );
}
