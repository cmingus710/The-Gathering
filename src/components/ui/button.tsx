import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";
export type ButtonSize = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold leading-tight transition-colors " +
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55 " +
  "select-none text-center";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-cta text-on-cta hover:bg-cta-hover active:bg-cta-hover disabled:hover:bg-cta",
  secondary:
    "bg-surface-muted text-text border border-border hover:border-border-strong active:bg-surface disabled:hover:border-border",
  ghost: "bg-transparent text-primary hover:bg-primary-soft active:bg-primary-soft",
  danger: "bg-danger text-on-cta hover:bg-danger-hover active:bg-danger-hover disabled:hover:bg-danger",
  "danger-outline": "bg-transparent text-danger border border-danger hover:bg-danger-soft active:bg-danger-soft",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-12 px-6 py-2.5 text-base",
  sm: "min-h-11 px-4 py-2 text-[0.95rem]",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  icon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingText,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode };

export function ButtonLink({ variant = "primary", size = "md", icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
