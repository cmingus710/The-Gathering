import { CircleDashed, Sprout, Repeat, Leaf } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STAGES } from "@/lib/memory/format";
import type { Stage } from "@/lib/memory/types";

const ICONS = { new: CircleDashed, learning: Sprout, reviewing: Repeat, well_known: Leaf } as const;

/** A verse's place in the review schedule (icon and words, never colour alone). */
export function StageBadge({ stage }: { stage: Stage }) {
  const Icon = ICONS[stage];
  return (
    <Badge tone={stage === "new" ? "neutral" : stage === "learning" ? "info" : "success"} icon={<Icon className="size-3.5" aria-hidden="true" />}>
      {STAGES[stage].label}
    </Badge>
  );
}
