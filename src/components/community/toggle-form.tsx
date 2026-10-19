"use client";

import { useActionState, type ReactNode } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";

/** A one-button form for on/off settings (follow, mute), with a spoken result. */
export function ToggleForm({
  action,
  hidden,
  label,
  pressed,
  icon,
  description,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  label: string;
  pressed: boolean;
  icon?: ReactNode;
  description: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton size="sm" variant={pressed ? "secondary" : "ghost"} icon={icon}>
        {label}
        <span className="sr-only">: {description}</span>
      </SubmitButton>
      <span role="status" className={state.status === "error" ? "ml-2 text-sm text-danger" : "sr-only"}>
        {state.message ?? ""}
      </span>
    </form>
  );
}
