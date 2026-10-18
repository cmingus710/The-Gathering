import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { timeZoneLabel } from "@/lib/time";
import { AnnouncementForm } from "../announcement-form";

export const metadata: Metadata = { title: "New announcement" };

export default async function NewAnnouncementPage() {
  await requireCapability(CAPABILITIES.announcementsManage, "/admin/announcements/new");
  const { settings } = await getChurchSettings();
  return (
    <>
      <Link href="/admin/announcements" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Announcements
      </Link>
      <PageHeader title="New announcement" />
      <AnnouncementForm
        timeZoneLabel={`Church time (${timeZoneLabel(settings.timezone)})`}
        initial={{
          title: "",
          body: "",
          visibility: "members",
          pinned: false,
          publishAt: "",
          expiresAt: "",
          imageAlt: "",
          imageUrl: null,
          effective: "draft",
        }}
      />
    </>
  );
}
