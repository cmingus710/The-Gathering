import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { SpotIcon } from "@/components/icons/icon";
import type { IconName } from "@/lib/icons";
import { cn } from "./cn";

/** Restrained surface for forms and grouped content. */
export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-border bg-surface p-5 shadow-(--elev-card) sm:p-6", className)} {...rest} />;
}

/** Sentence-case section heading with an optional action on the right. */
export function SectionHeading({
  children,
  id,
  action,
  as: Tag = "h2",
  description,
}: {
  children: ReactNode;
  id?: string;
  action?: ReactNode;
  as?: "h2" | "h3";
  description?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <Tag id={id} className="text-[1.125rem] font-semibold leading-snug text-text">
          {children}
        </Tag>
        {description ? <p className="text-meta text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** "View all ›" link beside section headings. Omit it when there is nothing to view. */
export function SectionLink({ href, children, label }: { href: string; children: ReactNode; label?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="-mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-full px-2 text-meta font-semibold text-primary transition-colors hover:bg-primary-soft hover:text-primary-hover"
    >
      {children}
      <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-8">
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? <p className="mb-1 text-meta font-semibold text-text-secondary">{eyebrow}</p> : null}
        <h1 className="font-display text-display font-semibold text-text [overflow-wrap:anywhere] sm:text-[2.125rem]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-[60ch] text-text-secondary [overflow-wrap:anywhere]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** Container for compact rows (conversations, threads, categories): one surface, hairline dividers. */
export const rowListClass = "divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-(--elev-card)";

/**
 * Compact row: leading icon, label, optional trailing detail (time, badge,
 * chevron). Renders as a link when href is given.
 */
export function ListRow({
  icon,
  label,
  description,
  trailing,
  href,
  className,
  plain = false,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  className?: string;
  /** Inside a rowListClass container: no own border or radius. */
  plain?: boolean;
}) {
  const body = (
    <>
      {icon ? <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-title font-semibold text-text">{label}</span>
        {description ? <span className="block truncate text-meta text-text-secondary">{description}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-meta text-text-secondary">{trailing}</span> : null}
    </>
  );
  const classes = cn(
      "flex min-h-14 items-center gap-3.5 px-4 py-2.5",
      plain ? "bg-transparent" : "rounded-tile border border-border bg-surface",
      className,
    );
  return href ? (
    <Link href={href} className={cn(classes, plain ? "transition-colors hover:bg-surface-muted/60" : "interactive hover:bg-surface-muted/60")}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/**
 * Compact empty state: a small illustration, a short title, one helpful line,
 * and an optional action (for example an administrator-only setup link).
 */
export function EmptyState({
  icon,
  glyph,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  /** Custom illustration from the icon set (preferred over icon). */
  glyph?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    // Wraps so the text drops below the illustration when there's no room beside it (large text on a narrow phone).
    <div className={cn("flex flex-wrap items-center gap-4 rounded-card border border-dashed border-border px-4 py-4 sm:px-5", className)}>
      {glyph ? (
        <SpotIcon name={glyph} className="size-12" />
      ) : icon ? (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-secondary">{icon}</span>
      ) : null}
      <div className="min-w-[min(100%,9rem)] flex-1">
        <p className="font-semibold text-text">{title}</p>
        {children ? <div className="text-meta text-text-secondary">{children}</div> : null}
        {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
