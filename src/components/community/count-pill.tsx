import { cn } from "@/components/ui/cn";

/** Count pill: a number in text (never colour alone), capped at 99+. */
export function CountPill({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-bold tabular-nums leading-none text-on-primary ring-2 ring-background",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function label(base: string, count: number) {
  return count > 0 ? `${base}, ${count > 99 ? "more than 99" : count} unread` : base;
}

