import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ToggleForm } from "@/components/community/toggle-form";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { allTimeZones } from "@/app/admin/events/series";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { getPushConfig } from "@/lib/community/server";
import type { MySettings } from "@/lib/community/types";
import { muteAction } from "../../community/actions";
import { PrefsForm, PushDevices, QuietHoursForm } from "../notification-forms";

export const metadata: Metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  await requireApprovedMember("/notifications/settings");
  const settings = await tryCommunityRpc<MySettings>("community_my_settings");
  const push = getPushConfig();
  return (
    <>
      <Link href="/notifications" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Notifications
      </Link>
      <PageHeader title="Notification settings" description="Choose what reaches you, where, and when. Giving receipts and event emails have their own settings." />
      {!settings ? (
        <Alert tone="error" title="Settings couldn't be loaded right now." />
      ) : (
        <div className="space-y-10">
          <section aria-labelledby="prefs-heading">
            <SectionHeading id="prefs-heading">What you hear about</SectionHeading>
            <Card>
              <PrefsForm prefs={settings.prefs} pushAvailable={!!push} />
            </Card>
          </section>
          <section aria-labelledby="quiet-heading">
            <SectionHeading id="quiet-heading">Quiet hours</SectionHeading>
            <Card>
              <QuietHoursForm settings={settings} timezones={allTimeZones([settings.effective_timezone])} />
            </Card>
          </section>
          <section aria-labelledby="push-heading">
            <SectionHeading id="push-heading">Push notifications</SectionHeading>
            <Card>
              <PushDevices publicKey={push?.publicKey ?? null} devices={settings.push_devices} />
            </Card>
          </section>
          <section aria-labelledby="mutes-heading">
            <SectionHeading id="mutes-heading">Muted</SectionHeading>
            {settings.mutes.length ? (
              <ul className="space-y-2">
                {settings.mutes.map((m) => (
                  <li key={`${m.type}:${m.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-5 py-3">
                    <span>
                      <span className="block font-semibold">{m.label ?? "No longer available"}</span>
                      <span className="block text-sm text-text-secondary">{m.type === "thread" ? "Discussion" : m.type === "group" ? "Group" : "Conversation"}</span>
                    </span>
                    <ToggleForm action={muteAction} hidden={{ type: m.type, id: m.id, on: "false" }} label="Unmute" pressed={false} description={m.label ?? "this item"} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-card bg-surface px-5 py-4 text-text-secondary">Nothing is muted. Use Mute on a discussion, group, or conversation.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
