import { cn } from "@/components/ui/cn";

const month = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" });
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });

/**
 * Calendar-leaf date for event cards, from a local YYYY-MM-DD date. The full
 * date is also given in words for assistive technology by the caller's text.
 */
export function DateBlock({ ymd, canceled = false, className }: { ymd: string; canceled?: boolean; className?: string }) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-tile border border-border bg-surface text-center leading-none",
        canceled && "opacity-60",
        className,
      )}
    >
      <span className="w-full bg-primary-soft py-1 text-[0.75rem] font-bold text-primary">{month.format(d)}</span>
      <span className="pt-1.5 font-display text-[1.5rem] font-semibold tabular-nums text-text">{d.getUTCDate()}</span>
      <span className="pb-1.5 pt-0.5 text-[0.75rem] font-semibold text-text-secondary">{weekday.format(d)}</span>
    </span>
  );
}
