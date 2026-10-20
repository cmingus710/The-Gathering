/* eslint-disable @next/next/no-img-element -- brand art is pre-optimized (scripts/generate-brand-assets.mjs) and may come from Supabase Storage; plain <img> keeps exact proportions without a remote-image config. */
import { DEFAULT_ICON, DEFAULT_LOGO } from "@/lib/settings/queries";
import { cn } from "@/components/ui/cn";

/**
 * The approved full logo. Width is set by the caller; height always follows the
 * artwork's own aspect ratio (never stretched, cropped, or recoloured).
 */
export function FullLogo({
  src = DEFAULT_LOGO.src,
  alt = "The Gathering",
  className,
  priority = false,
}: {
  src?: string;
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  const isDefault = src === DEFAULT_LOGO.src;
  return (
    <img
      src={src}
      alt={alt}
      width={isDefault ? DEFAULT_LOGO.width : undefined}
      height={isDefault ? DEFAULT_LOGO.height : undefined}
      className={cn("h-auto max-w-full object-contain", className)}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
    />
  );
}

/** The approved icon mark for compact navigation. Decorative unless alt is given. */
export function IconMark({ src = DEFAULT_ICON.src, alt = "", className }: { src?: string; alt?: string; className?: string }) {
  const isDefault = src === DEFAULT_ICON.src;
  return (
    <img
      src={src}
      alt={alt}
      width={isDefault ? DEFAULT_ICON.width : undefined}
      height={isDefault ? DEFAULT_ICON.height : undefined}
      className={cn("h-9 w-auto object-contain", className)}
      decoding="async"
    />
  );
}

/**
 * The full logo on its theme plate: bare on the light theme, on an ivory
 * plaque in dark mode (the charcoal lettering would disappear on dark
 * surfaces), never recoloured.
 */
export function LogoPlaque({
  src,
  alt,
  className,
  logoClassName,
  priority,
}: {
  src?: string;
  alt?: string;
  className?: string;
  logoClassName?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("brand-plaque inline-flex items-center justify-center rounded-card px-6 py-5", className)}>
      <FullLogo src={src} alt={alt} className={logoClassName} priority={priority} />
    </div>
  );
}

/**
 * The symbol for compact headers: bare on light, inside an ivory disc on dark.
 * Decorative unless alt is given.
 */
export function IconBadge({ src, alt = "", className }: { src?: string; alt?: string; className?: string }) {
  return (
    <span className={cn("brand-mark inline-flex size-10 shrink-0 items-center justify-center rounded-full", className)}>
      <IconMark src={src} alt={alt} className="h-(--mark-img) w-auto" />
    </span>
  );
}
