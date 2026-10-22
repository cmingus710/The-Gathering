"use client";

import { HandHeart } from "lucide-react";
import { useActionState, useState } from "react";
import { volunteerAction } from "@/app/(app)/(member)/prayer/care-actions";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

export function VolunteerForm({ opportunityId }: { opportunityId: string }) {
  const [state, action] = useActionState(volunteerAction, initialFormState);
  const [note, setNote] = useState("");
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="on" value="true" />
      <TextField label="Note for the coordinator" name="note" optional maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint="For example, what time works for you. Don't include anyone else's details." />
      <SubmitButton pendingText="Sending…" icon={<HandHeart className="size-4" aria-hidden="true" />}>
        I can help
      </SubmitButton>
    </form>
  );
}
