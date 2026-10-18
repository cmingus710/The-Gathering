import { LogOut } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Plain form POST so sign-out works without JavaScript and clears caches server-side. */
export function SignOutButton({ className, label = "Sign out" }: { className?: string; label?: string }) {
  return (
    <form action="/auth/sign-out" method="post">
      <button
        type="submit"
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-left font-semibold text-text hover:bg-surface-muted",
          className,
        )}
      >
        <LogOut className="size-5" aria-hidden="true" />
        {label}
      </button>
    </form>
  );
}
