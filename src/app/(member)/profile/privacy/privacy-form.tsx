"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { UnsavedNotice, useUnsavedChanges } from "@/components/profile/unsaved-changes";
import { Card, SectionHeading } from "@/components/ui/card";
import { CheckboxField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { PrivacyKey } from "@/lib/profile/schemas";
import { updatePrivacyAction } from "../actions";

const SHARED: Array<{ key: PrivacyKey; label: string; hint: string }> = [
  { key: "show_photo", label: "Photo", hint: "Without it, members see your initials." },
  { key: "show_city_state", label: "City and state", hint: "Members can also find you by searching for your city." },
  { key: "show_ministry_interests", label: "Ministry interests", hint: "The areas of church life you've chosen." },
  { key: "show_household", label: "Household", hint: "Adults you've connected as a household, if they share theirs too." },
];

const PRIVATE: Array<{ key: PrivacyKey; label: string; hint: string }> = [
  { key: "show_phone", label: "Phone number", hint: "Members can tap to call you." },
  { key: "show_contact_email", label: "Directory email", hint: "Your directory email, never your sign-in email." },
  { key: "show_street_address", label: "Street address", hint: "Includes your city, state, and postal code." },
  { key: "show_birthday", label: "Birthday", hint: "Month and day only." },
];

export function PrivacyForm({ initial }: { initial: Record<string, boolean> }) {
  const [state, action] = useActionState(updatePrivacyAction, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const savedAt = state.values?.savedAt ?? "initial";
  const dirty = useUnsavedChanges(formRef, savedAt);
  const checked = (k: PrivacyKey) => (state.values ? state.values[k] === "on" : initial[k]);
  const [listed, setListed] = useState(checked("directory_listed"));

  return (
    <form ref={formRef} action={action} className="space-y-6">
      <FormMessage state={state} successTitle="Saved" />
      <input type="hidden" name="savedAt" value={savedAt} />

      <Card>
        <SectionHeading>Directory listing</SectionHeading>
        <CheckboxField
          name="directory_listed"
          label="Show me in the member directory"
          hint="Turn this off to hide your whole profile from other members. Your name will no longer appear in searches."
          defaultChecked={checked("directory_listed")}
          onChange={(e) => setListed(e.currentTarget.checked)}
        />
      </Card>

      {/* Choices stay editable (and are kept) while hidden, so turning the listing back on restores them. */}
      <div className={listed ? "space-y-6" : "space-y-6 opacity-70"}>
        {!listed ? (
          <p className="text-meta text-text-secondary">While you&apos;re hidden, none of these details are shown, whatever is ticked.</p>
        ) : null}
        <Card>
          <fieldset>
            <legend className="mb-3 text-[1.0625rem] font-semibold">Shared unless you turn them off</legend>
            <div className="space-y-4">
              {SHARED.map((f) => (
                <CheckboxField key={f.key} name={f.key} label={f.label} hint={f.hint} defaultChecked={checked(f.key)} />
              ))}
            </div>
          </fieldset>
        </Card>

        <Card>
          <fieldset>
            <legend className="mb-3 text-[1.0625rem] font-semibold">Hidden unless you share them</legend>
            <div className="space-y-4">
              {PRIVATE.map((f) => (
                <CheckboxField key={f.key} name={f.key} label={f.label} hint={f.hint} defaultChecked={checked(f.key)} />
              ))}
            </div>
          </fieldset>
        </Card>
      </div>

      <div className="sticky bottom-(--dock-clearance) z-10 flex flex-wrap items-center gap-4 rounded-card border border-border bg-background/95 p-3 backdrop-blur lg:bottom-4">
        <SubmitButton pendingText="Saving…">Save privacy choices</SubmitButton>
        <Link href="/profile/preview" className="font-semibold text-primary hover:underline">
          Preview my directory profile
        </Link>
        <UnsavedNotice dirty={dirty} />
      </div>
    </form>
  );
}
