"use client";

import { useEffect, useRef } from "react";
import type { FormState } from "@/lib/forms";
import { Alert } from "./alert";

/**
 * Shows a form's result. On an error, moves focus to the message so keyboard
 * and screen-reader users learn what went wrong; field errors are linked from
 * each input via aria-describedby.
 */
export function FormMessage({ state, successTitle }: { state: FormState; successTitle?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error") ref.current?.focus();
  }, [state]);
  if (state.status === "idle" || !state.message) return null;
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <Alert tone={state.status === "error" ? "error" : "success"} title={state.status === "success" ? (successTitle ?? state.message) : state.message}>
        {state.status === "success" && successTitle ? state.message : null}
      </Alert>
    </div>
  );
}
