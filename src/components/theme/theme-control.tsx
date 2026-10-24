"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import type { ThemePreference } from "@/lib/theme/preference";
import { THEME_COLOR } from "@/lib/theme/tokens";
import { saveThemePreference } from "./actions";

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Keeps the browser chrome colour in step with the choice. "System" gets the
 * same light/dark media pair the server renders, so the bar keeps following
 * the device setting after this page has loaded.
 */
function syncThemeColor(theme: ThemePreference) {
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const pairs: Array<[string, string | null]> =
    theme === "system"
      ? [
          [THEME_COLOR.light, "(prefers-color-scheme: light)"],
          [THEME_COLOR.dark, "(prefers-color-scheme: dark)"],
        ]
      : [[THEME_COLOR[theme], null]];
  for (const [color, media] of pairs) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    if (media) meta.media = media;
    document.head.appendChild(meta);
  }
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme === "system" ? "light dark" : theme);
}

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
    syncThemeColor(next);
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
                // In a tight row the icon sits above the word rather than the word splitting.
                "flex min-h-11 cursor-pointer flex-wrap content-center items-center justify-center gap-x-1.5 rounded-full px-2 text-meta font-semibold [overflow-wrap:normal] transition-colors",
                "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary",
                value === v ? "bg-surface-raised text-text shadow-(--elev-card) ring-1 ring-border" : "text-text-secondary hover:text-text",
              )}
            >
              <input type="radio" name="theme" value={v} checked={value === v} onChange={() => apply(v)} className="sr-only" />
              <Icon className="size-4 shrink-0" aria-hidden="true" />
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
