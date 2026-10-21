import Link from "next/link";
import type { ReactNode } from "react";
import { IconMark } from "@/components/brand/logo";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemeControl } from "@/components/theme/theme-control";
import { displayName, type Viewer } from "@/lib/auth/viewer";
import type { ChurchSettings } from "@/lib/settings/queries";
import { getThemePreference } from "@/lib/theme/server";
import { YouthNav } from "./youth-nav";

/**
 * The app shell for independent youth accounts: the Youth area plus the
 * learning tools they may use (memory verses, Bible reading, journal). No
 * directory, messages, community, giving, prayer, or notifications: those
 * are adult-only and the database refuses youth accounts there anyway.
 */
export async function YouthShell({ viewer, settings, children }: { viewer: Viewer; settings: ChurchSettings; children: ReactNode }) {
  const theme = await getThemePreference();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-(--header-bg) pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
          <Link href="/youth" className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-full pr-2" aria-label={`${settings.churchName} Youth home`}>
            <span className="brand-halo flex size-11 shrink-0 items-center justify-center rounded-full">
              <IconMark src={settings.iconUrl} className="h-10 w-auto" />
            </span>
            <span aria-hidden="true" className="truncate font-display text-[1.25rem] font-semibold leading-none text-text">
              Youth
            </span>
          </Link>
          <p className="hidden min-w-0 truncate text-meta text-text-secondary sm:block">
            <span className="sr-only">Signed in as </span>
            {displayName(viewer)}
          </p>
        </div>
        <YouthNav />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 outline-none has-[>.layout-wide]:max-w-6xl sm:px-6 lg:pt-8">
        {children}
      </main>
      <footer className="mx-auto max-w-3xl space-y-3 border-t border-border px-4 py-6 sm:px-6">
        <ThemeControl current={theme} compact />
        <SignOutButton className="min-h-11 rounded-tile px-3 text-text-secondary hover:text-text" />
      </footer>
    </div>
  );
}
