"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useId, useMemo, useState } from "react";
import type { ImageChoice } from "@/app/admin/media/picker-actions";
import { MarkdownBody } from "@/components/announcements/markdown-body";
import { CoverImageField } from "@/components/media/cover-image-field";
import { VideoPickerField, type PickedVideo } from "@/components/media/video-picker-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { KIND_LABEL } from "@/lib/media/format";
import type { Attachment, ItemAdmin, ItemKind } from "@/lib/media/types";
import { saveContentAction } from "./actions";
import type { AssetChoice, EditorData } from "./editor-data";

type DocAttachment = { asset_id: string; role: "handout" | "slides" | "resource"; label: string; members_only: boolean };

const PUBLIC_KINDS: ItemKind[] = ["devotional", "lesson", "episode"];
const PEOPLE_LABEL: Partial<Record<ItemKind, [string, string]>> = {
  devotional: ["Author", "Written by (names, separated by commas)"],
  lesson: ["Speaker", "Who taught it (names, separated by commas)"],
  episode: ["Hosts", "Hosts and guests (names, separated by commas)"],
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-card border border-border bg-surface p-5 sm:p-6">
      <legend className="float-left mb-1 w-full text-lg font-semibold">{title}</legend>
      {description ? <p className="clear-both -mt-1 text-meta text-text-secondary">{description}</p> : null}
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}

/** Saved video attachments as picker entries (order kept). */
const pickedFrom = (att: Attachment[]): PickedVideo[] =>
  att
    .filter((a) => a.role === "video" && (a.kind === "video" || a.kind === "external_video"))
    .map((a) => ({
      asset_id: a.asset_id,
      kind: a.kind === "external_video" ? "external_video" : "video",
      title: a.title,
      provider: a.provider,
      provider_ref: a.provider_ref,
      provider_hash: a.provider_hash,
      duration_seconds: a.duration_seconds,
      width: a.width,
      height: a.height,
      has_thumb: a.has_thumb ?? (a.kind === "external_video" && a.provider === "youtube"),
      unavailable: a.unavailable ?? false,
      attribution: a.attribution,
      captions: a.captions,
      public_ok: a.public_ok,
      provider_status: null,
      caption: a.caption ?? "",
      members_only: a.members_only,
    }));

const assetLabel = (a: AssetChoice) => `${a.title}${a.kind === "external_video" ? (a.provider === "vimeo" ? " (Vimeo)" : " (YouTube)") : ""}`;

