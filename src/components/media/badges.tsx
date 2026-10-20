import { Archive, CircleAlert, CircleCheck, Clock, Globe, LoaderCircle, Lock, PencilLine, ShieldCheck, ShieldQuestion, TimerOff, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Audience, ItemState } from "@/lib/media/types";

const ic = "size-3.5";

export function AssetStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ready":
      return <Badge tone="success" icon={<CircleCheck className={ic} aria-hidden="true" />}>Ready</Badge>;
    case "uploading":
    case "processing":
      return <Badge tone="warning" icon={<LoaderCircle className={ic} aria-hidden="true" />}>{status === "uploading" ? "Uploading" : "Processing"}</Badge>;
    case "failed":
      return <Badge tone="danger" icon={<CircleAlert className={ic} aria-hidden="true" />}>Failed</Badge>;
    default:
      return <Badge tone="neutral" icon={<Archive className={ic} aria-hidden="true" />}>Removed</Badge>;
  }
}

export const RIGHTS_LABEL: Record<string, string> = {
  unknown: "Not confirmed",
  church_owned: "Church owned",
  licensed: "Licensed",
  permission: "Used with permission",
  public_domain: "Public domain",
};

export function RightsBadge({ rights, confirmed }: { rights: string; confirmed: boolean }) {
  return rights !== "unknown" && confirmed ? (
    <Badge tone="success" icon={<ShieldCheck className={ic} aria-hidden="true" />}>{RIGHTS_LABEL[rights]}</Badge>
  ) : (
    <Badge tone="warning" icon={<ShieldQuestion className={ic} aria-hidden="true" />}>Rights not confirmed</Badge>
  );
}

export function StateBadge({ state }: { state: ItemState }) {
  switch (state) {
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

export function AudienceBadge({ audience, groupName }: { audience: Audience; groupName?: string | null }) {
  if (audience === "public") return <Badge tone="info" icon={<Globe className={ic} aria-hidden="true" />}>Public</Badge>;
  if (audience === "group") return <Badge tone="info" icon={<Users className={ic} aria-hidden="true" />}>{groupName ? `Group: ${groupName}` : "Group"}</Badge>;
  return <Badge tone="info" icon={<Lock className={ic} aria-hidden="true" />}>Members</Badge>;
}
