"use client";

import { Download, LifeBuoy, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { NavCount } from "@/components/community/notification-bell";
import { DockGlyph, type DockGlyphName } from "@/components/icons/dock-glyphs";
import { Icon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";
import { MEMBER_NAV, MOBILE_PRIMARY_KEYS, NAV_SECTIONS, isActivePath, type NavItem, type NavSection } from "@/lib/navigation";

type Available = Extract<NavItem, { status: "available" }>;
const available = MEMBER_NAV.filter((i): i is Available => i.status === "available");
const upcoming = MEMBER_NAV.filter((i): i is Extract<NavItem, { status: "upcoming" }> => i.status === "upcoming");
const inSection = (items: Available[], section: NavSection) => items.filter((i) => i.section === section);

function rowClass(active: boolean) {
  return cn(
    "group flex min-h-11 items-center gap-3 rounded-tile px-3 py-1.5 font-semibold transition-colors",
    active ? "bg-primary-soft text-text" : "text-text-secondary hover:bg-surface-muted hover:text-text",
  );
}

function NavRow({ item, pathname }: { item: Available; pathname: string }) {
  const active = isActivePath(pathname, item.href);
  return (
    <Link href={item.href} className={rowClass(active)} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} active={active} className="size-6" />
      <span className="min-w-0 flex-1 break-words leading-tight">{item.label}</span>
      {item.count ? <NavCount kind={item.count} /> : null}
    </Link>
  );
}

function SectionLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="px-3 pb-1 text-eyebrow font-semibold text-text-secondary">
      {children}
    </h2>
  );
}

