/* eslint-disable @next/next/no-img-element -- short-lived signed Supabase Storage URLs; next/image would cache private photos in the optimizer. */
import { cn } from "@/components/ui/cn";
import { initials } from "@/lib/directory/format";

const SIZES = {
  sm: "size-12 text-base",
  md: "size-16 text-xl",
  lg: "size-28 text-3xl",
} as const;

/**
 * Member photo, or initials when there is no photo or it isn't shared. The
 * name is announced by the surrounding content, so the image is decorative.
 */
export function MemberAvatar({ name, photoUrl, size = "md", className }: { name: string; photoUrl?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const classes = cn("shrink-0 overflow-hidden rounded-full", SIZES[size], className);
  if (photoUrl) {
    return <img src={photoUrl} alt="" className={cn(classes, "bg-surface-muted object-cover")} referrerPolicy="no-referrer" />;
  }
  return (
    <span aria-hidden="true" className={cn(classes, "flex items-center justify-center bg-primary-soft font-bold text-primary ring-1 ring-primary/40")}>
      {initials(name)}
    </span>
  );
}
