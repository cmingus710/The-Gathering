import { Megaphone } from "lucide-react";
import type { Metadata } from "next";
import { AnnouncementFeedItem } from "@/components/announcements/announcement-card";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { listLiveAnnouncements, type AnnouncementWithImage } from "@/lib/announcements/queries";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  await requireApprovedMember("/announcements");
  const { settings } = await getChurchSettings();
  const supabase = await requireClient();
  let announcements: AnnouncementWithImage[] = [];
  let failed = false;
  try {
    announcements = await listLiveAnnouncements(supabase, { limit: 50 });
  } catch {
    failed = true;
  }
  return (
    <>
      <PageHeader title="Announcements" description="News and updates from the church." />
      {failed ? (
        <Alert tone="error" title="Announcements couldn't be loaded right now." />
      ) : announcements.length ? (
        <div className="divide-y divide-border">
          {announcements.map((a) => (
            <AnnouncementFeedItem key={a.id} announcement={a} churchName={settings.churchName} iconUrl={settings.iconUrl} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Megaphone className="size-8" aria-hidden="true" />} title="No announcements right now">
          New announcements from the church will appear here.
        </EmptyState>
      )}
    </>
  );
}
