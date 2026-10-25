"use client";

import { LogOut } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { purgeColoringDrafts } from "@/lib/youth/coloring-local";

/**
 * Plain form POST so sign-out works without JavaScript and clears caches
 * server-side. With JavaScript, on-device copies of unsaved coloring are
 * removed first, so the next person on a shared device never sees them.
 */
export function SignOutButton({ className, label = "Sign out" }: { className?: string; label?: string }) {
  return (
    <form action="/auth/sign-out" method="post" onSubmit={() => purgeColoringDrafts()}>
      <button
        type="submit"
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-full px-4 py-2 text-left font-semibold text-text transition-colors hover:bg-surface-muted",
          className,
        )}
      >
        <LogOut className="size-6 p-0.5" aria-hidden="true" />
        {label}
      </button>
    </form>
  );
}
