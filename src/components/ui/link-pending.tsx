"use client";

import { useLinkStatus } from "next/link";
import { cn } from "./cn";
import { Spinner } from "./spinner";

/**
 * Put inside a <Link>: a small spinner beside the link text while the page
 * it opens is on its way, for destinations without a loading skeleton. The
 * space is always reserved, so nothing shifts when it appears.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-link-pending={pending ? "" : undefined}
      className={cn("ml-1.5 inline-flex size-4 align-[-0.125em] text-text-secondary transition-opacity", pending ? "opacity-100" : "opacity-0", className)}
    >
      {pending ? <Spinner /> : null}
    </span>
  );
}
