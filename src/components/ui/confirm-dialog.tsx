"use client";

import { useId, useRef, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./button";

/**
 * A button that opens a modal confirmation. Uses the native <dialog>, which
 * moves focus into the dialog, keeps it there, closes on Escape, and returns
 * focus to the trigger. The confirm button submits `formAction`.
 */
export function ConfirmDialog({
  trigger,
  triggerVariant = "danger-outline",
  title,
  children,
  confirmLabel,
  formAction,
  hidden,
}: {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  formAction: (formData: FormData) => void;
  hidden?: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  return (
    <>
      <Button variant={triggerVariant} size="sm" onClick={() => ref.current?.showModal()} aria-haspopup="dialog">
        {trigger}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-6 text-text backdrop:bg-black/60"
      >
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        {children ? (
          <div id={bodyId} className="mt-2 text-text-secondary">
            {children}
          </div>
        ) : null}
        <form
          action={(fd) => {
            ref.current?.close();
            formAction(fd);
          }}
          className="mt-6 flex flex-wrap justify-end gap-2"
        >
          {Object.entries(hidden ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <Button variant="secondary" size="sm" onClick={() => ref.current?.close()} autoFocus>
            Cancel
          </Button>
          <Button type="submit" variant="danger" size="sm">
            {confirmLabel}
          </Button>
        </form>
      </dialog>
    </>
  );
}
