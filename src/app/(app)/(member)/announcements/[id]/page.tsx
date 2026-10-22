/* eslint-disable @next/next/no-img-element -- signed Supabase Storage URL */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarkdownBody } from "@/components/announcements/markdown-body";
import { BackLink } from "@/components/ui/back-link";
import { PinnedBadge } from "@/components/ui/badge";
import { getLiveAnnouncement } from "@/lib/announcements/queries";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Announcement" };

export default async function AnnouncementPage({ params }: PageProps<"/announcements/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/announcements/${id}`);
  const { settings } = await getChurchSettings();
  const announcement = await getLiveAnnouncement(await requireClient(), id);
  if (!announcement) notFound();

  return (
    <article className="max-w-2xl">
      <BackLink route="/announcements/[id]" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {announcement.pinned ? <PinnedBadge /> : null}
        {announcement.publish_at ? (
          <time dateTime={announcement.publish_at} className="text-text-secondary">
            {formatDate(announcement.publish_at, settings.timezone)}
          </time>
        ) : null}
      </div>
      <h1 className="font-display text-[2rem] font-semibold leading-tight">{announcement.title}</h1>
            {announcement.imageUrl ? (
        <img src={announcement.imageUrl} alt={announcement.image_alt ?? ""} className="mt-6 w-full rounded-card border border-border bg-surface-muted object-cover" />
      ) : null}
      <MarkdownBody source={announcement.body} className="mt-6 text-[1.075rem]" />
    </article>
  );
}
