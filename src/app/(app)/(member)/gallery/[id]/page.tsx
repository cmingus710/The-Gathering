import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlbumCoverImage } from "@/components/media/album-cover-image";
import { AlbumVideo } from "@/components/media/album-video";
import { GalleryViewer, type ViewerPhoto } from "@/components/media/gallery-viewer";
import { MyPhotos } from "@/components/media/my-photos";
import { PhotoUploader } from "@/components/media/photo-uploader";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { albumCoverPath, isChosenCover } from "@/lib/media/album-cover";
import { formatDay, isUuid } from "@/lib/media/format";
import { signPaths, UPLOAD_BUCKET } from "@/lib/media/storage";
import type { Album, Photo } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Media gallery album" };

const SHOW = [
  { value: "", label: "All" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
] as const;

type AlbumPage = Album & { photos: Photo[]; my_pending: Photo[]; limits: { file_mb: number; batch_max: number; daily_max: number } };

export default async function AlbumPage({ params, searchParams }: PageProps<"/gallery/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const show = sp.show === "photos" || sp.show === "videos" ? sp.show : "";
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const [, { data, error }] = await Promise.all([requireApprovedMember(`/gallery/${id}`), supabase.rpc("media_album", { p_id: id })]);
  if (error || !data) notFound();
  const a = data as AlbumPage;
  const videos = a.photos.filter((p) => p.kind === "video" && p.video);
  const stills = a.photos.filter((p) => p.kind !== "video");
  // The header shows a cover chosen for the album (not the automatic one, which is already the first photo below).
  const headerCover = isChosenCover(a.cover) ? albumCoverPath(a.cover, "header") : null;
  const [urls, reviewUrls] = await Promise.all([
    signPaths(supabase, [...stills.flatMap((p) => [p.thumb_path, p.display_path]), ...a.my_pending.map((p) => p.thumb_path), headerCover]),
    signPaths(supabase, a.my_pending.map((p) => p.review_thumb_path), UPLOAD_BUCKET),
  ]);
  const photos: ViewerPhoto[] = stills.map((p) => ({
    id: p.id,
    thumb: urls.get(p.thumb_path ?? "") ?? null,
    display: urls.get(p.display_path ?? "") ?? null,
    alt: p.alt_text,
    caption: p.caption,
    width: p.width,
    height: p.height,
  }));

  return (
    <>
      <BackLink route="/gallery/[id]" />
      {(() => {
        const header = (
          <PageHeader
            eyebrow={[a.album_on ? formatDay(a.album_on) : null, a.audience === "group" ? `Shared with ${a.group_name ?? "one group"}` : "Shared with members"].filter(Boolean).join(" · ")}
            title={a.title}
            description={a.description || undefined}
          />
        );
        const src = headerCover ? urls.get(headerCover) : null;
        if (!src) return header;
        return (
          <div className="grid gap-x-8 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-start">
            {header}
            <AlbumCoverImage
              src={src}
              alt={a.cover?.alt || `Cover image for ${a.title}`}
              framing={a.cover?.framing ?? null}
              className="order-first mb-5 w-full max-w-md rounded-card border border-border md:order-none md:mb-6"
            />
          </div>
        );
      })()}
      {a.event ? (
        <p className="-mt-3 mb-6 text-meta">
          From {a.event.title}
        </p>
      ) : null}

      {videos.length && photos.length ? (
        <nav aria-label="Show" className="mb-5 flex gap-2">
          {SHOW.map((o) => (
            <Link
              key={o.value || "all"}
              href={{ pathname: `/gallery/${a.id}`, query: o.value ? { show: o.value } : {} }}
              aria-current={show === o.value ? "page" : undefined}
              scroll={false}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-meta font-semibold",
                show === o.value ? "border-text bg-text text-background" : "border-border bg-surface hover:bg-surface-muted",
              )}
            >
              {o.label}
              {o.value === "photos" ? ` (${photos.length})` : o.value === "videos" ? ` (${videos.length})` : ""}
            </Link>
          ))}
        </nav>
      ) : null}

      {videos.length && show !== "photos" ? (
        <section aria-labelledby="al-videos" className="mb-8">
          <SectionHeading id="al-videos" description="Press Play to watch here.">
            Videos
          </SectionHeading>
          <ul className="grid gap-4 md:grid-cols-2">
            {videos.map((v) => (
              <li key={v.id}>
                <AlbumVideo id={v.id} video={v.video!} caption={v.caption} albumTitle={a.title} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {photos.length && show !== "videos" ? (
        <section aria-labelledby={videos.length ? "al-photos" : undefined} aria-label={videos.length ? undefined : "Photos"}>
          {videos.length ? <SectionHeading id="al-photos">Photos</SectionHeading> : null}
          <GalleryViewer photos={photos} albumTitle={a.title} />
        </section>
      ) : null}

      {!photos.length && !videos.length ? (
        <EmptyState glyph="gallery" title="Nothing here yet">
          {a.can_upload ? "Be the first to add some photos." : "Photos and videos will appear here after they're approved."}
        </EmptyState>
      ) : null}

      {a.my_pending.length ? (
        <section aria-labelledby="al-mine" className="mt-8">
          <SectionHeading id="al-mine" description="Only you and gallery moderators can see these.">
            Your photos waiting or declined
          </SectionHeading>
          <MyPhotos photos={a.my_pending} urls={new Map([...urls, ...reviewUrls])} />
        </section>
      ) : null}

      {a.can_upload ? (
        <section aria-labelledby="al-add" className="mt-8 rounded-card border border-border bg-surface p-5">
          <SectionHeading id="al-add">Add photos</SectionHeading>
          <PhotoUploader albumId={a.id} fileMb={a.limits.file_mb} batchMax={a.limits.batch_max} />
        </section>
      ) : null}

      <p className="mt-8 text-meta text-text-secondary">
        To ask for a photo or video to be taken down (for example, if you&apos;re in it), open the photo or look under the video and choose “Report or ask to
        remove.” Anyone who can see these can still screenshot or record them.
      </p>
    </>
  );
}
