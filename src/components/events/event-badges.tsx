import { Archive, Ban, CircleCheck, Clock, Globe, Hourglass, ListOrdered, Lock, PencilLine, Users, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RsvpState, SeriesStatus } from "@/lib/events/types";

const ic = "size-3.5";

/** Registration status for the signed-in member: icon + words, never colour alone. */
export function RsvpBadge({ state, position }: { state: RsvpState; position?: number | null }) {
  switch (state) {
    case "confirmed":
      return <Badge tone="success" icon={<CircleCheck className={ic} aria-hidden="true" />}>You&apos;re registered</Badge>;
    case "waitlisted":
      return (
        <Badge tone="warning" icon={<ListOrdered className={ic} aria-hidden="true" />}>
          Waitlist{position ? ` #${position}` : ""}
        </Badge>
      );
    case "canceled":
      return <Badge tone="danger" icon={<Ban className={ic} aria-hidden="true" />}>Canceled</Badge>;
    case "full":
      return <Badge tone="neutral" icon={<Users className={ic} aria-hidden="true" />}>Full</Badge>;
    case "waitlist":
      return <Badge tone="neutral" icon={<ListOrdered className={ic} aria-hidden="true" />}>Full · waitlist open</Badge>;
    case "closed":
      return <Badge tone="neutral" icon={<Clock className={ic} aria-hidden="true" />}>Registration closed</Badge>;
    default:
      return null;
  }
}

export function AudienceBadge({ audience }: { audience: "public" | "members" | "group" }) {
  if (audience === "group") return <Badge tone="info" icon={<Users className={ic} aria-hidden="true" />}>Group only</Badge>;
  return audience === "public" ? (
    <Badge tone="info" icon={<Globe className={ic} aria-hidden="true" />}>Public</Badge>
  ) : (
    <Badge tone="info" icon={<Lock className={ic} aria-hidden="true" />}>Members only</Badge>
  );
}

export function SeriesStatusBadge({ status, scheduled }: { status: SeriesStatus; scheduled?: boolean }) {
  switch (status) {
    case "published":
      return scheduled ? (
        <Badge tone="warning" icon={<Clock className={ic} aria-hidden="true" />}>Scheduled</Badge>
      ) : (
        <Badge tone="success" icon={<CircleCheck className={ic} aria-hidden="true" />}>Published</Badge>
      );
    case "canceled":
      return <Badge tone="danger" icon={<XCircle className={ic} aria-hidden="true" />}>Canceled</Badge>;
    case "archived":
      return <Badge tone="neutral" icon={<Archive className={ic} aria-hidden="true" />}>Archived</Badge>;
    default:
      return <Badge tone="info" icon={<PencilLine className={ic} aria-hidden="true" />}>Draft</Badge>;
  }
}

export function WaitlistCount({ n }: { n: number }) {
  return <Badge tone="neutral" icon={<Hourglass className={ic} aria-hidden="true" />}>{n} waiting</Badge>;
}
