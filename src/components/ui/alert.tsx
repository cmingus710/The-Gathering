import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "success" | "warning" | "error";

const tones: Record<Tone, { box: string; icon: ReactNode; label: string }> = {
  info: { box: "bg-surface border-border text-text", icon: <Info className="size-5 text-primary" aria-hidden="true" />, label: "Note" },
  success: {
    box: "bg-success-soft border-success text-text",
    icon: <CircleCheck className="size-5 text-success" aria-hidden="true" />,
    label: "Success",
  },
  warning: {
    box: "bg-primary-soft border-primary text-text",
    icon: <TriangleAlert className="size-5 text-primary" aria-hidden="true" />,
    label: "Attention",
  },
  error: {
    box: "bg-danger-soft border-danger text-text",
    icon: <CircleAlert className="size-5 text-danger" aria-hidden="true" />,
    label: "Error",
  },
};

/**
 * Status message with an icon and an (optionally visually hidden) text label,
 * so meaning never depends on colour alone. Errors are announced assertively.
 */
export function Alert({
  tone = "info",
  title,
  children,
  className,
  live = true,
  id,
  tabIndex,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  live?: boolean;
  id?: string;
  tabIndex?: number;
}) {
  const t = tones[tone];
  const role = live ? (tone === "error" ? "alert" : "status") : undefined;
  return (
    <div id={id} tabIndex={tabIndex} role={role} className={cn("flex flex-wrap gap-3 rounded-tile border px-4 py-3", t.box, className)}>
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      {/* Drops below the icon only when there's no room beside it (large text on a narrow phone). */}
      <div className="min-w-[min(100%,9rem)] flex-1 space-y-1">
        {title ? (
          <p className="font-semibold">
            <span className="sr-only">{t.label}: </span>
            {title}
          </p>
        ) : (
          <span className="sr-only">{t.label}: </span>
        )}
        {children ? <div className="text-meta">{children}</div> : null}
      </div>
    </div>
  );
}
