/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VideoPlayer } from "@/components/media/video-player";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { signPaths } from "@/lib/media/storage";
import type { Album, AssetRow, Photo } from "@/lib/media/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { addAlbumVideoAction, albumStatusAction, movePhotoAction, reviewPhotoAction, setCoverAction } from "../actions";
import { AlbumForm } from "../album-form";

export const metadata: Metadata = { title: "Album" };

const SAVED: Record<string, string> = {
  created: "Album created as a draft.",
  saved: "Album saved.",
  publish: "Album published.",
  unpublish: "Album unpublished.",
  archive: "Album archived; uploads closed.",
  restore: "Album restored as a draft.",
  approve: "Photo approved and published.",
  reject: "Photo rejected. The uploader sees your reason.",
  hide: "Photo hidden from members.",
  unhide: "Photo shown again.",
  remove: "Photo removed and its files deleted.",
  cover: "Cover photo set.",
  order: "Order saved.",
  video_added: "Video added. Review it under “Waiting for review” to publish it in the album.",
};

const field = "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3";

type AlbumAdmin = Album & {
  can_moderate: boolean;
  event_series_id: string | null;
  group_id: string | null;
  sort_order: number;
  cover_photo_id: string | null;
  raw_uploads_open: boolean;
  counts: Record<string, number> | null;
  photos: Photo[];
};

