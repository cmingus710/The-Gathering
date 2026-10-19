import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-card bg-surface p-5 sm:p-6", className)} {...rest} />;
}

/** Uppercase section label with an optional gold action link on the right. */
export function SectionHeading({
  children,
  id,
  action,
  as: Tag = "h2",
}: {
  children: ReactNode;
  id?: string;
  action?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <Tag id={id} className="text-[0.95rem] font-bold uppercase tracking-[0.08em] text-text">
        {children}
      </Tag>
      {action}
    </div>
  );
}

/** "VIEW ALL >" style link used beside section headings. */
export function SectionLink({ href, children, label }: { href: string; children: ReactNode; label?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex min-h-11 items-center gap-1 text-sm font-bold uppercase tracking-[0.08em] text-primary hover:text-primary-hover"
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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? <p className="mb-1 text-sm font-bold uppercase tracking-[0.08em] text-text-secondary">{eyebrow}</p> : null}
        <h1 className="text-[1.75rem] font-bold leading-tight text-text sm:text-[2rem]">{title}</h1>
        {description ? <p className="mt-2 text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

/**
 * Rounded list row: leading icon, label, optional trailing detail
 * (duration, badge, check). Renders as a link when href is given.
 */
export function ListRow({
  icon,
  label,
  description,
  trailing,
  href,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      {icon ? <span className="flex size-7 shrink-0 items-center justify-center text-text">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.05rem] font-semibold text-text">{label}</span>
        {description ? <span className="block truncate text-[0.95rem] text-text-secondary">{description}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-[0.95rem] text-text-secondary">{trailing}</span> : null}
    </>
  );
  const classes = cn("flex min-h-16 items-center gap-4 rounded-card bg-surface px-5 py-3", className);
  return href ? (
    <Link href={href} className={cn(classes, "transition-colors hover:bg-surface-muted")}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-card px-5 py-12 text-center">
      {icon ? <div className="mb-3 flex size-12 items-center justify-center text-text-secondary">{icon}</div> : null}
      <p className="text-lg font-bold text-text-secondary">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-sm text-text-secondary">{children}</div> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
