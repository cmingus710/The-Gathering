"use client";

/* eslint-disable @next/next/no-img-element -- access-checked thumbnails from this app, never through the image optimizer */
import { ArrowDown, ArrowUp, Film, Link2, Plus, Search, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { addVideoLink, listLibraryVideos, type VideoChoice } from "@/app/admin/media/video-picker-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextField } from "@/components/ui/field";
import { formatDuration } from "@/lib/media/format";

/** One chosen video: the library asset plus its caption and members-only flag for this content. */
export type PickedVideo = VideoChoice & { caption: string; members_only: boolean };

const PROVIDER = { youtube: "YouTube", vimeo: "Vimeo" } as const;
const providerLabel = (v: VideoChoice) => (v.kind === "external_video" && v.provider ? PROVIDER[v.provider] : "Uploaded video");

function Thumb({ v }: { v: VideoChoice }) {
  const [ok, setOk] = useState(v.kind === "external_video" && v.has_thumb);
  return ok ? (
    <img src={`/api/media/${v.asset_id}/thumb`} alt="" loading="lazy" onError={() => setOk(false)} className="aspect-video w-28 shrink-0 rounded-tile bg-black object-cover" />
  ) : (
    <span className="flex aspect-video w-28 shrink-0 items-center justify-center rounded-tile bg-surface-muted" aria-hidden="true">
      <Film className="size-6 text-text-secondary" />
    </span>
  );
}

/**
 * Videos for a lesson, devotional, book, reading assignment, or standalone
 * video page, chosen inside the editor: pick ready videos from the media
 * library or paste a YouTube/Vimeo link (added to the library, or the
 * existing record reused, without leaving the page). Order and captions are
 * per content item. Nothing changes until the editor's form is saved, and
 * the rest of the form keeps what was typed.
 */
export function VideoPickerField({
  value,
  onChange,
  max = 10,
  canAddLinks,
  audience,
}: {
  value: PickedVideo[];
  onChange: (next: PickedVideo[]) => void;
  max?: number;
  /** Media managers may add new links (the same rule as the library). */
  canAddLinks: boolean;
  audience: string;
}) {
  const ids = useId();
  const [browsing, setBrowsing] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<VideoChoice[] | null>(null);
  const [more, setMore] = useState(false);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const full = value.length >= max;
  const chosen = new Set(value.map((v) => v.asset_id));

  const add = (v: VideoChoice) => {
    if (chosen.has(v.asset_id) || full) return;
    onChange([...value, { ...v, caption: "", members_only: false }]);
  };
  const update = (i: number, patch: Partial<PickedVideo>) => onChange(value.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const move = (i: number, delta: number) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + delta, 0, x);
    onChange(next);
  };
  const search = (offset = 0) =>
    start(async () => {
      const r = await listLibraryVideos({ q, offset });
      if (!r.ok) {
        setMessage({ tone: "error", text: r.message });
        return;
      }
      setResults((prev) => (offset && prev ? [...prev, ...r.items.filter((x) => !prev.some((p) => p.asset_id === x.asset_id))] : r.items));
      setMore(r.more);
    });

  return (
    <div className="space-y-3">
      {value.length ? (
        <ol className="space-y-3" aria-label="Chosen videos, in the order members see them">
          {value.map((v, i) => (
            <li key={v.asset_id} className="space-y-3 rounded-tile border border-border p-3">
              <div className="flex gap-3">
                <Thumb v={v} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug [overflow-wrap:anywhere]">{v.title}</p>
                  <p className="text-meta text-text-secondary">
                    {[providerLabel(v), v.duration_seconds ? formatDuration(v.duration_seconds) : null].filter(Boolean).join(" · ")}
                  </p>
                  {v.unavailable ? (
                    <p className="text-meta font-semibold text-danger">The provider reports it can&apos;t be played here; members will get an “Open in” link instead.</p>
                  ) : null}
                </div>
              </div>
              <TextField
                label="Caption"
                name={`_video_caption_${i}`}
                value={v.caption}
                maxLength={120}
                onChange={(e) => update(i, { caption: e.target.value })}
                optional
                hint="A short note shown under the video, such as “Watch before the discussion”."
              />
              {v.kind === "video" && audience === "public" ? (
                <CheckboxField name={`_video_mo_${i}`} label="Members only (even when this is public)" checked={v.members_only} onChange={(e) => update(i, { members_only: e.target.checked })} />
              ) : null}
              <div className="flex flex-wrap gap-1">
                {i > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => move(i, -1)} icon={<ArrowUp className="size-4" aria-hidden="true" />}>
                    Earlier<span className="sr-only">: {v.title}</span>
                  </Button>
                ) : null}
                {i < value.length - 1 ? (
                  <Button variant="ghost" size="sm" onClick={() => move(i, 1)} icon={<ArrowDown className="size-4" aria-hidden="true" />}>
                    Later<span className="sr-only">: {v.title}</span>
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" aria-hidden="true" />}>
                  Remove<span className="sr-only">: {v.title}</span>
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-text-secondary">No video chosen.</p>
      )}

      {message ? <Alert tone={message.tone} title={message.text} /> : null}

      {!full ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={browsing}
            aria-controls={`${ids}-library`}
            icon={<Search className="size-4" aria-hidden="true" />}
            onClick={() => {
              setBrowsing((b) => !b);
              if (!results) search(0);
            }}
          >
            Choose from the media library
          </Button>
        </div>
      ) : null}

      {browsing && !full ? (
        <div id={`${ids}-library`} className="space-y-3 rounded-tile border border-border bg-background p-3">
          <div className="flex gap-2">
            <label htmlFor={`${ids}-q`} className="sr-only">
              Search library videos
            </label>
            <input
              id={`${ids}-q`}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Search here instead of submitting the whole editor form.
                if (e.key === "Enter") {
                  e.preventDefault();
                  search(0);
                }
              }}
              placeholder="Search titles"
              className="min-h-11 min-w-0 flex-1 rounded-control border border-border-strong bg-surface px-3"
            />
            <Button size="sm" variant="secondary" onClick={() => search(0)} disabled={pending}>
              Search
            </Button>
          </div>
          {pending && !results ? <p className="text-meta text-text-secondary">Loading…</p> : null}
          {results && !results.length ? <p className="text-meta text-text-secondary">No ready videos match.</p> : null}
          {results?.length ? (
            <ul className="max-h-96 space-y-2 overflow-y-auto">
              {results.map((v) => (
                <li key={v.asset_id} className="flex items-center gap-3">
                  <Thumb v={v} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug [overflow-wrap:anywhere]">{v.title}</span>
                    <span className="block text-meta text-text-secondary">{providerLabel(v)}</span>
                  </span>
                  <Button size="sm" variant={chosen.has(v.asset_id) ? "ghost" : "secondary"} disabled={chosen.has(v.asset_id)} onClick={() => add(v)}>
                    {chosen.has(v.asset_id) ? "Added" : "Add"}
                    <span className="sr-only">: {v.title}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {more ? (
            <Button size="sm" variant="ghost" onClick={() => search(results?.length ?? 0)} disabled={pending}>
              Show more
            </Button>
          ) : null}
        </div>
      ) : null}

      {!full && canAddLinks ? (
        <div className="space-y-2">
          <label htmlFor={`${ids}-url`} className="block font-semibold">
            Add a YouTube or Vimeo link
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${ids}-url`}
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              className="min-h-11 min-w-0 flex-1 rounded-control border border-border-strong bg-surface px-3"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !url.trim()}
              icon={<Link2 className="size-4" aria-hidden="true" />}
              onClick={() =>
                start(async () => {
                  setMessage(null);
                  const r = await addVideoLink({ url });
                  if (!r.ok) {
                    setMessage({ tone: "error", text: r.message });
                    return;
                  }
                  if (chosen.has(r.video.asset_id)) {
                    setMessage({ tone: "success", text: "That video is already chosen." });
                  } else {
                    add(r.video);
                    setMessage({ tone: "success", text: r.created ? `Added “${r.video.title}” to the library and chose it.` : `“${r.video.title}” was already in the library; chose it.` });
                  }
                  setUrl("");
                })
              }
            >
              {pending ? "Adding…" : "Add link"}
            </Button>
          </div>
          <p className="text-meta text-text-secondary">Paste the video&apos;s address, not embed code. The same video is never stored twice.</p>
        </div>
      ) : null}
      {!canAddLinks ? (
        <p className="text-meta text-text-secondary">
          <Plus className="mr-1 inline size-4 align-[-3px]" aria-hidden="true" />
          New links are added by a media manager (in the media library or here).
        </p>
      ) : null}
    </div>
  );
}
