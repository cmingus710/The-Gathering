"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Clamps rich content to a few lines with "Read more" when it overflows. */
export function ReadMore({ children, className }: { children: ReactNode; className?: string }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={className}>
      <div id={id} ref={box} className={cn("relative [overflow-wrap:anywhere]", !open && "max-h-[4.75rem] overflow-hidden")}>
        {children}
        {!open && overflows ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background" /> : null}
      </div>
      {overflows || open ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="mt-0.5 inline-flex min-h-11 items-center rounded-full px-1 text-meta font-semibold text-primary hover:underline"
        >
          {open ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
