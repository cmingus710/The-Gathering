import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GalleryViewer, type ViewerPhoto } from "@/components/media/gallery-viewer";
import { MyPhotos } from "@/components/media/my-photos";
import { PhotoUploader } from "@/components/media/photo-uploader";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { formatDay, isUuid } from "@/lib/media/format";
import { signPaths, UPLOAD_BUCKET } from "@/lib/media/storage";
import type { Album, Photo } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Photo album" };

type AlbumPage = Album & { photos: Photo[]; my_pending: Photo[]; limits: { file_mb: number; batch_max: number; daily_max: number } };

export default async function AlbumPage({ params }: PageProps<"/gallery/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const [, { data, error }] = await Promise.all([requireApprovedMember(`/gallery/${id}`), supabase.rpc("media_album", { p_id: id })]);
  if (error || !data) notFound();
  const a = data as AlbumPage;
  const [urls, reviewUrls] = await Promise.all([
    signPaths(supabase, [...a.photos.flatMap((p) => [p.thumb_path, p.display_path]), ...a.my_pending.map((p) => p.thumb_path)]),
    signPaths(supabase, a.my_pending.map((p) => p.review_thumb_path), UPLOAD_BUCKET),
  ]);
  const photos: ViewerPhoto[] = a.photos.map((p) => ({
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
      <PageHeader
        eyebrow={[a.album_on ? formatDay(a.album_on) : null, a.audience === "group" ? `Shared with ${a.group_name ?? "one group"}` : "Shared with members"].filter(Boolean).join(" · ")}
        title={a.title}
        description={a.description || undefined}
      />
      {a.event ? (
        <p className="-mt-3 mb-6 text-meta">
          From {a.event.title}
        </p>
      ) : null}

      {photos.length ? (
        <GalleryViewer photos={photos} albumTitle={a.title} />
      ) : (
        <EmptyState glyph="gallery" title="No photos yet">
          {a.can_upload ? "Be the first to add some." : "Photos will appear here after they're approved."}
        </EmptyState>
      )}

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
        To ask for a photo to be taken down (for example, if you&apos;re in it), open it and choose “Report or ask to remove.” Anyone who can see these photos
        can still screenshot them.
      </p>
    </>
  );
}
