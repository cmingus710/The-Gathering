"use client";

import { HandHeart } from "lucide-react";
import { useState, useTransition } from "react";
import { prayAction } from "@/app/(app)/(member)/prayer/actions";
import { cn } from "@/components/ui/cn";

/**
 * "I'm praying": one per member, removable. Shows a gentle aggregate only
 * ("3 praying"), never names or rankings.
 */
export function PrayButton({ requestId, initialCount, initialPraying, disabled }: { requestId: string; initialCount: number; initialPraying: boolean; disabled?: boolean }) {
  const [count, setCount] = useState(initialCount);
  const [praying, setPraying] = useState(initialPraying);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const next = !praying;
      const result = await prayAction(requestId, next);
      if (result.ok) {
        setCount(result.count);
        setPraying(result.praying);
        setMessage(result.praying ? "Thank you for praying." : "Removed.");
      } else {
        setMessage(result.message);
      }
    });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || pending}
        aria-pressed={praying}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-full border px-5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          praying ? "border-primary bg-primary-soft text-text" : "border-border-strong bg-surface text-text hover:border-primary",
        )}
      >
        <HandHeart className={cn("size-5", praying ? "text-primary" : "")} aria-hidden="true" />
        {praying ? "I'm praying" : "I'll pray"}
      </button>
      <span className="text-meta text-text-secondary">{count > 0 ? `${count} praying` : "Be the first to pray"}</span>
      <span role="status" className="sr-only">
        {message}
      </span>
    </div>
  );
}
