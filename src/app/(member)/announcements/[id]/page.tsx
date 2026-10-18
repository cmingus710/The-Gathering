/* eslint-disable @next/next/no-img-element -- signed Supabase Storage URL */
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownBody } from "@/components/announcements/markdown-body";
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
      <Link href="/announcements" className="mb-6 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary underline-offset-2 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All announcements
      </Link>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {announcement.pinned ? <PinnedBadge /> : null}
        {announcement.publish_at ? (
          <time dateTime={announcement.publish_at} className="text-text-secondary">
            {formatDate(announcement.publish_at, settings.timezone)}
          </time>
        ) : null}
      </div>
      <h1 className="font-serif text-[2rem] font-semibold leading-tight">{announcement.title}</h1>
      <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-full bg-brand-gold" />
      {announcement.imageUrl ? (
        <img src={announcement.imageUrl} alt={announcement.image_alt ?? ""} className="mt-6 w-full rounded-card bg-surface-muted object-cover" />
      ) : null}
      <MarkdownBody source={announcement.body} className="mt-6 text-[1.075rem]" />
    </article>
  );
}
