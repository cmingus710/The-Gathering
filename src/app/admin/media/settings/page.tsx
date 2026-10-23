import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { MediaSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Media limits" };

export default async function MediaSettingsPage() {
  const viewer = await requireAnyCapability([CAPABILITIES.mediaManage, CAPABILITIES.galleryModerate, CAPABILITIES.podcastsManage], "/admin/media/settings");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_admin_settings");
  const can = (c: (typeof CAPABILITIES)[keyof typeof CAPABILITIES]) => viewer.capabilities.has(c);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/media" className="hover:underline">
            Media library
          </Link>
        }
        title="Media limits"
        description="Upload sizes, Media gallery limits, and how often external podcast feeds refresh."
      />
      {error || !data ? (
        <Alert tone="error" title="Settings couldn't be loaded." />
      ) : (
        <MediaSettingsForm
          values={data as Record<string, number>}
          sections={{ library: can(CAPABILITIES.mediaManage), gallery: can(CAPABILITIES.galleryModerate), feeds: can(CAPABILITIES.podcastsManage) }}
        />
      )}
    </>
  );
}
