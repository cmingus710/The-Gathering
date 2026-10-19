"use client";

import { Copy, KeyRound, RefreshCw } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { revokeFeedAction, rotateFeedAction, setRemindersAction } from "../actions";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="block text-sm font-semibold">
        {label}
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="mt-1 block min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 font-mono text-sm" />
      </label>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1"
        icon={<Copy className="size-4" aria-hidden="true" />}
        onClick={async () => {
          await navigator.clipboard?.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function FeedControls({ active, siteUrl }: { active: boolean; siteUrl: string }) {
  const [rotate, rotateForm] = useActionState(rotateFeedAction, initialFormState);
  const [revoke, revokeForm] = useActionState(revokeFeedAction, initialFormState);
  const state = [rotate, revoke].find((s) => s.status !== "idle") ?? initialFormState;
  const token = rotate.status === "success" && revoke.status === "idle" ? rotate.values?.token : undefined;
  const https = token ? `${siteUrl}/api/calendar/feed/${token}` : "";
  const webcal = https.replace(/^https?:/, "webcal:");

  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      {token ? (
        <div className="space-y-3 rounded-card border border-primary/50 bg-primary-soft p-4">
          <CopyField label="Subscription link (Google Calendar: Other calendars → From URL)" value={https} />
          <a href={webcal} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
            Subscribe on this device (Apple Calendar / Outlook)
          </a>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <form action={rotateForm}>
          <SubmitButton variant={active ? "secondary" : "primary"} pendingText="Creating…" icon={active ? <RefreshCw className="size-4" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}>
            {active ? "Create a new link" : "Create my calendar link"}
          </SubmitButton>
        </form>
        {active || token ? (
          <ConfirmDialog trigger="Turn off my link" title="Turn off your calendar link?" confirmLabel="Turn off" formAction={revokeForm}>
            Calendars subscribed with your current link will stop updating. You can create a new link at any time.
          </ConfirmDialog>
        ) : null}
      </div>
      {active && !token ? (
        <p className="text-sm text-text-secondary">For your security the link is only shown when it&apos;s created. Creating a new link turns the old one off.</p>
      ) : null}
    </div>
  );
}

export function RemindersForm({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState(setRemindersAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <CheckboxField
        name="reminders"
        label="Email me reminders before events I'm registered for"
        hint="Confirmations, waitlist updates, and change or cancellation notices are always sent."
        defaultChecked={enabled}
      />
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        Save
      </SubmitButton>
    </form>
  );
}
