/* eslint-disable @next/next/no-img-element -- short-lived signed URLs */
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { SegmentedTrack, segmentClass } from "@/components/ui/segmented";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { signPaths } from "@/lib/media/storage";
import type { Photo } from "@/lib/media/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { resolveReportAction } from "../actions";

export const metadata: Metadata = { title: "Photo reports" };

const REASON: Record<string, string> = {
  removal_request: "Removal request (for example, the person is in the photo)",
  privacy: "Privacy",
  minor: "Shows a child",
  inappropriate: "Inappropriate",
  other: "Other",
};

type Report = {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  resolution: string | null;
  reporter: string | null;
  album: { id: string; title: string };
  photo: Photo;
};

export default async function PhotoReportsPage({ searchParams }: PageProps<"/admin/gallery/reports">) {
  await requireCapability(CAPABILITIES.galleryModerate, "/admin/gallery/reports");
  const sp = await searchParams;
  const status = sp.status === "actioned" || sp.status === "dismissed" ? sp.status : "open";
  const supabase = await requireClient();
  const [{ settings }, { data, error }] = await Promise.all([getChurchSettings(), supabase.rpc("media_admin_photo_reports", { p_status: status })]);
  const reports = (data ?? []) as Report[];
  const urls = await signPaths(supabase, reports.map((r) => r.photo.thumb_path));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/gallery" className="hover:underline">
            Gallery
          </Link>
        }
        title="Photo reports and removal requests"
        description="Act quickly on removal requests. To take a photo down, open its album and remove or hide it, then mark the report actioned."
      />
      {sp.saved ? <Alert tone="success" title="Report updated." className="mb-6" /> : null}
      {error ? <Alert tone="error" title="Reports couldn't be loaded." className="mb-6" /> : null}
      <SegmentedTrack label="Report status" className="mb-4">
        {(["open", "actioned", "dismissed"] as const).map((s) => (
          <Link key={s} href={`?status=${s}`} className={segmentClass(status === s)} aria-current={status === s ? "page" : undefined}>
            {s === "open" ? "Open" : s === "actioned" ? "Actioned" : "Dismissed"}
          </Link>
        ))}
      </SegmentedTrack>
      {reports.length ? (
        <ul className="space-y-4">
          {reports.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-wrap gap-4">
                {r.photo.thumb_path && urls.get(r.photo.thumb_path) ? (
                  <img src={urls.get(r.photo.thumb_path)} alt={r.photo.alt_text} className="size-32 rounded-tile object-cover" />
                ) : (
                  <div className="flex size-32 items-center justify-center rounded-tile bg-surface-muted text-meta text-text-secondary">{r.photo.status}</div>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">{REASON[r.reason] ?? r.reason}</p>
                  <p className="text-meta text-text-secondary">
                    {r.reporter ?? "Former member"} · {formatDateTime(r.created_at, settings.timezone)} ·{" "}
                    <Link href={`/admin/gallery/${r.album.id}#photo-${r.photo.id}`} className="font-semibold text-primary hover:underline">
                      {r.album.title}
                    </Link>
                  </p>
                  {r.details ? <p className="whitespace-pre-line">{r.details}</p> : null}
                  {r.resolution ? <p className="text-meta text-text-secondary">Outcome: {r.resolution}</p> : null}
                  {status === "open" ? (
                    <form action={resolveReportAction} className="flex flex-wrap items-end gap-2 pt-2">
                      <input type="hidden" name="id" value={r.id} />
                      <div className="min-w-48 flex-1 space-y-1">
                        <label htmlFor={`res-${r.id}`} className="block text-meta font-semibold">
                          Note (moderators only)
                        </label>
                        <input id={`res-${r.id}`} name="resolution" maxLength={1000} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
                      </div>
                      <SubmitButton size="sm" name="status" value="actioned">
                        Mark actioned
                      </SubmitButton>
                      <SubmitButton size="sm" variant="secondary" name="status" value="dismissed">
                        Dismiss
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState glyph="gallery" title={status === "open" ? "No open reports" : "Nothing here"} />
      )}
    </>
  );
}