export function ContentForm({
  kind,
  item,
  data,
  timeZoneLabel,
  defaultDate,
}: {
  kind: ItemKind;
  item: ItemAdmin | null;
  data: EditorData;
  timeZoneLabel: string;
  /** Pre-filled date for new content (from the devotional calendar). */
  defaultDate?: string;
}) {
  const [state, action] = useActionState(saveContentAction, initialFormState);
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  const canPublish = data.options.can_publish;
  const [clientKey] = useState(() => crypto.randomUUID());
  const tabs = useId();
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [body, setBody] = useState(v?.body ?? item?.body ?? "");
  const [audience, setAudience] = useState<string>(v?.audience ?? item?.audience ?? "members");
  const att = item?.attachments ?? [];
  const [audio, setAudio] = useState(att.find((a) => a.role === "audio")?.asset_id ?? "");
  const [audioMembersOnly, setAudioMembersOnly] = useState(att.find((a) => a.role === "audio")?.members_only ?? false);
  const [videos, setVideos] = useState<PickedVideo[]>(() => pickedFrom(att));
  const [docs, setDocs] = useState<DocAttachment[]>(
    att.filter((a) => a.role !== "audio" && a.role !== "video").map((a) => ({ asset_id: a.asset_id, role: a.role as DocAttachment["role"], label: a.label, members_only: a.members_only })),
  );
  const [links, setLinks] = useState<string[]>(item?.links.map((l) => l.id) ?? []);
  const [linkPick, setLinkPick] = useState("");
  const [cover, setCover] = useState<ImageChoice | null>(null);

  const attachments = useMemo(
    () =>
      JSON.stringify([
        ...(audio && kind !== "video" ? [{ asset_id: audio, role: "audio", members_only: audioMembersOnly }] : []),
        // Order here is the order members see; the caption is stored as the attachment's label.
        ...videos.map((v) => ({ asset_id: v.asset_id, role: "video", label: v.caption.trim(), members_only: v.kind === "video" && v.members_only })),
        ...(kind !== "video" ? docs.filter((d) => d.asset_id) : []),
      ]),
    [audio, audioMembersOnly, videos, docs, kind],
  );
  const allAssets = [...data.assets.audio, ...data.assets.video, ...data.assets.document];
  const externalChosen = videos.some((v) => v.kind === "external_video");
  const notPublicOk: Array<{ title: string }> =
    audience === "public"
      ? [
          ...[audio, ...docs.map((d) => d.asset_id)].map((id) => allAssets.find((a) => a.id === id)).filter((a) => a && !a.public_ok && a.kind !== "external_video").map((a) => a!),
          ...videos.filter((v) => v.kind === "video" && !v.public_ok),
          ...(cover && !cover.public_ok ? [{ title: `${cover.title} (cover image)` }] : []),
        ]
      : [];
  const peopleLabel = PEOPLE_LABEL[kind];
  const people = item?.people ?? [];
  const live = item && item.status !== "draft";
  const readOnly = !!live && !canPublish;

  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage state={state} />
      {readOnly ? (
        <Alert tone="warning" title="This content is scheduled, published, or archived.">
          Only a content publisher can change it. You can still preview it.
        </Alert>
      ) : null}
      {item ? <input type="hidden" name="id" value={item.id} /> : <input type="hidden" name="client_key" value={clientKey} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="attachments" value={attachments} />
      <input type="hidden" name="links" value={JSON.stringify(links)} />

      <fieldset disabled={readOnly} className="space-y-6">
        <Section title={KIND_LABEL[kind]}>
          <TextField label="Title" name="title" required maxLength={200} defaultValue={v?.title ?? item?.title ?? ""} error={fe.title} />
          {kind === "devotional" ? (
            <TextField
              label="Devotional date"
              name="devotional_on"
              type="date"
              required
              defaultValue={v?.devotional_on ?? item?.devotional_on ?? defaultDate ?? ""}
              hint={`The day it is “today's devotional” (${timeZoneLabel}).`}
              error={fe.devotional_on}
            />
          ) : null}
          {kind === "lesson" ? (
            <TextField label="Sunday delivered" name="delivered_on" type="date" required defaultValue={v?.delivered_on ?? item?.delivered_on ?? defaultDate ?? ""} error={fe.delivered_on} />
          ) : null}
          {kind === "episode" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Church podcast show" name="show_id" required defaultValue={v?.show_id ?? item?.show_id ?? ""} error={fe.show_id} className="sm:col-span-3">
                <option value="">Choose a show…</option>
                {data.options.shows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.status !== "published" ? " (not published yet)" : ""}
                  </option>
                ))}
              </SelectField>
              <TextField label="Episode number" name="episode_number" inputMode="numeric" optional defaultValue={v?.episode_number ?? item?.episode_number ?? ""} error={fe.episode_number} />
              <TextField label="Season" name="season_number" inputMode="numeric" optional defaultValue={v?.season_number ?? item?.season_number ?? ""} error={fe.season_number} />
            </div>
          ) : null}
          {kind === "episode" && !data.options.shows.length ? (
            <Alert tone="info" title="Create a church podcast show first.">
              A podcast manager can add one at <Link href="/admin/podcasts" className="font-semibold underline">Podcasts</Link>.
            </Alert>
          ) : null}
          {kind === "book" ? (
            <>
              <TextField label="Book author" name="book_author" maxLength={160} defaultValue={v?.book_author ?? item?.book_author ?? ""} optional />
              <TextField
                label="Audible link"
                name="audible_url"
                type="url"
                inputMode="url"
                defaultValue={v?.audible_url ?? item?.audible_url ?? ""}
                optional
                error={fe.audible_url}
                hint="Members open it in Audible with their own account. The church's purchase doesn't give members access, and nothing syncs back to this app."
              />
            </>
          ) : null}
          {kind === "assignment" ? (
            <>
              <SelectField label="Book" name="book_id" required defaultValue={v?.book_id ?? item?.book_id ?? ""} error={fe.book_id}>
                <option value="">Choose a book…</option>
                {data.options.books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                    {b.state !== "live" ? ` (${b.state})` : ""}
                  </option>
                ))}
              </SelectField>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Starts" name="starts_on" type="date" required defaultValue={v?.starts_on ?? item?.starts_on ?? defaultDate ?? ""} error={fe.starts_on} />
                <TextField label="Ends" name="ends_on" type="date" optional defaultValue={v?.ends_on ?? item?.ends_on ?? ""} error={fe.ends_on} />
              </div>
              <TextField
                label="What to read"
                name="instructions"
                maxLength={1000}
                defaultValue={v?.instructions ?? item?.instructions ?? ""}
                hint="For example: Chapters 3–4 (pages 41–88)."
                optional
              />
            </>
          ) : null}
          {kind === "playlist" ? (
            <TextField
              label="Spotify playlist link"
              name="spotify_url"
              type="url"
              inputMode="url"
              required
              defaultValue={v?.spotify_url ?? (item?.spotify_id ? `https://open.spotify.com/playlist/${item.spotify_id}` : "")}
              error={fe.spotify_url}
              hint="From Spotify: Share → Copy link to playlist. Who can find or play the playlist itself is set in Spotify, not here."
            />
          ) : null}
          <TextAreaField label="Summary" name="summary" rows={2} maxLength={600} defaultValue={v?.summary ?? item?.summary ?? ""} optional hint={kind === "video" ? "A short description shown on the video's card and in search." : "One or two sentences for cards and search."} error={fe.summary} />
        </Section>

        <Section
          title={kind === "devotional" ? "Devotional" : kind === "lesson" ? "Written summary" : kind === "book" || kind === "playlist" || kind === "video" ? "Description" : kind === "assignment" ? "Details" : "Episode notes"}
          description="Formatting: **bold**, *italic*, ## heading, - list, [link text](https://…). HTML isn't allowed."
        >
          <div role="tablist" aria-label="Text" className="flex w-fit rounded-control border border-border-strong p-0.5">
            {(["write", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`${tabs}-${t}`}
                aria-selected={tab === t}
                aria-controls={`${tabs}-${t}-panel`}
                onClick={() => setTab(t)}
                className={cn("min-h-10 rounded-[0.5rem] px-4 font-semibold", tab === t ? "bg-text text-background" : "hover:bg-surface-muted")}
              >
                {t === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </div>
          <div id={`${tabs}-write-panel`} role="tabpanel" aria-labelledby={`${tabs}-write`} hidden={tab !== "write"}>
            <TextAreaField label={<span className="sr-only">Text</span>} name="body" rows={14} value={body} onChange={(e) => setBody(e.target.value)} error={fe.body} />
          </div>
          <div id={`${tabs}-preview-panel`} role="tabpanel" aria-labelledby={`${tabs}-preview`} hidden={tab !== "preview"} tabIndex={0} className="rounded-control border border-border bg-background p-4">
            {body.trim() ? <MarkdownBody source={body} /> : <p className="text-text-secondary">Nothing written yet.</p>}
          </div>
          {kind === "lesson" ? (
            <TextAreaField
              label="Notes shown to members"
              name="notes"
              rows={8}
              defaultValue={v?.notes ?? item?.notes ?? ""}
              optional
              hint="Outline or study notes (same formatting). Members and, for a public lesson, visitors see these on the lesson page. For notes only teachers see, use the lesson builder's teacher notes."
              error={fe.notes}
            />
          ) : null}
          {kind !== "playlist" && kind !== "book" && kind !== "video" ? (
            <TextAreaField
              label={kind === "devotional" ? "Reflection questions" : "Discussion questions"}
              name="questions"
              rows={4}
              defaultValue={v?.questions ?? item?.questions.join("\n") ?? ""}
              optional
              hint="One per line."
              error={fe.questions}
            />
          ) : null}
        </Section>

        {kind !== "playlist" ? (
          <Section
            title={kind === "video" ? "The video" : "Videos"}
            description={
              kind === "video"
                ? "Choose one library video or paste a link. The same video can also be shown on lessons, devotionals, and reading without copying it."
                : "Shown in the page itself, in this order, each with a Play button. Videos are shared from the media library, never copied."
            }
          >
            <VideoPickerField value={videos} onChange={setVideos} max={kind === "video" ? 1 : 10} canAddLinks={data.options.can_manage_media && !readOnly} audience={audience} />
            {externalChosen && audience !== "public" ? (
              <Alert tone="warning" title="YouTube and Vimeo videos keep their own privacy.">
                Limiting this page to members or a group doesn&apos;t make the video private. An unlisted YouTube video can be watched by anyone who has its
                link; only the provider&apos;s own privacy settings control that.
              </Alert>
            ) : null}
          </Section>
        ) : null}

        {kind !== "playlist" && kind !== "video" ? (
          <Section title="Audio and files" description="Choose ready files from the media library. Files are shared, never copied, so one recording can serve a lesson and a podcast episode.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <SelectField label="Audio" name="_audio" value={audio} onChange={(e) => setAudio(e.target.value)} optional>
                  <option value="">None</option>
                  {data.assets.audio.map((a) => (
                    <option key={a.id} value={a.id}>
                      {assetLabel(a)}
                    </option>
                  ))}
                </SelectField>
                {audio ? <CheckboxField name="_audio_mo" label="Members only (even when this is public)" checked={audioMembersOnly} onChange={(e) => setAudioMembersOnly(e.target.checked)} /> : null}
              </div>
            </div>
            <div className="space-y-2">
              <p className="font-semibold">Handouts, slides, and resources</p>
              {docs.map((d, i) => (
                <div key={i} className="grid gap-2 rounded-tile border border-border p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-end">
                  <SelectField label="File" name={`_doc_${i}`} value={d.asset_id} onChange={(e) => setDocs((ds) => ds.map((x, j) => (j === i ? { ...x, asset_id: e.target.value } : x)))}>
                    <option value="">Choose…</option>
                    {[...data.assets.document, ...(kind === "assignment" || kind === "book" ? data.assets.audio : [])].map((a) => (
                      <option key={a.id} value={a.id}>
                        {assetLabel(a)}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label="As" name={`_role_${i}`} value={d.role} onChange={(e) => setDocs((ds) => ds.map((x, j) => (j === i ? { ...x, role: e.target.value as DocAttachment["role"] } : x)))}>
                    <option value="handout">Handout</option>
                    <option value="slides">Slides</option>
                    <option value="resource">Resource</option>
                  </SelectField>
                  <TextField label="Label" name={`_label_${i}`} value={d.label} onChange={(e) => setDocs((ds) => ds.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} optional />
                  <Button variant="ghost" size="sm" onClick={() => setDocs((ds) => ds.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" aria-hidden="true" />}>
                    Remove
                  </Button>
                  <CheckboxField
                    className="sm:col-span-4"
                    name={`_mo_${i}`}
                    label="Members only (even when this is public)"
                    checked={d.members_only}
                    onChange={(e) => setDocs((ds) => ds.map((x, j) => (j === i ? { ...x, members_only: e.target.checked } : x)))}
                  />
                </div>
              ))}
              <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setDocs((ds) => [...ds, { asset_id: "", role: "handout", label: "", members_only: false }])}>
                Add a file
              </Button>
            </div>
            {data.options.can_manage_media ? (
              <p className="text-meta text-text-secondary">
                Need a new file?{" "}
                <Link href="/admin/media" target="_blank" className="font-semibold text-primary underline">
                  Upload it to the media library
                </Link>{" "}
                (opens a new tab), then reload this page.
              </p>
            ) : null}
          </Section>
        ) : null}

        <Section title="Cover image" description="Upload a new image or choose one from the media library. The cover changes when you save.">
          {/* Keeps its own state across a failed save; starts over from the saved cover after a successful one. */}
          <CoverImageField
            key={item?.updated_at ?? "new"}
            name="cover_asset_id"
            defaultAssetId={item?.cover_asset_id}
            altName="cover_alt"
            defaultAlt={item?.cover_alt ?? ""}
            canUpload={data.options.can_manage_media && !readOnly}
            maxUploadMb={data.imageMaxMb}
            saveLabel={item ? "Save changes" : "Save draft"}
            onChange={setCover}
          />
        </Section>

        <Section title="Organize" description="Helps members find it in the archive and search.">
          {peopleLabel ? (
            <TextField
              label={peopleLabel[1]}
              name="people"
              defaultValue={v?.people ?? people.filter((p) => p.role !== "contributor").map((p) => p.name).join(", ")}
              optional
            />
          ) : null}
          {peopleLabel ? (
            <TextField label="Contributors" name="contributors" defaultValue={v?.contributors ?? people.filter((p) => p.role === "contributor").map((p) => p.name).join(", ")} optional />
          ) : null}
          {kind === "lesson" || kind === "devotional" || kind === "episode" ? (
            <SelectField label="Series" name="series_id" defaultValue={v?.series_id ?? item?.series_id ?? ""} optional>
              <option value="">None</option>
              {data.taxonomy.series
                .filter((s) => !s.archived && (s.scope === "any" || s.scope === kind))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
            </SelectField>
          ) : null}
          <TextField
            label="Topics"
            name="topics"
            defaultValue={v?.topics ?? item?.topics.map((t) => t.name).join(", ") ?? ""}
            optional
            hint="Separated by commas. New topics are created as you save."
          />
          <TextField label="Tags" name="tags" defaultValue={v?.tags ?? item?.tags.join(", ") ?? ""} optional hint="Separated by commas." />
          {kind !== "playlist" ? (
            <TextAreaField
              label="Scripture references"
              name="scripture"
              rows={3}
              defaultValue={v?.scripture ?? item?.scripture_refs.join("\n") ?? ""}
              optional
              hint="One per line, for example “John 3:16–18”. Only the reference is stored; no Bible text is added."
              error={fe.scripture}
            />
          ) : null}
          <div className="space-y-2">
            <p className="font-semibold">Related content</p>
            {links.length ? (
              <ul className="space-y-1">
                {links.map((id) => {
                  const it = data.items.find((x) => x.id === id) ?? item?.links.find((x) => x.id === id);
                  return (
                    <li key={id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {it ? `${it.title} (${KIND_LABEL[it.kind]})` : "Content"}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => setLinks((ls) => ls.filter((x) => x !== id))}>
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <SelectField label="Add related content" name="_link" value={linkPick} onChange={(e) => setLinkPick(e.target.value)} className="min-w-64 flex-1" optional>
                <option value="">Choose…</option>
                {data.items
                  .filter((x) => x.id !== item?.id && !links.includes(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title} ({KIND_LABEL[x.kind]})
                    </option>
                  ))}
              </SelectField>
              <Button
                variant="secondary"
                size="sm"
                disabled={!linkPick}
                onClick={() => {
                  setLinks((ls) => [...ls, linkPick].slice(0, 20));
                  setLinkPick("");
                }}
              >
                Add
              </Button>
            </div>
            <p className="text-meta text-text-secondary">Members only see related items they can open.</p>
          </div>
        </Section>

        <Section title="Who can see it">
          <div role="radiogroup" aria-label="Audience" className="space-y-2">
            {(
              [
                ["members", "Approved members", "Signed-in, approved adult members (the default)."],
                ["group", "One group", "Only current members of the group you choose."],
                ...(PUBLIC_KINDS.includes(kind) ? [["public", "Public", "Anyone, including people who aren't signed in."] as const] : []),
              ] as Array<readonly [string, string, string]>
            ).map(([value, label, hint]) => (
              <label key={value} className={cn("flex items-start gap-3 rounded-tile border px-3 py-2.5", audience === value ? "border-primary bg-primary-soft" : "border-border")}>
                <input
                  type="radio"
                  name="audience"
                  value={value}
                  checked={audience === value}
                  onChange={() => setAudience(value)}
                  disabled={value === "public" && !canPublish && item?.audience !== "public"}
                  className="mt-1 size-5 accent-primary"
                />
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-meta text-text-secondary">
                    {hint}
                    {value === "public" && !canPublish ? " Publishers choose this." : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {fe.audience ? <p className="text-meta text-danger">{fe.audience[0]}</p> : null}
          {audience === "group" ? (
            <SelectField label="Group" name="group_id" defaultValue={v?.group_id ?? item?.group_id ?? ""} error={fe.group_id}>
              <option value="">Choose a group…</option>
              {data.options.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {audience === "public" && item?.audience !== "public" ? (
            <CheckboxField name="confirm_public" label="I confirm this should be visible to anyone, including people who aren't signed in" />
          ) : null}
          {audience === "public" && notPublicOk.length ? (
            <Alert tone="info" title="Some files stay members-only.">
              {notPublicOk.map((a) => a.title).join(", ")} {notPublicOk.length === 1 ? "isn't" : "aren't"} approved for public use, so visitors won&apos;t get{" "}
              {notPublicOk.length === 1 ? "it" : "them"}. A media manager can approve files in the library.
            </Alert>
          ) : null}
          <SelectField
            label="Linked discussion"
            name="discussion_thread_id"
            defaultValue={v?.discussion_thread_id ?? item?.discussion_thread_id ?? ""}
            optional
            hint="A community discussion members can join. It can't reach more people than this content (a group's content needs that group's discussion)."
          >
            <option value="">None</option>
            {data.options.threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
                {t.group ? ` (${t.group})` : " (church-wide)"}
              </option>
            ))}
          </SelectField>
        </Section>

        <Section title="Options">
          {kind !== "book" ? (
            <CheckboxField
              name="notify"
              label="Notify members when it's published"
              hint="Sent once, at its publish time, to people who can see it and haven't turned these notices off. Email and lock-screen previews never include the title."
              defaultChecked={v ? v.notify === "on" : (item?.notify ?? false)}
            />
          ) : null}
          {canPublish ? (
            <CheckboxField name="featured" label="Feature it" hint="Shown first where featured content appears." defaultChecked={v ? v.featured === "on" : (item?.featured ?? false)} />
          ) : null}
          {canPublish && kind === "book" ? (
            <CheckboxField name="book_current" label="This is the current church book" defaultChecked={v ? v.book_current === "on" : (item?.book_current ?? false)} />
          ) : null}
          <TextField label="Attribution" name="attribution" maxLength={300} defaultValue={v?.attribution ?? item?.attribution ?? ""} optional hint="Shown to members, for example for licensed material." />
          <TextField label="Display order" name="sort_order" type="number" inputMode="numeric" min={0} max={100000} defaultValue={v?.sort_order ?? String(item?.sort_order ?? 100)} hint="Lower numbers appear first among items on the same date." />
        </Section>
      </fieldset>

      {!readOnly ? (
        <div className="sticky bottom-[calc(var(--dock-clearance)-5rem)] z-10 flex flex-wrap gap-2 rounded-card border border-border bg-surface p-3 shadow-(--elev-lift) lg:bottom-4">
          <SubmitButton pendingText="Saving…">{item ? "Save changes" : "Save draft"}</SubmitButton>
          <p className="self-center text-meta text-text-secondary">{item && item.status !== "draft" ? "Changes apply immediately to published content." : "Saving never publishes."}</p>
        </div>
      ) : null}
    </form>
  );
}
