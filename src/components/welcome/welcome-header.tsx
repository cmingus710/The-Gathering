import Link from "next/link";
import { IconMark } from "@/components/brand/logo";

/** Outlined button on ivory with a fine antique-gold border, used in the welcome header. */
export const welcomeOutlineButton =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-(--welcome-gold) px-5 font-display text-[1.0625rem] text-text " +
  "transition-colors hover:bg-text hover:border-text hover:text-background active:bg-cta-hover active:text-background sm:min-h-12 sm:px-8";

/**
 * Compact ivory header for the public pages: the approved mark beside the
 * church name (the mark has no lettering, so the name is never repeated).
 */
export function WelcomeHeader({ churchName, iconUrl, signedIn }: { churchName: string; iconUrl: string; signedIn: boolean }) {
  return (
    <header className="border-b border-(--welcome-rule) bg-(--header-bg)">
      <div className="mx-auto flex min-h-18 max-w-[100rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:min-h-22 sm:px-8 lg:px-20">
        <Link href="/" className="-mx-1 flex min-h-11 items-center gap-3 rounded-md px-1">
          <IconMark src={iconUrl} className="h-11 sm:h-16" />
          <span className="font-display text-[1.5rem] leading-tight font-semibold tracking-[-0.02em] text-text sm:text-[2.375rem]">{churchName}</span>
        </Link>
        <div className="flex items-center gap-6 sm:gap-10">
          <span className="hidden font-display text-[1.125rem] tracking-[0.04em] text-text sm:inline">Welcome</span>
          <Link href={signedIn ? "/home" : "/sign-in"} className={welcomeOutlineButton}>
            {signedIn ? "Open app" : "Sign in"}
          </Link>
        </div>
      </div>
    </header>
  );
}
