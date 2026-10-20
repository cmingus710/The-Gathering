import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { AnnouncementList } from "@/components/youth/sections";
import { requireYouthArea } from "@/lib/auth/viewer";
import { youthRead } from "@/lib/youth/queries";
import type { Announcement } from "@/lib/youth/types";

export const metadata: Metadata = { title: "Youth announcements" };

export default async function AnnouncementsPage() {
  await requireYouthArea("/youth/announcements");
  const { data, failed } = await youthRead<Announcement[]>("youth_announcements", { p_group: null });
  return (
    <>
      <PageHeader eyebrow="Youth & Families" title="Youth announcements" description="Announcements for the youth groups you or your children belong to." />
      {failed || !data ? <Alert tone="error" title="Announcements couldn't be loaded right now." /> : <AnnouncementList items={data} empty="No youth announcements right now." />}
    </>
  );
}
