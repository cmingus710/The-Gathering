import Link from "next/link";
import type { ReactNode } from "react";
import { IconMark } from "@/components/brand/logo";
import { displayName, type Viewer } from "@/lib/auth/viewer";
import type { ChurchSettings } from "@/lib/settings/queries";
import { MobileTabBar, SidebarNav } from "./member-nav";
import { SignOutButton } from "./sign-out-button";

export function MemberShell({ viewer, settings, children }: { viewer: Viewer; settings: ChurchSettings; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-surface lg:flex lg:sticky lg:top-0 lg:h-dvh">
        <Link href="/home" className="flex items-center gap-3 px-6 pb-6 pt-7">
          <IconMark src={settings.iconUrl} className="h-11" />
          <span className="font-serif text-lg font-semibold leading-tight">{settings.churchName}</span>
        </Link>
        <div className="flex-1 overflow-y-auto px-3">
          <SidebarNav showAdmin={viewer.isAdmin} />
        </div>
        <div className="border-t border-border px-3 py-4">
          <p className="truncate px-3 pb-2 text-sm text-text-secondary">
            Signed in as <span className="font-semibold text-text">{displayName(viewer)}</span>
          </p>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur lg:hidden">
          <div className="flex h-16 items-center gap-3 px-4">
            <Link href="/home" className="flex items-center gap-2.5">
              <IconMark src={settings.iconUrl} className="h-9" />
              <span className="font-serif text-lg font-semibold">{settings.churchName}</span>
            </Link>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 pb-28 pt-6 outline-none sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          {children}
        </main>
      </div>

      <MobileTabBar showAdmin={viewer.isAdmin} signOut={<SignOutButton />} />
    </div>
  );
}
