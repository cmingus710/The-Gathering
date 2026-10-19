"use client";

import { Download, Ellipsis, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { SoonPill } from "@/components/ui/badge";
import { MEMBER_NAV, MOBILE_PRIMARY_KEYS, isActivePath, type NavItem } from "@/lib/navigation";
import { NavCount } from "@/components/community/notification-bell";
import { NavIcon } from "./nav-icon";

const available = MEMBER_NAV.filter((i): i is Extract<NavItem, { status: "available" }> => i.status === "available");
const upcoming = MEMBER_NAV.filter((i): i is Extract<NavItem, { status: "upcoming" }> => i.status === "upcoming");

function linkClass(active: boolean) {
  return cn(
    "flex min-h-11 items-center gap-3 rounded-full px-4 py-2 font-semibold transition-colors",
    active ? "bg-surface-muted text-text" : "text-text-secondary hover:bg-surface hover:text-text",
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
                {item.count ? <NavCount kind={item.count} /> : null}
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
      <h2 id="upcoming-heading" className="px-4 text-sm font-bold uppercase tracking-[0.08em] text-text-secondary">
        Coming later
      </h2>
      <ul className="mt-2 space-y-0.5">
        {upcoming.map((item) => (
          <li key={item.key} className="flex min-h-10 items-center justify-between gap-2 px-4 text-text-secondary">
            <span className="flex items-center gap-3">
              <NavIcon name={item.icon} />
              {item.label}
            </span>
            <SoonPill />
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
  const secondary = available.filter((i) => !(MOBILE_PRIMARY_KEYS as readonly string[]).includes(i.key));

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  const tab = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[0.75rem] font-semibold transition-colors",
      active ? "bg-surface-muted text-text" : "text-text-secondary hover:text-text",
    );

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-full border border-border bg-surface/95 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur lg:hidden"
      >
        <ul className="flex gap-1">
          {primary.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.key} className="flex flex-1">
                <Link href={item.href} className={cn(tab(active), "relative")} aria-current={active ? "page" : undefined}>
                  <NavIcon name={item.icon} className={cn("size-[22px]", active && "text-primary")} />
                  {item.label === "Announcements" ? "News" : item.label}
                  {item.count ? (
                    <span className="absolute right-[18%] top-1.5">
                      <NavCount kind={item.count} />
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          <li className="flex flex-1">
            <button type="button" className={tab(false)} aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
              <Ellipsis className="size-[22px]" aria-hidden="true" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={dialogRef}
        aria-labelledby="more-menu-title"
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-[1.75rem] border-t border-border bg-surface p-0 text-text backdrop:bg-black/60 lg:hidden"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="more-menu-title" className="text-xl font-bold">
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
            {secondary.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className={linkClass(isActivePath(pathname, item.href))}>
                  <NavIcon name={item.icon} />
                  {item.label}
                  {item.count ? <NavCount kind={item.count} /> : null}
                </Link>
              </li>
            ))}
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
            <h3 className="px-4 text-sm font-bold uppercase tracking-[0.08em] text-text-secondary">Coming later</h3>
            <ul className="mt-2 space-y-2">
              {upcoming.map((item) => (
                <li key={item.key} className="flex min-h-12 items-center gap-3 rounded-card bg-surface-muted px-4 text-text">
                  <NavIcon name={item.icon} className="size-5" />
                  <span className="flex-1 font-semibold">{item.label}</span>
                  <span className="rounded-md bg-background px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-primary">Soon</span>
                  <span className="sr-only">(coming soon)</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </dialog>
    </>
  );
}
