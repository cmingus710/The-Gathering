"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

const PROMPT = "You have unsaved changes. Leave this page without saving?";

/**
 * Tracks whether a form differs from what was last saved, and warns before
 * the member leaves: the browser's own prompt on reload/close, and a
 * confirmation on in-app link clicks. `savedKey` changes only after a
 * successful save (forms echo it back in a hidden "savedAt" input on
 * errors), which marks the current values as the new baseline.
 */
export function useUnsavedChanges(formRef: RefObject<HTMLFormElement | null>, savedKey: unknown): boolean {
  const [dirty, setDirty] = useState(false);
  const baseline = useRef<string>("");

  const snapshot = () => {
    const form = formRef.current;
    if (!form) return "";
    const entries: string[] = [];
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v === "string" && !k.startsWith("$ACTION") && k !== "savedAt") entries.push(`${k}=${v}`);
    }
    return entries.sort().join("&");
  };

  useEffect(() => {
    baseline.current = snapshot();
    const form = formRef.current;
    if (!form) return;
    const update = () => setDirty(snapshot() !== baseline.current);
    queueMicrotask(update);
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-baseline only when a save completes
  }, [savedKey]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (formRef.current?.contains(link)) return;
      if (!window.confirm(PROMPT)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, formRef]);

  return dirty;
}

/** Small persistent indicator, announced politely when it appears. */
export function UnsavedNotice({ dirty }: { dirty: boolean }) {
  return (
    <p role="status" className="min-h-6 text-meta font-semibold text-primary">
      {dirty ? "You have unsaved changes." : ""}
    </p>
  );
}
