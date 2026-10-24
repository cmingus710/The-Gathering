import type { BadgeTone } from "@/components/ui/badge";
import type { CollectionState } from "@/lib/devotionals/types";

export const STATE_BADGE: Record<CollectionState, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft · not visible", tone: "warning" },
  hidden: { label: "Hidden from members", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  live: { label: "Live", tone: "success" },
};
