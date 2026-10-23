import { FileText, Film, Image as ImageIcon, MonitorPlay, Music, Subtitles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AssetStatusBadge, RightsBadge } from "@/components/media/badges";
import { UploadPanel } from "@/components/media/upload-panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { formatBytes } from "@/lib/media/files";
import { durationLabel } from "@/lib/media/format";
import type { AssetRow } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";
import { ExternalVideoForm } from "./external-video-form";

export const metadata: Metadata = { title: "Media library" };

const KINDS = [
  ["", "All"],
  ["audio", "Audio"],
  ["video", "Video"],
  ["external_video", "YouTube & Vimeo"],
  ["image", "Images"],
  ["document", "Documents"],
] as const;

const KIND_ICON: Record<string, React.ReactNode> = {
  audio: <Music className="size-5" aria-hidden="true" />,
  video: <Film className="size-5" aria-hidden="true" />,
  external_video: <MonitorPlay className="size-5" aria-hidden="true" />,
  image: <ImageIcon className="size-5" aria-hidden="true" />,
  document: <FileText className="size-5" aria-hidden="true" />,
  captions: <Subtitles className="size-5" aria-hidden="true" />,
};

const NOTICES: Record<string, string> = { removed: "The file was removed and its stored copies deleted." };

/** A short "can members find it?" label for library videos (details on the file's page). */
function VideoReachBadge({ a }: { a: AssetRow }) {
  if (a.kind !== "video" && a.kind !== "external_video") return null;
  if (a.provider_status === "unavailable" || a.provider_status === "not_embeddable") return <Badge tone="danger">Can&apos;t play here</Badge>;
  const p = a.publishing;
  if (!p) return null;
  const page = p.standalone.find((x) => x.state !== "archived");
  if (page) {
    return page.state === "live" ? (
      <Badge tone="success">{page.audience === "group" ? "Published video (one group)" : "Published video"}</Badge>
    ) : (
      <Badge tone="warning">Video page: {page.state === "scheduled" ? "scheduled" : page.state === "expired" ? "expired" : "draft"}</Badge>
    );
  }
  const live = p.attached.filter((x) => x.state === "live").length + p.albums.filter((x) => x.status === "approved" && x.album_status === "published").length;
  if (live) return <Badge tone="info">Inside {live} published {live === 1 ? "page or album" : "pages or albums"}</Badge>;
  if (p.attached.length || p.albums.length || p.blocks) return <Badge tone="warning">Used only in unpublished content</Badge>;
  return <Badge tone="warning">Library only: not visible to members</Badge>;
}

