"use client";

import { LogOut, Send } from "lucide-react";
import { useActionState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import {
  createHouseholdAction,
  inviteAction,
  leaveHouseholdAction,
  renameHouseholdAction,
  respondInvitationAction,
  revokeInvitationAction,
} from "./actions";

const NAME_HINT = "Optional, e.g. “The Rivera household”. Shown in the directory only to members who can see your household.";

export function CreateHouseholdForm() {
  const [state, action] = useActionState(createHouseholdAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField label="Household name" name="displayName" optional maxLength={80} hint={NAME_HINT} error={state.fieldErrors?.displayName} />
      <SubmitButton pendingText="Creating…">Create household</SubmitButton>
    </form>
  );
}

export function RenameHouseholdForm({ current }: { current: string }) {
  const [state, action] = useActionState(renameHouseholdAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField label="Household name" name="displayName" optional maxLength={80} hint={NAME_HINT} defaultValue={current} error={state.fieldErrors?.displayName} />
      <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
        Save name
      </SubmitButton>
    </form>
  );
}

export function InviteButton({ inviteeId, name }: { inviteeId: string; name: string }) {
  const [state, action] = useActionState(inviteAction, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="inviteeId" value={inviteeId} />
      {state.status === "success" ? (
        <p role="status" className="text-[0.95rem] font-semibold text-success">
          Invited
        </p>
      ) : (
        <>
          <SubmitButton size="sm" variant="secondary" pendingText="Sending…" icon={<Send className="size-4" aria-hidden="true" />}>
            Invite<span className="sr-only"> {name}</span>
          </SubmitButton>
          {state.status === "error" ? (
            <p role="alert" className="text-[0.95rem] text-danger">
              {state.message}
            </p>
          ) : null}
        </>
      )}
    </form>
  );
}

export function RevokeButton({ invitationId, name }: { invitationId: string; name: string }) {
  const [state, action] = useActionState(revokeInvitationAction, initialFormState);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <SubmitButton size="sm" variant="ghost" pendingText="Withdrawing…">
        Withdraw<span className="sr-only"> invitation to {name}</span>
      </SubmitButton>
    </form>
  );
}

export function RespondButtons({ invitationId, householdLabel }: { invitationId: string; householdLabel: string }) {
  const [state, action] = useActionState(respondInvitationAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="answer" value="accept" size="sm" pendingText="Joining…">
          Accept<span className="sr-only"> invitation to {householdLabel}</span>
        </SubmitButton>
        <SubmitButton name="answer" value="decline" size="sm" variant="secondary" pendingText="Declining…">
          Decline<span className="sr-only"> invitation to {householdLabel}</span>
        </SubmitButton>
      </div>
    </form>
  );
}

export function LeaveHouseholdButton({ lastMember }: { lastMember: boolean }) {
  const [state, action] = useActionState(leaveHouseholdAction, initialFormState);
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <ConfirmDialog
        trigger={
          <>
            <LogOut className="size-4" aria-hidden="true" /> Leave household
          </>
        }
        title="Leave this household?"
        confirmLabel="Leave household"
        formAction={action}
      >
        {lastMember
          ? "You're the only adult in it, so the household and any open invitations will be removed."
          : "You'll no longer be connected to the other adults. You can be invited again later."}
      </ConfirmDialog>
    </div>
  );
}
