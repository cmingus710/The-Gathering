"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type MenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Runs after the menu closes. */
  onSelect?: () => void;
  /** Opens this dialog (through the menu's onDialog) after the menu closes, so the dialog takes focus. */
  dialog?: string;
  href?: string;
  danger?: boolean;
};

/**
 * The three-dot menu on posts and comments. A button with aria-expanded
 * opens a role="menu" list: arrow keys, Home, and End move between items;
 * Escape or Tab closes it (Escape returns focus to the button), and so does
 * a tap outside. It works by tap, click, or keyboard; nothing needs hover or
 * a long press. Showing an item here is never the permission check: the
 * server re-checks every action.
 */
export function ActionMenu({
  label,
  items,
  onDialog,
  className,
}: {
  label: string;
  items: MenuItem[];
  onDialog?: (dialog: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const itemsEls = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    itemsEls()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!items.length) return null;

  function close(focusButton: boolean) {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const els = itemsEls();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const itemClass = (danger?: boolean) =>
    cn(
      "flex min-h-11 w-full items-center gap-3 px-4 text-left text-[0.9375rem] font-semibold outline-none hover:bg-surface-muted focus-visible:bg-surface-muted",
      danger ? "text-danger" : "text-text",
    );

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex size-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-muted hover:text-text focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </button>
      {open ? (
        <ul
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-border bg-surface py-1 shadow-(--elev-lift)"
        >
          {items.map((item) => (
            <li key={item.key} role="none">
              {item.href ? (
                <Link role="menuitem" href={item.href} tabIndex={-1} className={itemClass(item.danger)} onClick={() => setOpen(false)}>
                  {item.icon}
                  {item.label}
                </Link>
              ) : (
                <button
                  role="menuitem"
                  type="button"
                  tabIndex={-1}
                  className={itemClass(item.danger)}
                  onClick={() => {
                    close(true);
                    item.onSelect?.();
                    if (item.dialog) onDialog?.(item.dialog);
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
