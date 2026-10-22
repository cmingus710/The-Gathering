"use client";

import { CalendarPlus, CircleCheck, Download, UserPlus } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { RsvpBadge } from "@/components/events/event-badges";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { RsvpState } from "@/lib/events/types";
import { cancelRsvpAction, rsvpAction } from "../actions";

type Props = {
  occurrenceId: string;
  state: RsvpState;
  position: number | null;
  spotsLeft: number | null;
  canRegister: boolean;
  signedIn: boolean;
  googleUrl: string;
  canceled: boolean;
};

export function RsvpPanel({ occurrenceId, state, position, spotsLeft, canRegister, signedIn, googleUrl, canceled }: Props) {
  const [rsvp, rsvpForm] = useActionState(rsvpAction, initialFormState);
  const [cancel, cancelForm] = useActionState(cancelRsvpAction, initialFormState);
  const message = [cancel, rsvp].find((s) => s.status !== "idle") ?? initialFormState;
  const hidden = { occurrenceId };

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-bold">Registration</h2>
        <FormMessage state={message} />
        <div aria-live="polite">
          {state === "none" ? <p className="text-text-secondary">No registration needed. Just come along.</p> : null}
          {state === "started" || state === "past" ? <p className="text-text-secondary">This event has already started.</p> : null}
          {state === "canceled" ? <RsvpBadge state="canceled" /> : null}
          {["confirmed", "waitlisted", "full", "waitlist", "closed"].includes(state) ? <RsvpBadge state={state} position={position} /> : null}
          {state === "waitlisted" ? (
            <p className="mt-2 text-meta text-text-secondary">
              If a place opens, you&apos;ll be registered automatically (your place is then confirmed) and we&apos;ll email you.
            </p>
          ) : null}
          {state === "open" && spotsLeft !== null ? (
            <p className="text-meta text-text-secondary">
              {spotsLeft} {spotsLeft === 1 ? "place" : "places"} left
            </p>
          ) : null}
        </div>

        {(state === "open" || state === "waitlist") && canRegister ? (
          <form action={rsvpForm} className="space-y-2">
            <input type="hidden" name="occurrenceId" value={occurrenceId} />
            <SubmitButton pendingText="Registering…" icon={<UserPlus className="size-4" aria-hidden="true" />}>
              {state === "waitlist" ? "Join the waitlist" : "Register"}
            </SubmitButton>
            <p className="text-sm text-text-secondary">One place per account. Event organizers can see your name and email address.</p>
          </form>
        ) : null}
        {(state === "open" || state === "waitlist") && !canRegister ? (
          signedIn ? (
            <p className="text-text-secondary">Registration is open to approved members.</p>
          ) : (
            <ButtonLink href={`/sign-in?next=/events/${occurrenceId}`} variant="secondary">
              Sign in to register
            </ButtonLink>
          )
        ) : null}

        {state === "confirmed" || state === "waitlisted" ? (
          <ConfirmDialog
            trigger={state === "waitlisted" ? "Leave the waitlist" : "Cancel my registration"}
            title={state === "waitlisted" ? "Leave the waitlist?" : "Cancel your registration?"}
            confirmLabel={state === "waitlisted" ? "Leave the waitlist" : "Cancel registration"}
            formAction={cancelForm}
            hidden={hidden}
          >
            {state === "confirmed" ? "Your place goes to the next person on the waitlist, if there is one." : "You'll lose your place in line."}
          </ConfirmDialog>
        ) : null}
        {state === "confirmed" ? (
          <p className="flex items-center gap-2 text-meta text-success">
            <CircleCheck className="size-4" aria-hidden="true" /> A confirmation was emailed to you.
          </p>
        ) : null}
      </Card>

      {!canceled ? (
        <Card className="space-y-3">
          <h2 className="font-bold">Add to your calendar</h2>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/events/${occurrenceId}/ics`}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-muted px-4 font-semibold hover:border-border-strong"
            >
              <Download className="size-4" aria-hidden="true" /> Apple / Outlook (.ics)
            </a>
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-muted px-4 font-semibold hover:border-border-strong"
            >
              <CalendarPlus className="size-4" aria-hidden="true" /> Google Calendar<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          <p className="text-sm text-text-secondary">
            These add a copy of the event as it is now; later changes won&apos;t update it. To get updates automatically, subscribe to your
            private calendar under <Link href="/events/calendar" className="font-semibold text-primary underline">Calendar &amp; reminders</Link>.
          </p>
        </Card>
      ) : null}
    </>
  );
}