function UpcomingList({ idPrefix }: { idPrefix: string }) {
  if (upcoming.length === 0) return null;
  return (
    <section aria-labelledby={`${idPrefix}-upcoming`}>
      <SectionLabel id={`${idPrefix}-upcoming`}>Coming later</SectionLabel>
      <ul className="space-y-0.5">
        {upcoming.map((item) => (
          <li key={item.key} className="flex min-h-10 items-center gap-3 px-3 text-text-secondary">
            <Icon name={item.icon} className="size-5 opacity-80" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="sr-only">(not available yet)</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Report a problem" (Phase 12). Passes only the current path (never the
 * query string) so the report can say where it happened; the member can
 * leave it out on the form.
 */
function ReportProblemLink({ pathname, compact }: { pathname: string; compact?: boolean }) {
  const active = pathname === "/report-problem";
  const href = active ? "/report-problem" : `/report-problem?from=${encodeURIComponent(pathname)}`;
  return (
    <Link href={href} className={rowClass(active)} aria-current={active ? "page" : undefined}>
      <LifeBuoy className="size-6 p-0.5" aria-hidden="true" />
      <span className={cn("min-w-0", compact ? "truncate" : "flex-1 break-words leading-tight")}>Report a problem</span>
    </Link>
  );
}

/** Desktop sidebar links, grouped into the same sections as the phone More menu. */
export function SidebarNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {NAV_SECTIONS.map((section) => (
        <section key={section.key} aria-labelledby={`side-${section.key}`}>
          <SectionLabel id={`side-${section.key}`}>{section.label}</SectionLabel>
          <ul className="space-y-0.5">
            {inSection(available, section.key).map((item) => (
              <li key={item.key}>
                <NavRow item={item} pathname={pathname} />
              </li>
            ))}
            {section.key === "you" ? (
              <li>
                <ReportProblemLink pathname={pathname} />
              </li>
            ) : null}
            {section.key === "you" && showAdmin ? (
              <li>
                <Link href="/admin" className={rowClass(false)}>
                  <Icon name="admin" className="size-6" />
                  Administration
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ))}
      <UpcomingList idPrefix="side" />
    </nav>
  );
}

/**
 * Phone dock: four primary destinations plus More, on a full-width bar docked
 * to the bottom edge (smoked glass on dark, translucent ivory on light, solid
 * where blur is unsupported). The bar's background runs to the screen edge and
 * the safe-area inset is padding inside it (see .dock in globals.css). The
 * page reserves --dock-clearance below its content, and focus scrolling keeps
 * the same margin, so the dock never covers the last content, form actions,
 * or focus.
 */
export function MobileTabBar({ showAdmin, signOut, appearance }: { showAdmin: boolean; signOut: ReactNode; appearance: ReactNode }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primary = MOBILE_PRIMARY_KEYS.map((k) => available.find((i) => i.key === k)!).filter(Boolean);
  const secondary = available.filter((i) => !(MOBILE_PRIMARY_KEYS as readonly string[]).includes(i.key));
  const moreActive = secondary.some((i) => isActivePath(pathname, i.href)) || pathname === "/install" || pathname === "/report-problem";

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  const tab = (active: boolean) =>
    cn(
      "relative flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[1.375rem] px-1 text-[0.75rem] leading-none transition-colors",
      active ? "dock-active font-bold" : "font-semibold text-text-secondary hover:text-text",
    );

  return (
    <>
      <nav
        aria-label="Main"
        className="dock fixed inset-x-0 bottom-0 z-40 rounded-t-[1.25rem] lg:hidden"
      >
        <ul className="mx-auto flex h-(--dock-height) max-w-lg items-center gap-0.5 px-1.5">
          {primary.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.key} className="flex min-w-0 flex-1">
                <Link href={item.href} className={tab(active)} aria-current={active ? "page" : undefined}>
                  <span className="relative">
                    <DockGlyph name={item.key as DockGlyphName} className="size-[1.375rem]" />
                    {item.count ? (
                      <span className="absolute -right-2.5 -top-1.5">
                        <NavCount kind={item.count} />
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-full truncate pt-0.5">{item.shortLabel ?? item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button type="button" className={tab(moreActive)} aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
              <DockGlyph name="more" className="size-[1.375rem]" />
              <span className="max-w-full truncate pt-0.5">More</span>
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={dialogRef}
        aria-labelledby="more-menu-title"
        className="sheet fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-[1.5rem] border-t border-border bg-surface p-0 text-text shadow-(--elev-lift) backdrop:bg-black/45 lg:hidden"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="px-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2">
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong/50" />
          <div className="mb-2 flex items-center justify-between px-3">
            <h2 id="more-menu-title" className="font-display text-xl font-semibold">
              More
            </h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="-mr-2 flex size-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-muted hover:text-text"
            >
              <X className="size-5" aria-hidden="true" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <div className="space-y-4">
            {NAV_SECTIONS.map((section) => {
              const items = inSection(secondary, section.key);
              if (!items.length && !(section.key === "you")) return null;
              return (
                <section key={section.key} aria-labelledby={`more-${section.key}`}>
                  <SectionLabel id={`more-${section.key}`}>{section.label}</SectionLabel>
                  <ul className="grid grid-cols-2 gap-1">
                    {items.map((item) => (
                      <li key={item.key} className="min-w-0">
                        <NavRow item={item} pathname={pathname} />
                      </li>
                    ))}
                    {section.key === "you" ? (
                      <li className="min-w-0">
                        <Link href="/install" className={rowClass(pathname === "/install")}>
                          <Download className="size-6 p-0.5" aria-hidden="true" />
                          <span className="min-w-0 truncate">Install app</span>
                        </Link>
                      </li>
                    ) : null}
                    {section.key === "you" ? (
                      <li className="min-w-0">
                        <ReportProblemLink pathname={pathname} compact />
                      </li>
                    ) : null}
                  </ul>
                </section>
              );
            })}
            {showAdmin ? (
              <section aria-labelledby="more-admin">
                <SectionLabel id="more-admin">Administration</SectionLabel>
                <Link href="/admin" className={rowClass(false)}>
                  <Icon name="admin" className="size-6" />
                  Open administration
                </Link>
              </section>
            ) : null}
            <div className="px-3">{appearance}</div>
            <div className="border-t border-border pt-3">{signOut}</div>
            <div className="border-t border-border pt-3">
              <UpcomingList idPrefix="more" />
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

