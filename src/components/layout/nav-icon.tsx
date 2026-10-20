import { Icon } from "@/components/icons/icon";
import type { IconName } from "@/lib/icons";

/** Navigation icon from the custom set; decorative (the link text is the label). */
export function NavIcon({ name, active = false, className = "size-6" }: { name: IconName; active?: boolean; className?: string }) {
  return <Icon name={name} active={active} className={className} />;
}
