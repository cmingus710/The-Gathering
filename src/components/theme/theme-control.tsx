"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import type { ThemePreference } from "@/lib/theme/preference";
import { saveThemePreference } from "./actions";

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Light / Dark / System segmented control. Applies the choice immediately,
 * then saves it to the theme cookie with a Server Action. Without JavaScript
 * the Save button submits the same form.
 */
export function ThemeControl({ current, className, compact = false }: { current: ThemePreference; className?: string; compact?: boolean }) {
  const [value, setValue] = useState(current);
  const formRef = useRef<HTMLFormElement>(null);
  const legendId = useId();

  function apply(next: ThemePreference) {
    setValue(next);
    document.documentElement.setAttribute("data-theme", next);
    const bg = getComputedStyle(document.body).backgroundColor;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute("content", bg);
      m.removeAttribute("media");
    });
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} action={saveThemePreference} className={className}>
      <fieldset aria-labelledby={legendId}>
        <legend id={legendId} className={cn("font-semibold text-text", compact ? "sr-only" : "mb-2")}>
          Appearance
        </legend>
        <div className="grid grid-cols-3 gap-1 rounded-full border border-border bg-surface-muted p-1">
          {OPTIONS.map(({ value: v, label, Icon }) => (
            <label
              key={v}
              className={cn(
                "flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 text-meta font-semibold transition-colors",
                "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary",
                value === v ? "bg-surface-raised text-text shadow-(--elev-card) ring-1 ring-border" : "text-text-secondary hover:text-text",
              )}
            >
              <input type="radio" name="theme" value={v} checked={value === v} onChange={() => apply(v)} className="sr-only" />
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <noscript>
        <button type="submit" className="mt-2 font-semibold text-primary underline">
          Save appearance
        </button>
      </noscript>
    </form>
  );
}
