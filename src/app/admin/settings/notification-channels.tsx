import { Alert } from "@/components/ui/alert";
import { Card, SectionHeading } from "@/components/ui/card";
import { getPushConfig } from "@/lib/community/server";
import { getEmailConfig } from "@/lib/env";
import type { NotificationChannelsAdmin } from "@/lib/notifications/channels";
import { ChannelForm } from "./notification-channels-forms";

/**
 * "Notifications" on Church settings: which notification types the church
 * allows by push and by email, each with an "All" override. Shown only to
 * settings.manage holders (the page checks; the database functions check
 * again and refuse everyone else).
 */
export function NotificationChannelsSection({ admin }: { admin: NotificationChannelsAdmin | null }) {
  return (
    <Card>
      <SectionHeading id="notifications-heading">Notifications</SectionHeading>
      <p className="mb-6 text-text-secondary">
        Choose which kinds of notifications the church sends by push and by email. Each member still chooses what they receive in their own
        notification settings, and quiet hours, mutes, and device permissions still apply. Sign-in emails, event registration emails, and giving
        receipts aren&apos;t affected.
      </p>
      {!admin ? (
        <Alert tone="error" title="Notification settings couldn't be loaded">
          Try again in a moment. Nothing was changed.
        </Alert>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <ChannelForm
            channel="push"
            settings={admin.push}
            providerConfigured={!!getPushConfig()}
            membershipAlertsEnabled={admin.membership_alerts_enabled}
          />
          <ChannelForm
            channel="email"
            settings={admin.email}
            providerConfigured={!!getEmailConfig()}
            membershipAlertsEnabled={admin.membership_alerts_enabled}
          />
        </div>
      )}
    </Card>
  );
}
