/* eslint-disable @next/next/no-img-element -- access-checked redirects to short-lived signed URLs; next/image would cache private photos in the optimizer. */
import { attachmentUrl, formatDuration } from "@/lib/community/attachments";
import type { Attachment } from "@/lib/community/types";

/**
 * Photos and videos on a discussion or reply. Every file loads through
 * /api/community/attachments/<id>, which rechecks access and redirects to a
 * short-lived signed link. Photos link to the full-size copy; videos never
 * autoplay and load only their metadata until played.
 */
export function AttachmentGallery({ items, className = "mt-4" }: { items: Attachment[] | null | undefined; className?: string }) {
  if (!items?.length) return null;
  const images = items.filter((a) => a.kind === "image");
  const videos = items.filter((a) => a.kind === "video");
  const single = images.length === 1;
  const cols = single ? "grid-cols-1" : images.length === 2 || images.length === 4 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";
  return (
    <div className={`space-y-3 ${className}`}>
      {images.length ? (
        <ul className={`grid gap-2 ${cols}`} aria-label={images.length === 1 ? "1 photo" : `${images.length} photos`}>
          {images.map((a, i) => {
            const alt = a.alt_text || `Photo ${i + 1} of ${images.length} (no description)`;
            return (
              <li key={a.id} className="min-w-0">
                <a
                  href={attachmentUrl(a.id, "display")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative block overflow-hidden rounded-tile border border-border bg-surface-muted outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <img
                    src={attachmentUrl(a.id, single ? "display" : "thumb")}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    width={single ? (a.width ?? undefined) : undefined}
                    height={single ? (a.height ?? undefined) : undefined}
                    className={single ? "h-auto max-h-[32rem] w-full max-w-full object-contain" : "aspect-square h-auto w-full object-cover"}
                  />
                  <span className="sr-only"> (opens the full-size photo in a new tab)</span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {videos.map((v, i) => {
        const duration = formatDuration(v.duration);
        const label = `Video${videos.length > 1 ? ` ${i + 1} of ${videos.length}` : ""}${duration ? `, ${duration}` : ""}`;
        return (
          <figure key={v.id} className="relative min-w-0 overflow-hidden rounded-tile border border-border bg-surface-muted">
            <video
              controls
              preload="metadata"
              playsInline
              src={attachmentUrl(v.id, "video")}
              aria-label={label}
              width={v.width ?? undefined}
              height={v.height ?? undefined}
              className="h-auto max-h-[32rem] w-full bg-black"
            >
              <a href={attachmentUrl(v.id, "video")} className="font-semibold text-primary underline">
                Open the video
              </a>
            </video>
            {duration ? <figcaption className="px-3 py-1.5 text-meta text-text-secondary">{label}</figcaption> : null}
          </figure>
        );
      })}
    </div>
  );
}
