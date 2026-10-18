import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { BrandAssetForm } from "./branding-form";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Church settings" };

const COMMON_ZONES = ["America/Chicago", "America/New_York", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export default async function SettingsPage() {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/settings");
  const { settings, available } = await getChurchSettings();
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIMEZONE];
  const timeZones = [...COMMON_ZONES, ...all.filter((z) => !COMMON_ZONES.includes(z))];
  if (!timeZones.includes(settings.timezone)) timeZones.unshift(settings.timezone);

  return (
    <>
      <PageHeader title="Church settings" description="Public details shown on the welcome page and in the app. Leave anything blank until it's confirmed." />
      {!available ? (
        <Alert tone="error" title="Settings couldn't be loaded" className="mb-6">
          The settings service isn&apos;t reachable, so saving is disabled until it is.
        </Alert>
      ) : (
        <div className="space-y-8">
          <SettingsForm settings={settings} timeZones={timeZones} />
          <Card>
            <SectionHeading>Branding</SectionHeading>
            <p className="mb-6 text-text-secondary">
              The approved logo and icon are used by default. Replacements are checked for file type and size before saving.
              Colors are fixed by the approved palette. Home Screen icons use the approved artwork and are updated with a new
              release.
            </p>
            <div className="grid gap-8 lg:grid-cols-2">
              <BrandAssetForm asset="logo" currentUrl={settings.logoUrl} isDefault={!settings.logoPath} />
              <BrandAssetForm asset="icon" currentUrl={settings.iconUrl} isDefault={!settings.iconPath} />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
