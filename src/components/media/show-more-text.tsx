"use client";

import { useId, useState } from "react";
import { cn } from "@/components/ui/cn";

/** Plain text clamped to a few lines, with "Show more" when it is long. */
export function ShowMoreText({ text, className, threshold = 220 }: { text: string; className?: string; threshold?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = text.length > threshold;
  return (
    <div className={className}>
      <p id={id} className={cn("max-w-[65ch] whitespace-pre-line text-text-secondary [overflow-wrap:anywhere]", long && !open && "line-clamp-3")}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="mt-1 inline-flex min-h-11 items-center rounded-full px-1 text-meta font-semibold text-primary hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
