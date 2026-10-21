import { CircleCheck } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { meterText } from "@/lib/giving/campaigns";
import { formatCents } from "@/lib/giving/money";

const whole = (c: number) => formatCents(c).replace(/\.00$/, "");

/**
 * Campaign progress meter. Shows only the aggregate raised against the goal
 * (never donors or gift counts). Exposed to assistive technology as a
 * progressbar whose value text reads like "$1,250 raised of $5,000 goal".
 * The bar is capped at 100%; the amount keeps counting past the goal.
 */
export function CampaignMeter({
  raisedCents,
  goalCents,
  percent,
  goalReached,
  closed = false,
  size = "md",
  className,
}: {
  raisedCents: number;
  goalCents: number;
  percent: number;
  goalReached: boolean;
  closed?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, Math.floor(percent)));
  const text = meterText(raisedCents, goalCents);
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className={cn("font-bold text-text", size === "md" ? "text-xl" : "text-lg")}>
          {whole(raisedCents)} <span className="text-meta font-semibold text-text-secondary">raised of {whole(goalCents)}</span>
        </p>
        <p className="text-meta font-semibold text-text-secondary" aria-hidden="true">
          {value}%
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Campaign progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${text}${goalReached ? ", goal reached" : ""}`}
        className={cn("w-full overflow-hidden rounded-full border border-border bg-surface-muted", size === "md" ? "h-3.5" : "h-2.5")}
      >
        <div
          className={cn("h-full rounded-full transition-[width] motion-reduce:transition-none", goalReached ? "bg-success" : "bg-primary")}
          style={{ width: `${value}%` }}
        />
      </div>
      {goalReached ? (
        <p className="flex items-center gap-1.5 text-meta font-semibold text-success">
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          Goal reached — thank you
          {closed ? null : <span className="font-normal text-text-secondary">· gifts are still welcome</span>}
        </p>
      ) : null}
    </div>
  );
}
