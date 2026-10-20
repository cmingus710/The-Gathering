import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { formatBytes } from "@/lib/media/files";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { runCleanupAction } from "../actions";

export const metadata: Metadata = { title: "Storage and cleanup" };

type Candidates = {
  abandoned: Array<{ id: string; title: string; status: string; created_at: string; paths: string[] }>;
  removed: Array<{ id: string; title: string; removed_at: string; paths: string[] }>;
  photos: Array<{ id: string; status: string; updated_at: string; uploads: string[]; media: string[] }>;
  orphans: Array<{ bucket: string; path: string; created_at: string }>;
};

export default async function CleanupPage({ searchParams }: PageProps<"/admin/media/cleanup">) {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media/cleanup");
  const sp = await searchParams;
  const supabase = await requireClient();
  const [{ settings }, cand, storage] = await Promise.all([getChurchSettings(), supabase.rpc("media_admin_cleanup_candidates"), supabase.rpc("media_admin_storage")]);
  const c = (cand.data ?? { abandoned: [], removed: [], photos: [], orphans: [] }) as Candidates;
  const usage = storage.data as {
    quota_mb: number;
    buckets: Array<{ bucket: string; objects: number; bytes: number }>;
    by_kind: Array<{ kind: string; files: number; bytes: number }>;
    gallery: { photos: number; bytes: number };
  } | null;
  const tz = settings.timezone;
  const total = c.abandoned.length + c.removed.length + c.photos.length + c.orphans.length;
  const row = (value: string, label: string, detail: string) => (
    <li key={value} className="flex items-start gap-3 px-4 py-3">
      <input type="checkbox" name="pick" value={value} id={value} defaultChecked className="mt-1 size-5 accent-primary" />
      <label htmlFor={value} className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-meta text-text-secondary">{detail}</span>
      </label>
    </li>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/media" className="hover:underline">
            Media library
          </Link>
        }
        title="Storage and cleanup"
        description="Review what can be deleted. Nothing here is removed automatically; existing content is never touched."
      />
      {typeof sp.saved === "string" ? <Alert tone="success" title={`Cleaned up ${Number(sp.saved) || 0} item(s).`} className="mb-6" /> : null}
      {typeof sp.error === "string" ? <Alert tone="error" title={sp.error === "unavailable" ? "The media service is unavailable." : sp.error.slice(0, 200)} className="mb-6" /> : null}

      {usage ? (
        <Card className="mb-6">
          <SectionHeading description={`Your limit for the usage report: ${formatBytes(usage.quota_mb * 1024 * 1024)}.`}>Usage</SectionHeading>
          <dl className="grid gap-3 sm:grid-cols-2">
            {usage.buckets.map((b) => (
              <div key={b.bucket} className="rounded-tile bg-surface-muted px-4 py-3">
                <dt className="text-meta text-text-secondary">{b.bucket === "media" ? "Served files" : "Photo uploads waiting (quarantine)"}</dt>
                <dd className="text-lg font-semibold">
                  {formatBytes(Number(b.bytes))} · {b.objects} file{b.objects === 1 ? "" : "s"}
                </dd>
              </div>
            ))}
            {usage.by_kind.map((k) => (
              <div key={k.kind} className="rounded-tile border border-border px-4 py-3">
                <dt className="text-meta capitalize text-text-secondary">{k.kind}</dt>
                <dd className="font-semibold">
                  {formatBytes(Number(k.bytes))} · {k.files}
                </dd>
              </div>
            ))}
            <div className="rounded-tile border border-border px-4 py-3">
              <dt className="text-meta text-text-secondary">Gallery photos</dt>
              <dd className="font-semibold">
                {formatBytes(Number(usage.gallery.bytes))} · {usage.gallery.photos}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-meta text-text-secondary">
            Supabase&apos;s Free plan includes 1 GB of storage and 5 GB of downloads (egress) a month for the whole project; Pro includes 100 GB and 250 GB.
            Audio and especially video use most of it. See docs/media-guide.md for costs.
          </p>
        </Card>
      ) : null}

      <form action={runCleanupAction} className="space-y-6">
        <Card>
          <SectionHeading description="Uploads never finished, or files that failed processing.">Abandoned uploads</SectionHeading>
          {c.abandoned.length ? (
            <ul className="divide-y divide-border">{c.abandoned.map((a) => row(`asset:${a.id}`, a.title, `${a.status} · started ${formatDateTime(a.created_at, tz)}`))}</ul>
          ) : (
            <p className="text-text-secondary">None.</p>
          )}
        </Card>
        <Card>
          <SectionHeading description="Removed or replaced files whose stored copies are still there.">Removed files</SectionHeading>
          {c.removed.length ? (
            <ul className="divide-y divide-border">{c.removed.map((a) => row(`asset:${a.id}`, a.title, `removed ${formatDateTime(a.removed_at, tz)}`))}</ul>
          ) : (
            <p className="text-text-secondary">None.</p>
          )}
        </Card>
        <Card>
          <SectionHeading description="Rejected or removed photos, and photo uploads that never finished.">Gallery files</SectionHeading>
          {c.photos.length ? (
            <ul className="divide-y divide-border">
              {c.photos.map((p) => row(`photo:${p.id}`, `Photo (${p.status})`, `${p.uploads.length + p.media.length} stored file(s) · ${formatDateTime(p.updated_at, tz)}`))}
            </ul>
          ) : (
            <p className="text-text-secondary">None.</p>
          )}
        </Card>
        <Card>
          <SectionHeading description="Stored files more than a day old that no record refers to.">Unreferenced files</SectionHeading>
          {c.orphans.length ? (
            <ul className="divide-y divide-border">{c.orphans.map((o) => row(`orphan:${o.bucket}:${o.path}`, o.path, `${o.bucket} · ${formatDateTime(o.created_at, tz)}`))}</ul>
          ) : (
            <p className="text-text-secondary">None.</p>
          )}
        </Card>
        {total ? (
          <Card>
            <label className="mb-4 flex items-start gap-3">
              <input type="checkbox" name="confirm" className="mt-1 size-5 accent-primary" />
              <span>I reviewed the selected items. Delete their stored files permanently.</span>
            </label>
            <SubmitButton variant="danger" pendingText="Deleting…">
              Delete selected
            </SubmitButton>
          </Card>
        ) : null}
      </form>
    </>
  );
}
