"use client";

import { useActionState, type ReactNode } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { initialFormState, type FormState } from "@/lib/forms";

/** A form bound to a management Server Action, with its result message. */
export function ActionForm({
  action,
  hidden,
  children,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className={className}>
      <FormMessage state={state} />
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
    </form>
  );
}
