import type { ReactNode } from "react";
import { TileIcon } from "@/components/icons/icon";
import { SECTIONS, sectionBackgroundStyle, sectionIcon, type SectionKey } from "@/lib/section-headers/sections";
import { cn } from "./cn";

/**
 * The page heading of a member section (approved section-header design):
 * the section's menu artwork, the title (the page's one h1), a short
 * description, and optional actions, on the section's decorative banner
 * (charcoal and gold on dark, ivory and gold on light) with a fine gold rule.
 *
 * - The banner is a CSS background chosen by the resolved theme in
 *   globals.css (.section-header), so the first paint is already right, a
 *   theme change while the page is open swaps it, and only the image in use
 *   is downloaded. It's decorative: no alt text, nothing announced.
 * - "full" is for section landing pages; "compact" is a slimmer version for
 *   pages inside a section, and for Messages, where the list matters most.
 * - Text sits on the artwork's quiet left side over a fade in the artwork's
 *   own edge colour; on phones the artwork recedes further rather than the
 *   banner growing. Long titles, translations, and enlarged text wrap and the
 *   banner grows to fit; actions wrap beneath only when they don't fit.
 * - `aside` sits at the end of the title row on phones only (for example a
 *   jump to tools that are in a side panel on wider screens).
 */
export function SectionHeader({
  section,
  title,
  description,
  eyebrow,
  actions,
  aside,
  size = "full",
  stretchActions = false,
  className,
}: {
  section: SectionKey;
  /** Defaults to the section's approved name. */
  title?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  size?: "full" | "compact";
  /** On phones, actions fill the width beneath the title (a single primary action). */
  stretchActions?: boolean;
  className?: string;
}) {
  const config = SECTIONS[section];
  const art = sectionIcon(section);
  const compact = size === "compact";
  return (
    <header className={cn("section-header", compact && "section-header--compact", className)} style={sectionBackgroundStyle(section)} data-section={section}>
      <span aria-hidden="true" className="section-header-art" />
      <div className="section-header-main">
        {art ? (
          // Decorative: the section's dimensional menu artwork (the heading names the section).
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP copies with srcset (scripts/generate-menu-icons.mjs)
          <img
            src={art.src}
            srcSet={art.srcSet}
            sizes={compact ? "40px" : "(min-width: 640px) 64px, 46px"}
            alt=""
            width={64}
            height={64}
            decoding="async"
            className="section-header-icon"
          />
        ) : (
          <TileIcon name={config.glyph} className="section-header-icon" />
        )}
        <div className="section-header-text">
          {eyebrow ? <p className="section-header-description font-semibold">{eyebrow}</p> : null}
          <div className="flex flex-wrap items-center gap-x-3">
            <h1 className="section-header-title min-w-0 flex-1 font-display font-semibold text-text [overflow-wrap:anywhere]">{title ?? config.label}</h1>
            {aside ? <div className="section-header-aside shrink-0 lg:hidden">{aside}</div> : null}
          </div>
          {description ? <p className="section-header-description [overflow-wrap:anywhere]">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className={cn("section-header-actions", stretchActions && "section-header-actions--stretch")}>{actions}</div> : null}
    </header>
  );
}
