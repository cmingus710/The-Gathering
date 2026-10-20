import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, Hourglass } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const ICON: Record<BadgeTone, typeof CircleCheck> = {
  success: CircleCheck,
  warning: Hourglass,
  danger: CircleAlert,
  neutral: CircleMinus,
  info: CircleDashed,
};

/** A state shown with an icon and words, never by color alone. */
export function StateBadge({ map, value }: { map: Record<string, { label: string; tone: BadgeTone }>; value: string | null | undefined }) {
  const s = (value && map[value]) || { label: value ?? "Unknown", tone: "neutral" as BadgeTone };
  const I = ICON[s.tone];
  return (
    <Badge tone={s.tone} icon={<I className="size-3.5" aria-hidden="true" />}>
      {s.label}
    </Badge>
  );
}
