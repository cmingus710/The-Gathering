import { Download } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { IconBadge } from "@/components/brand/logo";
import { displayName, type Viewer } from "@/lib/auth/viewer";
import type { ChurchSettings } from "@/lib/settings/queries";
import { MobileTabBar, SidebarNav } from "./member-nav";
import { SignOutButton } from "./sign-out-button";

/** Round initial avatar linking to the profile. */
function Avatar({ viewer, className = "size-10" }: { viewer: Viewer; className?: string }) {
  const initial = displayName(viewer).trim().charAt(0).toUpperCase() || "?";
  return (
    <Link
      href="/profile"
      className={`flex ${className} shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-bold text-primary ring-1 ring-primary/40`}
    >
      <span aria-hidden="true">{initial}</span>
      <span className="sr-only">Your profile</span>
    </Link>
  );
}

export function MemberShell({ viewer, settings, children }: { viewer: Viewer; settings: ChurchSettings; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-background lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <Link href="/home" className="flex items-center gap-3 px-6 pb-6 pt-7">
          <IconBadge src={settings.iconUrl} className="size-11" />
          <span className="text-lg font-bold leading-tight">{settings.churchName}</span>
        </Link>
        <div className="flex-1 overflow-y-auto px-3">
          <SidebarNav showAdmin={viewer.isAdmin} />
        </div>
        <div className="border-t border-border px-3 py-4">
          <div className="flex items-center gap-3 px-3 pb-2">
            <Avatar viewer={viewer} className="size-9" />
            <p className="min-w-0 truncate text-sm text-text-secondary">
              Signed in as <span className="font-semibold text-text">{displayName(viewer)}</span>
            </p>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 bg-background/90 backdrop-blur lg:hidden">
          <div className="grid h-16 grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 px-4">
            <Avatar viewer={viewer} />
            <Link href="/home" className="truncate text-center text-lg font-bold">
              {settings.churchName}
            </Link>
            <Link
              href="/install"
              className="flex size-11 items-center justify-center rounded-full bg-surface text-text hover:bg-surface-muted"
            >
              <Download className="size-5" aria-hidden="true" />
              <span className="sr-only">Add to Home Screen</span>
            </Link>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 pb-32 pt-4 outline-none sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          {children}
        </main>
      </div>

      <MobileTabBar showAdmin={viewer.isAdmin} signOut={<SignOutButton />} />
    </div>
  );
}
