"use client";

import { useId, useRef, type ReactNode, type RefObject } from "react";
import { Button, type ButtonVariant } from "./button";

/**
 * A button that opens a modal confirmation. Uses the native <dialog>, which
 * moves focus into the dialog, keeps it there, closes on Escape, and returns
 * focus to the trigger. The confirm button submits `formAction`.
 * Pass `trigger={null}` and a `dialogRef` to open it from elsewhere (a menu).
 */
export function ConfirmDialog({
  trigger,
  triggerVariant = "danger-outline",
  title,
  children,
  confirmLabel,
  formAction,
  hidden,
  fields,
  dismissLabel = "Cancel",
  dialogRef,
}: {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  formAction: (formData: FormData) => void;
  hidden?: Record<string, string>;
  /** Inputs submitted with the confirmation (e.g. a reason). */
  fields?: ReactNode;
  /** Label for the button that closes the dialog without acting. */
  dismissLabel?: string;
  /** Opens the dialog from outside (call showModal()); use with trigger={null}. */
  dialogRef?: RefObject<HTMLDialogElement | null>;
}) {
  const ownRef = useRef<HTMLDialogElement>(null);
  const ref = dialogRef ?? ownRef;
  const titleId = useId();
  const bodyId = useId();
  return (
    <>
      {trigger === null ? null : (
        <Button variant={triggerVariant} size="sm" onClick={() => ref.current?.showModal()} aria-haspopup="dialog">
          {trigger}
        </Button>
      )}
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-6 text-text shadow-(--elev-lift) backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold">
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
          {fields ? <div className="w-full">{fields}</div> : null}
          <Button variant="secondary" size="sm" onClick={() => ref.current?.close()} autoFocus>
            {dismissLabel}
          </Button>
          <Button type="submit" variant="danger" size="sm">
            {confirmLabel}
          </Button>
        </form>
      </dialog>
    </>
  );
}
