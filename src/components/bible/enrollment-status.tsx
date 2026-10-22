import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { leavePlanAction } from "@/app/(member)/bible/actions";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Enrollment } from "@/lib/bible/types";

export type EnrollmentState = "none" | "joined" | "left";

/** Joined only while active; "left" only when an earlier enrollment was left. */
export function enrollmentState(e: Enrollment | null): EnrollmentState {
  return e?.status === "active" ? "joined" : e ? "left" : "none";
}

export const JOIN_EXPLAINER =
  "Anyone can read every day without joining. Joining turns on personal tracking for this plan: marking readings as read, your progress, and catch-up. Reminders are separate and stay off until you turn them on in this plan's settings.";

/**
 * The member's enrollment for a plan, shown the same way on the plan overview
 * and on each day's reading. Opening a page never joins; only the join form
 * does. On the overview `joinForm` is the form itself; elsewhere the call to
 * action links to it.
 */
export function EnrollmentStatus({
  planId,
  enrollment,
  joinable,
  joinForm,
  className,
}: {
  planId: string;
  enrollment: Enrollment | null;
  /** The plan is published, so it can be joined or rejoined. */
  joinable: boolean;
  joinForm?: ReactNode;
  className?: string;
}) {
  const state = enrollmentState(enrollment);
  if (state === "joined" && enrollment) {
    return (
      <Card className={className} aria-label="Your enrollment">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Badge tone="success" icon={<Check className="size-3.5" aria-hidden="true" />}>
              Joined
            </Badge>
            <p className="text-meta text-text-secondary">
              Your reading is tracked for this plan.{" "}
              {enrollment.reminders ? (enrollment.reminders_paused ? "Reminders are paused." : "Reminders are on.") : "Reminders are off."}
            </p>
          </div>
          <ConfirmDialog trigger="Leave" triggerVariant="secondary" title="Leave this plan?" confirmLabel="Leave plan" formAction={leavePlanAction} hidden={{ id: enrollment.id }}>
            Tracking and reminders stop. What you&apos;ve read and your journal entries are kept, and you can rejoin later.
          </ConfirmDialog>
        </div>
      </Card>
    );
  }
  if (!joinable) {
    return state === "left" ? (
      <Card className={className} aria-label="Your enrollment">
        <Badge>Left</Badge>
        <p className="mt-1 text-meta text-text-secondary">This plan can&apos;t be joined right now. What you read before is still here.</p>
      </Card>
    ) : null;
  }
  const heading = state === "left" ? "Rejoin plan" : "Join plan";
  return (
    <Card className={className} id={joinForm ? "join" : undefined} aria-label="Your enrollment">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-title font-semibold">{heading}</h2>
        <Badge>{state === "left" ? "You left this plan" : "Not joined"}</Badge>
      </div>
      <p className="mb-3 max-w-[65ch] text-meta text-text-secondary">
        {state === "left" ? "What you read before is still here and counts again when you rejoin. " : ""}
        {JOIN_EXPLAINER}
      </p>
      {joinForm ?? (
        <ButtonLink href={`/bible/plans/${planId}#join`} size="sm">
          {heading}
        </ButtonLink>
      )}
    </Card>
  );
}
