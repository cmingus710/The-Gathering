import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { Reason } from "@/lib/media/visibility";

const ICON = { success: CheckCircle2, info: Info, warning: AlertTriangle, danger: XCircle } as const;
const COLOR = { success: "text-success", info: "text-text-secondary", warning: "text-primary", danger: "text-danger" } as const;

/** Administrator-facing list of visibility reasons (see lib/media/visibility). */
export function ReasonList({ reasons, className }: { reasons: Reason[]; className?: string }) {
  return (
    <ul className={cn("space-y-3", className)}>
      {reasons.map((r, i) => {
        const Icon = ICON[r.tone];
        return (
          <li key={i} className="flex gap-2.5">
            <Icon className={cn("mt-0.5 size-5 shrink-0", COLOR[r.tone])} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-semibold leading-snug">{r.title}</span>
              {r.detail ? <span className="block text-meta text-text-secondary">{r.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
