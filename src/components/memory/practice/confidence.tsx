"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CONFIDENCE } from "@/lib/memory/format";
import type { Confidence } from "@/lib/memory/types";

/** "How well did you know it?" (the member's own judgment, recorded as such). */
export function ConfidencePicker({
  kids,
  busy,
  onChoose,
  question = "How well did you know it?",
  submitLabel = "Save",
  optional = false,
}: {
  kids: boolean;
  busy: boolean;
  onChoose: (c: Confidence | null) => void;
  question?: string;
  submitLabel?: string;
  optional?: boolean;
}) {
  const [value, setValue] = useState<Confidence | null>(null);
  const name = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="font-semibold">
        {question}
        {optional ? <span className="font-normal text-text-secondary"> (optional)</span> : null}
      </legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CONFIDENCE.map((c) => (
          <label
            key={c.key}
            className={cn(
              "memory-control flex min-h-12 cursor-pointer items-center justify-center rounded-tile border px-3 text-center font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
              value === c.key ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:text-text",
            )}
          >
            <input type="radio" name={name} value={c.key} className="sr-only" checked={value === c.key} onChange={() => setValue(c.key)} />
            {value === c.key ? <span aria-hidden="true">✓&nbsp;</span> : null}
            {kids ? c.kids : c.label}
          </label>
        ))}
      </div>
      <Button className="memory-control" disabled={!optional && !value} loading={busy} loadingText="Saving…" onClick={() => onChoose(value)}>
        {submitLabel}
      </Button>
    </fieldset>
  );
}