export default async function AlbumAdminPage({ params, searchParams }: PageProps<"/admin/gallery/[id]">) {
  await requireAnyCapability([CAPABILITIES.galleryModerate, CAPABILITIES.eventsManage], "/admin/gallery");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const supabase = await requireClient();
  const libraryVideos = (kind: string) => supabase.rpc("media_admin_assets", { p_kind: kind, p_status: "ready", p_q: null, p_limit: 100, p_offset: 0 });
  const [{ settings }, albumRes, optsRes, extRes, fileRes] = await Promise.all([
    getChurchSettings(),
    supabase.rpc("media_admin_album", { p_id: id, p_status: null }),
    supabase.rpc("media_admin_album_options"),
    // Only people who can browse the media library get these; others paste a link.
    libraryVideos("external_video"),
    libraryVideos("video"),
  ]);
  if (albumRes.error || !albumRes.data) notFound();
  const a = albumRes.data as AlbumAdmin;
  const options = (optsRes.data ?? { events: [], groups: [] }) as { events: Array<{ id: string; title: string; start_date: string }>; groups: Array<{ id: string; name: string }> };
  const library = [extRes, fileRes].flatMap((r) => (r.error ? [] : ((r.data as { items?: AssetRow[] } | null)?.items ?? [])));
  const inAlbum = new Set(a.photos.map((p) => p.video?.asset_id).filter(Boolean));
  const pending = a.photos.filter((p) => p.status === "pending");
  const published = a.photos.filter((p) => p.status === "approved");
  const hidden = a.photos.filter((p) => p.status === "hidden");
  const [reviewUrls, servedUrls] = await Promise.all([
    signPaths(supabase, pending.map((p) => p.review_display_path), "media-uploads"),
    signPaths(supabase, [...published, ...hidden].map((p) => p.thumb_path)),
  ]);
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const error = typeof sp.error === "string" ? (sp.error === "unavailable" ? "The gallery service is unavailable." : sp.error.slice(0, 300)) : undefined;
  const order = published.map((p) => p.id);
  const moved = (i: number, delta: number) => {
    const next = [...order];
    const [x] = next.splice(i, 1);
    next.splice(i + delta, 0, x);
    return next.join(",");
  };
  const statusForm = (action: string, label: string, variant: "primary" | "secondary" | "danger-outline" = "secondary") => (
    <form action={albumStatusAction}>
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/gallery" className="hover:underline">
            Media gallery
          </Link>
        }
        title={a.title}
        description={`${published.length} published · ${pending.length} waiting · ${hidden.length} hidden`}
      />
      {saved ? <Alert tone="success" title={saved} className="mb-6" /> : null}
      {error ? <Alert tone="error" title={error} className="mb-6" /> : null}

      {a.can_moderate ? (
        <section aria-labelledby="pending-heading" className="mb-8">
          <SectionHeading id="pending-heading" description="Approve only photos everyone in the album's audience may see. There is no automatic face or age detection.">
            Waiting for review
          </SectionHeading>
          {pending.length ? (
            <ul className="grid gap-4 md:grid-cols-2">
              {pending.map((p) => (
                <li key={p.id} id={`photo-${p.id}`} className="space-y-3 rounded-card border border-border bg-surface p-4">
                  {p.kind === "video" && p.video ? (
                    <VideoPlayer video={p.video} title={p.caption || p.video.title} compact />
                  ) : p.review_display_path && reviewUrls.get(p.review_display_path) ? (
                    <img src={reviewUrls.get(p.review_display_path)} alt={p.alt_text || "Photo waiting for review"} className="max-h-80 w-full rounded-tile bg-surface-muted object-contain" />
                  ) : (
                    <p className="text-text-secondary">Preview unavailable.</p>
                  )}
                  <dl className="text-meta">
                    <div>
                      <dt className="inline text-text-secondary">{p.kind === "video" ? "Added by: " : "Shared by: "}</dt>
                      <dd className="inline">{p.uploader ?? "Former member"}</dd>
                    </div>
                    <div>
                      <dt className="inline text-text-secondary">Sent: </dt>
                      <dd className="inline">{formatDateTime(p.created_at, settings.timezone)}</dd>
                    </div>
                    {p.caption ? (
                      <div>
                        <dt className="inline text-text-secondary">Caption: </dt>
                        <dd className="inline">{p.caption}</dd>
                      </div>
                    ) : null}
                    {p.kind === "video" ? (
                      <div>
                        <dt className="inline text-text-secondary">Video: </dt>
                        <dd className="inline">{p.video?.title ?? "No longer in the library"}</dd>
                      </div>
                    ) : (
                      <>
                        <div>
                          <dt className="inline text-text-secondary">Description: </dt>
                          <dd className="inline">{p.alt_text || "None given"}</dd>
                        </div>
                        <div>
                          <dt className="inline text-text-secondary">Uploader confirmed permission to share: </dt>
                          <dd className="inline">{p.permission_confirmed ? "Yes" : "No"}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                  <form action={reviewPhotoAction} className="space-y-2">
                    <input type="hidden" name="album" value={a.id} />
                    <input type="hidden" name="photo" value={p.id} />
                    <input type="hidden" name="action" value="approve" />
                    <fieldset className="space-y-1.5">
                      <legend className="font-semibold">People under 18</legend>
                      <label className="flex items-start gap-2">
                        <input type="radio" name="minors" value="none" required className="mt-1 size-5 accent-primary" />
                        <span>No one under 18 can be identified</span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input type="radio" name="minors" value="permission_confirmed" className="mt-1 size-5 accent-primary" />
                        <span>
                          Shows someone under 18, and they&apos;re linked to their photo consent under Youth &amp; families → Photo consent (approval is refused
                          until every linked child has member-gallery consent)
                        </span>
                      </label>
                    </fieldset>
                    <SubmitButton size="sm" pendingText="Approving…">
                      Approve and publish
                    </SubmitButton>
                  </form>
                  <form action={reviewPhotoAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <input type="hidden" name="album" value={a.id} />
                    <input type="hidden" name="photo" value={p.id} />
                    <input type="hidden" name="action" value="reject" />
                    <div className="min-w-48 flex-1 space-y-1">
                      <label htmlFor={`reason-${p.id}`} className="block text-meta font-semibold">
                        Reason (shown to the uploader)
                      </label>
                      <input id={`reason-${p.id}`} name="reason" maxLength={500} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
                    </div>
                    <SubmitButton size="sm" variant="danger-outline" pendingText="Rejecting…">
                      Reject
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary">Nothing waiting.</p>
          )}
        </section>
      ) : null}

      {a.can_moderate ? (
        <section aria-labelledby="published-heading" className="mb-8">
          <SectionHeading id="published-heading" description="Hidden and removed photos stop loading for members at once; links already open expire within 5 minutes.">
            Published
          </SectionHeading>
          {published.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {published.map((p, i) => (
                <li key={p.id} id={`photo-${p.id}`} className="space-y-2 rounded-card border border-border bg-surface p-3">
                  {p.kind === "video" && p.video ? (
                    <VideoPlayer video={p.video} title={p.caption || p.video.title} compact />
                  ) : p.thumb_path && servedUrls.get(p.thumb_path) ? (
                    <img src={servedUrls.get(p.thumb_path)} alt={p.alt_text} className="aspect-square w-full rounded-tile object-cover" />
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    {a.cover_photo_id === p.id ? <Badge tone="warning">Cover</Badge> : null}
                    {p.open_reports ? <Badge tone="danger">{p.open_reports} report(s)</Badge> : null}
                    {p.caption_edited_at ? <Badge tone="neutral">Caption edited</Badge> : null}
                    {p.minors === "permission_confirmed" ? <Badge tone="info">Minor (permission confirmed)</Badge> : null}
                    {p.kind === "video" ? <Badge tone="neutral">Video</Badge> : null}
                  </div>
                  <p className="line-clamp-2 text-meta">{p.caption || <span className="text-text-secondary">No caption</span>}</p>
                  <div className="flex flex-wrap gap-1">
                    {i > 0 ? (
                      <form action={movePhotoAction}>
                        <input type="hidden" name="album" value={a.id} />
                        <input type="hidden" name="order" value={moved(i, -1)} />
                        <button type="submit" className="media-icon-btn" aria-label="Move earlier">
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </button>
                      </form>
                    ) : null}
                    {i < published.length - 1 ? (
                      <form action={movePhotoAction}>
                        <input type="hidden" name="album" value={a.id} />
                        <input type="hidden" name="order" value={moved(i, 1)} />
                        <button type="submit" className="media-icon-btn" aria-label="Move later">
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </button>
                      </form>
                    ) : null}
                    {a.cover_photo_id !== p.id && p.kind !== "video" ? (
                      <form action={setCoverAction}>
                        <input type="hidden" name="album" value={a.id} />
                        <input type="hidden" name="photo" value={p.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Make cover
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={reviewPhotoAction}>
                      <input type="hidden" name="album" value={a.id} />
                      <input type="hidden" name="photo" value={p.id} />
                      <input type="hidden" name="action" value="hide" />
                      <SubmitButton size="sm" variant="secondary">
                        Hide
                      </SubmitButton>
                    </form>
                    <ConfirmDialog
                      trigger="Remove"
                      title={p.kind === "video" ? "Remove this video from the album?" : "Remove this photo?"}
                      confirmLabel="Remove"
                      formAction={reviewPhotoAction}
                      hidden={{ album: a.id, photo: p.id, action: "remove" }}
                    >
                      {p.kind === "video" ? "It stops showing in the album at once. The video stays in the media library." : "Its files are deleted and the uploader is told it was removed."}
                    </ConfirmDialog>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary">No published photos yet.</p>
          )}
          {hidden.length ? (
            <>
              <h3 className="mb-2 mt-6 font-semibold">Hidden</h3>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {hidden.map((p) => (
                  <li key={p.id} id={`photo-${p.id}`} className="space-y-2 rounded-card border border-border bg-surface p-3">
                    {p.kind === "video" ? (
                      <p className="font-semibold">Video: {p.caption || p.video?.title}</p>
                    ) : p.thumb_path && servedUrls.get(p.thumb_path) ? (
                      <img src={servedUrls.get(p.thumb_path)} alt={p.alt_text} className="aspect-square w-full rounded-tile object-cover opacity-60" />
                    ) : null}
                    <div className="flex flex-wrap gap-1">
                      <form action={reviewPhotoAction}>
                        <input type="hidden" name="album" value={a.id} />
                        <input type="hidden" name="photo" value={p.id} />
                        <input type="hidden" name="action" value="unhide" />
                        <SubmitButton size="sm" variant="secondary">
                          Show again
                        </SubmitButton>
                      </form>
                      <ConfirmDialog trigger="Remove" title="Remove this photo?" confirmLabel="Remove" formAction={reviewPhotoAction} hidden={{ album: a.id, photo: p.id, action: "remove" }}>
                        Its files are deleted.
                      </ConfirmDialog>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : (
        <Alert tone="info" title="A gallery moderator reviews member photos for this album." className="mb-8" />
      )}

      {a.can_moderate && a.status !== "archived" ? (
        <section aria-labelledby="add-video-heading" id="add-video" className="mb-8 scroll-mt-24">
          <Card>
            <SectionHeading
              id="add-video-heading"
              description="Videos aren't copied: YouTube and Vimeo play from the provider, and uploaded videos stay in the media library. Members can't add videos; they wait for your review like photos."
            >
              Add a video
            </SectionHeading>
            <form action={addAlbumVideoAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="album" value={a.id} />
              {library.length ? (
                <div className="space-y-1">
                  <label htmlFor="av-asset" className="block font-semibold">
                    From the media library
                  </label>
                  <select id="av-asset" name="asset" defaultValue="" className={field}>
                    <option value="">Choose a video…</option>
                    {library
                      .filter((v) => !inAlbum.has(v.id))
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title}
                          {v.kind === "external_video" ? (v.provider === "vimeo" ? " (Vimeo)" : " (YouTube)") : " (uploaded)"}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
              <div className="space-y-1">
                <label htmlFor="av-url" className="block font-semibold">
                  {library.length ? "Or paste a YouTube or Vimeo link" : "YouTube or Vimeo link"}
                </label>
                <input id="av-url" name="url" type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" className={field} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor="av-caption" className="block font-semibold">
                  Caption <span className="font-normal text-text-secondary">(optional)</span>
                </label>
                <input id="av-caption" name="caption" maxLength={500} className={field} />
              </div>
              <p className="text-meta text-text-secondary sm:col-span-2">
                An unlisted YouTube video isn&apos;t protected by this album&apos;s audience: anyone who has its link can watch it on YouTube.
              </p>
              <div className="sm:col-span-2">
                <SubmitButton size="sm" pendingText="Adding…">
                  Add video for review
                </SubmitButton>
              </div>
            </form>
          </Card>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <SectionHeading>Album details</SectionHeading>
          <AlbumForm
            album={{
              id: a.id,
              title: a.title,
              description: a.description,
              album_on: a.album_on,
              event_series_id: a.event_series_id,
              audience: a.audience === "group" ? "group" : "members",
              group_id: a.group_id,
              uploads_open: a.raw_uploads_open,
              sort_order: a.sort_order,
            }}
            groups={options.groups}
            events={options.events}
          />
        </Card>
        {a.can_moderate ? (
          <Card>
            <SectionHeading>Status</SectionHeading>
            <p className="mb-3">
              <Badge tone={a.status === "published" ? "success" : "neutral"}>{a.status === "published" ? "Published" : a.status === "archived" ? "Archived" : "Draft"}</Badge>
            </p>
            <div className="flex flex-wrap gap-2">
              {a.status === "draft" ? statusForm("publish", "Publish", "primary") : null}
              {a.status === "published" ? statusForm("unpublish", "Unpublish") : null}
              {a.status !== "archived" ? statusForm("archive", "Archive", "danger-outline") : statusForm("restore", "Restore")}
              {a.status !== "published" ? (
                <ConfirmDialog trigger="Delete album" title="Delete this album?" confirmLabel="Delete" formAction={albumStatusAction} hidden={{ id: a.id, action: "delete" }}>
                  Only possible once its photos are removed. Archive it to keep the photos.
                </ConfirmDialog>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
