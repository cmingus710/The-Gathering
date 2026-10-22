"use client";

import { useActionState } from "react";
import { CheckboxField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { challengeAction } from "../../actions";

export function ChallengeControls({ id, joined, sharing, active }: { id: string; joined: boolean; sharing: boolean; active: boolean }) {
  const [state, action] = useActionState(challengeAction, initialFormState);
  return (
    <form action={action} className="space-y-3 rounded-card border border-border bg-surface p-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      {!joined ? (
        active ? (
          <>
            <CheckboxField name="understood" label="I've read what joining shares." />
            <SubmitButton name="op" value="join" pendingText="Joining…">
              Join the challenge
            </SubmitButton>
          </>
        ) : null
      ) : (
        <div className="flex flex-wrap gap-2">
          {sharing ? (
            <SubmitButton name="op" value="pause" variant="secondary" pendingText="Pausing…">
              Pause sharing
            </SubmitButton>
          ) : (
            <SubmitButton name="op" value="resume" variant="secondary" pendingText="Resuming…">
              Resume sharing
            </SubmitButton>
          )}
          <SubmitButton name="op" value="leave" variant="danger-outline" pendingText="Leaving…">
            Leave the challenge
          </SubmitButton>
        </div>
      )}
    </form>
  );
}
