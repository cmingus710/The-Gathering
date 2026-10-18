import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(54,52,48,0.06)] sm:p-6", className)} {...rest} />;
}

export function SectionHeading({ children, id, action, as: Tag = "h2" }: { children: ReactNode; id?: string; action?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <Tag id={id} className="font-serif text-xl font-semibold text-text sm:text-[1.35rem]">
        {children}
      </Tag>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-text-secondary">{eyebrow}</p> : null}
        <h1 className="font-serif text-[1.85rem] font-semibold leading-tight text-text sm:text-[2.2rem]">{title}</h1>
        <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-full bg-brand-gold" />
        {description ? <p className="mt-3 text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-border-strong bg-surface px-5 py-8 text-center">
      {icon ? <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-surface-muted text-text">{icon}</div> : null}
      <p className="font-semibold text-text">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-text-secondary">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
