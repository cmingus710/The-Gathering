"use client";

import { Send } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { careMessageAction, createCareAction } from "@/app/(member)/prayer/care-actions";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { CARE_KIND_LABEL, CARE_LIMITS, CONTACT_LABEL } from "@/lib/prayer/format";
import type { CareKind, ContactMethod } from "@/lib/prayer/types";

/**
 * "Request help". Private to the care team by default; never published as
 * a prayer request. Asks only for what's needed to help: no medical
 * details, diagnoses, or documents. Drafts live in component state only.
 */
export function CareRequestForm({ hasPhone }: { hasPhone: boolean }) {
  const [state, action] = useActionState(createCareAction, initialFormState);
  const v = state.values ?? {};
  const [kind, setKind] = useState<CareKind>((v.kind as CareKind) || "meal");
  const [summary, setSummary] = useState(v.summary ?? "");
  const [details, setDetails] = useState(v.details ?? "");
  const [neededOn, setNeededOn] = useState(v.neededOn ?? "");
  const [neededUntil, setNeededUntil] = useState(v.neededUntil ?? "");
  const [contact, setContact] = useState<ContactMethod>((v.contactMethod as ContactMethod) || "app");
  const [contactNote, setContactNote] = useState(v.contactNote ?? "");
  const [consent, setConsent] = useState(false);
  const [clientKey] = useState(() => crypto.randomUUID());
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-6">
      <FormMessage state={state} />
      <input type="hidden" name="clientKey" value={clientKey} />
      <SelectField label="What kind of help?" name="kind" value={kind} onChange={(e) => setKind(e.target.value as CareKind)} error={fe.kind}>
        {(Object.keys(CARE_KIND_LABEL) as CareKind[]).map((k) => (
          <option key={k} value={k}>
            {CARE_KIND_LABEL[k]}
          </option>
        ))}
      </SelectField>
      <TextField label="Describe the need in a few words" name="summary" required minLength={3} maxLength={CARE_LIMITS.summary} value={summary} onChange={(e) => setSummary(e.target.value)} error={fe.summary} hint="For example: “Meals for our family after a surgery” or “A ride to an appointment”." />
      <TextAreaField
        label="Anything the care team should know"
        name="details"
        optional
        maxLength={CARE_LIMITS.details}
        rows={4}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        error={fe.details}
        hint="Please don't include medical records, diagnoses, ID numbers, or other sensitive details. Share only what's needed to help."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Needed from" name="neededOn" type="date" optional value={neededOn} onChange={(e) => setNeededOn(e.target.value)} error={fe.neededOn} />
        <TextField label="Until" name="neededUntil" type="date" optional value={neededUntil} min={neededOn || undefined} onChange={(e) => setNeededUntil(e.target.value)} error={fe.neededUntil} />
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">How should the care team contact you?</legend>
        {(Object.keys(CONTACT_LABEL) as ContactMethod[]).map((m) => {
          const disabled = m === "phone" && !hasPhone;
          return (
            <label key={m} className={`flex min-h-11 items-center gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
              <input type="radio" name="contactMethod" value={m} checked={contact === m} disabled={disabled} onChange={() => setContact(m)} className="size-5 accent-primary" />
              <span>
                {CONTACT_LABEL[m]}
                {disabled ? <span className="block text-meta text-text-secondary">Add a phone number to your profile to choose this.</span> : null}
              </span>
            </label>
          );
        })}
        <p className="text-meta text-text-secondary">The care team sees only the contact detail you choose here.</p>
      </fieldset>
      <TextField label="Best times or other contact notes" name="contactNote" optional maxLength={CARE_LIMITS.contactNote} value={contactNote} onChange={(e) => setContactNote(e.target.value)} error={fe.contactNote} />
      <CheckboxField
        label="The care team may share my first name and the details needed (such as a drop-off address) with volunteers they accept"
        name="consent"
        checked={consent}
        onChange={(e) => setConsent(e.target.checked)}
        hint="Optional. Without this, volunteers only see a general task and time. You can change it later."
      />
      <p className="rounded-tile border border-border bg-surface-muted px-4 py-3 text-meta">
        Your request goes privately to the care team. It isn&apos;t posted as a prayer request or shared with volunteers automatically. The care team isn&apos;t monitored around the clock and isn&apos;t an emergency service: in an emergency, call 911.
      </p>
      <SubmitButton pendingText="Sending…" icon={<Send className="size-4" aria-hidden="true" />}>
        Send to the care team
      </SubmitButton>
    </form>
  );
}

/** Message box for the requester ↔ care team thread (either side). */
export function CareMessageForm({ careId, label, hint }: { careId: string; label: string; hint: string }) {
  const [state, action] = useActionState(careMessageAction, initialFormState);
  const [body, setBody] = useState("");
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.status !== "success" || handled.current === state) return;
    handled.current = state;
    setBody("");
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="careId" value={careId} />
      <FormMessage state={state} />
      <TextAreaField label={label} name="body" required maxLength={CARE_LIMITS.message} rows={3} value={body} onChange={(e) => setBody(e.target.value)} hint={hint} />
      <SubmitButton size="sm" pendingText="Sending…" icon={<Send className="size-4" aria-hidden="true" />}>
        Send
      </SubmitButton>
    </form>
  );
}
