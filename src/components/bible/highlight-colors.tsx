"use client";

import { Check, Minus } from "lucide-react";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/bible/format";

/**
 * The six highlight colors as toggle buttons (reader toolbar and Scripture
 * Highlights in My Journal). Each has its name as its accessible name and
 * tooltip; aria-pressed is true when every chosen verse has that color and
 * "mixed" when only some do, shown as a check or a bar on the swatch so the
 * state never depends on color alone.
 */
export function HighlightColorButtons({
  pressed,
  onPick,
  disabled,
  label = "Highlight color",
}: {
  pressed: (color: HighlightColor) => boolean | "mixed";
  onPick: (color: HighlightColor) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {HIGHLIGHT_COLORS.map((c) => {
        const state = pressed(c.value);
        return (
          <button
            key={c.value}
            type="button"
            title={state === "mixed" ? `${c.label} (some verses)` : c.label}
            aria-label={c.label}
            aria-pressed={state}
            disabled={disabled}
            onClick={() => onPick(c.value)}
            className="grid size-11 place-items-center rounded-full focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-55"
          >
            <span
              aria-hidden="true"
              className={
                "grid size-8 place-items-center rounded-full border text-text " +
                (state === true ? "border-2 border-text" : state === "mixed" ? "border-2 border-dashed border-text" : "border-border-strong")
              }
              style={{ background: `var(--hl-${c.value})` }}
            >
              {state === true ? <Check className="size-4" strokeWidth={3} /> : state === "mixed" ? <Minus className="size-4" strokeWidth={3} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
