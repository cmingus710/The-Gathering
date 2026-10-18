import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { IconMark } from "@/components/brand/logo";
import { displayName, type Viewer } from "@/lib/auth/viewer";
import { adminNavFor } from "@/lib/navigation";
import type { ChurchSettings } from "@/lib/settings/queries";
import { AdminNav } from "./admin-nav";
import { SignOutButton } from "./sign-out-button";

export function AdminShell({ viewer, settings, children }: { viewer: Viewer; settings: ChurchSettings; children: ReactNode }) {
  const items = adminNavFor(viewer.capabilities);
  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex items-center gap-3 px-6 pb-2 pt-7">
          <IconMark src={settings.iconUrl} className="h-11" />
          <div>
            <p className="font-serif text-lg font-semibold leading-tight">{settings.churchName}</p>
            <p className="text-sm font-semibold uppercase tracking-wider text-text-secondary">Administration</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pt-6">
          <AdminNav items={items} variant="sidebar" />
        </div>
        <div className="space-y-1 border-t border-border px-3 py-4">
          <Link href="/home" className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 font-semibold hover:bg-surface-muted">
            <ArrowLeft className="size-5" aria-hidden="true" />
            Back to member app
          </Link>
          <p className="truncate px-3 py-1 text-sm text-text-secondary">
            Signed in as <span className="font-semibold text-text">{displayName(viewer)}</span>
          </p>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 pb-3 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3">
            <Link href="/admin" className="flex items-center gap-2.5">
              <IconMark src={settings.iconUrl} className="h-8" />
              <span className="font-serif text-lg font-semibold">Administration</span>
            </Link>
            <Link href="/home" className="flex min-h-11 items-center gap-1.5 rounded-control px-2 font-semibold text-primary hover:bg-primary-soft">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Member app
            </Link>
          </div>
          <AdminNav items={items} variant="tabs" />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6 outline-none sm:px-6 lg:px-10 lg:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
