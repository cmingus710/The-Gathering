"use client";

/* eslint-disable @next/next/no-img-element -- object-URL and signed-URL previews */
import { Bold, Heading2, Italic, Link2, List, ListOrdered } from "lucide-react";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "@/components/announcements/markdown-body";
import { AnnouncementStatusBadge, PinnedBadge, VisibilityBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import type { EffectiveStatus } from "@/lib/announcements/status";
import { initialFormState } from "@/lib/forms";
import { saveAnnouncementAction } from "./actions";

export type AnnouncementFormValues = {
  id?: string;
  title: string;
  body: string;
  visibility: "public" | "members";
  pinned: boolean;
  publishAt: string;
  expiresAt: string;
  imageAlt: string;
  imageUrl: string | null;
  effective: EffectiveStatus;
};

type Tool = { label: string; icon: React.ReactNode; apply: (selected: string) => { text: string; cursorOffset?: number } };

const TOOLS: Tool[] = [
  { label: "Bold", icon: <Bold className="size-4" aria-hidden="true" />, apply: (s) => ({ text: `**${s || "bold text"}**` }) },
  { label: "Italic", icon: <Italic className="size-4" aria-hidden="true" />, apply: (s) => ({ text: `*${s || "italic text"}*` }) },
  { label: "Heading", icon: <Heading2 className="size-4" aria-hidden="true" />, apply: (s) => ({ text: `\n## ${s || "Heading"}\n` }) },
  {
    label: "Bulleted list",
    icon: <List className="size-4" aria-hidden="true" />,
    apply: (s) => ({ text: `\n${(s || "List item").split("\n").map((l) => `- ${l}`).join("\n")}\n` }),
  },
  {
    label: "Numbered list",
    icon: <ListOrdered className="size-4" aria-hidden="true" />,
    apply: (s) => ({ text: `\n${(s || "List item").split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n")}\n` }),
  },
  { label: "Link", icon: <Link2 className="size-4" aria-hidden="true" />, apply: (s) => ({ text: `[${s || "link text"}](https://)` }) },
];

export function AnnouncementForm({ initial, timeZoneLabel }: { initial: AnnouncementFormValues; timeZoneLabel: string }) {
  const [state, action] = useActionState(saveAnnouncementAction, initialFormState);
  const v = state.values;
  const [title, setTitle] = useState(v?.title ?? initial.title);
  const [body, setBody] = useState(v?.body ?? initial.body);
  const [visibility, setVisibility] = useState<"public" | "members">((v?.visibility as "public" | "members") ?? initial.visibility);
  const [pinned, setPinned] = useState(v ? v.pinned === "on" : initial.pinned);
  const [imageAlt, setImageAlt] = useState(v?.imageAlt ?? initial.imageAlt);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const tabsId = useId();
  const fe = state.fieldErrors ?? {};

  useEffect(() => () => (filePreview ? URL.revokeObjectURL(filePreview) : undefined), [filePreview]);

  const imageUrl = filePreview ?? (removeImage ? null : initial.imageUrl);
  const isLiveOrScheduled = initial.effective === "live" || initial.effective === "scheduled" || initial.effective === "expired";
  const preview = useMemo(() => ({ title, body }), [title, body]);

  function applyTool(tool: Tool) {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const { text } = tool.apply(body.slice(start, end));
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }

  return (
    <form action={action} noValidate className="space-y-6" encType="multipart/form-data">
      <FormMessage state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="space-y-6 rounded-card bg-surface p-5 sm:p-6">
        <TextField label="Title" name="title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} error={fe.title} />

        <div className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <span id={`${tabsId}-label`} className="font-semibold">
              Message
            </span>
            <div role="tablist" aria-labelledby={`${tabsId}-label`} className="flex rounded-control border border-border-strong p-0.5">
              {(["write", "preview"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`${tabsId}-${t}-tab`}
                  aria-selected={tab === t}
                  aria-controls={`${tabsId}-${t}-panel`}
                  onClick={() => setTab(t)}
                  className={cn(
                    "min-h-10 rounded-[0.5rem] px-4 font-semibold",
                    tab === t ? "bg-text text-background" : "text-text hover:bg-surface-muted",
                  )}
                >
                  {t === "write" ? "Write" : "Preview"}
                </button>
              ))}
            </div>
          </div>

          <div id={`${tabsId}-write-panel`} role="tabpanel" aria-labelledby={`${tabsId}-write-tab`} hidden={tab !== "write"}>
            <div role="toolbar" aria-label="Formatting" aria-controls="field-body" className="mb-2 flex flex-wrap gap-1">
              {TOOLS.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  onClick={() => applyTool(tool)}
                  className="flex size-11 items-center justify-center rounded-control border border-border-strong bg-surface hover:bg-primary-soft"
                >
                  {tool.icon}
                  <span className="sr-only">{tool.label}</span>
                </button>
              ))}
            </div>
            <TextAreaField
              label={<span className="sr-only">Message text</span>}
              name="body"
              rows={12}
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              hint="Formatting: **bold**, *italic*, ## heading, - list, [link text](https://…). HTML isn't allowed."
              error={fe.body}
            />
          </div>
          <div id={`${tabsId}-preview-panel`} role="tabpanel" aria-labelledby={`${tabsId}-preview-tab`} hidden={tab !== "preview"} tabIndex={0}>
            <div className="rounded-control border border-border bg-background p-4 sm:p-6">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-secondary">Preview as members will see it</p>
              <article className="overflow-hidden rounded-card bg-surface">
                {imageUrl ? <img src={imageUrl} alt={imageAlt} className="aspect-[16/9] w-full object-cover" /> : null}
                <div className="p-5">
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pinned ? <PinnedBadge /> : null}
                    <VisibilityBadge visibility={visibility} />
                  </div>
                  <h2 className="text-2xl font-bold">{preview.title || "Untitled announcement"}</h2>
                  {preview.body.trim() ? (
                    <MarkdownBody source={preview.body} className="mt-3" />
                  ) : (
                    <p className="mt-3 text-text-secondary">Nothing written yet.</p>
                  )}
                </div>
              </article>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <fieldset className="space-y-4 rounded-card bg-surface p-5 sm:p-6">
          <legend className="float-left mb-2 w-full text-xl font-bold">Image</legend>
          <div className="clear-both space-y-4">
            {imageUrl ? <img src={imageUrl} alt="" className="aspect-[16/9] w-full rounded-control bg-surface-muted object-cover" /> : null}
            <div className="space-y-1.5">
              <label htmlFor="field-image" className="block font-semibold">
                {initial.imageUrl ? "Replace image" : "Add an image"} <span className="font-normal text-text-secondary">(optional)</span>
              </label>
              <p id="field-image-hint" className="text-[0.95rem] text-text-secondary">PNG, JPEG, or WebP, up to 4 MB. Wide images work best.</p>
              <input
                id="field-image"
                name="image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-describedby={`field-image-hint${fe.image ? " field-image-error" : ""}`}
                aria-invalid={fe.image ? true : undefined}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFilePreview(f ? URL.createObjectURL(f) : null);
                  if (f) setRemoveImage(false);
                }}
                className="block w-full text-[0.95rem] file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-control file:border file:border-border-strong file:bg-surface file:px-4 file:font-semibold hover:file:bg-primary-soft"
              />
              {fe.image ? (
                <p id="field-image-error" className="font-medium text-danger">
                  <span className="sr-only">Error: </span>
                  {fe.image[0]}
                </p>
              ) : null}
            </div>
            {initial.imageUrl && !filePreview ? (
              <CheckboxField label="Remove the current image" name="removeImage" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} />
            ) : null}
            {imageUrl ? (
              <TextField
                label="Image description"
                name="imageAlt"
                hint="Describe the image for people who can't see it."
                value={imageAlt}
                onChange={(e) => setImageAlt(e.target.value)}
                error={fe.imageAlt}
              />
            ) : (
              <input type="hidden" name="imageAlt" value="" />
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-card bg-surface p-5 sm:p-6">
          <legend className="float-left mb-2 w-full text-xl font-bold">Audience and timing</legend>
          <div className="clear-both space-y-5">
            <fieldset>
              <legend className="mb-2 font-semibold">Who can see it</legend>
              <div className="space-y-2">
                {(
                  [
                    ["members", "Approved members only", "Visible after signing in."],
                    ["public", "Everyone", "Also shown on the public welcome page."],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className="flex cursor-pointer items-start gap-3 rounded-control border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                    <input
                      type="radio"
                      name="visibility"
                      value={value}
                      checked={visibility === value}
                      onChange={() => setVisibility(value)}
                      className="mt-1 size-5 accent-primary"
                    />
                    <span>
                      <span className="block font-semibold">{label}</span>
                      <span className="block text-[0.95rem] text-text-secondary">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {fe.visibility ? <p className="mt-1 font-medium text-danger">{fe.visibility[0]}</p> : null}
            </fieldset>
            <CheckboxField label="Pin to the top" name="pinned" checked={pinned} onChange={(e) => setPinned(e.target.checked)} hint="Pinned announcements appear first." />
            <TextField
              label="Publish at"
              name="publishAt"
              type="datetime-local"
              optional
              defaultValue={v?.publishAt ?? initial.publishAt}
              hint={`${timeZoneLabel}. Needed to schedule; “Publish now” uses the current time.`}
              error={fe.publishAt}
            />
            <TextField
              label="Expires at"
              name="expiresAt"
              type="datetime-local"
              optional
              defaultValue={v?.expiresAt ?? initial.expiresAt}
              hint={`${timeZoneLabel}. The announcement disappears automatically at this time.`}
              error={fe.expiresAt}
            />
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 rounded-card bg-surface p-4">
        <span className="mr-auto flex items-center gap-2 text-text-secondary">
          Current state: <AnnouncementStatusBadge status={initial.effective} />
        </span>
        {isLiveOrScheduled ? (
          <SubmitButton name="intent" value="update" pendingText="Saving…">
            Save changes
          </SubmitButton>
        ) : (
          <>
            <SubmitButton name="intent" value="save_draft" variant="secondary" pendingText="Saving…">
              Save draft
            </SubmitButton>
            <SubmitButton name="intent" value="schedule" variant="secondary" pendingText="Scheduling…">
              Schedule
            </SubmitButton>
            <SubmitButton name="intent" value="publish_now" pendingText="Publishing…">
              Publish now
            </SubmitButton>
          </>
        )}
      </div>
    </form>
  );
}
