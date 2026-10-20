"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/components/ui/cn";
import { initialFormState } from "@/lib/forms";
import { saveShowAction } from "./actions";

export type ShowFormValues = {
  id?: string;
  kind: "church" | "external";
  title: string;
  description: string;
  author: string | null;
  artwork_asset_id: string | null;
  website_url: string | null;
  feed_url: string | null;
  provider_url: string | null;
  allow_stream: boolean;
  audience: "public" | "members" | "group";
  group_id: string | null;
  featured: boolean;
  sort_order: number;
  public_feed: boolean;
  feed_language: string;
  feed_category: string;
  feed_explicit: boolean;
  feed_owner_email: string | null;
};

export function ShowForm({
  show,
  groups,
  images,
  feedUrl,
}: {
  show: ShowFormValues;
  groups: Array<{ id: string; name: string }>;
  images: Array<{ id: string; title: string; public_ok: boolean }>;
  feedUrl: string;
}) {
  const [state, action] = useActionState(saveShowAction, initialFormState);
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  const [audience, setAudience] = useState(v?.audience ?? show.audience);
  const [publicFeed, setPublicFeed] = useState(v ? v.public_feed === "on" : show.public_feed);
  const external = show.kind === "external";
  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage state={state} />
      {show.id ? <input type="hidden" name="id" value={show.id} /> : null}
      <input type="hidden" name="kind" value={show.kind} />
      <div className="space-y-4 rounded-card border border-border bg-surface p-5 sm:p-6">
        <TextField label="Title" name="title" required maxLength={160} defaultValue={v?.title ?? show.title} error={fe.title} />
        <TextAreaField label="Description" name="description" rows={4} maxLength={4000} defaultValue={v?.description ?? show.description} optional />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={external ? "Publisher" : "Author or host"} name="author" maxLength={160} defaultValue={v?.author ?? show.author ?? ""} optional />
          <TextField label="Website" name="website_url" type="url" defaultValue={v?.website_url ?? show.website_url ?? ""} optional error={fe.website_url} />
        </div>
        {!external ? (
          <SelectField label="Artwork" name="artwork_asset_id" defaultValue={v?.artwork_asset_id ?? show.artwork_asset_id ?? ""} optional hint="Square, at least 1400 × 1400 pixels for podcast apps.">
            <option value="">None</option>
            {images.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
                {i.public_ok ? "" : " (not approved for public use)"}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>

      {external ? (
        <div className="space-y-4 rounded-card border border-border bg-surface p-5 sm:p-6">
          <TextField
            label="Public RSS feed"
            name="feed_url"
            type="url"
            inputMode="url"
            defaultValue={v?.feed_url ?? show.feed_url ?? ""}
            optional
            error={fe.feed_url}
            hint="The show's public podcast feed address (from its website or hosting service). Episodes are imported from it and refreshed on a schedule. A Spotify or Apple Podcasts page is not a feed."
          />
          <TextField
            label="Spotify or Apple Podcasts link"
            name="provider_url"
            type="url"
            inputMode="url"
            defaultValue={v?.provider_url ?? show.provider_url ?? ""}
            optional
            error={fe.provider_url}
            hint="Used for the official embedded player and an “Open in …” link."
          />
          <CheckboxField
            name="allow_stream"
            label="The publisher allows playing its feed audio in other apps"
            hint="Turn on only if the publisher's terms allow it (most public podcast feeds do). Members then play episodes in the app's player straight from the publisher; nothing is downloaded or copied."
            defaultChecked={v ? v.allow_stream === "on" : show.allow_stream}
          />
        </div>
      ) : null}

      <div className="space-y-4 rounded-card border border-border bg-surface p-5 sm:p-6">
        <p className="font-semibold">Who can see it in the app</p>
        <div role="radiogroup" aria-label="Audience" className="space-y-2">
          {(
            [
              ["members", "Approved members"],
              ["group", "One group"],
              ["public", "Public"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={cn("flex items-center gap-3 rounded-tile border px-3 py-2.5", audience === value ? "border-primary bg-primary-soft" : "border-border")}>
              <input type="radio" name="audience" value={value} checked={audience === value} onChange={() => setAudience(value)} className="size-5 accent-primary" />
              {label}
            </label>
          ))}
        </div>
        {audience === "group" ? (
          <SelectField label="Group" name="group_id" defaultValue={v?.group_id ?? show.group_id ?? ""} error={fe.group_id}>
            <option value="">Choose a group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        {audience === "public" && show.audience !== "public" ? (
          <CheckboxField name="confirm_public" label="I confirm this show should be listed for anyone, including people who aren't signed in" />
        ) : null}
        {external && audience !== "public" ? (
          <Alert tone="info" title="This only limits the app's page.">
            The show&apos;s own feed and its Spotify or Apple page stay public on the internet; restricting it here doesn&apos;t make them private.
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <CheckboxField name="featured" label="Featured" hint="Shown first, and on the home page." defaultChecked={v ? v.featured === "on" : show.featured} />
          <TextField label="Display order" name="sort_order" type="number" min={0} max={100000} defaultValue={v?.sort_order ?? String(show.sort_order)} />
        </div>
      </div>

      {!external ? (
        <div className="space-y-4 rounded-card border border-border bg-surface p-5 sm:p-6">
          <CheckboxField
            name="public_feed"
            label="Publish a public podcast feed"
            hint="For Apple Podcasts, Spotify, and other apps. Only episodes that are public, published, and whose audio is approved for public use with confirmed rights are included; member and group episodes never are. The show must be public."
            checked={publicFeed}
            onChange={(e) => setPublicFeed(e.target.checked)}
          />
          {publicFeed ? (
            <>
              <p className="rounded-tile bg-surface-muted px-3 py-2 text-meta">
                Feed address: <span className="font-mono break-all">{feedUrl}</span>
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Language" name="feed_language" defaultValue={v?.feed_language ?? show.feed_language} error={fe.feed_language} />
                <TextField label="Category" name="feed_category" defaultValue={v?.feed_category ?? show.feed_category} hint="For example: Religion & Spirituality > Christianity" />
                <TextField label="Owner email (shown in the feed)" name="feed_owner_email" type="email" defaultValue={v?.feed_owner_email ?? show.feed_owner_email ?? ""} optional error={fe.feed_owner_email} />
                <CheckboxField name="feed_explicit" label="Explicit content" defaultChecked={v ? v.feed_explicit === "on" : show.feed_explicit} />
              </div>
              <p className="text-meta text-text-secondary">Once podcast apps copy an episode, turning the feed off or unpublishing doesn&apos;t remove it from their listeners.</p>
            </>
          ) : null}
        </div>
      ) : null}

      <SubmitButton pendingText="Saving…">{show.id ? "Save show" : external ? "Add show and import episodes" : "Create show"}</SubmitButton>
    </form>
  );
}
