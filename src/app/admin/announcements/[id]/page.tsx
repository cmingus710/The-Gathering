import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { withImageUrls, type Announcement } from "@/lib/announcements/queries";
import { effectiveStatus } from "@/lib/announcements/status";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { timeZoneLabel, utcToZonedLocal } from "@/lib/time";
import { AnnouncementForm } from "../announcement-form";
import { AnnouncementStatusControls } from "../status-controls";

export const metadata: Metadata = { title: "Edit announcement" };

const SAVED: Record<string, string> = {
  save_draft: "Draft saved.",
  schedule: "Scheduled. It will appear automatically at the publish time.",
  publish_now: "Published. Members can see it now.",
  update: "Changes saved.",
  archived: "Archived. It's no longer visible to anyone but administrators.",
  restored: "Moved back to drafts.",
};

export default async function EditAnnouncementPage({ params, searchParams }: PageProps<"/admin/announcements/[id]">) {
  const { id } = await params;
  await requireCapability(CAPABILITIES.announcementsManage, `/admin/announcements/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await requireClient();
  const [{ settings }, sp] = await Promise.all([getChurchSettings(), searchParams]);
  const { data } = await supabase
    .from("announcements")
    .select("id, title, body, image_path, image_alt, status, visibility, pinned, publish_at, expires_at, created_at, updated_at")
    .eq("id", id)
    .maybeSingle<Announcement>();
  if (!data) notFound();
  const [a] = await withImageUrls(supabase, [data]);
  const effective = effectiveStatus(a);
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;

  return (
    <>
      <Link href="/admin/announcements" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Announcements
      </Link>
      <PageHeader title="Edit announcement" actions={<AnnouncementStatusControls id={a.id} archived={effective === "archived"} canUnpublish={effective !== "draft"} />} />
      {saved ? <Alert tone="success" title={saved} className="mb-6" /> : null}
      {effective === "archived" ? (
        <Alert tone="info" title="This announcement is archived" className="mb-6" live={false}>
          Restore it as a draft to edit or publish it again.
        </Alert>
      ) : (
        <AnnouncementForm
          key={a.updated_at}
          timeZoneLabel={`Church time (${timeZoneLabel(settings.timezone)})`}
          initial={{
            id: a.id,
            title: a.title,
            body: a.body,
            visibility: a.visibility,
            pinned: a.pinned,
            publishAt: utcToZonedLocal(a.publish_at, settings.timezone),
            expiresAt: utcToZonedLocal(a.expires_at, settings.timezone),
            imageAlt: a.image_alt ?? "",
            imageUrl: a.imageUrl,
            effective,
          }}
        />
      )}
    </>
  );
}
