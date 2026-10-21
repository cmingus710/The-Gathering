import Link from "next/link";
import { IconMark } from "@/components/brand/logo";

/** Outlined charcoal button on ivory, used in the welcome header. */
export const welcomeOutlineButton =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-text/70 px-4 text-meta font-semibold text-text " +
  "transition-colors hover:border-text hover:bg-text hover:text-background active:bg-cta-hover active:text-background";

/**
 * Compact ivory header for the public pages: the approved mark beside the
 * church name (the mark has no lettering, so the name is never repeated).
 */
export function WelcomeHeader({ churchName, iconUrl, signedIn }: { churchName: string; iconUrl: string; signedIn: boolean }) {
  return (
    <header className="border-b border-(--welcome-rule) bg-(--header-bg)">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-8">
        <Link href="/" className="-mx-1 flex min-h-11 items-center gap-2.5 rounded-md px-1">
          <IconMark src={iconUrl} className="h-10 sm:h-11" />
          <span className="font-display text-[1.25rem] leading-tight font-semibold text-text sm:text-[1.375rem]">{churchName}</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="hidden font-display text-meta tracking-[0.14em] text-text-secondary uppercase sm:inline">Welcome</span>
          <span aria-hidden="true" className="hidden h-5 w-px bg-(--welcome-rule) sm:block" />
          <Link href={signedIn ? "/home" : "/sign-in"} className={welcomeOutlineButton}>
            {signedIn ? "Open app" : "Sign in"}
          </Link>
        </div>
      </div>
    </header>
  );
}
