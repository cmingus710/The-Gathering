import { Archive, CircleCheck, CircleDashed, Clock, Globe, Hourglass, Lock, Pin, PencilLine, ShieldOff, TimerOff } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClass: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-text border-transparent",
  success: "bg-success-soft text-success border-success/40",
  warning: "bg-primary-soft text-primary border-primary/40",
  danger: "bg-danger-soft text-danger border-danger/40",
  info: "bg-surface text-text border-border-strong",
};

export function Badge({ tone = "neutral", icon, children, className }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-bold whitespace-nowrap", toneClass[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

const ic = "size-3.5";

export function MembershipBadge({ status }: { status: "pending" | "approved" | "suspended" }) {
  if (status === "approved") return <Badge tone="success" icon={<CircleCheck className={ic} aria-hidden="true" />}>Approved</Badge>;
  if (status === "suspended") return <Badge tone="danger" icon={<ShieldOff className={ic} aria-hidden="true" />}>Suspended</Badge>;
  return <Badge tone="warning" icon={<Hourglass className={ic} aria-hidden="true" />}>Pending approval</Badge>;
}

export function AnnouncementStatusBadge({ status }: { status: "draft" | "scheduled" | "live" | "expired" | "archived" }) {
  switch (status) {
    case "live":
      return <Badge tone="success" icon={<CircleCheck className={ic} aria-hidden="true" />}>Published</Badge>;
    case "scheduled":
      return <Badge tone="warning" icon={<Clock className={ic} aria-hidden="true" />}>Scheduled</Badge>;
    case "expired":
      return <Badge tone="neutral" icon={<TimerOff className={ic} aria-hidden="true" />}>Expired</Badge>;
    case "archived":
      return <Badge tone="neutral" icon={<Archive className={ic} aria-hidden="true" />}>Archived</Badge>;
    default:
      return <Badge tone="info" icon={<PencilLine className={ic} aria-hidden="true" />}>Draft</Badge>;
  }
}

export function VisibilityBadge({ visibility }: { visibility: "public" | "members" }) {
  return visibility === "public" ? (
    <Badge tone="info" icon={<Globe className={ic} aria-hidden="true" />}>Public</Badge>
  ) : (
    <Badge tone="info" icon={<Lock className={ic} aria-hidden="true" />}>Members only</Badge>
  );
}

export function PinnedBadge() {
  return <Badge tone="warning" icon={<Pin className={ic} aria-hidden="true" />}>Pinned</Badge>;
}

export function UpcomingBadge({ children = "Coming soon" }: { children?: ReactNode }) {
  return <Badge tone="neutral" icon={<CircleDashed className={ic} aria-hidden="true" />}>{children}</Badge>;
}

/** Small uppercase pill, like a plan tag, marking modules from later phases. */
export function SoonPill() {
  return (
    <span className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-primary">
      Soon
    </span>
  );
}
