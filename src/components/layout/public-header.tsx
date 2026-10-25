import Link from "next/link";
import { IconBadge } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";

export function PublicHeader({ churchName, iconUrl, signedIn }: { churchName: string; iconUrl: string; signedIn: boolean }) {
  return (
    <header className="bg-(--header-bg)">
      <div className="mx-auto flex min-h-16 max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <IconBadge src={iconUrl} />
          <span className="font-display text-lg font-semibold">{churchName}</span>
        </Link>
        {signedIn ? (
          <Link href="/home" className={buttonClasses("secondary", "sm")}>
            Open app
          </Link>
        ) : (
          <Link href="/sign-in" className={buttonClasses("secondary", "sm")}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