export default async function MediaLibraryPage({ searchParams }: PageProps<"/admin/media">) {
  const viewer = await requireAnyCapability(
    [CAPABILITIES.mediaManage, CAPABILITIES.contentEdit, CAPABILITIES.contentPublish, CAPABILITIES.podcastsManage],
    "/admin/media",
  );
  const canManage = viewer.capabilities.has(CAPABILITIES.mediaManage);
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" && KINDS.some(([k]) => k === sp.kind) ? sp.kind : "";
  const status = typeof sp.status === "string" && ["uploading", "processing", "ready", "failed", "removed", "needs_decision"].includes(sp.status) ? sp.status : null;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const page = Math.max(0, Number(sp.page) || 0);
  const supabase = await requireClient();
  const [list, settings, storage, undecided] = await Promise.all([
    supabase.rpc("media_admin_assets", { p_kind: kind || null, p_status: status, p_q: q || null, p_limit: 40, p_offset: page * 40 }),
    supabase.rpc("media_admin_settings"),
    canManage ? supabase.rpc("media_admin_storage") : Promise.resolve({ data: null, error: null }),
    // Ready videos not used anywhere (before 20261109000200 this filter matches nothing).
    status === "needs_decision" ? Promise.resolve(null) : supabase.rpc("media_admin_assets", { p_kind: null, p_status: "needs_decision", p_q: null, p_limit: 1, p_offset: 0 }),
  ]);
  const undecidedCount = undecided && !undecided.error ? ((undecided.data as { total?: number } | null)?.total ?? 0) : 0;
  const items = ((list.data as { items: AssetRow[] } | null)?.items ?? []) as AssetRow[];
  const total = (list.data as { total: number } | null)?.total ?? 0;
  const s = (settings.data ?? {}) as Record<string, number>;
  const usage = storage.data as { quota_mb: number; buckets: Array<{ bucket: string; bytes: number; objects: number }> } | null;
  const usedBytes = usage?.buckets.reduce((sum, b) => sum + Number(b.bytes), 0) ?? 0;
  const quotaBytes = (usage?.quota_mb ?? 0) * 1024 * 1024;
  const notice = typeof sp.saved === "string" ? NOTICES[sp.saved] : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Teaching & media"
        title="Media library"
        description="Audio, video, images, handouts, and captions used across devotionals, lessons, podcasts, and reading. Uploading never publishes anything."
        actions={
          canManage ? (
            <>
              <ButtonLink href="/admin/media/cleanup" variant="secondary" size="sm">
                Storage and cleanup
              </ButtonLink>
              <ButtonLink href="/admin/media/settings" variant="secondary" size="sm">
                Limits
              </ButtonLink>
            </>
          ) : null
        }
      />
      {notice ? <Alert tone="success" title={notice} className="mb-6" /> : null}
      {undecidedCount ? (
        <Alert tone="warning" title={`${undecidedCount} video${undecidedCount === 1 ? " isn't" : "s aren't"} visible to members yet`} className="mb-6">
          Library videos are never shown on their own. Each needs a decision: publish it as a video, attach it to a lesson, devotional, or reading, add it to a
          Media gallery album, or leave it in the library.{" "}
          <Link href={{ query: { status: "needs_decision" } }} className="font-semibold underline">
            Show them
          </Link>
        </Alert>
      ) : null}
      {list.error ? <Alert tone="error" title="The media library couldn't be loaded. If Phase 7 hasn't been applied to the database yet, apply it first." className="mb-6" /> : null}

      {canManage ? (
        <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card>
            <SectionHeading description="Files go straight to private storage, resumably for large files.">Upload</SectionHeading>
            <UploadPanel
              kinds={["audio", "video", "image", "document"]}
              limitsMb={{ audio: s.audio_max_mb, video: s.video_max_mb, image: s.image_max_mb, document: s.document_max_mb }}
            />
          </Card>
          <Card>
            <SectionHeading description="Only the link is stored; the video stays on YouTube or Vimeo.">Add a YouTube or Vimeo video</SectionHeading>
            <ExternalVideoForm />
            {usage ? (
              <div className="mt-6 border-t border-border pt-4">
                <p className="font-semibold">Storage used</p>
                <p className="text-meta text-text-secondary">
                  {formatBytes(usedBytes)} of the {formatBytes(quotaBytes)} you set as a limit
                  {quotaBytes && usedBytes / quotaBytes > 0.8 ? " — nearly full; consider cleanup or moving video to YouTube/Vimeo" : ""}.
                </p>
                <progress className="mt-2 h-2 w-full" max={Math.max(quotaBytes, 1)} value={Math.min(usedBytes, quotaBytes)} aria-label="Storage used" />
              </div>
            ) : null}
          </Card>
        </div>
      ) : (
        <Alert tone="info" title="You can browse the library and attach ready files to content. Uploading needs the media manager role." className="mb-6" />
      )}

      <section aria-labelledby="library-files">
        <SectionHeading id="library-files" description={`${total} file${total === 1 ? "" : "s"}`}>
          Files
        </SectionHeading>
        <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
          <div className="min-w-48 flex-1 space-y-1.5">
            <label htmlFor="media-q" className="block text-meta font-semibold">
              Search titles and file names
            </label>
            <input id="media-q" name="q" defaultValue={q} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="media-kind" className="block text-meta font-semibold">
              Kind
            </label>
            <select id="media-kind" name="kind" defaultValue={kind} className="min-h-11 rounded-control border border-border-strong bg-surface px-3">
              {KINDS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="media-status" className="block text-meta font-semibold">
              Status
            </label>
            <select id="media-status" name="status" defaultValue={status ?? ""} className="min-h-11 rounded-control border border-border-strong bg-surface px-3">
              <option value="">Not removed</option>
              <option value="ready">Ready</option>
              <option value="processing">Processing</option>
              <option value="uploading">Uploading</option>
              <option value="failed">Failed</option>
              <option value="removed">Removed</option>
              <option value="needs_decision">Videos not used anywhere yet</option>
            </select>
          </div>
          <button type="submit" className="min-h-11 rounded-full border border-border-strong bg-surface px-4 font-semibold hover:bg-surface-muted">
            Filter
          </button>
        </form>
        {items.length ? (
          <ul className={rowListClass}>
            {items.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/media/${a.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted">{KIND_ICON[a.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.title}</span>
                    <span className="block truncate text-meta text-text-secondary">
                      {[
                        a.kind === "external_video" ? (a.provider === "youtube" ? "YouTube" : "Vimeo") : a.mime,
                        a.size_bytes ? formatBytes(a.size_bytes) : null,
                        durationLabel(a.duration_seconds),
                        a.usage_count ? `Used ${a.usage_count}×` : "Not used",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <AssetStatusBadge status={a.status} />
                    {a.kind !== "external_video" && a.kind !== "image" ? <RightsBadge rights={a.rights} confirmed={!!a.rights_confirmed_at} /> : null}
                    {a.public_ok ? <Badge tone="info">Approved for public use</Badge> : null}
                    <VideoReachBadge a={a} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState glyph="media" title={q || kind || status ? "No files match" : "No files yet"}>
            {canManage ? "Upload a file or add a video link above." : "A media manager can add files here."}
          </EmptyState>
        )}
        {total > 40 ? (
          <nav aria-label="Pages" className="mt-4 flex justify-between">
            {page > 0 ? (
              <Link className="min-h-11 px-2 font-semibold text-primary" href={{ query: { ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}), page: page - 1 } }}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            {(page + 1) * 40 < total ? (
              <Link className="min-h-11 px-2 font-semibold text-primary" href={{ query: { ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}), page: page + 1 } }}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
