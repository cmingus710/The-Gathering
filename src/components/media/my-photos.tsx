/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { removeMyPhotoAction, updatePhotoAction } from "@/app/(member)/gallery/actions";
import { Badge } from "@/components/ui/badge";
import type { Photo } from "@/lib/media/types";

const STATUS: Record<string, { label: string; tone: "neutral" | "warning" | "danger" | "success" }> = {
  uploading: { label: "Upload not finished", tone: "warning" },
  processing: { label: "Processing", tone: "warning" },
  pending: { label: "Waiting for review", tone: "warning" },
  approved: { label: "In the album", tone: "success" },
  rejected: { label: "Not approved", tone: "danger" },
  hidden: { label: "Hidden by a moderator", tone: "neutral" },
  failed: { label: "Upload failed", tone: "danger" },
};

/**
 * The member's own photos that others can't see yet (or were declined).
 * They can fix the caption and description before review, or remove a
 * photo at any time (its files are deleted at once).
 */
export function MyPhotos({ photos, urls }: { photos: Array<Photo & { album_title?: string }>; urls: Map<string, string> }) {
  return (
    <ul className="space-y-3">
      {photos.map((p) => {
        const thumb = urls.get((p.status === "approved" || p.status === "hidden" ? p.thumb_path : p.review_thumb_path) ?? "") ?? null;
        const s = STATUS[p.status] ?? STATUS.failed;
        return (
          <li key={p.id} className="flex flex-wrap gap-3 rounded-tile border border-border bg-surface p-3">
            {thumb ? <img src={thumb} alt={p.alt_text || "Your photo"} className="size-24 shrink-0 rounded-tile object-cover" /> : <span className="size-24 shrink-0 rounded-tile bg-surface-muted" aria-hidden="true" />}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={s.tone}>{s.label}</Badge>
                {p.album_title ? <span className="text-meta text-text-secondary">{p.album_title}</span> : null}
              </p>
              {p.review_reason && (p.status === "rejected" || p.status === "hidden") ? <p className="text-meta text-text-secondary">Moderator note: {p.review_reason}</p> : null}
              {p.status === "pending" ? (
                <form action={updatePhotoAction} className="grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="block space-y-1">
                    <span className="text-meta font-semibold">Caption</span>
                    <input name="caption" defaultValue={p.caption} maxLength={500} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-meta font-semibold">Description for screen readers</span>
                    <input name="alt" defaultValue={p.alt_text} maxLength={500} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
                  </label>
                  <button type="submit" className="min-h-11 justify-self-start rounded-full border border-border-strong/60 px-4 text-meta font-semibold hover:bg-surface-muted">
                    Save changes
                  </button>
                </form>
              ) : p.caption ? (
                <p className="text-meta">{p.caption}</p>
              ) : null}
              <form action={removeMyPhotoAction}>
                <input type="hidden" name="id" value={p.id} />
                <button type="submit" className="min-h-11 text-meta font-semibold text-danger hover:underline">
                  Remove this photo
                </button>
              </form>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
