"use client";

import { useActionState, useState } from "react";
import { CheckboxField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import {
  ALL_OFF_TEXT,
  ALL_ON_TEXT,
  MEMBERSHIP_APPROVAL_TYPE,
  channelAllows,
  typeLabel,
  type ChannelSettings,
  type NotificationChannel,
} from "@/lib/notifications/channels";
import { saveNotificationChannelAction } from "./actions";

const NAMES: Record<NotificationChannel, { title: string; all: string; individual: string; provider: string }> = {
  push: {
    title: "Push notifications",
    all: "All push notifications",
    individual: "Push notification types",
    provider: "Push isn't set up for this site yet, so no push notifications are sent. These settings take effect once it is.",
  },
  email: {
    title: "Email notifications",
    all: "All email notifications",
    individual: "Email notification types",
    provider: "Email isn't set up for this site yet, so no notification emails are sent. These settings take effect once it is.",
  },
};

export function ChannelForm({
  channel,
  settings,
  providerConfigured,
  membershipAlertsEnabled,
}: {
  channel: NotificationChannel;
  settings: ChannelSettings;
  providerConfigured: boolean;
  membershipAlertsEnabled: boolean;
}) {
  const [state, action] = useActionState(saveNotificationChannelAction, initialFormState);
  // Re-mount after a save so the boxes show the stored values.
  const stored = `${settings.all}:${settings.disabled.join(",")}`;
  return <ChannelFormBody key={stored} {...{ channel, settings, providerConfigured, membershipAlertsEnabled, state, action }} />;
}

function ChannelFormBody({
  channel,
  settings,
  providerConfigured,
  membershipAlertsEnabled,
  state,
  action,
}: {
  channel: NotificationChannel;
  settings: ChannelSettings;
  providerConfigured: boolean;
  membershipAlertsEnabled: boolean;
  state: FormState;
  action: (formData: FormData) => void;
}) {
  const [all, setAll] = useState(settings.all);
  const names = NAMES[channel];
  // Membership approval alerts have their own switch further down the page.
  const types = settings.types.filter((t) => t !== MEMBERSHIP_APPROVAL_TYPE);
  const coversMembership = settings.types.includes(MEMBERSHIP_APPROVAL_TYPE);
  const statusId = `${channel}-all-status`;

  return (
    <form action={action} className="space-y-4" aria-labelledby={`${channel}-channel-heading`}>
      <h3 id={`${channel}-channel-heading`} className="text-lg font-bold">
        {names.title}
      </h3>
      <FormMessage state={state} />
      {providerConfigured ? null : <p className="text-meta text-text-secondary">{names.provider}</p>}
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="types" value={types.join(",")} />
      <div className="rounded-card border border-border p-4">
        <CheckboxField
          name="all"
          id={`${channel}-all`}
          label={names.all}
          checked={all}
          onChange={(e) => setAll(e.currentTarget.checked)}
          aria-describedby={statusId}
        />
        <p id={statusId} role="status" className="mt-2 text-meta text-text-secondary">
          {all ? ALL_ON_TEXT : ALL_OFF_TEXT}
        </p>
      </div>
      <fieldset disabled={all} aria-describedby={statusId} className="space-y-2 disabled:opacity-60">
        <legend className="mb-2 font-semibold">{names.individual}</legend>
        {types.map((t) => (
          <CheckboxField key={t} name={`type.${t}`} id={`${channel}-type-${t}`} label={typeLabel(t)} defaultChecked={channelAllows({ all: false, disabled: settings.disabled }, t)} />
        ))}
        {coversMembership ? (
          <p className="pt-1 text-meta text-text-secondary">
            {typeLabel(MEMBERSHIP_APPROVAL_TYPE)}: {all ? "on, through All email notifications" : membershipAlertsEnabled ? "on" : "off"}. Their own switch is further down this page.
          </p>
        ) : null}
      </fieldset>
      <SubmitButton variant="secondary" pendingText="Saving…">
        Save {channel === "push" ? "push" : "email"} settings
      </SubmitButton>
    </form>
  );
}
