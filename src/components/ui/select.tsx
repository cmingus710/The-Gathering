"use client";

import { useEffect, useRef, type ComponentProps } from "react";

/**
 * A <select> that keeps its intended value through a form reset. React
 * resets a form after its action runs; a select then falls back to its
 * first option (or its first default) even when the page still shows,
 * and the next submit sends, a different choice. After a reset this puts
 * back `value` (controlled) or the current `defaultValue` (echoed values),
 * and, since React ignores a changed `defaultValue` on a mounted select,
 * applies a new one when it arrives.
 */
export function Select(props: ComponentProps<"select">) {
  const ref = useRef<HTMLSelectElement>(null);
  const target = props.value ?? props.defaultValue;
  const single = typeof target === "string" || typeof target === "number" ? String(target) : null;
  const controlled = props.value !== undefined;
  const mounted = useRef(false);

  useEffect(() => {
    // Skip the first run so the server-rendered choice stays as it is.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!controlled && single !== null && ref.current) ref.current.value = single;
  }, [controlled, single]);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form || single === null) return;
    const onReset = () => {
      // The reset event fires before the reset itself; restore afterwards.
      queueMicrotask(() => {
        if (ref.current) ref.current.value = single;
      });
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [single]);

  return <select ref={ref} {...props} />;
}
