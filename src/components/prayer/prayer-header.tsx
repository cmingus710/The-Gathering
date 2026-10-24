import type { ReactNode } from "react";
import { SectionHeader } from "@/components/ui/section-header";

/**
 * Compact heading shared by the Prayer pages (Requests and the Prayer
 * Library tabs): the section header with the Prayer artwork and banner, a
 * short description, and the primary action (right-aligned when there's
 * room, full width on a phone). `shortcut` sits at the end of the title row
 * on a phone only (for example, a jump to the care tools that appear in a
 * side panel on wider screens).
 */
export function PrayerHeader({ description, action, shortcut }: { description: ReactNode; action?: ReactNode; shortcut?: ReactNode }) {
  return <SectionHeader section="prayer" description={description} actions={action} aside={shortcut} stretchActions />;
}
