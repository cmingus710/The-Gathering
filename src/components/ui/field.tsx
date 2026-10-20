import { CircleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "block w-full rounded-control border bg-surface px-4 py-2.5 text-base text-text min-h-12 " +
  "placeholder:text-text-secondary transition-colors hover:border-text-secondary " +
  "focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-secondary";

type FieldChrome = {
  label: ReactNode;
  name: string;
  id?: string;
  hint?: ReactNode;
  error?: string[] | string;
  optional?: boolean;
  className?: string;
};

function firstError(error?: string[] | string) {
  return Array.isArray(error) ? error[0] : error;
}

function Chrome({
  id,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: Omit<FieldChrome, "name"> & { id: string; children: ReactNode }) {
  const message = firstError(error);
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block font-semibold text-text">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-text-secondary">(optional)</span> : null}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-meta text-text-secondary">
          {hint}
        </p>
      ) : null}
      {children}
      {message ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-meta font-medium text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="sr-only">Error: </span>
            {message}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function TextField({
  label,
  name,
  id,
  hint,
  error,
  optional,
  className,
  trailing,
  ...input
}: FieldChrome & { trailing?: ReactNode } & Omit<ComponentProps<"input">, "name" | "id">) {
  const fieldId = id ?? `field-${name}`;
  const message = firstError(error);
  const field = (
    <input
      id={fieldId}
      name={name}
      aria-invalid={message ? true : undefined}
      aria-describedby={describedBy(fieldId, hint, message)}
      className={cn(control, message ? "border-danger" : "border-border-strong", trailing ? "pr-14" : null)}
      {...input}
    />
  );
  return (
    <Chrome id={fieldId} label={label} hint={hint} error={error} optional={optional} className={className}>
      {/* A trailing control (e.g. a show-password button) sits inside the input's right edge. */}
      {trailing ? (
        <div className="relative">
          {field}
          {trailing}
        </div>
      ) : (
        field
      )}
    </Chrome>
  );
}

export function TextAreaField({
  label,
  name,
  id,
  hint,
  error,
  optional,
  className,
  ...input
}: FieldChrome & Omit<ComponentProps<"textarea">, "name" | "id">) {
  const fieldId = id ?? `field-${name}`;
  const message = firstError(error);
  return (
    <Chrome id={fieldId} label={label} hint={hint} error={error} optional={optional} className={className}>
      <textarea
        id={fieldId}
        name={name}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, message)}
        className={cn(control, "min-h-32 leading-relaxed", message ? "border-danger" : "border-border-strong")}
        {...input}
      />
    </Chrome>
  );
}

export function SelectField({
  label,
  name,
  id,
  hint,
  error,
  optional,
  className,
  children,
  ...input
}: FieldChrome & Omit<ComponentProps<"select">, "name" | "id">) {
  const fieldId = id ?? `field-${name}`;
  const message = firstError(error);
  return (
    <Chrome id={fieldId} label={label} hint={hint} error={error} optional={optional} className={className}>
      <select
        id={fieldId}
        name={name}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, message)}
        className={cn(control, "appearance-auto pr-8", message ? "border-danger" : "border-border-strong")}
        {...input}
      >
        {children}
      </select>
    </Chrome>
  );
}

export function CheckboxField({
  label,
  name,
  id,
  hint,
  className,
  ...input
}: Omit<FieldChrome, "error" | "optional"> & Omit<ComponentProps<"input">, "name" | "id" | "type">) {
  const fieldId = id ?? `field-${name}`;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        id={fieldId}
        name={name}
        type="checkbox"
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className="mt-1 size-5 shrink-0 cursor-pointer rounded border-border-strong accent-primary"
        {...input}
      />
      <div>
        <label htmlFor={fieldId} className="cursor-pointer font-semibold">
          {label}
        </label>
        {hint ? (
          <p id={`${fieldId}-hint`} className="text-meta text-text-secondary">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
