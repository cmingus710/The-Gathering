"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { TextField } from "./field";

/**
 * Password input with a show/hide toggle. The toggle is a real button with a
 * stable name ("Show password") and aria-pressed, so screen readers announce
 * its state; it never submits the form.
 */
export function PasswordField(props: Omit<ComponentProps<typeof TextField>, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);
  const fieldId = props.id ?? `field-${props.name}`;
  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={fieldId}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-control text-text-secondary transition-colors hover:text-text focus-visible:outline-offset-[-3px]"
        >
          {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
        </button>
      }
    />
  );
}
