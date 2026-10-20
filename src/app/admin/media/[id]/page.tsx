/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetStatusBadge, RightsBadge } from "@/components/media/badges";
import { EmbedPlayer } from "@/components/media/embed-player";
import { UploadPanel } from "@/components/media/upload-panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { formatBytes } from "@/lib/media/files";
import { durationLabel, formatDuration, isUuid, KIND_LABEL } from "@/lib/media/format";
import { videoEmbed } from "@/lib/media/embeds";
import { signPaths } from "@/lib/media/storage";
import type { AssetDetail, AssetRow, ItemKind } from "@/lib/media/types";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";
import { removeAssetAction, replaceAssetAction, transcriptFromCaptionsAction } from "../actions";
import { AssetDetailsForm, TranscriptForm } from "./forms";

export const metadata: Metadata = { title: "Media file" };

const SAVED: Record<string, string> = {
  added: "Video added. Add details and rights below.",
  replaced: "Replaced everywhere it was used. The old file was removed.",
  transcript: "Transcript filled in from the captions. Review it before saving changes.",
};

export default async function MediaAssetPage({ params, searchParams }: PageProps<"/admin/media/[id]">) {
  const viewer = await requireAnyCapability(
    [CAPABILITIES.mediaManage, CAPABILITIES.contentEdit, CAPABILITIES.contentPublish, CAPABILITIES.podcastsManage],
    "/admin/media",
  );
  const canManage = viewer.capabilities.has(CAPABILITIES.mediaManage);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_admin_asset", { p_id: id });
  if (error || !data) notFound();
  const a = data as AssetDetail;
  const [signed, candidates] = await Promise.all([
    a.kind === "image" ? signPaths(supabase, [a.path, a.variant_path]) : Promise.resolve(new Map<string, string>()),
    canManage && a.status !== "removed" && a.kind !== "captions"
      ? supabase.rpc("media_admin_assets", { p_kind: a.kind, p_status: "ready", p_q: null, p_limit: 100, p_offset: 0 })
      : Promise.resolve({ data: null }),
  ]);
  const replacements = (((candidates.data as { items: AssetRow[] } | null)?.items ?? []) as AssetRow[]).filter((x) => x.id !== a.id);
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const errorMessage = typeof sp.error === "string" ? (sp.error === "unavailable" ? "The media service is unavailable." : sp.error.slice(0, 300)) : undefined;
  const hosted = a.kind !== "external_video";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/media" className="hover:underline">
            Media library
          </Link>
        }
        title={a.title}
        description={[a.original_name, a.mime, a.size_bytes ? formatBytes(a.size_bytes) : null, durationLabel(a.duration_seconds)].filter(Boolean).join(" · ")}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <AssetStatusBadge status={a.status} />
        {hosted && a.kind !== "image" ? <RightsBadge rights={a.rights} confirmed={!!a.rights_confirmed_at} /> : null}
        {a.public_ok ? <Badge tone="info">Approved for public use</Badge> : <Badge tone="neutral">Members and groups only</Badge>}
      </div>
      {saved ? <Alert tone="success" title={saved} className="mb-6" /> : null}
      {errorMessage ? <Alert tone="error" title={errorMessage} className="mb-6" /> : null}
      {a.status === "failed" ? <Alert tone="error" title="Processing failed" className="mb-6">{a.error ?? "Upload the file again."}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <SectionHeading>Preview</SectionHeading>
            {a.status !== "ready" ? (
              <p className="text-text-secondary">Available once processing finishes.</p>
            ) : a.kind === "image" ? (
              <img src={signed.get(a.path ?? "") ?? ""} alt={a.alt_text ?? ""} className="max-h-96 w-auto rounded-tile border border-border" />
            ) : a.kind === "audio" ? (
              // Previews go through the same access-checked route as members' playback.
              <audio controls preload="none" src={`/api/media/${a.id}/play`} className="w-full" />
            ) : a.kind === "video" ? (
              <video controls preload="metadata" src={`/api/media/${a.id}/play`} className="aspect-video w-full rounded-tile bg-black" />
            ) : a.kind === "external_video" && a.provider && a.provider_ref ? (
              <EmbedPlayer
                title={a.title}
                embed={videoEmbed(
                  a.provider === "youtube" ? { provider: "youtube", id: a.provider_ref } : { provider: "vimeo", id: a.provider_ref, hash: a.provider_hash },
                  { origin: getSiteUrl(), autoplay: true },
                )}
                note="This video's privacy is set on the provider, not in this app."
              />
            ) : a.kind === "document" ? (
              <a href={`/api/media/${a.id}/file`} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                Open the document
              </a>
            ) : null}
            {a.duration_seconds ? (
              <p className="mt-2 text-meta text-text-secondary">
                Length {formatDuration(a.duration_seconds)}
                {a.duration_source === "browser" ? " (measured by the uploader's browser)" : ""}
              </p>
            ) : null}
          </Card>

          <Card>
            <SectionHeading description="Where this file appears. A file in use can't be removed; replace it instead.">Used by</SectionHeading>
            {a.usage.length ? (
              <ul className={rowListClass}>
                {a.usage.map((u) => (
                  <li key={`${u.type}-${u.id}-${u.role}`} className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <Link
                      href={u.type === "item" ? `/admin/content/${u.id}` : u.type === "show" ? `/admin/podcasts/${u.id}` : "/admin/content/library"}
                      className="min-w-0 flex-1 truncate font-semibold hover:underline"
                    >
                      {u.title}
                    </Link>
                    <span className="text-meta text-text-secondary">
                      {u.type === "item" ? KIND_LABEL[u.kind as ItemKind] : u.type === "show" ? "Podcast show" : "Series"} · {u.role} · {u.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-secondary">Not used anywhere yet.</p>
            )}
          </Card>

          {(a.kind === "audio" || a.kind === "video") && a.status === "ready" ? (
            <Card>
              <SectionHeading description="WebVTT captions are shown with the video and as live text for audio.">Captions</SectionHeading>
              {a.captions.length ? (
                <ul className="mb-4 space-y-1">
                  {a.captions.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.label ?? c.language?.toUpperCase()}</span>
                      <AssetStatusBadge status={c.status} />
                      {canManage && c.status === "ready" ? (
                        <form action={transcriptFromCaptionsAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="caption" value={c.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Use as transcript
                          </SubmitButton>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-text-secondary">No captions yet.</p>
              )}
              {canManage ? <UploadPanel kinds={["captions"]} limitsMb={{ captions: 2 }} parentId={a.id} /> : null}
            </Card>
          ) : null}

          {(a.kind === "audio" || a.kind === "video" || a.kind === "external_video") && canManage ? (
            <Card>
              <SectionHeading description="Plain text shown beneath the player for anyone who can see the content.">Transcript</SectionHeading>
              <TranscriptForm id={a.id} transcript={a.transcript ?? ""} />
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {canManage ? (
            <Card>
              <SectionHeading>Details and rights</SectionHeading>
              <AssetDetailsForm asset={a} />
            </Card>
          ) : (
            <Card>
              <SectionHeading>Rights</SectionHeading>
              <p className="text-text-secondary">{a.attribution ?? "No attribution recorded."}</p>
            </Card>
          )}

          {canManage && a.status !== "removed" && a.kind !== "captions" ? (
            <Card>
              <SectionHeading description="Moves every use to another ready file of the same kind, then removes this one.">Replace</SectionHeading>
              {replacements.length ? (
                <form action={replaceAssetAction} className="space-y-3">
                  <input type="hidden" name="id" value={a.id} />
                  <label htmlFor="replacement" className="block font-semibold">
                    Replacement file
                  </label>
                  <select id="replacement" name="replacement" required className="min-h-12 w-full rounded-control border border-border-strong bg-surface px-3">
                    <option value="">Choose a file…</option>
                    {replacements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                  {a.kind === "audio" || a.kind === "video" ? (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="move_captions" className="size-5 accent-primary" /> Keep these captions (same timing)
                    </label>
                  ) : null}
                  <p className="text-meta text-text-secondary">Public approval isn&apos;t copied: approve the replacement separately if it should be public.</p>
                  <SubmitButton variant="secondary" pendingText="Replacing…">
                    Replace everywhere
                  </SubmitButton>
                </form>
              ) : (
                <p className="text-text-secondary">Upload the new version first; it will then appear here.</p>
              )}
            </Card>
          ) : null}

          {canManage && a.status !== "removed" ? (
            <Card>
              <SectionHeading>Remove</SectionHeading>
              {a.usage.length ? (
                <p className="text-text-secondary">Remove it from the content that uses it, or replace it, first.</p>
              ) : (
                <ConfirmDialog
                  trigger="Remove file"
                  title="Remove this file?"
                  confirmLabel="Remove"
                  formAction={removeAssetAction}
                  hidden={{ id: a.id }}
                >
                  The stored file and its captions are deleted. Links already open on someone&apos;s screen stop working within 30 minutes.
                </ConfirmDialog>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
