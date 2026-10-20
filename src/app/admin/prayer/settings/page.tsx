import type { Metadata } from "next";
import { PrayerSettingsForm } from "@/components/prayer/settings-form";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { PrayerSettings } from "@/lib/prayer/types";

export const metadata: Metadata = { title: "Prayer settings" };

/** Church settings managers: guidance and retention. No request content is reachable here. */
export default async function PrayerSettingsPage() {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/prayer/settings");
  const settings = await tryCommunityRpc<PrayerSettings>("prayer_admin_settings");
  return (
    <>
      <PageHeader title="Prayer settings" description="Member guidance and retention policy for prayer and care. Managing settings doesn't give access to any request." />
      {settings ? <div className="max-w-3xl"><PrayerSettingsForm initial={settings} /></div> : <Alert tone="error" title="Prayer settings couldn't be loaded." />}
    </>
  );
}
