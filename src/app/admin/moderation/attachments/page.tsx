import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { formatBytes } from "@/lib/media/files";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { runAttachmentCleanupAction } from "./actions";

export const metadata: Metadata = { title: "Attachment cleanup" };

type Item = { id: string; kind: "image" | "video"; status: string; size: number; created_at: string; updated_at: string; uploads: string[]; media: string[] };
type Candidates = { hours: number; abandoned: Item[]; removed: Item[]; orphans: Array<{ bucket: string; path: string; created_at: string }> };

/**
 * Discussion photo and video files that can be deleted: uploads never
 * posted, files of deleted posts that are still stored, and stored files no
 * attachment refers to. Nothing is deleted automatically, and no names,
 * text, or images are shown here.
 */
export default async function AttachmentCleanupPage({ searchParams }: PageProps<"/admin/moderation/attachments">) {
  await requireAnyCapability([CAPABILITIES.communityModerate, CAPABILITIES.mediaManage], "/admin/moderation/attachments");
  const sp = await searchParams;
  const supabase = await requireClient();
  const [{ settings }, cand] = await Promise.all([getChurchSettings(), supabase.rpc("community_mod_attachment_cleanup")]);
  const c = (cand.data ?? { hours: 24, abandoned: [], removed: [], orphans: [] }) as Candidates;
  const tz = settings.timezone;
  const total = c.abandoned.length + c.removed.length + c.orphans.length;
  const label = (i: Item) => `${i.kind === "video" ? "Video" : "Photo"} (${i.status})`;
  const row = (value: string, title: string, detail: string) => (
    <li key={value} className="flex items-start gap-3 px-4 py-3">
      <input type="checkbox" name="pick" value={value} id={value} defaultChecked className="mt-1 size-5 accent-primary" />
      <label htmlFor={value} className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block break-all text-meta text-text-secondary">{detail}</span>
      </label>
    </li>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/moderation" className="hover:underline">
            Moderation
          </Link>
        }
        title="Attachment cleanup"
        description="Discussion photo and video files that can be deleted. Nothing here is removed automatically, and posted photos and videos are never listed."
      />
      {typeof sp.saved === "string" ? <Alert tone="success" title={`Cleaned up ${Number(sp.saved) || 0} item(s).`} className="mb-6" /> : null}
      {typeof sp.error === "string" ? <Alert tone="error" title={sp.error === "unavailable" ? "The community service is unavailable." : sp.error.slice(0, 200)} className="mb-6" /> : null}
      {cand.error ? <Alert tone="error" title="Cleanup candidates couldn't be loaded." className="mb-6" /> : null}

      <form action={runAttachmentCleanupAction} className="space-y-6">
        <Card>
          <SectionHeading description={`Uploads that were never posted, untouched for ${c.hours} hours (Media settings → abandoned uploads).`}>Abandoned uploads</SectionHeading>
          {c.abandoned.length ? (
            <ul className="divide-y divide-border">
              {c.abandoned.map((i) => row(`attachment:${i.id}`, label(i), `${formatBytes(i.size)} · started ${formatDateTime(i.created_at, tz)}`))}
            </ul>
          ) : (
            <p className="text-text-secondary">None.</p>
          )}
        </Card>
        <Card>
          <SectionHeading description="From deleted posts, or removed before posting, whose stored files are still there.">Removed files</SectionHeading>
          {c.removed.length ? (
            <ul className="divide-y divide-border">
              {c.removed.map((i) => row(`attachment:${i.id}`, label(i), `${i.uploads.length + i.media.length} stored file(s) · removed ${formatDateTime(i.updated_at, tz)}`))}
            </ul>
          ) : (
            <p className="text-text-secondary">None.</p>
          )}
        </Card>
        <Card>
          <SectionHeading description="Files under community/ more than a day old that no attachment refers to.">Unreferenced files</SectionHeading>
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
