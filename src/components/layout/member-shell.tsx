import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { IconMark, LogoPlaque } from "@/components/brand/logo";
import { NotificationBell } from "@/components/community/notification-bell";
import { CommunityRealtimeProvider } from "@/components/community/realtime-provider";
import { ThemeControl } from "@/components/theme/theme-control";
import { ReturnViewRecorder } from "@/components/ui/back-link";
import { cn } from "@/components/ui/cn";
import type { UnreadCounts } from "@/lib/community/types";
import { getSupabasePublicConfig } from "@/lib/env";
import { displayName, type Viewer } from "@/lib/auth/viewer";
import type { ChurchSettings } from "@/lib/settings/queries";
import { getThemePreference } from "@/lib/theme/server";
import { AccountMenu } from "./account-menu";
import { MobileTabBar, SidebarNav } from "./member-nav";
import { SignOutButton } from "./sign-out-button";

/** Phone header: initial avatar opening Settings (profile, account, appearance, privacy, access). */
function Avatar({ viewer, className = "size-9 bg-surface-muted text-[1.0625rem] ring-border" }: { viewer: Viewer; className?: string }) {
  const initial = displayName(viewer).trim().charAt(0).toUpperCase() || "?";
  return (
    <Link
      href="/settings"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-text ring-1 transition-colors hover:ring-border-strong",
        className,
      )}
    >
      <span aria-hidden="true">{initial}</span>
      <span className="sr-only">Profile and settings</span>
    </Link>
  );
}

export async function MemberShell({
  viewer,
  settings,
  counts,
  children,
}: {
  viewer: Viewer;
  settings: ChurchSettings;
  counts: UnreadCounts;
  children: ReactNode;
}) {
  const supabase = getSupabasePublicConfig();
  const theme = await getThemePreference();
  return (
    <CommunityRealtimeProvider memberId={viewer.id} supabaseUrl={supabase?.url ?? null} supabaseKey={supabase?.publishableKey ?? null} initialCounts={counts}>
      <div className="min-h-dvh lg:flex">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Suspense fallback={null}>
          <ReturnViewRecorder />
        </Suspense>

        <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh">
          <Link href="/home" className="mx-4 mb-2 mt-5 flex justify-center rounded-card" aria-label={`${settings.churchName} home`}>
            <LogoPlaque src={settings.logoUrl} alt="" className="w-full px-4 py-3" logoClassName="w-[6.5rem]" />
          </Link>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <SidebarNav showAdmin={viewer.isAdmin} />
          </div>
          <div className="border-t border-border px-3 py-3">
            <AccountMenu
              name={displayName(viewer)}
              initial={displayName(viewer).trim().charAt(0).toUpperCase() || "?"}
              appearance={<ThemeControl current={theme} compact />}
              signOut={<SignOutButton className="min-h-11 rounded-tile px-3 text-text-secondary hover:text-text" />}
            />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header data-app-header className="sticky top-0 z-30 bg-(--header-bg) pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
            {/*
              The church name is never truncated: the wordmark scales with the
              viewport (full size from 400px up) and, only if it still can't
              fit (very large text), wraps onto a second line. With greatly
              enlarged text on a narrow phone, where the logo, bell, and avatar
              leave no room, it's left out (see .header-row in globals.css).
            */}
            <div className="header-row flex min-h-16 items-center justify-between gap-2 px-3 sm:px-5">
              <Link
                href="/home"
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full pr-1 min-[375px]:gap-2.5"
                aria-label={`${settings.churchName} home`}
              >
                <span className="brand-halo flex size-11 shrink-0 items-center justify-center rounded-full">
                  <IconMark src={settings.iconUrl} className="h-10 w-auto shrink-0" />
                </span>
                <span aria-hidden="true" className="header-wordmark min-w-0 font-display font-semibold text-text">
                  {settings.churchName}
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-1 min-[375px]:gap-1.5">
                <NotificationBell />
                <Avatar viewer={viewer} className="size-11 bg-surface-raised text-[1.125rem] ring-border-strong/50" />
              </div>
            </div>
          </header>
          {/* Desktop: the bell sits top right, above the page, with its panel anchored beneath it. */}
          <div data-app-header className="sticky top-0 z-30 hidden h-16 items-center justify-end bg-(--header-bg) px-6 backdrop-blur-md lg:flex">
            <NotificationBell />
          </div>
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-3xl flex-1 px-4 pb-(--dock-clearance) pt-3 outline-none has-[>.layout-wide]:max-w-6xl sm:px-6 lg:px-10 lg:pb-14 lg:pt-2"
          >
            {children}
          </main>
        </div>

        <MobileTabBar showAdmin={viewer.isAdmin} signOut={<SignOutButton className="rounded-tile px-3" />} appearance={<ThemeControl current={theme} />} />
      </div>
    </CommunityRealtimeProvider>
  );
}
