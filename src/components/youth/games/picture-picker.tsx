"use client";

/* eslint-disable @next/next/no-img-element -- short-lived signed URLs and local previews, never through the image optimizer */
import { ImagePlus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { uploadGameArtAction } from "@/app/admin/youth/activities/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { SelectField, TextField } from "@/components/ui/field";
import { ACCEPT } from "@/lib/media/files";
import { ART_SOURCES } from "@/lib/youth/activities";
import { GAME_ART, gameArtLabel } from "@/lib/youth/games/art";
import type { GameImage } from "@/lib/youth/games/config";
import { GameArt } from "./game-art";

export type ArtOption = { id: string; url: string | null; alt: string; source: string };

/**
 * Choose a picture for a scene or card: one of the built-in illustrations,
 * artwork already uploaded for this activity (every upload carries its
 * source and rights confirmation), or a new upload right here. The fields
 * have no names: they sit inside the editor's form but are never submitted
 * with it, and the upload goes through its own server action.
 */
export function PicturePicker({
  label,
  value,
  onChange,
  art,
  onUploaded,
  activityId,
}: {
  label: string;
  value: GameImage | null;
  onChange: (v: GameImage | null) => void;
  art: ArtOption[];
  onUploaded: (a: ArtOption) => void;
  activityId: string | null;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"built_in" | "uploaded" | "upload">("built_in");
  const current = value && "asset" in value ? art.find((a) => a.id === value.asset) : null;
  const tabClass = (on: boolean) =>
    cn("inline-flex min-h-11 items-center rounded-full border px-4 text-meta font-semibold", on ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:text-text");
  const choose = (v: GameImage) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <p className="font-semibold">{label}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="play-art size-20 shrink-0 overflow-hidden rounded-tile border border-border" data-kind="puzzle">
          {value && "art" in value ? (
            <div className="size-full p-2">
              <GameArt art={value.art} />
            </div>
          ) : current?.url ? (
            <img src={current.url} alt="" className="size-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-meta text-text-secondary">
            {!value ? "No picture yet." : "art" in value ? `Built-in: ${gameArtLabel(value.art)}` : current ? `Uploaded: ${current.alt || "no description yet"}` : "Uploaded picture (removed)"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" aria-expanded={open} aria-controls={`${fid}-panel`} onClick={() => setOpen((o) => !o)}>
              {value ? "Change picture" : "Choose picture"}
            </Button>
            {value ? (
              <Button variant="ghost" size="sm" icon={<X className="size-4" aria-hidden="true" />} onClick={() => onChange(null)}>
                Remove picture
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {open ? (
        <div id={`${fid}-panel`} className="space-y-3 rounded-card border border-border bg-surface-muted p-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Where the picture comes from">
            <button type="button" className={tabClass(tab === "built_in")} aria-pressed={tab === "built_in"} onClick={() => setTab("built_in")}>
              Built-in pictures
            </button>
            <button type="button" className={tabClass(tab === "uploaded")} aria-pressed={tab === "uploaded"} onClick={() => setTab("uploaded")}>
              Uploaded ({art.length})
            </button>
            <button type="button" className={tabClass(tab === "upload")} aria-pressed={tab === "upload"} onClick={() => setTab("upload")}>
              Upload new
            </button>
          </div>

          {tab === "built_in" ? (
            <ul className="grid grid-cols-3 gap-2 min-[28rem]:grid-cols-4 sm:grid-cols-5">
              {GAME_ART.map((a) => {
                const on = !!value && "art" in value && value.art === a.key;
                return (
                  <li key={a.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => choose({ art: a.key })}
                      className={cn(
                        "flex w-full flex-col items-center gap-1 rounded-tile border bg-surface p-1.5 text-center text-[0.8125rem] leading-tight focus-visible:outline-3 focus-visible:outline-primary",
                        on ? "border-primary ring-2 ring-primary" : "border-border hover:border-border-strong",
                      )}
                    >
                      <span className="play-art block aspect-square w-full rounded-control p-1.5" data-kind="matching">
                        <GameArt art={a.key} />
                      </span>
                      {a.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : tab === "uploaded" ? (
            art.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {art.map((a) => {
                  const on = !!value && "asset" in value && value.asset === a.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => choose({ asset: a.id })}
                        className={cn(
                          "flex w-full flex-col gap-1 rounded-tile border bg-surface p-1.5 text-left text-[0.8125rem] leading-tight focus-visible:outline-3 focus-visible:outline-primary",
                          on ? "border-primary ring-2 ring-primary" : "border-border hover:border-border-strong",
                        )}
                      >
                        {a.url ? <img src={a.url} alt="" className="aspect-square w-full rounded-control object-cover" /> : <span className="block aspect-square w-full rounded-control bg-surface-muted" />}
                        <span className="line-clamp-2">{a.alt || "No description yet"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-meta text-text-secondary">Nothing uploaded for this activity yet. Use Upload new, or a built-in picture.</p>
            )
          ) : (
            <InlineUpload activityId={activityId} onUploaded={(a) => (onUploaded(a), choose({ asset: a.id }))} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function InlineUpload({ activityId, onUploaded }: { activityId: string | null; onUploaded: (a: ArtOption) => void }) {
  const fid = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const [kind, setKind] = useState("original");
  const [credit, setCredit] = useState("");
  const [license, setLicense] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  if (!activityId) return <p className="text-meta text-text-secondary">Create the draft first, then upload pictures here. Built-in pictures work right away.</p>;

  const upload = async () => {
    setError(null);
    if (!file) return setError("Choose an image to upload.");
    if (!rights) return setError("Confirm the church may use this artwork.");
    if (kind !== "original" && !credit.trim()) return setError("Name the artist or source for artwork that isn't original.");
    const fd = new FormData();
    fd.set("activity", activityId);
    fd.set("file", file);
    fd.set("alt", alt);
    fd.set("source_kind", kind);
    fd.set("source_credit", credit);
    fd.set("license", license);
    fd.set("rights_confirmed", "on");
    setBusy(true);
    try {
      const r = await uploadGameArtAction(fd);
      if (r.ok) onUploaded(r.asset);
      else setError(r.message);
    } catch {
      setError("The upload didn't finish. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={`${fid}-file`} className="block font-semibold">
          Image
        </label>
        <p id={`${fid}-hint`} className="text-meta text-text-secondary">
          JPEG, PNG, WebP, or HEIC up to 4 MB, at least 200 pixels on each side. Re-encoded, with hidden details (like location) removed.
        </p>
        <input
          id={`${fid}-file`}
          type="file"
          accept={ACCEPT.image}
          aria-describedby={`${fid}-hint`}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
          className="block w-full min-h-12 rounded-control border border-border-strong bg-surface px-3 py-2 file:mr-3 file:min-h-9 file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:font-semibold"
        />
        {preview ? <img src={preview} alt="" className="mt-2 max-h-32 rounded-tile border border-border object-contain" /> : null}
      </div>
      <TextField id={`${fid}-alt`} name="" label="Description" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} hint="What the picture shows, for people who can't see it." optional />
      <SelectField id={`${fid}-kind`} name="" label="Where it came from" value={kind} onChange={(e) => setKind(e.target.value)}>
        {ART_SOURCES.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </SelectField>
      <TextField id={`${fid}-credit`} name="" label="Artist or source" value={credit} onChange={(e) => setCredit(e.target.value)} maxLength={300} optional={kind === "original"} />
      <TextField id={`${fid}-license`} name="" label="License or permission" value={license} onChange={(e) => setLicense(e.target.value)} maxLength={300} optional />
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1 size-5 shrink-0" />
        <span>I confirm this artwork is original or appropriately licensed, and the church may use it here.</span>
      </label>
      {error ? <Alert tone="error" title={error} /> : null}
      <Button size="sm" variant="secondary" icon={<ImagePlus className="size-4" aria-hidden="true" />} loading={busy} loadingText="Uploading…" onClick={upload}>
        Upload and use
      </Button>
    </div>
  );
}
