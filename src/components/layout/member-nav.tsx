"use client";

import { Download, Ellipsis, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { UpcomingBadge } from "@/components/ui/badge";
import { MEMBER_NAV, MOBILE_PRIMARY_KEYS, isActivePath, type NavItem } from "@/lib/navigation";
import { NavIcon } from "./nav-icon";

const available = MEMBER_NAV.filter((i): i is Extract<NavItem, { status: "available" }> => i.status === "available");
const upcoming = MEMBER_NAV.filter((i): i is Extract<NavItem, { status: "upcoming" }> => i.status === "upcoming");

function linkClass(active: boolean) {
  return cn(
    "flex min-h-11 items-center gap-3 rounded-control px-3 py-2 font-semibold transition-colors",
    active ? "bg-surface-muted text-text shadow-[inset_3px_0_0_var(--color-brand-gold)]" : "text-text hover:bg-surface-muted",
  );
}

/** Desktop sidebar links. */
export function SidebarNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-6">
      <ul className="space-y-1">
        {available.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.key}>
              <Link href={item.href} className={linkClass(active)} aria-current={active ? "page" : undefined}>
                <NavIcon name={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
        {showAdmin ? (
          <li>
            <Link href="/admin" className={linkClass(pathname.startsWith("/admin"))}>
              <ShieldCheck className="size-5" aria-hidden="true" />
              Administration
            </Link>
          </li>
        ) : null}
      </ul>
      <UpcomingList />
    </nav>
  );
}

function UpcomingList() {
  return (
    <section aria-labelledby="upcoming-heading">
      <h2 id="upcoming-heading" className="px-3 text-sm font-semibold uppercase tracking-wider text-text-secondary">
        Coming later
      </h2>
      <ul className="mt-2 space-y-0.5">
        {upcoming.map((item) => (
          <li key={item.key} className="flex min-h-10 items-center justify-between gap-2 px-3 text-text-secondary">
            <span className="flex items-center gap-3">
              <NavIcon name={item.icon} />
              {item.label}
            </span>
            <span className="sr-only">(coming soon)</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Phone tab bar: a small primary set plus a More sheet. */
export function MobileTabBar({ showAdmin, signOut }: { showAdmin: boolean; signOut: React.ReactNode }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primary = available.filter((i) => (MOBILE_PRIMARY_KEYS as readonly string[]).includes(i.key));

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  const tab = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.8rem] font-semibold",
      active ? "text-text" : "text-text-secondary hover:text-text",
    );

  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-lg">
          {primary.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.key} className="flex flex-1">
                <Link href={item.href} className={tab(active)} aria-current={active ? "page" : undefined}>
                  <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", active && "bg-surface-muted")}>
                    <NavIcon name={item.icon} />
                  </span>
                  {item.label === "Announcements" ? "News" : item.label}
                </Link>
              </li>
            );
          })}
          <li className="flex flex-1">
            <button type="button" className={tab(false)} aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
              <span className="flex h-7 w-12 items-center justify-center rounded-full">
                <Ellipsis className="size-5" aria-hidden="true" />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={dialogRef}
        aria-labelledby="more-menu-title"
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl bg-surface p-0 text-text backdrop:bg-brand-charcoal/50 lg:hidden"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="more-menu-title" className="font-serif text-xl font-semibold">
              More
            </h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="flex size-11 items-center justify-center rounded-full hover:bg-surface-muted"
            >
              <X className="size-5" aria-hidden="true" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <ul className="space-y-1">
            {showAdmin ? (
              <li>
                <Link href="/admin" className={linkClass(false)}>
                  <ShieldCheck className="size-5" aria-hidden="true" />
                  Administration
                </Link>
              </li>
            ) : null}
            <li>
              <Link href="/install" className={linkClass(pathname === "/install")}>
                <Download className="size-5" aria-hidden="true" />
                Add to Home Screen
              </Link>
            </li>
            <li>{signOut}</li>
          </ul>
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="px-3 text-sm font-semibold uppercase tracking-wider text-text-secondary">Coming later</h3>
            <ul className="mt-2 grid grid-cols-2 gap-1">
              {upcoming.map((item) => (
                <li key={item.key} className="flex min-h-11 items-center gap-2 px-3 text-text-secondary">
                  <NavIcon name={item.icon} className="size-[18px]" />
                  {item.label}
                  <span className="sr-only">(coming soon)</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 px-3">
              <UpcomingBadge>These areas arrive in later phases</UpcomingBadge>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
