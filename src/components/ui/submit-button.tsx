"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import type { ReactNode } from "react";

/**
 * Submit button that shows a loading state while its form's action runs.
 * When a form has several submit buttons, only the one that was pressed shows
 * the spinner; the rest are disabled to prevent double submission.
 */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  name,
  value,
  className,
  icon,
  formNoValidate,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  name?: string;
  value?: string;
  className?: string;
  icon?: ReactNode;
  formNoValidate?: boolean;
}) {
  const { pending, data } = useFormStatus();
  const isThisButton = pending && (!name || data?.get(name) === value);
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      name={name}
      value={value}
      className={className}
      icon={icon}
      formNoValidate={formNoValidate}
      loading={isThisButton}
      loadingText={pendingText}
      disabled={pending}
    >
      {children}
    </Button>
  );
}
