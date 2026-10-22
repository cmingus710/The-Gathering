"use client";

import { useActionState, type ReactNode } from "react";
import { youthFormAction } from "@/app/(app)/(member)/youth/actions";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

/**
 * A Youth & Families form: posts `op` and its fields, shows the saved or
 * error message (announced to screen readers by FormMessage), and keeps what
 * was typed when something fails. One-time codes are shown once, here only.
 */
export function YouthForm({
  op,
  hidden,
  children,
  submit,
  pendingText = "Saving…",
  variant = "primary",
  size = "md",
  className,
  inline = false,
  extraButtons,
}: {
  op: string;
  hidden?: Record<string, string | null | undefined>;
  children?: ReactNode;
  submit: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Compact: message and button on one line (single-button actions). */
  inline?: boolean;
  extraButtons?: ReactNode;
}) {
  const [state, action] = useActionState(youthFormAction, initialFormState);
  const code = state.status === "success" ? state.values?.code : undefined;
  return (
    <form action={action} className={cn(inline ? "space-y-2" : "space-y-4", className)}>
      <input type="hidden" name="op" value={op} />
      {Object.entries(hidden ?? {}).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={v} />))}
      {inline ? null : <FormMessage state={state} />}
      {children}
      {code ? (
        <div role="status" className="rounded-card border border-primary/50 bg-primary-soft p-4">
          <p className="font-semibold">One-time code</p>
          <p className="mt-1 font-mono text-[1.5rem] font-semibold tracking-wider">{code}</p>
          <p className="mt-1 text-meta text-text-secondary">
            Give this to the youth in person. It works once, only with the email address you entered, and expires in 7 days. It won&apos;t be shown again.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingText={pendingText} variant={variant} size={size}>
          {submit}
        </SubmitButton>
        {extraButtons}
      </div>
      {inline ? <FormMessage state={state} /> : null}
    </form>
  );
}
